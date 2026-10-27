// BRAID commands (M15, M16; build plan 5.4): the authority side of the two confirmations. Each one
// reads the actor's project role from current membership when it runs (rule 7), moves one entry
// through its machine, audits every entry it changed and runs evaluate, which keeps the approval,
// more info, new blocker and "it's cleared" items in step. Nothing here decides a proposal by itself.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { kindRequestOf, loadBraidLog, membersOf, persistBraidLog, persistKindRequest, type Versions } from "../db/records";
import * as t from "../db/schema";
import type { Moved } from "../domain/machine";
import {
  applyToLog,
  braidReminderDue,
  draftEntry,
  decidersFor,
  isOnLog,
  type BraidActor,
  type BraidCtx,
  type BraidEntryRecord,
  type BraidEntryState,
  type BraidEvent,
  type BraidLog,
  type DecisionPolicy,
  type ProjectMember,
  type ResolveOutcome,
} from "../domain/machines/braid-entry";
import { applyKindRequestEvent, draftKindRequest, type KindRequestRecord } from "../domain/machines/kind-request";
import { liveEntryOf, switchKind } from "../domain/machines/kind-switch";
import { linkConflict, mergeEntries, unmergeEntry, type LogResult, type MergeChoice } from "../domain/machines/match";
import { mayResolve, type BraidKind } from "../domain/rights";
import { audit, CommandRefused, moved, nextVersion, runCommand, StaleVersion, todayOf, type CommandCtx } from "./core";
import { evaluateProject, policyOf, type Evaluation } from "./evaluate";
import { notice, noticeReporters, withArticle } from "./notices";

export type BraidCommandResult = { outcome: Moved<BraidEntryState>; entry: BraidEntryRecord; evaluation: Evaluation };

export type BraidCommandOpts = {
  /** The entry's version when the person saw it. A newer one means someone acted first: StaleVersion, never a second answer. */
  seenVersion?: number;
  /** Overrides the project's decision policy (S11, S12); by default it is the project's own setting (D16). */
  policy?: Partial<DecisionPolicy>;
};

export type DecideAct = { type: "approve"; note?: string } | { type: "decline"; reason: string } | { type: "request_info"; question: string };

type Loaded = {
  projectId: string;
  policy: Partial<DecisionPolicy>;
  log: BraidLog;
  versions: Versions;
  entry: BraidEntryRecord;
  members: ProjectMember[];
  actor: BraidActor;
};

async function loadEntry(tx: Tx, ctx: CommandCtx, entryId: string, opts: BraidCommandOpts = {}): Promise<Loaded> {
  const [row] = await tx.select({ projectId: t.braidEntries.projectId }).from(t.braidEntries).where(eq(t.braidEntries.id, entryId));
  if (!row) throw new CommandRefused(`no BRAID entry ${entryId}`, "not_found");
  const [{ log, versions }, members, [project]] = await Promise.all([
    loadBraidLog(tx, row.projectId),
    membersOf(tx, row.projectId),
    tx.select({ decisionApprovers: t.projects.decisionApprovers }).from(t.projects).where(eq(t.projects.id, row.projectId)),
  ]);
  if (opts.seenVersion !== undefined && versions.get(entryId) !== opts.seenVersion) throw new StaleVersion(`BRAID entry ${entryId}`);
  const entry = log[entryId];
  const role = members.find((m) => m.id === ctx.actorId)?.role ?? null;
  return {
    projectId: row.projectId,
    policy: { ...policyOf(project), ...opts.policy },
    log,
    versions,
    entry,
    members,
    actor: { id: ctx.actorId, role, ownsBlockedWork: await ownsBlockedWork(tx, entry, ctx.actorId) },
  };
}

// S13: the owner of the blocked work is the blocker's owner, or whoever owns a work item it blocks
export async function ownsBlockedWork(tx: Tx, entry: BraidEntryRecord, personId: string): Promise<boolean> {
  if (entry.kind !== "blocker") return false;
  if (entry.ownerId === personId) return true;
  const items = await tx
    .select({ blockedLinks: t.workItems.blockedLinks })
    .from(t.workItems)
    .where(and(eq(t.workItems.projectId, entry.projectId), eq(t.workItems.ownerId, personId)));
  return items.some((w) => w.blockedLinks.includes(entry.id));
}

