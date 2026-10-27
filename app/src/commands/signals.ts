// Phase K, M29. Signals (conversational plan, section 13): Atlas notices trouble nobody reported and raises
// it to the people who can act, through their inbox (M10). The rules themselves run in signal-rules.ts (from
// evaluate); here are the answers and the timers. A signal is never a BRAID entry by itself: a PM or Lead
// accepts it into a risk through M15's own REPORT (or M16's same-as, SG5), as themselves, with the right
// checked when it runs (rule 4), or dismisses it. The owner of stale work says it is still going (SG8).
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { loadBraidLog, membersOf, persistBraidLog } from "../db/records";
import * as t from "../db/schema";
import { applyToLog, draftEntry, type BraidEvent } from "../domain/machines/braid-entry";
import { applySignalEvent, LIVE_SIGNAL, signalKey, signalRecipients, type SignalEvent, type SignalRecord } from "../domain/machines/signal";
import { riskTitle } from "../domain/signals";
import { conditionsNow, signalOf, type SignalRow } from "../queries/signals";
import { audit, CommandRefused, moved, runCommand, StaleVersion, todayOf, type CommandCtx } from "./core";
import { evaluateProject, policyOf, type Evaluation } from "./evaluate";
import { persistSignal, rememberSignal, runSignalRules } from "./signal-rules";

/** The day the nightly run last ran (app_meta), so the minute timer runs it once a day. */
const NIGHTLY = "signals_nightly";

export type SignalCommandResult = { signal: SignalRecord; evaluation: Evaluation };
export type AcceptResult = SignalCommandResult & { entryId: string };

export type SignalAnswerOpts = {
  /** The signal's version when the person saw it; a newer one means it changed under them (SG6). */
  seenVersion?: number;
};

async function firstNameOf(tx: Tx, personId: string | null): Promise<string> {
  if (!personId) return "Someone";
  const [p] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, personId));
  return p?.name.split(" ")[0] ?? "Someone";
}

/**
 * The signal as it is now, for an answer. CONDITION_GONE is checked when it runs, so nobody files a risk
 * on trouble that went away since the card was shown. SG6: a signal someone already answered is refused,
 * and the person is told who answered it.
 */
async function loadForAnswer(tx: Tx, ctx: CommandCtx, signalId: string, opts: SignalAnswerOpts): Promise<SignalRow> {
  const [first] = await tx.select().from(t.signals).where(eq(t.signals.id, signalId));
  if (!first) throw new CommandRefused(`no signal ${signalId}`, "not_found");
  await runSignalRules(tx, first.projectId, ctx.now, { detect: false });
  const [row] = await tx.select().from(t.signals).where(eq(t.signals.id, signalId));
  switch (row.state) {
    case "raised":
      break;
    case "accepted":
      throw new CommandRefused(`${await firstNameOf(tx, row.decidedBy)} already accepted this as a risk`);
    case "dismissed":
    case "ended":
      throw new CommandRefused(`${await firstNameOf(tx, row.decidedBy)} already dismissed this`);
    case "cleared":
      throw new CommandRefused("what this noticed is no longer true, so there is nothing to answer");
    default:
      throw new CommandRefused("this signal is closed");
  }
  if (opts.seenVersion !== undefined && opts.seenVersion !== row.version) throw new StaleVersion(`signal ${signalId}`);
  return row;
}

/**
 * ACCEPT (a PM or Lead it is raised to, rule 4): a risk whose source is the signal's facts as they are now,
 * filed through M15 as the person accepting (their report lands on the log, E92). SG5: `sameAs` adds it to a
 * risk already open instead (M16), which the inbox suggests when one covers it. Once only: a signal is
 * accepted at most once, so it files at most one risk.
 */
