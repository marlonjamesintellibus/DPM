// Phase K, M29: one project as the signal rules read it (domain/signals.ts), and the signals in one inbox
// item as the viewer may see them. Everything is read from the project the signal is on, and only for
// someone it is raised to now (rule 4, SG9), so every fact in a signal is one its reader may see (P10).
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { loadBraidLog, membersOf } from "../db/records";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { dateInZone, type IsoDate } from "../domain/dates";
import { LIVE_LEAVE } from "../domain/machines/leave";
import { signalKey, signalRecipients, type SignalMemory, type SignalRecord } from "../domain/machines/signal";
import { ownerCheckText, signalConditions, signalText, type SignalCondition, type SignalWorld } from "../domain/signals";
import { firstName, peopleById, projectReader, shortDate, todayIn } from "./project";

export type SignalRow = typeof t.signals.$inferSelect;
export type SignalMemoryRow = typeof t.signalMemory.$inferSelect;

export function signalOf(row: SignalRow): SignalRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    rule: row.rule,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    state: row.state,
    stage: row.stage,
    level: row.level,
    episode: row.episode,
    facts: row.facts,
    raisedOn: row.raisedOn,
    stageOn: row.stageOn,
    decidedBy: row.decidedBy,
    decidedOn: row.decidedOn,
    dismissReason: row.dismissReason,
    riskEntryId: row.riskEntryId,
    earlier: row.earlier,
  };
}

export function memoryOf(row: SignalMemoryRow): SignalMemory {
  return { episode: row.episode, level: row.level, answer: row.answer, by: row.by, on: row.on, reason: row.reason, seenGone: row.seenGone };
}

const dayOf = (at: Date) => dateInZone(at, config.timeZone);
const later = (a: IsoDate | undefined, b: IsoDate) => (a === undefined || b > a ? b : a);