function braidCtx(ctx: CommandCtx, actor: BraidActor | null, policy: Partial<DecisionPolicy> = {}): BraidCtx {
  return { actor, today: todayOf(ctx.now), policy };
}

/**
 * Writes the new log, audits the person's move on the entry and anything that followed on other
 * entries (a superseded decision, sources moved by a merge), then runs evaluate as the actor.
 */
async function commit(
  tx: Tx,
  ctx: CommandCtx,
  loaded: Loaded,
  next: BraidLog,
  outcome: Moved<BraidEntryState>,
  detail: Record<string, unknown> = {},
  /** Other entries the person moved as part of the act (a switch makes or reopens one), by the action to audit. */
  alsoMoved: ReadonlyMap<string, string> = new Map(),
): Promise<BraidCommandResult> {
  const id = loaded.entry.id;
  const changed = await persistBraidLog(tx, loaded.log, next, loaded.versions, ctx.now);
  await audit(tx, ctx.now, {
    actorType: "person",
    actorId: ctx.actorId,
    action: outcome.event,
    machine: "braid_entry",
    subjectType: "braid_entry",
    subjectId: id,
    fromState: outcome.from,
    toState: outcome.to,
    detail: { projectId: loaded.projectId, role: loaded.actor.role, ...detail },
  });
  for (const other of changed.filter((c) => c !== id)) {
    const from = loaded.log[other]?.state ?? null;
    const to = next[other].state;
    // A state change on another entry is the rule's doing (SUPERSEDE), unless the person's act made it; anything else is part of the act
    const byPerson = alsoMoved.has(other) || from === to;
    await audit(tx, ctx.now, {
      actorType: byPerson ? "person" : "rule",
      actorId: byPerson ? ctx.actorId : null,
      action: alsoMoved.get(other) ?? (from !== to && to === "superseded" ? "SUPERSEDE" : outcome.event),
      machine: "braid_entry",
      subjectType: "braid_entry",
      subjectId: other,
      fromState: from,
      toState: to,
      detail: { projectId: loaded.projectId, via: id },
    });
  }
  const evaluation = await evaluateProject(tx, loaded.projectId, ctx.now, { actorId: ctx.actorId });
  return { outcome, entry: next[id], evaluation };
}

/** One person's event on one entry, through applyToLog. */
function act(ctx: CommandCtx, entryId: string, event: BraidEvent, opts: BraidCommandOpts = {}, detail: Record<string, unknown> = {}) {
  return runCommand(ctx, async (tx) => {
    const loaded = await loadEntry(tx, ctx, entryId, opts);
    const r = applyToLog(loaded.log, entryId, event, braidCtx(ctx, loaded.actor, loaded.policy));
    return commit(tx, ctx, loaded, r.log, moved(r.outcome), detail);
  });
}

/**
 * A PM or Lead (a decider for a decision) approves, declines with a reason, or asks for more.
 * Approving a decision supersedes an approved decision linked to it as conflicting (E87); a pending
 * one is left for a person (E88). The reporter learns of it from the entry and its audit trail.
 */
export function decideBraidEntry(ctx: CommandCtx, entryId: string, decision: DecideAct, opts: BraidCommandOpts = {}): Promise<BraidCommandResult> {
  const event: BraidEvent =
    decision.type === "approve"
      ? { type: "APPROVE", note: decision.note }
      : decision.type === "decline"
        ? { type: "DECLINE", reason: decision.reason }
        : { type: "REQUEST_INFO", question: decision.question };
  return runCommand(ctx, async (tx) => {
    const loaded = await loadEntry(tx, ctx, entryId, opts);
    const r = applyToLog(loaded.log, entryId, event, braidCtx(ctx, loaded.actor, loaded.policy));
    const outcome = moved(r.outcome);
    const answer = r.log[entryId].answers.at(-1);
    const result = await commit(tx, ctx, loaded, r.log, outcome, {
      note: answer?.note ?? null,
      round: answer?.round,
      selfApproved: r.log[entryId].selfApproved,
    });
    // D15: the reporters hear once it is decided; one approval of two decides nothing yet
    if (decision.type === "approve" && outcome.to !== "proposed") await noticeReporters(tx, ctx.now, r.log[entryId], ctx.actorId, { act: "approved", note: decision.note });
    if (decision.type === "decline") await noticeReporters(tx, ctx.now, r.log[entryId], ctx.actorId, { act: "declined", reason: decision.reason });
    return result;
  });
}

