// evaluate(): the rules that run after every change to a project (build plan 5.3, M9, M10, M12).
// It recalculates the plan, moves the set status when the plan moved, and keeps every inbox item
// for the project in step with its cause. It never decides a proposal (S18) and never stores a
// calculated status (P6).
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../db/conn";
import { kindRequestOf, loadBraidLog, loadPlanRows, loadProject, membersOf, persistKindRequest, persistSetStatus, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { braidEntryCauses, decidersFor, isOnLog, switchedTo, type BraidEntryRecord, type DecisionPolicy, type ProjectMember } from "../domain/machines/braid-entry";
import { applyKindRequestEvent, kindRequestCauses } from "../domain/machines/kind-request";
import { liveEntryOf } from "../domain/machines/kind-switch";
import { evaluateCause, LIVE, type InboxItemRef } from "../domain/machines/inbox-item";
import { applySetStatus, setStatusCause, type SetStatusRecord } from "../domain/machines/set-status";
import { calculatePlan } from "../domain/status/rules";
import type { Status } from "../domain/status/status";
import { audit, CommandRefused, expectOne, nextVersion, todayOf } from "./core";
import { notice, withArticle } from "./notices";

export type Evaluation = {
  calculated: Status | null;
  threads: Record<string, Status | null>;
  setStatus: SetStatusRecord;
  opened: { ownerId: string; causeKey: string }[];
  closed: { ownerId: string; causeKey: string; to: "acted" | "auto_closed" }[];
};

/** Who an inbox cause belongs to. Keys are "<cause>:<subject id>" (M10). */
/** D16: the project's own number of decision approvers; self approval comes from config (S12). */
export function policyOf(project: { decisionApprovers: number }): Partial<DecisionPolicy> {
  return { approversNeeded: project.decisionApprovers };
}

function ownersOf(
  causeKey: string,
  project: { ownerId: string; setBy: string | null },
  entry: BraidEntryRecord | undefined,
  members: readonly ProjectMember[],
  policy: Partial<DecisionPolicy> = {},
): string[] {
  const [cause] = causeKey.split(":");
  const leads = members.filter((m) => m.role === "pm" || m.role === "lead").map((m) => m.id);
  switch (cause) {
    case "status_set_with_no_reason":
    case "keep_set_status":
      return [project.setBy ?? project.ownerId];
    case "approve":
      return entry ? decidersFor(entry, members, policy) : [];
    case "no_decider": // E91: nobody can decide it, so the project owner is told
      return [project.ownerId];
    case "more_info":
      return entry?.reportedBy ? [entry.reportedBy] : [];
    case "blocker_new":
      return members.filter((m) => m.role === "pm").map((m) => m.id);
    case "clear": // S13: the owner of the blocked work, or a PM or Lead, confirms
      return [...new Set([...(entry?.ownerId ? [entry.ownerId] : []), ...leads])].filter((id) => id !== entry?.resolveProposedBy);
    case "dependency_due": // Section 20, U2: those who decide its outcome or give it a new date
    case "confirm_outcome": // Section 20, U3: a member said it ended; those who may end it decide (D7)
    case "follow_up": // D10: a PM or Lead confirms or drops what Atlas drafted
    case "kind_change": // M17: a PM or Lead switches or keeps what a member asked
      return leads;
    default:
      throw new Error(`unknown inbox cause ${causeKey}`);
  }
}

/**
 * Runs the rules for one project. `actorId` is the person whose command caused this run: an item of
 * theirs whose cause their own action removed closes as acted (M10), anyone else's as auto closed.
 */
export async function evaluateProject(tx: Tx, projectId: string, now: Date, opts: { actorId?: string } = {}): Promise<Evaluation> {
  const project = await loadProject(tx, projectId);
  if (!project) throw new CommandRefused(`no project ${projectId}`, "not_found");
  const [planRows, members, { log }, work] = await Promise.all([
    loadPlanRows(tx, projectId),
    membersOf(tx, projectId),
    loadBraidLog(tx, projectId),
    tx
      .select({ id: t.workItems.id, ownerId: t.workItems.ownerId, state: t.workItems.state, blockedLinks: t.workItems.blockedLinks, linkedChange: t.workItems.linkedChange })
      .from(t.workItems)
      .where(eq(t.workItems.projectId, projectId)),
  ]);
  const policy = policyOf(project);
  const plan = calculatePlan(planRows, todayOf(now));

  // M9: tell the set status the plan may have moved. "previous" is the plan the reason was given
  // against, so a reason goes stale exactly when the plan differs from then (no cached status needed).
  let record = setStatusRecordOf(project);
  if (record.override !== "calculated_only") {
    const r = applySetStatus(record, plan.project, { type: "CALCULATED_CHANGED", previous: record.reasonGivenAt ?? plan.project, next: plan.project });
    if (r.outcome.ok) {
      await persistSetStatus(tx, projectId, project.version, r.record, now);
      await audit(tx, now, {
        actorType: "rule",
        action: "CALCULATED_CHANGED",
        machine: "set_status",
        subjectType: "project",
        subjectId: projectId,
        fromState: r.outcome.from,
        toState: r.outcome.to,
        detail: { calculated: plan.project, setStatus: record.setStatus },
      });
      // The reason stays, marked "given when the plan said ..." until the owner keeps or changes it
      if (r.outcome.to === "reason_stale") {
        await tx.update(t.statusReasons).set({ staleSince: now }).where(and(eq(t.statusReasons.projectId, projectId), isNull(t.statusReasons.staleSince)));
      }
      record = r.record;
    }
  }

  // M10: the causes that hold now, and who owns each
  const desired = new Map<string, string[]>();
  const statusCause = setStatusCause(record);
  if (statusCause) desired.set(`${statusCause}:${projectId}`, ownersOf(`${statusCause}:${projectId}`, project, undefined, members));
  for (const entry of Object.values(log)) {
    for (const key of braidEntryCauses(entry, members, policy, todayOf(now))) desired.set(key, ownersOf(key, project, entry, members, policy));
    // E93: every work item the blocker held has moved on; its owners are asked, the blocker is never closed by the rule
    const held = work.filter((w) => w.blockedLinks.includes(entry.id));
    if (entry.kind === "blocker" && entry.state === "reported" && !entry.resolveProposedBy && held.length && held.every((w) => w.state !== "blocked")) {
      desired.set(`confirm_clear:${entry.id}`, [...new Set(held.map((w) => w.ownerId))].sort());
    }
  }

  // M5, A10.1 (D18): work marked Done with no PR or document linked; its owner links one
  for (const w of work) if (w.state === "done" && !w.linkedChange) desired.set(`done_no_change:${w.id}`, [w.ownerId]);

  // D32: work still Blocked whose blocker changed kind and is no blocker now; its owner unblocks it or links another
  for (const w of work) {
    if (w.state !== "blocked" || !w.blockedLinks.length) continue;
    const lost = w.blockedLinks.every((id) => {
      const e = log[id];
      if (!e || !switchedTo(e)) return false;
      const now_ = log[liveEntryOf(log, id)];
      return !(now_?.kind === "blocker" && isOnLog(now_));
    });
    if (lost) desired.set(`blocked_without_blocker:${w.id}`, [w.ownerId]);
  }

  // M17: a request waits on a PM or Lead while its entry can still change kind; otherwise it lapses and the asker is told
  const requests = await tx.select().from(t.braidKindRequests).where(and(eq(t.braidKindRequests.projectId, projectId), eq(t.braidKindRequests.state, "asked")));
  for (const row of requests) {
    const record = kindRequestOf(row);
    const entry = log[row.entryId];
    const lapse = entry ? applyKindRequestEvent(record, { type: "LAPSE" }, { entry, actor: null, today: todayOf(now) }) : null;
    if (lapse?.outcome.ok) {
      await persistKindRequest(tx, lapse.record, row.version, now);
      await audit(tx, now, { actorType: "rule", action: "LAPSE", machine: "kind_request", subjectType: "kind_request", subjectId: row.id, fromState: "asked", toState: "lapsed", detail: { projectId, entryId: row.entryId } });
      if (row.askedBy) {
        await notice(tx, now, [row.askedBy], `"${entry!.title}" can no longer change kind, so your request to make it ${withArticle(row.toKind)} is closed.`, {
          type: "kind_request",
          id: row.id,
          projectId,
          act: "lapsed",
        });
      }
      continue;
    }
    for (const key of kindRequestCauses(record)) desired.set(key, ownersOf(key, project, entry, members, policy));
  }

  // Every item ever made for this project's causes (the project itself, its BRAID entries, its work)
  const allRequests = await tx.select({ id: t.braidKindRequests.id }).from(t.braidKindRequests).where(eq(t.braidKindRequests.projectId, projectId));
  const subjects = new Set([projectId, ...Object.keys(log), ...work.map((w) => w.id), ...allRequests.map((r) => r.id)]);
  const items = (await tx.select().from(t.inboxItems)).filter((i) => subjects.has(i.causeKey.slice(i.causeKey.indexOf(":") + 1)));
  const { opened, closed } = await syncInbox(tx, now, items, desired, opts);

  return { calculated: plan.project, threads: plan.threads, setStatus: record, opened, closed };
}

type InboxRow = typeof t.inboxItems.$inferSelect;

/**
 * Keeps the inbox in step with a set of causes (M10). `items` are every item ever made for these
 * causes; `desired` is who each cause belongs to now. An item whose cause is gone closes as acted
 * when the owner's own action removed it, otherwise as auto closed.
 */
export async function syncInbox(
  tx: Tx,
  now: Date,
  items: readonly InboxRow[],
  desired: ReadonlyMap<string, readonly string[]>,
  opts: { actorId?: string } = {},
): Promise<{ opened: Evaluation["opened"]; closed: Evaluation["closed"] }> {
  const opened: Evaluation["opened"] = [];
  const closed: Evaluation["closed"] = [];
  const pairs = new Set<string>([...items.filter((i) => LIVE.includes(i.state)).map((i) => `${i.ownerId}|${i.causeKey}`)]);
  for (const [key, owners] of desired) for (const o of owners) pairs.add(`${o}|${key}`);

  for (const pair of pairs) {
    const [ownerId, causeKey] = pair.split("|");
    const theirs: InboxItemRef[] = items
      .filter((i) => i.ownerId === ownerId && i.causeKey === causeKey)
      .map((i) => ({ id: i.id, causeKey: i.causeKey, episode: i.episode, state: i.state }));
    const holds = desired.get(causeKey)?.includes(ownerId) ?? false;
    const plan = evaluateCause(causeKey, theirs, holds, { byOwnerAction: ownerId === opts.actorId });
    if (plan.create) {
      const id = `inbox-${ownerId}-${causeKey}-${plan.create.episode}`;
      await tx.insert(t.inboxItems).values({ id, ownerId, causeKey, episode: plan.create.episode, state: "open", createdAt: now });
      await audit(tx, now, { actorType: "rule", action: "INBOX_ITEM_CREATED", machine: "inbox_item", subjectType: "inbox_item", subjectId: id, toState: "open", detail: { ownerId, causeKey } });
      opened.push({ ownerId, causeKey });
    }
    for (const c of plan.close) {
      const row = items.find((i) => i.id === c.id)!;
      const rows = await tx
        .update(t.inboxItems)
        .set({ state: c.to, closedAt: now, version: nextVersion(t.inboxItems.version) })
        .where(and(eq(t.inboxItems.id, c.id), eq(t.inboxItems.version, row.version)))
        .returning({ id: t.inboxItems.id });
      expectOne(rows, `inbox item ${c.id}`);
      await audit(tx, now, { actorType: "rule", action: "CAUSE_GONE", machine: "inbox_item", subjectType: "inbox_item", subjectId: c.id, fromState: row.state, toState: c.to, detail: { ownerId, causeKey } });
      closed.push({ ownerId, causeKey, to: c.to });
    }
  }
  return { opened, closed };
}

/** Runs evaluate for several projects, each once, in a stable order. */
export async function evaluateProjects(tx: Tx, projectIds: Iterable<string>, now: Date, opts: { actorId?: string } = {}): Promise<Map<string, Evaluation>> {
  const out = new Map<string, Evaluation>();
  for (const id of [...new Set(projectIds)].sort()) out.set(id, await evaluateProject(tx, id, now, opts));
  return out;
}

/** Live inbox items for a set of cause keys, for commands that need to know what is open. */
export async function liveItems(tx: Tx, causeKeys: readonly string[]) {
  if (!causeKeys.length) return [];
  return (await tx.select().from(t.inboxItems).where(inArray(t.inboxItems.causeKey, [...causeKeys]))).filter((i) => LIVE.includes(i.state));
}