/** The project on `today` as the rules read it, and who is on leave today (SG4). Null when there is no such project. */
export async function loadSignalWorld(conn: Conn, projectId: string, today: IsoDate): Promise<{ world: SignalWorld; away: ReadonlySet<string> } | null> {
  const [project] = await conn.select().from(t.projects).where(eq(t.projects.id, projectId));
  if (!project) return null;
  const [workItems, milestones, { log }, kindRequests, members] = await Promise.all([
    conn.select().from(t.workItems).where(eq(t.workItems.projectId, projectId)),
    conn.select().from(t.milestones).where(eq(t.milestones.projectId, projectId)),
    loadBraidLog(conn, projectId),
    conn.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.projectId, projectId)),
    membersOf(conn, projectId),
  ]);
  const memberIds = new Set(members.map((m) => m.id));
  const workIds = workItems.map((w) => w.id);
  const milestoneIds = milestones.map((m) => m.id);
  const entryIds = Object.keys(log);

  const [workAudit, milestoneAudit, entryAudit, undone, routed, sources] = await Promise.all([
    workIds.length ? conn.select({ subjectId: t.auditEntries.subjectId, at: t.auditEntries.at }).from(t.auditEntries).where(and(eq(t.auditEntries.subjectType, "work_item"), inArray(t.auditEntries.subjectId, workIds))) : [],
    milestoneIds.length
      ? conn
          .select({ subjectId: t.auditEntries.subjectId, detail: t.auditEntries.detail, captureId: t.auditEntries.captureId, id: t.auditEntries.id })
          .from(t.auditEntries)
          .where(and(eq(t.auditEntries.subjectType, "milestone"), eq(t.auditEntries.action, "FORECAST_CHANGED"), inArray(t.auditEntries.subjectId, milestoneIds)))
      : [],
    entryIds.length
      ? conn
          .select({ subjectId: t.auditEntries.subjectId, at: t.auditEntries.at, fromState: t.auditEntries.fromState, id: t.auditEntries.id })
          .from(t.auditEntries)
          .where(and(eq(t.auditEntries.subjectType, "braid_entry"), eq(t.auditEntries.toState, "reported"), inArray(t.auditEntries.subjectId, entryIds)))
      : [],
    conn.select({ captureId: t.undos.captureId }).from(t.undos).where(eq(t.undos.state, "undone")),
    // Saved updates with something filed in this project, and what each item was about
    conn
      .select({ authorId: t.captures.authorId, messageAt: t.captures.messageAt, draft: t.extractions.draft })
      .from(t.extractions)
      .innerJoin(t.captures, eq(t.captures.id, t.extractions.captureId))
      .where(and(eq(t.extractions.projectId, projectId), eq(t.captures.state, "saved"), isNull(t.extractions.withdrawn))),
    entryIds.length
      ? conn
          .select({ personId: t.braidSources.personId, at: t.braidSources.at, signalId: t.braidSources.signalId })
          .from(t.braidSources)
          .where(and(inArray(t.braidSources.entryId, entryIds), isNull(t.braidSources.withdrawnAt)))
      : [],
  ]);
  const undoneCaptures = new Set(undone.map((u) => u.captureId));

  // Stale work: the last change to the item (any move or word on it, "still going" too), the last saved update
  // that mentions it, or its start
  const lastActivity = new Map<string, IsoDate>();
  for (const w of workItems) if (w.startDate) lastActivity.set(w.id, w.startDate);
  for (const a of workAudit) lastActivity.set(a.subjectId, later(lastActivity.get(a.subjectId), dayOf(a.at)));
  for (const r of routed) {
    const target = r.draft.target;
    if (target?.type === "work_item" && workIds.includes(target.id)) lastActivity.set(target.id, later(lastActivity.get(target.id), dayOf(r.messageAt)));
  }

  // Slipping forecast: each move later, in the order it was made; a save that was undone took its move back
  const slips = new Map<string, IsoDate[]>();
  for (const a of [...milestoneAudit].sort((x, y) => x.id - y.id)) {
    if (a.captureId && undoneCaptures.has(a.captureId)) continue;
    const move = (a.detail as { forecast?: { from: IsoDate | null; to: IsoDate | null } } | null)?.forecast;
    if (!move?.from || !move.to || move.to <= move.from) continue;
    slips.set(a.subjectId, [...(slips.get(a.subjectId) ?? []), move.to]);
  }

  // Repeated blocker: when it last moved into reported (its first report, or a reopen after it was resolved)
  const reportedSince = new Map<string, { on: IsoDate; reopened: boolean }>();
  for (const e of Object.values(log)) {
    const moves = entryAudit.filter((a) => a.subjectId === e.id && a.fromState !== "reported").sort((x, y) => x.id - y.id);
    const last = moves.at(-1);
    if (last) reportedSince.set(e.id, { on: dayOf(last.at), reopened: last.fromState === "resolved" });
    else if (e.sources.length) reportedSince.set(e.id, { on: dayOf(new Date([...e.sources].sort((a, b) => a.at.localeCompare(b.at))[0].at)), reopened: false });
  }

  // Quiet project: the last update from someone who is a member now: a saved update filed here, or a report on
  // the log (an accepted signal is not an update). No update and no start date: nothing to count from
  let lastUpdateOn: IsoDate | undefined = project.startDate ?? undefined;
  for (const r of routed) if (memberIds.has(r.authorId)) lastUpdateOn = later(lastUpdateOn, dayOf(r.messageAt));
  for (const s of sources) if (memberIds.has(s.personId) && !s.signalId) lastUpdateOn = later(lastUpdateOn, dayOf(s.at));

  const people = await peopleById(conn, [
    ...memberIds,
    ...Object.values(log).flatMap((e) => [e.reportedBy, ...e.sources.map((s) => s.personId)]),
    ...kindRequests.map((r) => r.askedBy),
  ]);
  const leave = await conn.select({ personId: t.leave.personId, startDate: t.leave.startDate, endDate: t.leave.endDate, state: t.leave.state }).from(t.leave);
  const away = new Set(leave.filter((l) => LIVE_LEAVE.includes(l.state) && l.state !== "requested" && l.startDate <= today && today <= l.endDate).map((l) => l.personId));

  return {
    world: {
      projectId,
      projectName: project.name,
      paused: project.paused,
      startDate: project.startDate,
      today,
      workItems,
      milestones,
      log,
      kindRequests,
      lastActivity,
      slips,
      reportedSince,
      lastUpdateOn: lastUpdateOn ?? null,
      names: new Map([...people].map(([id, p]) => [id, firstName(p.name)])),
    },
    away,
  };
}