/** The reporter answers a request for more information; the entry goes back to the deciders. */
export function replyToRequest(ctx: CommandCtx, entryId: string, answer: string, opts: BraidCommandOpts = {}): Promise<BraidCommandResult> {
  if (!answer.trim()) return Promise.reject(new CommandRefused("write your answer first"));
  return act(ctx, entryId, { type: "REPLY", answer }, opts);
}

/** The reporter takes an entry back before anyone decided or added to it. */
export function withdrawEntry(ctx: CommandCtx, entryId: string, opts: BraidCommandOpts = {}): Promise<BraidCommandResult> {
  return act(ctx, entryId, { type: "WITHDRAW" }, opts);
}

/**
 * Resolves an entry when the actor may (S13). For a blocker, anyone else saying it is cleared makes a
 * proposal to the owner of the blocked work and the PM or Lead, who confirm it by resolving (E93).
 */
export function resolveBraidEntry(ctx: CommandCtx, entryId: string, outcome?: ResolveOutcome, opts: BraidCommandOpts = {}): Promise<BraidCommandResult> {
  return runCommand(ctx, async (tx) => {
    const loaded = await loadEntry(tx, ctx, entryId, opts);
    const { entry, actor } = loaded;
    const isOwner = entry.kind === "blocker" ? (actor.ownsBlockedWork ?? false) : entry.ownerId === actor.id;
    const may = actor.role !== null && mayResolve({ role: actor.role, isOwner }, entry.kind);
    const proposeInstead = !may && (entry.kind === "blocker" || entry.kind === "issue");
    const event: BraidEvent = proposeInstead ? { type: "PROPOSE_RESOLVE" } : { type: "RESOLVE", outcome };
    const r = applyToLog(loaded.log, entryId, event, braidCtx(ctx, actor, loaded.policy));
    const result = moved(r.outcome);
    let next = r.log;
    // D10: what follows is drafted for a PM or Lead to confirm in one step, never put on the log by the rule
    const follow = followUpOf(next[entryId]);
    if (follow && event.type === "RESOLVE") {
      const id = `${entryId}-raised`;
      if (!next[id]) {
        const draft = { ...draftEntry({ id, projectId: loaded.projectId, kind: follow, title: entry.title }), links: [{ relation: "raised_from" as const, entryId }] };
        next = { ...next, [id]: draft, [entryId]: { ...next[entryId], links: [...next[entryId].links, { relation: "related" as const, entryId: id }] } };
      }
    }
    const committed = await commit(tx, ctx, loaded, next, result, event.type === "RESOLVE" ? { outcome: outcome ?? null } : {});
    if (event.type === "RESOLVE") await noticeReporters(tx, ctx.now, next[entryId], ctx.actorId, { act: "resolved" });
    return committed;
  });
}

/** The owner of the blocked work, or a PM or Lead, says a proposed clearing is wrong; the blocker stays. */
export function keepOpen(ctx: CommandCtx, entryId: string, opts: BraidCommandOpts = {}): Promise<BraidCommandResult> {
  return act(ctx, entryId, { type: "KEEP_OPEN" }, opts);
}

/** The PM has seen the "New blocker" item. */
export function acknowledgeBlocker(ctx: CommandCtx, entryId: string, opts: BraidCommandOpts = {}): Promise<BraidCommandResult> {
  return act(ctx, entryId, { type: "ACKNOWLEDGE" }, opts);
}

/** A risk starts mitigating, or a dependency starts waiting (resolve right, G6). */
export function progressEntry(ctx: CommandCtx, entryId: string, opts: BraidCommandOpts = {}): Promise<BraidCommandResult> {
  return act(ctx, entryId, { type: "PROGRESS" }, opts);
}