export function acceptSignal(ctx: CommandCtx, signalId: string, opts: SignalAnswerOpts & { sameAs?: string | null } = {}): Promise<AcceptResult> {
  return runCommand(ctx, async (tx) => {
    const row = await loadForAnswer(tx, ctx, signalId, opts);
    const today = todayOf(ctx.now);
    const [members, { log, versions }, [project], held] = await Promise.all([
      membersOf(tx, row.projectId),
      loadBraidLog(tx, row.projectId),
      tx.select({ decisionApprovers: t.projects.decisionApprovers }).from(t.projects).where(eq(t.projects.id, row.projectId)),
      conditionsNow(tx, row.projectId, today),
    ]);
    const policy = policyOf(project);
    const actor = { id: ctx.actorId, role: members.find((m) => m.id === ctx.actorId)?.role ?? null };
    const record = signalOf(row);
    const facts = held.get(signalKey(row))?.facts ?? record.facts;
    const r = applySignalEvent(record, { type: "ACCEPT", facts }, { actor, recipients: signalRecipients(record, members, log, policy), today });
    const outcome = moved(r.outcome);

    // The risk, as the person accepting: its only source is this signal
    const source = { id: `src-${signalId}`, personId: ctx.actorId, captureId: null, span: null, at: ctx.now.toISOString() };
    const entryId = opts.sameAs ?? `br-${randomUUID().slice(0, 8)}`;
    const start = opts.sameAs ? log : { ...log, [entryId]: draftEntry({ id: entryId, projectId: row.projectId, kind: "risk", title: riskTitle(facts) }) };
    const event: BraidEvent = opts.sameAs ? { type: "ADD_SOURCE", projectId: row.projectId, kind: "risk", source } : { type: "REPORT", source };
    const filed = applyToLog(start, entryId, event, { actor, today, policy });
    if (!filed.outcome.ok && opts.sameAs) throw new CommandRefused(`it cannot be added to that risk: ${filed.outcome.reason}`);
    const entryMoved = moved(filed.outcome);
    await persistBraidLog(tx, log, filed.log, versions, ctx.now, { signalIdBySource: new Map([[source.id, signalId]]) });
    await audit(tx, ctx.now, {
      actorType: "person",
      actorId: ctx.actorId,
      action: entryMoved.event,
      machine: "braid_entry",
      subjectType: "braid_entry",
      subjectId: entryId,
      fromState: entryMoved.from,
      toState: entryMoved.to,
      detail: { projectId: row.projectId, role: actor.role, signalId, ...(opts.sameAs ? { sameAs: true } : {}) },
    });

    const accepted = { ...r.record, riskEntryId: entryId };
    await persistSignal(tx, ctx.now, row, accepted, outcome, { actorType: "person", actorId: ctx.actorId }, { riskEntryId: entryId });
    await rememberSignal(tx, ctx.now, accepted);
    const evaluation = await evaluateProject(tx, row.projectId, ctx.now, { actorId: ctx.actorId });
    return { signal: accepted, entryId, evaluation };
  });
}

/** DISMISS(reason), by a PM or Lead it is raised to. It is snoozed signalSnoozeDays, then raised again only if worse (SG2, SG3). */
export function dismissSignal(ctx: CommandCtx, signalId: string, reason: string, opts: SignalAnswerOpts = {}): Promise<SignalCommandResult> {
  return runCommand(ctx, async (tx) => {
    const row = await loadForAnswer(tx, ctx, signalId, opts);
    const today = todayOf(ctx.now);
    const [members, { log }, [project]] = await Promise.all([
      membersOf(tx, row.projectId),
      loadBraidLog(tx, row.projectId),
      tx.select({ decisionApprovers: t.projects.decisionApprovers }).from(t.projects).where(eq(t.projects.id, row.projectId)),
    ]);
    const actor = { id: ctx.actorId, role: members.find((m) => m.id === ctx.actorId)?.role ?? null };
    const record = signalOf(row);
    const r = applySignalEvent(record, { type: "DISMISS", reason }, { actor, recipients: signalRecipients(record, members, log, policyOf(project)), today });
    const outcome = moved(r.outcome);
    await persistSignal(tx, ctx.now, row, r.record, outcome, { actorType: "person", actorId: ctx.actorId }, { reason: r.record.dismissReason });
    await rememberSignal(tx, ctx.now, r.record);
    const evaluation = await evaluateProject(tx, row.projectId, ctx.now, { actorId: ctx.actorId });
    return { signal: r.record, evaluation };
  });
}

/**
 * SG8: the owner of work In progress says it is still going. Nothing about the item changes; its clock
 * restarts (the rule reads this as a change), so a stale work signal clears and never reaches the PM. Rule
 * 10: only the owner's word does this; anyone else saying it changes nothing of theirs.
 */
