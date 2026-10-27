// Set status and reason commands (M9, M11; build plan 5.3 and 5.5). The set status is the only
// stored status (A4.3): each command moves it through the set status machine against the plan
// calculated now, audits the move and runs evaluate, which keeps the owner's inbox in step.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Conn, Tx } from "../db/conn";
import { loadBraidLog, loadPlanRows, loadProject, membersOf, persistSetStatus, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { dateInZone, daysBetween, type IsoDate } from "../domain/dates";
import type { Moved } from "../domain/machine";
import { isOnLog, type BraidEntryRecord } from "../domain/machines/braid-entry";
import { applySetStatus, type OverrideState, type SetStatusEvent, type SetStatusRecord } from "../domain/machines/set-status";
import { calculatePlan, milestoneStatus, workItemStatus } from "../domain/status/rules";
import { RANK, type Status } from "../domain/status/status";
import type { Drafter } from "../atlas/extractor";
import { wordReason } from "../atlas/reason";
import { standingOf } from "../queries/acting";
import { STATUS_LABEL } from "../queries/project";
import { audit, CommandRefused, moved, runCommand, StaleVersion, todayOf, type CommandCtx } from "./core";
import { evaluateProject, type Evaluation } from "./evaluate";

export type StatusCommandResult = { outcome: Moved<OverrideState>; record: SetStatusRecord; evaluation: Evaluation };

type ProjectRow = NonNullable<Awaited<ReturnType<typeof loadProject>>>;

// M9 guard: the project owner, or a PM or Lead of the project, with the role held now (rule 7).
// The plan is calculated for the command's own day, so a replayed story reads the plan of then.
async function loadAt(tx: Tx, ctx: CommandCtx, projectId: string) {
  const project = await loadProject(tx, projectId);
  if (!project) throw new CommandRefused(`no project ${projectId}`, "not_found");
  const role = (await membersOf(tx, projectId)).find((m) => m.id === ctx.actorId)?.role;
  if (project.ownerId !== ctx.actorId && role !== "pm" && role !== "lead") {
    throw new CommandRefused("only the project owner, or a PM or Lead of the project, sets its status", "not_allowed");
  }
  const plan = calculatePlan(await loadPlanRows(tx, projectId), todayOf(ctx.now));
  return { project, calculated: plan.project };
}

async function move(
  tx: Tx,
  ctx: CommandCtx,
  project: ProjectRow,
  calculated: Status | null,
  event: SetStatusEvent,
  detail: Record<string, unknown> = {},
  /** Phase B, M20: the chat message the act came from. */
  captureId: string | null = null,
): Promise<StatusCommandResult> {
  const before = setStatusRecordOf(project);
  const r = applySetStatus(before, calculated, event);
  const outcome = moved(r.outcome);
  await persistSetStatus(tx, project.id, project.version, r.record, ctx.now, event.type === "OWNER_SETS" ? ctx.actorId : undefined);
  await audit(tx, ctx.now, {
    actorType: "person",
    actorId: ctx.actorId,
    action: event.type,
    machine: "set_status",
    subjectType: "project",
    subjectId: project.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId,
    detail: { calculated, setStatus: r.record.setStatus, previousSetStatus: before.setStatus, ...detail },
  });
  const evaluation = await evaluateProject(tx, project.id, ctx.now, { actorId: ctx.actorId });
  return { outcome, record: evaluation.setStatus, evaluation };
}

/** The owner sets a status by hand. Refused when the work is Done, the status cannot be set, it matches the plan, or it is already set (E43, E44). */
export function setStatus(ctx: CommandCtx, projectId: string, status: Status): Promise<StatusCommandResult> {
  return runCommand(ctx, async (tx) => {
    const { project, calculated } = await loadAt(tx, ctx, projectId);
    return move(tx, ctx, project, calculated, { type: "OWNER_SETS", status });
  });
}

/** "Use At risk instead": setting the calculated status clears the set status. */
export function useCalculated(ctx: CommandCtx, projectId: string): Promise<StatusCommandResult> {
  return runCommand(ctx, async (tx) => {
    const { project, calculated } = await loadAt(tx, ctx, projectId);
    if (calculated === null) throw new CommandRefused("the plan has no status yet");
    return move(tx, ctx, project, calculated, { type: "OWNER_SETS", status: calculated });
  });
}

/** "Keep Off track": the owner keeps a set status whose reason went stale; the reason now counts against today's plan. */
export function keepSetStatus(ctx: CommandCtx, projectId: string): Promise<StatusCommandResult> {
  return runCommand(ctx, async (tx) => {
    const { project, calculated } = await loadAt(tx, ctx, projectId);
    const result = await move(tx, ctx, project, calculated, { type: "KEEP" });
    // The reason counts against today's plan again
    await tx.update(t.statusReasons).set({ staleSince: null }).where(eq(t.statusReasons.projectId, projectId));
    return result;
  });
}

export type ReasonInput = { text: string; entryIds: readonly string[]; draftedByAtlas: boolean; edited: boolean };

/**
 * Saves the reason for a set status. Every linked entry must be on this project's log; a proposed,
 * declined or withdrawn one cannot explain a status (M9). The reason item closes because evaluate
 * finds the reason, not because this command closes it (M10).
 */
export function saveReason(ctx: CommandCtx, projectId: string, input: ReasonInput): Promise<StatusCommandResult & { reasonId: string }> {
  return runCommand(ctx, (tx) => saveReasonIn(tx, ctx, projectId, input));
}

/**
 * saveReason inside a transaction already open: the chat's Give a reason runs it in its own (phase B, M20),
 * against the project's version the answer showed, as every other act from the chat does (AC3).
 */
export async function saveReasonIn(
  tx: Tx,
  ctx: CommandCtx,
  projectId: string,
  input: ReasonInput,
  opts: { captureId?: string; seenVersion?: number } = {},
): Promise<StatusCommandResult & { reasonId: string }> {
  const text = input.text.trim();
  if (!text) throw new CommandRefused("write the reason first");
  const { project, calculated } = await loadAt(tx, ctx, projectId);
  if (opts.seenVersion !== undefined && project.version !== opts.seenVersion) throw new StaleVersion(`project ${projectId}`);
  const { log } = await loadBraidLog(tx, projectId);
  const entryIds = [...new Set(input.entryIds)];
  for (const id of entryIds) {
    const entry = log[id];
    if (!entry) throw new CommandRefused(`entry ${id} is not on this project's BRAID log`);
    if (!isOnLog(entry)) throw new CommandRefused(`"${entry.title}" is ${entry.state}, not on the log; approve it before linking it`);
  }
  if (!entryIds.length) throw new CommandRefused("link at least one BRAID entry on the log, or add one to the log first");

  // The reason is stored before evaluate runs, so the rules see it in the same transaction
  const reasonId = `reason-${projectId}-${randomUUID()}`;
  await tx.insert(t.statusReasons).values({
    id: reasonId,
    projectId,
    text,
    draftedByAtlas: input.draftedByAtlas,
    edited: input.edited,
    savedBy: ctx.actorId,
    savedAt: ctx.now,
  });
  await tx.insert(t.statusReasonLinks).values(entryIds.map((braidEntryId) => ({ reasonId, braidEntryId })));
  const result = await move(tx, ctx, project, calculated, { type: "GIVE_REASON", linksOnLog: entryIds.length }, {
    reasonId,
    links: entryIds,
    draftedByAtlas: input.draftedByAtlas,
    edited: input.edited,
  }, opts.captureId ?? null);
  return { ...result, reasonId };
}

// ---- Reason draft (M11) ----

export type ReasonDraft = {
  text: string;
  entryIds: string[];
  /** Who wrote it. Rules for now; Atlas from phase 4. The screen labels it a draft either way. */
  by: "rules" | "atlas";
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: IsoDate) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

const MAX_ENTRIES = 4;
const MAX_ITEMS = 2;

/**
 * A plain draft from what the owner can already see on the project: BRAID entries on the log and
 * the worst work items and milestones. It never reads leave, captures or care data (M11). An empty
 * draft means "write it yourself" (E47).
 */
export async function draftReason(conn: Conn, projectId: string, now: Date): Promise<ReasonDraft> {
  const today = todayOf(now);
  const [{ log }, milestones, workItems] = await Promise.all([
    loadBraidLog(conn, projectId),
    conn.select().from(t.milestones).where(eq(t.milestones.projectId, projectId)),
    conn.select().from(t.workItems).where(eq(t.workItems.projectId, projectId)),
  ]);
  const onLog = Object.values(log).filter(isOnLog);

  const order = ["blocker", "issue", "risk"] as const;
  const byNewest = (a: BraidEntryRecord, b: BraidEntryRecord) => (b.decidedOn ?? "").localeCompare(a.decidedOn ?? "") || a.title.localeCompare(b.title);
  const entries = order.flatMap((kind) => onLog.filter((e) => e.kind === kind).sort(byNewest)).slice(0, MAX_ENTRIES);

  const sentences: string[] = [];
  const covered = new Set<string>();
  for (const e of entries) {
    if (e.kind === "blocker") {
      // Links stay after work moves on (E93), so only work still blocked counts here
      const blocked = workItems.filter((w) => w.blockedLinks.includes(e.id) && w.state === "blocked" && w.number);
      blocked.forEach((w) => covered.add(w.id));
      const first = e.sources.map((s) => dateInZone(new Date(s.at), config.timeZone)).sort()[0] ?? today;
      const n = Math.max(0, daysBetween(first, today));
      const refs = blocked.length ? ` (${blocked.map((w) => w.number).join(", ")})` : "";
      sentences.push(`${e.title} has been blocked ${n ? `for ${days(n)}` : "since today"}${refs}.`);
    } else {
      sentences.push(`${e.kind === "issue" ? "Open issue" : "Risk"}: ${e.title}.`);
    }
  }

  const worstItems = [
    ...milestones.map((m) => ({ status: milestoneStatus(m), text: milestoneLine(m), id: m.id })),
    ...workItems.filter((w) => !covered.has(w.id)).map((w) => ({ status: workItemStatus(w, today), text: workItemLine(w, today), id: w.id })),
  ]
    .filter((i): i is { status: Status; text: string; id: string } => (i.status === "at_risk" || i.status === "off_track") && i.text !== null)
    .sort((a, b) => RANK[b.status] - RANK[a.status])
    .slice(0, MAX_ITEMS);
  // Worst items go after blockers: the blocker usually explains them
  const blockers = entries.filter((e) => e.kind === "blocker").length;
  sentences.splice(blockers, 0, ...worstItems.map((i) => i.text));

  return { text: sentences.join(" "), entryIds: entries.map((e) => e.id), by: "rules" };
}

function milestoneLine(m: { name: string; state: string; targetDate: IsoDate; forecastDate: IsoDate | null }): string {
  if (m.state === "missed") return `${m.name} missed its target of ${short(m.targetDate)}.`;
  const forecast = m.forecastDate ?? m.targetDate;
  return `${m.name} is forecast for ${short(forecast)}, ${days(daysBetween(m.targetDate, forecast))} after its target.`;
}

function workItemLine(w: { number: string | null; title: string; state: string; dueDate: IsoDate | null }, today: IsoDate): string | null {
  const name = w.number ? `${w.number} ${w.title}` : w.title;
  if (w.dueDate && daysBetween(w.dueDate, today) > 0) return `${name} is past its due date of ${short(w.dueDate)}.`;
  if (w.state === "blocked") return `${name} is blocked.`;
  return null;
}

/**
 * The rules draft, reworded by Atlas when it is connected (phase 4). Atlas sees only the facts in
 * the rules draft, never the project's records, captures or leave; if its wording adds anything,
 * the rules draft is returned unchanged. An empty rules draft stays empty (E47).
 */
export async function draftReasonWithAtlas(conn: Conn, projectId: string, now: Date, drafter: Drafter | null): Promise<ReasonDraft & { fallback?: string }> {
  const draft = await draftReason(conn, projectId, now);
  if (!drafter || !draft.text) return draft;
  const [project] = await conn.select({ name: t.projects.name, setStatus: t.projects.setStatus }).from(t.projects).where(eq(t.projects.id, projectId));
  if (!project?.setStatus) return draft;
  const worded = await wordReason(drafter, { projectName: project.name, status: STATUS_LABEL[project.setStatus], facts: draft.text });
  return worded.by === "atlas" ? { ...draft, text: worded.text, by: "atlas" } : { ...draft, fallback: worded.fallback };
}

/**
 * draftReasonWithAtlas for a viewer: only someone who may give the project's reason now gets a draft (M9,
 * rule 4). Anyone else gets an empty one, so a project they cannot read is never named (P10), whichever
 * screen asks with a project id: the inbox's editor or the chat's Give a reason (phase B).
 */
export async function draftReasonFor(conn: Conn, viewerId: string, projectId: string, now: Date, drafter: Drafter | null): Promise<ReasonDraft & { fallback?: string }> {
  const { right } = await standingOf(conn, viewerId, { act: "give_reason", subject: { type: "project", id: projectId, projectId }, proposal: null });
  if (!right) return { text: "", entryIds: [], by: "rules" };
  return draftReasonWithAtlas(conn, projectId, now, drafter);
}

/** M5, A10.1 (D18): the owner links the PR or document that finished their work; the error item closes. */
export function linkChange(ctx: CommandCtx, workItemId: string, url: string): Promise<void> {
  return runCommand(ctx, async (tx) => {
    const link = url.trim();
    if (!/^https?:\/\/\S+$/.test(link)) throw new CommandRefused("paste the link to the PR or document");
    const [row] = await tx.select().from(t.workItems).where(eq(t.workItems.id, workItemId));
    if (!row) throw new CommandRefused(`no work item ${workItemId}`, "not_found");
    const members = await membersOf(tx, row.projectId);
    const role = members.find((m) => m.id === ctx.actorId)?.role;
    if (row.ownerId !== ctx.actorId && role !== "pm" && role !== "lead") throw new CommandRefused("only the owner, a PM or a Lead links a change", "not_allowed");
    await tx.update(t.workItems).set({ linkedChange: link, updatedAt: ctx.now }).where(eq(t.workItems.id, workItemId));
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "LINK_CHANGE", subjectType: "work_item", subjectId: workItemId, detail: { link } });
    await evaluateProject(tx, row.projectId, ctx.now, { actorId: ctx.actorId });
  });
}