function logCommand(ctx: CommandCtx, entryId: string, run: (loaded: Loaded, c: BraidCtx) => LogResult, detail: (loaded: Loaded) => Record<string, unknown>) {
  return runCommand(ctx, async (tx) => {
    const loaded = await loadEntry(tx, ctx, entryId);
    const r = run(loaded, braidCtx(ctx, loaded.actor, loaded.policy));
    return commit(tx, ctx, loaded, r.log, moved(r.outcome), detail(loaded));
  });
}

/**
 * A PM merges a duplicate into another entry of the same kind and project; its sources move across
 * (M16, E86). D9: an open duplicate into a resolved entry needs a choice: reopen it, or keep it resolved.
 */
export function mergeBraidEntries(ctx: CommandCtx, fromId: string, intoId: string, choice?: MergeChoice): Promise<BraidCommandResult> {
  return logCommand(
    ctx,
    fromId,
    ({ log }, c) => mergeEntries(log, fromId, intoId, c, choice),
    ({ entry }) => ({ into: intoId, sources: entry.sources.map((s) => s.id), ...(choice ? { choice } : {}) }),
  );
}

/**
 * D17: a PM, Lead or member reports an entry straight onto the project's log, for instance while
 * writing a reason. It lands where the reporter's right puts it (landsAs): on the log for a PM or
 * Lead, a proposal otherwise.
 */
export function reportBraidEntry(ctx: CommandCtx, projectId: string, input: { kind: BraidKind; title: string }): Promise<BraidCommandResult> {
  return runCommand(ctx, async (tx) => {
    const title = input.title.trim();
    if (!title) throw new CommandRefused("give the entry a title");
    const [{ log, versions }, members, [project]] = await Promise.all([
      loadBraidLog(tx, projectId),
      membersOf(tx, projectId),
      tx.select({ decisionApprovers: t.projects.decisionApprovers }).from(t.projects).where(eq(t.projects.id, projectId)),
    ]);
    if (!project) throw new CommandRefused(`no project ${projectId}`, "not_found");
    const role = members.find((m) => m.id === ctx.actorId)?.role ?? null;
    const id = `br-${randomUUID().slice(0, 8)}`;
    const start = { ...log, [id]: draftEntry({ id, projectId, kind: input.kind, title }) };
    const source = { id: `src-${id}`, personId: ctx.actorId, captureId: null, span: null, at: ctx.now.toISOString() };
    const loaded: Loaded = { projectId, policy: policyOf(project), log: start, versions, entry: start[id], members, actor: { id: ctx.actorId, role } };
    const r = applyToLog(start, id, { type: "REPORT", source }, braidCtx(ctx, loaded.actor, loaded.policy));
    return commit(tx, ctx, { ...loaded, log }, r.log, moved(r.outcome), { reportedDirectly: true });
  });
}

/** D10: a risk realised becomes an issue; an assumption broken or a dependency late raises a risk. */
function followUpOf(entry: BraidEntryRecord): BraidKind | null {
  if (entry.kind === "risk" && entry.state === "realised") return "issue";
  if ((entry.kind === "assumption" && entry.state === "broken") || (entry.kind === "dependency" && entry.state === "late")) return "risk";
  return null;
}

/** D10: a PM or Lead confirms the follow up Atlas drafted, as it is or with a better title. It lands where their right puts it. */
export function confirmFollowUp(ctx: CommandCtx, draftId: string, title?: string): Promise<BraidCommandResult> {
  return runCommand(ctx, async (tx) => {
    const loaded = await loadEntry(tx, ctx, draftId);
    const draft = loaded.entry;
    if (draft.state !== "none" || !draft.links.some((l) => l.relation === "raised_from")) throw new CommandRefused("not a drafted follow up");
    if (loaded.actor.role !== "pm" && loaded.actor.role !== "lead") throw new CommandRefused("a PM or Lead confirms a drafted follow up", "not_allowed");
    const named = title?.trim() ? { ...draft, title: title.trim() } : draft;
    const source = { id: `src-${draftId}-${ctx.actorId}`, personId: ctx.actorId, captureId: null, span: null, at: ctx.now.toISOString() };
    const r = applyToLog({ ...loaded.log, [draftId]: named }, draftId, { type: "REPORT", source }, braidCtx(ctx, loaded.actor, loaded.policy));
    return commit(tx, ctx, loaded, r.log, moved(r.outcome), { followUp: true });
  });
}