export function stillGoing(ctx: CommandCtx, workItemId: string): Promise<Evaluation> {
  return runCommand(ctx, async (tx) => {
    const [item] = await tx.select().from(t.workItems).where(eq(t.workItems.id, workItemId));
    if (!item) throw new CommandRefused(`no work item ${workItemId}`, "not_found");
    const members = await membersOf(tx, item.projectId);
    if (item.ownerId !== ctx.actorId || !members.some((m) => m.id === ctx.actorId)) {
      throw new CommandRefused(`only ${await firstNameOf(tx, item.ownerId)} says whether ${item.number ?? item.title} is still going`, "not_allowed");
    }
    if (item.state !== "in_progress") throw new CommandRefused(`${item.number ?? item.title} is not In progress`);
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "STILL_GOING", subjectType: "work_item", subjectId: item.id, detail: { projectId: item.projectId } });
    return evaluateProject(tx, item.projectId, ctx.now, { actorId: ctx.actorId });
  });
}

/** CD13: the PM marks a project paused (or between phases), so no quiet-project signal is raised; a raised one clears (SG7). */
export function setProjectPaused(ctx: CommandCtx, projectId: string, paused: boolean): Promise<Evaluation> {
  return runCommand(ctx, async (tx) => {
    const [project] = await tx.select({ paused: t.projects.paused }).from(t.projects).where(eq(t.projects.id, projectId));
    if (!project) throw new CommandRefused(`no project ${projectId}`, "not_found");
    const members = await membersOf(tx, projectId);
    if (members.find((m) => m.id === ctx.actorId)?.role !== "pm") throw new CommandRefused("only the project's PM marks it paused", "not_allowed");
    if (project.paused === paused) throw new CommandRefused(paused ? "it is already paused" : "it is not paused");
    await tx.update(t.projects).set({ paused, updatedAt: ctx.now }).where(eq(t.projects.id, projectId));
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: paused ? "PAUSE" : "RESUME", subjectType: "project", subjectId: projectId, detail: { paused } });
    return evaluateProject(tx, projectId, ctx.now, { actorId: ctx.actorId });
  });
}

/** The rules over one project, looking for new trouble too, as the nightly run and a saved update do. */
export function detectSignals(ctx: { db: Db; now: Date }, projectId: string): Promise<Evaluation> {
  return runCommand({ ...ctx, actorId: "rule" }, (tx) => evaluateProject(tx, projectId, ctx.now, { detectSignals: true }));
}

export type NightlyRun = { escalated: string[]; expired: string[]; ended: string[] } | null;

/**
 * The nightly run, once a day from the minute timer: for each project, a raised signal whose condition went
 * clears first; then M29's timers (a dismissal's snooze ends; stale work its owner did not answer goes to PM
 * and Leads, ownerAnswerDays; a signal with PM and Leads expires, signalExpiryDays, and is remembered); then
 * the rules look for new trouble. Null when it already ran today.
 */
export function runSignalTimers(ctx: { db: Db; now: Date }): Promise<NightlyRun> {
  const today = todayOf(ctx.now);
  return runCommand({ ...ctx, actorId: "rule" }, async (tx) => {
    const [mark] = await tx.select().from(t.appMeta).where(eq(t.appMeta.key, NIGHTLY));
    if (mark?.value === today) return null;
    const run = { escalated: [] as string[], expired: [] as string[], ended: [] as string[] };
    const projects = (await tx.select({ id: t.projects.id }).from(t.projects)).map((p) => p.id).sort();
    for (const projectId of projects) {
      await runSignalRules(tx, projectId, ctx.now, { detect: false });
      const live = await tx.select().from(t.signals).where(and(eq(t.signals.projectId, projectId), inArray(t.signals.state, [...LIVE_SIGNAL])));
      for (const row of live.sort((a, b) => a.id.localeCompare(b.id))) {
        const event: SignalEvent = row.state === "dismissed" ? { type: "SNOOZE_OVER" } : row.stage === "owner" ? { type: "ESCALATE" } : { type: "EXPIRE" };
        const r = applySignalEvent(signalOf(row), event, { actor: null, today });
        if (!r.outcome.ok) continue;
        await persistSignal(tx, ctx.now, row, r.record, r.outcome, { actorType: "rule" });
        await rememberSignal(tx, ctx.now, r.record);
        (event.type === "SNOOZE_OVER" ? run.ended : event.type === "ESCALATE" ? run.escalated : run.expired).push(row.id);
      }
      await evaluateProject(tx, projectId, ctx.now, { detectSignals: true });
    }
    await tx.insert(t.appMeta).values({ key: NIGHTLY, value: today, updatedAt: ctx.now }).onConflictDoUpdate({ target: t.appMeta.key, set: { value: today, updatedAt: ctx.now } });
    return run;
  });
}