/** The conditions that hold in the project now, by signalKey. */
export async function conditionsNow(conn: Conn, projectId: string, today: IsoDate): Promise<Map<string, SignalCondition>> {
  const loaded = await loadSignalWorld(conn, projectId, today);
  if (!loaded) return new Map();
  return new Map(signalConditions(loaded.world).map((c) => [signalKey({ projectId, ...c }), c]));
}

export type SignalView = {
  id: string;
  version: number;
  rule: SignalRecord["rule"];
  stage: SignalRecord["stage"];
  /** The template over its facts, as they are now. */
  text: string;
  /** SG2: "Alicia dismissed this on 21 Oct: …" when it was dismissed before and came back worse. */
  earlier: string | null;
  /** Stale work with its owner: the item they say is still going. */
  workItemId: string | null;
  /** SG5: an open risk that already covers it; accepting adds the signal to it (M16 same as). */
  sameAs: { id: string; title: string } | null;
};

/** Risk states a signal can be added to: still waiting or on the log, not ended. */
const COVERING = ["proposed", "more_info", "open", "mitigating"];

/**
 * The raised signals of one inbox item (a project and a day, SG10) that are raised to the viewer now and still
 * hold when read (CONDITION_GONE is checked on read). A project the viewer cannot read gives nothing.
 */
export async function signalsFor(conn: Conn, viewerId: string, projectId: string, day: IsoDate, now: Date): Promise<SignalView[]> {
  const reader = await projectReader(conn, viewerId);
  if (!reader.mayRead(projectId)) return [];
  const rows = await conn
    .select()
    .from(t.signals)
    .where(and(eq(t.signals.projectId, projectId), eq(t.signals.state, "raised"), eq(t.signals.stageOn, day)));
  if (!rows.length) return [];
  const [members, { log }, [project], held] = await Promise.all([
    membersOf(conn, projectId),
    loadBraidLog(conn, projectId),
    conn.select({ decisionApprovers: t.projects.decisionApprovers }).from(t.projects).where(eq(t.projects.id, projectId)),
    conditionsNow(conn, projectId, todayIn(now)),
  ]);
  const mine = rows.filter((r) => signalRecipients(signalOf(r), members, log, { approversNeeded: project.decisionApprovers }).includes(viewerId) && held.has(signalKey(r)));
  if (!mine.length) return [];

  // SG5: a risk filed from an earlier signal on the same subject, or one linked to the blocker it is about
  const earlierSignals = await conn
    .select({ id: t.signals.id, rule: t.signals.rule, subjectId: t.signals.subjectId })
    .from(t.signals)
    .where(and(eq(t.signals.projectId, projectId), eq(t.signals.state, "accepted")));
  const signalSources = earlierSignals.length
    ? await conn
        .select({ entryId: t.braidSources.entryId, signalId: t.braidSources.signalId })
        .from(t.braidSources)
        .where(and(inArray(t.braidSources.signalId, earlierSignals.map((s) => s.id)), isNull(t.braidSources.withdrawnAt)))
    : [];
  const covering = (r: SignalRow) => {
    const before = new Set(earlierSignals.filter((s) => s.rule === r.rule && s.subjectId === r.subjectId).map((s) => s.id));
    const risks = Object.values(log).filter((e) => e.kind === "risk" && COVERING.includes(e.state));
    return (
      risks.find((e) => signalSources.some((s) => s.entryId === e.id && s.signalId && before.has(s.signalId))) ??
      (r.subjectType === "braid_entry" ? risks.find((e) => e.links.some((l) => l.entryId === r.subjectId)) : undefined)
    );
  };
  const people = await peopleById(conn, mine.map((r) => r.earlier?.by));

  return mine
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((r) => {
      const facts = held.get(signalKey(r))!.facts;
      const risk = covering(r);
      return {
        id: r.id,
        version: r.version,
        rule: r.rule,
        stage: r.stage,
        text: r.stage === "owner" && facts.rule === "stale_work" ? ownerCheckText(facts) : signalText(facts),
        earlier: r.earlier ? `${firstName(people.get(r.earlier.by)?.name ?? "Someone")} dismissed this on ${shortDate(r.earlier.on)}: "${r.earlier.reason}"` : null,
        workItemId: r.subjectType === "work_item" ? r.subjectId : null,
        sameAs: risk ? { id: risk.id, title: risk.title } : null,
      };
    });
}