/** D10: the PM or Lead drops the draft; the entry it came from stays as it is. */
export function dropFollowUp(ctx: CommandCtx, draftId: string): Promise<BraidCommandResult> {
  return act(ctx, draftId, { type: "WITHDRAW" });
}

/** D16: the PM sets how many approvals a decision needs on their project (1 or 2, S11). Decisions already approved stay. */
export function setDecisionApprovers(ctx: CommandCtx, projectId: string, approvers: 1 | 2): Promise<void> {
  return runCommand(ctx, async (tx) => {
    const members = await membersOf(tx, projectId);
    if (members.find((m) => m.id === ctx.actorId)?.role !== "pm") throw new CommandRefused("only the project's PM sets how many approve a decision", "not_allowed");
    if (approvers !== 1 && approvers !== 2) throw new CommandRefused("a decision needs 1 or 2 approvers");
    const [before] = await tx.select({ n: t.projects.decisionApprovers }).from(t.projects).where(eq(t.projects.id, projectId));
    await tx.update(t.projects).set({ decisionApprovers: approvers, updatedAt: ctx.now }).where(eq(t.projects.id, projectId));
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "SET_DECISION_APPROVERS", subjectType: "project", subjectId: projectId, detail: { from: before.n, to: approvers } });
    await evaluateProject(tx, projectId, ctx.now, { actorId: ctx.actorId });
  });
}

/** A PM undoes a merge, latest first; the entry gets back exactly the sources it had. */
export function unmergeBraidEntry(ctx: CommandCtx, entryId: string): Promise<BraidCommandResult> {
  return logCommand(
    ctx,
    entryId,
    ({ log }, c) => unmergeEntry(log, entryId, c),
    ({ entry }) => ({ from: entry.mergedInto, sources: entry.mergedSources.map((s) => s.id) }),
  );
}

/**
 * Flags two decisions as possibly conflicting, both ways. It decides nothing: the approver sees both,
 * and only approving one supersedes the other, if that one was approved (E87, E88). Any member may flag.
 */
export function linkConflictingDecisions(ctx: CommandCtx, a: string, b: string): Promise<{ log: BraidLog; evaluation: Evaluation }> {
  return runCommand(ctx, async (tx) => {
    const loaded = await loadEntry(tx, ctx, a);
    if (!loaded.actor.role) throw new CommandRefused("only a project member can flag a conflict", "not_allowed");
    const r = linkConflict(loaded.log, a, b);
    if (!r.ok) throw new CommandRefused(r.reason);
    const changed = await persistBraidLog(tx, loaded.log, r.log, loaded.versions, ctx.now);
    for (const id of changed) {
      await audit(tx, ctx.now, {
        actorType: "person",
        actorId: ctx.actorId,
        action: "LINK_CONFLICT",
        machine: "braid_entry",
        subjectType: "braid_entry",
        subjectId: id,
        detail: { projectId: loaded.projectId, with: id === a ? b : a },
      });
    }
    const evaluation = await evaluateProject(tx, loaded.projectId, ctx.now, { actorId: ctx.actorId });
    return { log: r.log, evaluation };
  });
}

export type Reminder = { entryId: string; projectId: string; deciders: string[] };

/**
 * The S18 timer: one REMIND for every proposed entry that is due (2 working days, then weekly). A
 * reminder only counts and tells the deciders; it never approves or declines anything (E98).
 */
export function runBraidReminders(ctx: { db: Db; now: Date }): Promise<Reminder[]> {
  const today = todayOf(ctx.now);
  return ctx.db.transaction(async (tx) => {
    const projectIds = (await tx.selectDistinct({ projectId: t.braidEntries.projectId }).from(t.braidEntries).where(eq(t.braidEntries.state, "proposed"))).map(
      (r) => r.projectId,
    );
    const reminders: Reminder[] = [];
    for (const projectId of projectIds.sort()) {
      const [{ log, versions }, members, [project]] = await Promise.all([
        loadBraidLog(tx, projectId),
        membersOf(tx, projectId),
        tx.select({ decisionApprovers: t.projects.decisionApprovers }).from(t.projects).where(eq(t.projects.id, projectId)),
      ]);
      let next = log;
      const due = Object.values(log).filter((e) => braidReminderDue(e, today));
      for (const entry of due) {
        const r = applyToLog(next, entry.id, { type: "REMIND" }, { actor: null, today });
        if (!r.outcome.ok) continue;
        next = r.log;
        const deciders = decidersFor(next[entry.id], members, policyOf(project));
        reminders.push({ entryId: entry.id, projectId, deciders });
        await audit(tx, ctx.now, {
          actorType: "rule",
          action: "REMIND",
          machine: "braid_entry",
          subjectType: "braid_entry",
          subjectId: entry.id,
          fromState: r.outcome.from,
          toState: r.outcome.to,
          detail: { projectId, deciders, remindersSent: next[entry.id].remindersSent },
        });
      }
      if (!due.length) continue;
      await persistBraidLog(tx, log, next, versions, ctx.now);
      await evaluateProject(tx, projectId, ctx.now);
    }
    return reminders;
  });
}

// ---- Changing an entry's kind (machines doc, section 13) ----

export type SwitchKindResult = BraidCommandResult & { targetId: string };

/**
 * The switch itself, once the person's right to make it is settled: the old entry ends, the entry it
 * becomes takes the reports, and what pointed at the old one follows: blocked work while the chain
 * ends on a blocker (D32), saved reasons (BK11), and a request asking for exactly this kind.
 */
async function switchOnLog(tx: Tx, ctx: CommandCtx, loaded: Loaded, to: BraidKind, why: string, detail: Record<string, unknown> = {}): Promise<SwitchKindResult> {
  const entryId = loaded.entry.id;
  const newId = `br-${randomUUID().slice(0, 8)}`;
  const r = switchKind(loaded.log, entryId, to, why, braidCtx(ctx, loaded.actor, loaded.policy), newId);
  const outcome = moved(r.outcome);
  const targetId = r.targetId!;

  // A request asking for this very kind is met by the switch; any other one lapses when evaluate runs
  const waiting = await tx.select().from(t.braidKindRequests).where(and(eq(t.braidKindRequests.entryId, entryId), eq(t.braidKindRequests.state, "asked")));
  for (const row of waiting.filter((q) => q.toKind === to)) {
    const met = applyKindRequestEvent(kindRequestOf(row), { type: "SWITCH" }, { entry: loaded.entry, actor: loaded.actor, today: todayOf(ctx.now) });
    if (!met.outcome.ok) continue;
    await persistKindRequest(tx, met.record, row.version, ctx.now);
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "SWITCH", machine: "kind_request", subjectType: "kind_request", subjectId: row.id, fromState: "asked", toState: "switched", detail: { entryId, targetId } });
    if (row.askedBy && row.askedBy !== ctx.actorId) {
      await notice(tx, ctx.now, [row.askedBy], `${await firstNameOf(tx, ctx.actorId)} made "${loaded.entry.title}" ${withArticle(to)}, as you asked.`, { type: "kind_request", id: row.id, projectId: loaded.projectId, act: "switched" });
    }
  }

  const committed = await commit(tx, ctx, loaded, r.log, outcome, { to, why: why.trim(), targetId, ...detail }, new Map([[targetId, targetId === newId ? "SWITCH_IN" : "RESTORE"]]));

  // D32: work blocked by this entry follows the chain only while it ends on a blocker; otherwise it keeps its link and evaluate asks its owner
  const work = await tx.select().from(t.workItems).where(eq(t.workItems.projectId, loaded.projectId));
  for (const w of work) {
    const links = w.blockedLinks.map((id) => {
      const live = liveEntryOf(r.log, id);
      return live !== id && r.log[live]?.kind === "blocker" && isOnLog(r.log[live]) ? live : id;
    });
    if (links.join() === w.blockedLinks.join()) continue;
    await tx.update(t.workItems).set({ blockedLinks: [...new Set(links)], version: nextVersion(t.workItems.version), updatedAt: ctx.now }).where(eq(t.workItems.id, w.id));
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "BLOCKED_LINK_MOVED", machine: "work_item", subjectType: "work_item", subjectId: w.id, detail: { from: entryId, to: targetId } });
  }

  // BK11: a saved reason keeps pointing at a live entry
  const reasonLinks = await tx.select().from(t.statusReasonLinks).where(eq(t.statusReasonLinks.braidEntryId, entryId));
  for (const link of reasonLinks) {
    await tx.delete(t.statusReasonLinks).where(and(eq(t.statusReasonLinks.reasonId, link.reasonId), eq(t.statusReasonLinks.braidEntryId, entryId)));
    await tx.insert(t.statusReasonLinks).values({ reasonId: link.reasonId, braidEntryId: targetId }).onConflictDoNothing();
  }

  await noticeReporters(tx, ctx.now, r.log[targetId], ctx.actorId, { act: "switched", from: loaded.entry.kind, why: why.trim() });
  // The work's owner hears now, not on the next run: evaluate already ran inside commit, before the links were settled
  const evaluation = await evaluateProject(tx, loaded.projectId, ctx.now, { actorId: ctx.actorId });
  return { ...committed, evaluation, entry: r.log[entryId], targetId };
}

async function firstNameOf(tx: Tx, personId: string): Promise<string> {
  const [p] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, personId));
  return p?.name.split(" ")[0] ?? "Someone";
}

/**
 * A PM or Lead changes an entry's kind and says why (section 13, SWITCH_KIND). Rights are read when it
 * runs (rule 7, BK5); a newer version than the one seen is StaleVersion (BK6).
 */
export function switchEntryKind(ctx: CommandCtx, entryId: string, to: BraidKind, why: string, opts: BraidCommandOpts = {}): Promise<SwitchKindResult> {
  return runCommand(ctx, async (tx) => switchOnLog(tx, ctx, await loadEntry(tx, ctx, entryId, opts), to, why));
}

export type KindRequestCommandResult = { request: KindRequestRecord; evaluation: Evaluation; targetId?: string };

/** M17: a member asks a PM or Lead to change an entry's kind (D31: any member). One request waits per entry (BK16). */
export function askKindChange(ctx: CommandCtx, entryId: string, to: BraidKind, why: string): Promise<KindRequestCommandResult> {
  return runCommand(ctx, async (tx) => {
    const loaded = await loadEntry(tx, ctx, entryId);
    const [open] = await tx.select().from(t.braidKindRequests).where(and(eq(t.braidKindRequests.entryId, entryId), eq(t.braidKindRequests.state, "asked")));
    const draft = draftKindRequest({ id: `kr-${randomUUID().slice(0, 8)}`, projectId: loaded.projectId, entryId, toKind: to });
    const r = applyKindRequestEvent(draft, { type: "ASK", why }, { entry: loaded.entry, actor: loaded.actor, openRequest: !!open, today: todayOf(ctx.now) });
    if (!r.outcome.ok && open && r.outcome.reason === "a change is already asked for this entry") {
      throw new CommandRefused(`${open.askedBy ? await firstNameOf(tx, open.askedBy) : "Someone"} already asked to make this ${withArticle(open.toKind)}`);
    }
    moved(r.outcome);
    await persistKindRequest(tx, r.record, null, ctx.now);
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "ASK", machine: "kind_request", subjectType: "kind_request", subjectId: r.record.id, fromState: "none", toState: "asked", detail: { projectId: loaded.projectId, entryId, to, why: r.record.why } });
    const evaluation = await evaluateProject(tx, loaded.projectId, ctx.now, { actorId: ctx.actorId });
    return { request: r.record, evaluation };
  });
}

export type KindAnswer = { type: "switch" } | { type: "keep"; reason: string };

/** M17: a PM or Lead switches the entry to the asked kind, or keeps it with a reason. The asker is told either way. */
export function answerKindChange(ctx: CommandCtx, requestId: string, answer: KindAnswer, opts: { seenVersion?: number } = {}): Promise<KindRequestCommandResult> {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.id, requestId));
    if (!row) throw new CommandRefused(`no kind change request ${requestId}`, "not_found");
    if (opts.seenVersion !== undefined && opts.seenVersion !== row.version) throw new StaleVersion(`kind change request ${requestId}`);
    const loaded = await loadEntry(tx, ctx, row.entryId);
    const event = answer.type === "switch" ? ({ type: "SWITCH" } as const) : ({ type: "KEEP", reason: answer.reason } as const);
    const r = applyKindRequestEvent(kindRequestOf(row), event, { entry: loaded.entry, actor: loaded.actor, today: todayOf(ctx.now) });
    moved(r.outcome);
    await persistKindRequest(tx, r.record, row.version, ctx.now);
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: event.type, machine: "kind_request", subjectType: "kind_request", subjectId: row.id, fromState: "asked", toState: r.record.state, detail: { projectId: loaded.projectId, entryId: row.entryId, ...(answer.type === "keep" ? { reason: r.record.keepReason } : {}) } });
    const who = await firstNameOf(tx, ctx.actorId);
    const tell = (text: string, act: string) => (row.askedBy ? notice(tx, ctx.now, [row.askedBy], text, { type: "kind_request", id: row.id, projectId: loaded.projectId, act }) : Promise.resolve());
    if (answer.type === "keep") {
      await tell(`${who} kept "${loaded.entry.title}" as ${withArticle(loaded.entry.kind)}. Reason: ${r.record.keepReason}`, "kept");
      const evaluation = await evaluateProject(tx, loaded.projectId, ctx.now, { actorId: ctx.actorId });
      return { request: r.record, evaluation };
    }
    const switched = await switchOnLog(tx, ctx, loaded, row.toKind, row.why, { request: row.id, askedBy: row.askedBy });
    await tell(`${who} made "${loaded.entry.title}" ${withArticle(row.toKind)}, as you asked.`, "switched");
    return { request: r.record, evaluation: switched.evaluation, targetId: switched.targetId };
  });
}

/** M17: the person who asked takes it back. */
export function withdrawKindChange(ctx: CommandCtx, requestId: string): Promise<KindRequestCommandResult> {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.id, requestId));
    if (!row) throw new CommandRefused(`no kind change request ${requestId}`, "not_found");
    const loaded = await loadEntry(tx, ctx, row.entryId);
    const r = applyKindRequestEvent(kindRequestOf(row), { type: "WITHDRAW" }, { entry: loaded.entry, actor: loaded.actor, today: todayOf(ctx.now) });
    moved(r.outcome);
    await persistKindRequest(tx, r.record, row.version, ctx.now);
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "WITHDRAW", machine: "kind_request", subjectType: "kind_request", subjectId: row.id, fromState: "asked", toState: "withdrawn", detail: { projectId: loaded.projectId, entryId: row.entryId } });
    const evaluation = await evaluateProject(tx, loaded.projectId, ctx.now, { actorId: ctx.actorId });
    return { request: r.record, evaluation };
  });
}

/** S18 for kind change requests: a REMIND for each waiting request that is due. It never decides. */
export function runKindRequestReminders(ctx: { db: Db; now: Date }): Promise<{ requestId: string; projectId: string }[]> {
  const today = todayOf(ctx.now);
  return ctx.db.transaction(async (tx) => {
    const rows = await tx.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.state, "asked"));
    const sent: { requestId: string; projectId: string }[] = [];
    const logs = new Map<string, BraidLog>();
    for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
      if (!logs.has(row.projectId)) logs.set(row.projectId, (await loadBraidLog(tx, row.projectId)).log);
      const entry = logs.get(row.projectId)![row.entryId];
      if (!entry) continue;
      const r = applyKindRequestEvent(kindRequestOf(row), { type: "REMIND" }, { entry, actor: null, today });
      if (!r.outcome.ok) continue;
      await persistKindRequest(tx, r.record, row.version, ctx.now);
      await audit(tx, ctx.now, { actorType: "rule", action: "REMIND", machine: "kind_request", subjectType: "kind_request", subjectId: row.id, fromState: "asked", toState: "asked", detail: { projectId: row.projectId, remindersSent: r.record.remindersSent } });
      sent.push({ requestId: row.id, projectId: row.projectId });
    }
    return sent;
  });
}
