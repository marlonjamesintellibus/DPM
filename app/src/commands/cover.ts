// M35 commands (conversational plan, phase P): Atlas offers a cover after a leave is saved with something due while
// away; the person picks a teammate and the items to ask (LV8); the teammate accepts, declines, or declines one item
// of several; an accepted cover proposes a handover (M7) with no PM OK, and the PM is told (CD19); the leave's own
// moves reach every request (LV3, LV4, LV9, and the model's declineCancels); the minute timer ends an ask nobody
// answered in config.coverAskHours, lapses an offer once the leave starts, and withdraws, telling nobody, an ask
// whose person or teammate left the project (leaveProjectWithdraws). Every move runs the machine
// (domain/machines/cover-request.ts), checked now (rule 4), and writes an audit entry. Atlas cannot speak first yet
// (phase F): the ask reaches the teammate as an inbox item plus a notice in their DPM chat.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { coverOf, leaveRecordOf, loadWorld, orgTagsOf, persistCover } from "../db/records";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { daysBetween } from "../domain/dates";
import { firstDayBack, type AwayRange } from "../domain/away";
import type { Moved } from "../domain/machine";
import {
  applyCoverEvent,
  coverCauses,
  itemKey,
  LIVE_HANDOVER,
  offerCover,
  takenBy,
  type CoverCtx,
  type CoverEvent,
  type CoverItem,
  type CoverRecord,
  type CoverState,
} from "../domain/machines/cover-request";
import { applyHandover, type HandoverRecord } from "../domain/machines/handover";
import { DECIDED_LEAVE, LIVE_LEAVE } from "../domain/machines/leave";
import { isCandidate } from "../domain/machines/membership";
import { awayDuring } from "../queries/people";
import { awayFor, awayLabel, itemsSaid } from "../queries/cover";
import { rangeLabel } from "../queries/leave";
import { firstName, todayIn } from "../queries/project";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, type CommandCtx } from "./core";
import { syncInbox } from "./evaluate";
import { notice } from "./notices";

type Row = typeof t.coverRequests.$inferSelect;
type By = { actorType: "person" | "rule" | "atlas"; actorId: string | null };
const RULE: By = { actorType: "rule", actorId: null };
const person = (id: string): By => ({ actorType: "person", actorId: id });

/** The leave as it is now: live, decided by an admin, started; its dates are the ones asked for (a change waiting, D6). */
async function leaveFacts(tx: Tx, leaveId: string, now: Date) {
  const [row] = await tx.select().from(t.leave).where(eq(t.leave.id, leaveId));
  if (!row) return null;
  const l = leaveRecordOf(row);
  const range: AwayRange = l.change ?? { start: l.start, end: l.end };
  return { row, range, live: LIVE_LEAVE.includes(l.state), approved: DECIDED_LEAVE.includes(l.state), started: daysBetween(range.start, todayIn(now)) >= 0 };
}

/**
 * What the machine reads now (rule 4): the leave, what the person has due while away on projects they read now,
 * what another of their requests holds (oneCoverPerItem), whether the teammate reads each item and is shown away then
 * (LV2), and whether the person still reads every item.
 */
async function ctxFor(tx: Tx, now: Date, r: CoverRecord, actorId: string | null, pick?: { toId: string; items: readonly CoverItem[] }): Promise<CoverCtx> {
  const leave = await leaveFacts(tx, r.leaveId, now);
  const range = leave?.range ?? null;
  const due = range ? (await awayFor(tx, r.askerId, range, now)).things.map((x) => x.key) : [];
  const theirs = (await tx.select().from(t.coverRequests).where(eq(t.coverRequests.askerId, r.askerId))).map(coverOf);
  const world = await loadWorld(tx);
  const readerOf = async (id: string) => {
    const tags = await orgTagsOf(tx, id);
    return (projectId: string) => isCandidate(id, tags, projectId, world);
  };
  const toId = pick?.toId ?? r.toId;
  const items = pick?.items ?? r.items;
  const teammate = toId ? await readerOf(toId) : null;
  const asker = await readerOf(r.askerId);
  const projects = [...new Set(items.map((i) => i.projectId))];
  const away = toId && range ? await awayDuring(tx, r.askerId, [toId], projects, range) : new Map();
  return {
    actorId,
    now,
    leaveLive: !!leave?.live,
    leaveApproved: !!leave?.approved,
    leaveStarted: !!leave?.started,
    due,
    taken: takenBy(theirs, r.id),
    teammateReads: teammate ? items.filter((i) => teammate(i.projectId)).map(itemKey) : [],
    teammateAway: !!toId && away.has(toId),
    askerReads: items.every((i) => asker(i.projectId)),
  };
}

/** M10: an asked request is an inbox item for the teammate alone; their own answer closes it as acted. */
async function syncItems(tx: Tx, now: Date, r: CoverRecord, byTeammate: boolean): Promise<void> {
  const key = `cover_ask:${r.id}`;
  const items = await tx.select().from(t.inboxItems).where(eq(t.inboxItems.causeKey, key));
  const desired = new Map(coverCauses(r).map((k) => [k, [r.toId!]]));
  await syncInbox(tx, now, items, desired, byTeammate && r.toId ? { actorId: r.toId } : {});
}

type Step = Moved<CoverState> | { event: "OFFER"; from: null; to: CoverState };

/** Writes one move: the record, its audit entry, and the teammate's inbox. */
async function write(tx: Tx, now: Date, row: Row | null, r: CoverRecord, m: Step, by: By, detail: Record<string, unknown> = {}, commands: { askCommandId?: string; answerCommandId?: string } = {}) {
  await persistCover(tx, r, row?.version ?? null, now, commands);
  await audit(tx, now, {
    ...by,
    action: m.event,
    machine: "cover_request",
    subjectType: "cover_request",
    subjectId: r.id,
    fromState: m.from,
    toState: m.to,
    detail: { leaveId: r.leaveId, toId: r.toId, items: r.items.map(itemKey), handover: r.handover, ...(r.endedWhy ? { endedWhy: r.endedWhy } : {}), ...detail },
  });
  await syncItems(tx, now, r, by.actorId !== null && by.actorId === r.toId);
}

const reread = async (tx: Tx, id: string) => (await tx.select().from(t.coverRequests).where(eq(t.coverRequests.id, id)))[0];

/** First names by id, for what people are told. */
async function firstNames(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
  const rows = ids.length ? await tx.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, [...new Set(ids)])) : [];
  return new Map(rows.map((p) => [p.id, firstName(p.name)]));
}

/** The items' labels as their project shows them: "#152 Store feed connector", "Trend model". */
async function labelsOf(tx: Tx, items: readonly CoverItem[]): Promise<{ key: string; label: string }[]> {
  const out: { key: string; label: string }[] = [];
  for (const i of items) {
    if (i.type === "work_item") {
      const [w] = await tx.select({ number: t.workItems.number, title: t.workItems.title }).from(t.workItems).where(eq(t.workItems.id, i.id));
      if (w) out.push({ key: itemKey(i), label: `${w.number ? `${w.number} ` : ""}${w.title}` });
    } else {
      const [m] = await tx.select({ name: t.milestones.name }).from(t.milestones).where(eq(t.milestones.id, i.id));
      if (m) out.push({ key: itemKey(i), label: m.name });
    }
  }
  return out;
}

// ---- Atlas's offer (the model's AtlasOffers) ----

/**
 * After a leave is saved, and whenever an ask ends with something still free: one offer per leave at a time, while
 * the leave is live and has not started, and only when something due then is not asked or covered (LV1: nothing due,
 * nothing offered). Atlas makes it; nothing on a project changes (rule 1).
 */
export async function offerIn(tx: Tx, now: Date, leaveId: string, captureId: string | null): Promise<CoverRecord | null> {
  const leave = await leaveFacts(tx, leaveId, now);
  if (!leave || !leave.live || leave.started) return null;
  const askerId = leave.row.personId;
  const ofLeave = await tx.select().from(t.coverRequests).where(eq(t.coverRequests.leaveId, leaveId));
  if (ofLeave.some((r) => r.state === "suggested")) return null;
  const taken = takenBy((await tx.select().from(t.coverRequests).where(eq(t.coverRequests.askerId, askerId))).map(coverOf));
  const { things } = await awayFor(tx, askerId, leave.range, now);
  if (!things.some((x) => !taken.includes(x.key))) return null;
  const record = offerCover({ id: `cv-${leaveId}-${ofLeave.length + 1}`, leaveId, askerId, captureId });
  await write(tx, now, null, record, { event: "OFFER", from: null, to: "suggested" }, { actorType: "atlas", actorId: null });
  return record;
}

// ---- The person going on leave ----

// The machine's reasons, as the person is told them
const PICK_REFUSED: Record<string, (name: string) => string> = {
  "they are away then": (name) => `${name} is away then, so I won't ask them. Pick someone else.`,
  "I can't ask them about that": () => "I can't ask them about that. Pick someone on the project.",
  "pick someone else": () => "You can't cover your own work. Pick someone else.",
  "someone is already asked, or covers it": () => "Someone is already asked about that, or covers it.",
  "your leave has started": () => "Your leave has started, so it's too late to ask from here.",
  "the leave is off": () => "That leave is no longer on.",
};

/**
 * PICK: the person asks one teammate to cover one or several of their things on one project (LV8), only on their
 * own tap (rule 9). The leave must be theirs; the command id makes a repeat change nothing (rule 6). The teammate
 * gets an inbox item and a notice in their chat; Atlas offers again if anything is still free.
 */
export function askCover(ctx: CommandCtx, leaveId: string, toId: string, keys: readonly string[], commandId: string): Promise<{ record: CoverRecord; message: string }> {
  return runCommand(ctx, async (tx) => {
    const [again] = await tx.select().from(t.coverRequests).where(eq(t.coverRequests.askCommandId, commandId));
    if (again) {
      if (again.askerId !== ctx.actorId) throw new CommandRefused("Not found, or not yours to see", "not_found");
      return { record: coverOf(again), message: await askedText(tx, coverOf(again)) };
    }
    const leave = await leaveFacts(tx, leaveId, ctx.now);
    if (!leave || leave.row.personId !== ctx.actorId) throw new CommandRefused("Not found, or not yours to see", "not_found");
    let [offer] = await tx.select().from(t.coverRequests).where(and(eq(t.coverRequests.leaveId, leaveId), eq(t.coverRequests.state, "suggested")));
    if (!offer && (await offerIn(tx, ctx.now, leaveId, null))) [offer] = await tx.select().from(t.coverRequests).where(and(eq(t.coverRequests.leaveId, leaveId), eq(t.coverRequests.state, "suggested")));
    if (!offer) throw new CommandRefused(leave.started ? "Your leave has started, so it's too late to ask from here." : "Nothing of yours is left to ask cover for.");
    const { things } = await awayFor(tx, ctx.actorId, leave.range, ctx.now);
    const items = keys.map((k) => things.find((x) => x.key === k)?.item);
    if (!items.length || items.some((i) => !i)) throw new CommandRefused("That is not yours, or not due while you're away.");
    const record = coverOf(offer);
    const event: CoverEvent = { type: "PICK", toId, items: items as CoverItem[] };
    const r = applyCoverEvent(record, event, await ctxFor(tx, ctx.now, record, ctx.actorId, { toId, items: items as CoverItem[] }));
    if (!r.outcome.ok) {
      const name = (await firstNames(tx, [toId])).get(toId) ?? "They";
      throw new CommandRefused(PICK_REFUSED[r.outcome.reason]?.(name) ?? r.outcome.reason);
    }
    await write(tx, ctx.now, offer, r.record, r.outcome, person(ctx.actorId), { commandId }, { askCommandId: commandId });
    const names = await firstNames(tx, [ctx.actorId]);
    const [project] = await tx.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, r.record.projectId!));
    const what = itemsSaid(await labelsOf(tx, r.record.items));
    await notice(tx, ctx.now, [toId], `${names.get(ctx.actorId)} asks if you can cover ${what} on ${project.name} while they're away ${awayLabel(leave.range)}. Accept, or say you can't.`, {
      type: "cover_request",
      id: r.record.id,
      projectId: r.record.projectId,
      act: "ask",
    });
    await offerIn(tx, ctx.now, leaveId, record.captureId);
    return { record: r.record, message: await askedText(tx, r.record) };
  });
}

async function askedText(tx: Tx, r: CoverRecord): Promise<string> {
  const who = (await firstNames(tx, [r.toId!])).get(r.toId!) ?? "them";
  return `Asked ${who} to cover ${itemsSaid(await labelsOf(tx, r.items))}. I'll tell you when they answer.`;
}

/** DISMISS: the person needs no cover; the offer ends and nothing is asked. A later message about the leave offers again. */
export function dismissCover(ctx: CommandCtx, leaveId: string): Promise<{ message: string }> {
  return runCommand(ctx, async (tx) => {
    const leave = await leaveFacts(tx, leaveId, ctx.now);
    if (!leave || leave.row.personId !== ctx.actorId) throw new CommandRefused("Not found, or not yours to see", "not_found");
    const [offer] = await tx.select().from(t.coverRequests).where(and(eq(t.coverRequests.leaveId, leaveId), eq(t.coverRequests.state, "suggested")));
    // A second tap finds nothing open, and changes nothing (rule 6)
    if (!offer) return { message: "No cover asked." };
    const record = coverOf(offer);
    const r = applyCoverEvent(record, { type: "DISMISS" }, await ctxFor(tx, ctx.now, record, ctx.actorId));
    await write(tx, ctx.now, offer, r.record, moved(r.outcome), person(ctx.actorId));
    return { message: "No cover asked." };
  });
}

// ---- The teammate asked ----

export type CoverAnswer = { act: "accept" } | { act: "decline" } | { act: "decline_item"; key: string };

const ANSWER_REFUSED: Record<string, string> = {
  "that is no longer on a project you share": "That is no longer on a project you share, so it can't be accepted.",
  "the leave is off": "They no longer need cover for that.",
  "it is the only thing asked: decline the request": "It's the only thing asked: decline the request instead.",
};

/**
 * The teammate answers (rule 10: only their own tap makes them cover). Accept proposes the handover, or keeps it
 * waiting while the leave is not approved (LV9), and tells the person and the project's PM (CD19); decline, or
 * declining one item of several (LV8), tells the person, and Atlas offers again. Someone else's ask is not found
 * (P10), and the command id makes a repeat change nothing (rule 6).
 */
export function answerCover(ctx: CommandCtx, requestId: string, answer: CoverAnswer, commandId: string): Promise<{ record: CoverRecord; message: string }> {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.coverRequests).where(eq(t.coverRequests.id, requestId));
    if (!row || row.toId !== ctx.actorId) throw new CommandRefused("Not found, or not yours to see", "not_found");
    const record = coverOf(row);
    const [seen] = await tx
      .select({ detail: t.auditEntries.detail })
      .from(t.auditEntries)
      .where(and(eq(t.auditEntries.subjectType, "cover_request"), eq(t.auditEntries.subjectId, requestId), sql`${t.auditEntries.detail}->>'commandId' = ${commandId}`))
      .limit(1);
    if (seen) return { record, message: (seen.detail as { said: string }).said };
    if (record.state !== "asked") throw new CommandRefused(record.state === "withdrawn" ? "They no longer need cover for that." : `You already answered: ${record.state}.`);
    const event: CoverEvent = answer.act === "accept" ? { type: "ACCEPT" } : answer.act === "decline" ? { type: "DECLINE" } : { type: "DECLINE_ITEM", item: keyItem(answer.key) };
    const r = applyCoverEvent(record, event, await ctxFor(tx, ctx.now, record, ctx.actorId));
    if (!r.outcome.ok) throw new CommandRefused(ANSWER_REFUSED[r.outcome.reason] ?? r.outcome.reason);
    let next = r.record;
    const names = await firstNames(tx, [record.askerId, ctx.actorId]);
    const [asker, me] = [names.get(record.askerId)!, names.get(ctx.actorId)!];
    const leave = (await leaveFacts(tx, record.leaveId, ctx.now))!;
    const subject = { type: "cover_request", id: record.id, projectId: record.projectId };
    let said: string;
    if (answer.act === "accept") {
      if (next.handover === "proposed") next = { ...next, handoverId: await startHandover(tx, ctx.now, next, person(ctx.actorId)) };
      const what = itemsSaid(await labelsOf(tx, next.items));
      const starts = next.handover === "proposed" ? "A handover is proposed." : "The handover starts when the leave is approved.";
      await notice(tx, ctx.now, [record.askerId], `${me} will cover ${what} while you're away. ${starts}`, { ...subject, act: "accepted" });
      // CD19: no OK is needed, but a change of who does the work never surprises the PM
      const pms = (await loadWorld(tx)).memberships.filter((m) => m.projectId === record.projectId && m.state === "member" && m.role === "pm" && m.personId !== record.askerId && m.personId !== ctx.actorId).map((m) => m.personId);
      await notice(tx, ctx.now, pms, `${me} will cover ${what} for ${asker} while they're away ${awayLabel(leave.range)}. ${starts} No OK is needed from you.`, { ...subject, act: "cover_pm" });
      said = `You'll cover ${what}. ${starts}`;
    } else if (answer.act === "decline") {
      const what = itemsSaid(await labelsOf(tx, record.items));
      await notice(tx, ctx.now, [record.askerId], `${me} can't cover ${what}. You can ask someone else.`, { ...subject, act: "declined" });
      said = `Declined. ${asker} is told.`;
    } else {
      const what = itemsSaid(await labelsOf(tx, record.items.filter((i) => itemKey(i) === answer.key)));
      await notice(tx, ctx.now, [record.askerId], `${me} can't cover ${what}; the rest still waits on them. You can ask someone else for it.`, { ...subject, act: "declined_item" });
      said = `You said you can't cover ${what}. ${asker} is told.`;
    }
    await write(tx, ctx.now, row, next, r.outcome, person(ctx.actorId), { answer: answer.act, commandId, said }, { answerCommandId: commandId });
    if (answer.act !== "accept") await offerIn(tx, ctx.now, record.leaveId, null);
    return { record: next, message: said };
  });
}

const keyItem = (key: string): Pick<CoverItem, "type" | "id"> => {
  const at = key.indexOf(":");
  return { type: key.slice(0, at) as CoverItem["type"], id: key.slice(at + 1) };
};

// ---- M7 ----

/**
 * The accepted cover's handover, through M7: one step per thing covered, from the person to the teammate, starting
 * not started. Nothing else changes: who owns the work stays as it is (cover is a rule, A10.2).
 */
async function startHandover(tx: Tx, now: Date, r: CoverRecord, by: By): Promise<string> {
  const id = `ho-${r.id}`;
  const leave = (await leaveFacts(tx, r.leaveId, now))!;
  const names = await firstNames(tx, [r.askerId, r.toId!]);
  const steps = await labelsOf(tx, r.items);
  await tx.insert(t.handovers).values({ id, projectId: r.projectId!, fromPersonId: r.askerId, toPersonId: r.toId!, title: `${names.get(r.askerId)} to ${names.get(r.toId!)}: cover for ${rangeLabel(leave.range)}`, state: "not_started", createdAt: now, updatedAt: now });
  await tx.insert(t.handoverSteps).values(steps.map((s, i) => ({ id: `${id}-${i + 1}`, handoverId: id, title: s.label, state: "not_done" as const, position: i + 1, updatedAt: now })));
  await audit(tx, now, { ...by, action: "PROPOSE", machine: "handover", subjectType: "handover", subjectId: id, toState: "not_started", detail: { coverRequest: r.id, steps: steps.length, firstDayBack: firstDayBack(leave.range) } });
  return id;
}

/** LV4: the leave behind it is off, so the handover is cancelled through M7's own CANCEL. */
async function cancelHandover(tx: Tx, now: Date, handoverId: string): Promise<void> {
  const [row] = await tx.select().from(t.handovers).where(eq(t.handovers.id, handoverId));
  if (!row) return;
  const steps = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.handoverId, handoverId));
  const record: HandoverRecord = { ...row, stepsDone: steps.filter((s) => s.state === "handed_over").length, stepsTotal: steps.length };
  const r = applyHandover(record, { type: "CANCEL" });
  if (!r.outcome.ok) return;
  const rows = await tx
    .update(t.handovers)
    .set({ state: r.record.state, version: nextVersion(t.handovers.version), updatedAt: now })
    .where(and(eq(t.handovers.id, handoverId), eq(t.handovers.version, row.version)))
    .returning({ id: t.handovers.id });
  expectOne(rows, `handover ${handoverId}`);
  await audit(tx, now, { ...RULE, action: "CANCEL", machine: "handover", subjectType: "handover", subjectId: handoverId, fromState: r.outcome.from, toState: r.outcome.to, detail: { why: "leave_off" } });
}

// ---- The rules: the leave's own moves, and the timer ----

/**
 * Every rule that can move one request now, in order, each read again after the last: the leave is off (LV4,
 * declineCancels), the leave started with the offer open (suggestedWayOut), the person or the teammate left the
 * project (leaveProjectWithdraws, told to nobody), what is no longer due leaves the ask (LV3), the leave was approved
 * so a waiting handover starts (LV9), and no answer in config.coverAskHours. Returns whether something became free.
 */
async function settle(tx: Tx, now: Date, id: string): Promise<boolean> {
  let freed = false;
  let row = await reread(tx, id);
  let facts = await ctxFor(tx, now, coverOf(row), null);
  for (const type of ["LEAVE_OFF", "LAPSE", "LEFT_PROJECT", "DATES", "LEAVE_APPROVED", "NO_ANSWER"] as const) {
    const record = coverOf(row);
    const r = applyCoverEvent(record, { type }, facts);
    if (!r.outcome.ok) continue;
    let next = r.record;
    const names = await firstNames(tx, [record.askerId, ...(record.toId ? [record.toId] : [])]);
    const subject = { type: "cover_request", id: record.id, projectId: record.projectId };
    if (type === "LEAVE_OFF" && record.state === "accepted") {
      if (record.handoverId) await cancelHandover(tx, now, record.handoverId);
      await notice(tx, now, [record.toId!], `${names.get(record.askerId)} no longer needs cover for ${itemsSaid(await labelsOf(tx, record.items))}, so the handover is cancelled.`, { ...subject, act: "cancelled" });
    }
    if (type === "LEAVE_APPROVED") {
      next = { ...next, handoverId: await startHandover(tx, now, next, RULE) };
      await notice(tx, now, [record.toId!], `${names.get(record.askerId)}'s leave is approved, so the handover for ${itemsSaid(await labelsOf(tx, record.items))} starts.`, { ...subject, act: "handover" });
    }
    if (type === "NO_ANSWER") {
      await notice(tx, now, [record.askerId], `${names.get(record.toId!)} didn't answer about covering ${itemsSaid(await labelsOf(tx, record.items))} within ${config.coverAskHours} hours. You can ask someone else.`, { ...subject, act: "unanswered" });
    }
    await write(tx, now, row, next, r.outcome, RULE);
    freed ||= type === "NO_ANSWER" || type === "DATES" || type === "LEFT_PROJECT";
    // The next rule reads the request as this one left it
    row = await reread(tx, id);
    facts = await ctxFor(tx, now, coverOf(row), null);
  }
  return freed;
}

/**
 * After anything moves a leave (an admin decides it, the person withdraws it, a save changes its dates, an undo):
 * every request of it settles, and Atlas offers again when something is free and the person already asked about
 * this leave. Run in the transaction that moved the leave.
 */
export async function coverOnLeave(tx: Tx, now: Date, leaveId: string): Promise<void> {
  const rows = await tx.select().from(t.coverRequests).where(eq(t.coverRequests.leaveId, leaveId));
  if (!rows.length) return;
  for (const r of rows.filter((x) => x.state === "suggested" || x.state === "asked" || (x.state === "accepted" && LIVE_HANDOVER.includes(x.handover)))) await settle(tx, now, r.id);
  await offerIn(tx, now, leaveId, null);
}

/** The minute timer: every open request, and every live cover, settles; Atlas offers again where something was freed. */
export async function runCoverTimers(ctx: { db: Db; now: Date }): Promise<{ settled: string[] }> {
  const rows = await ctx.db.select().from(t.coverRequests).where(inArray(t.coverRequests.state, ["suggested", "asked", "accepted"]));
  const settled: string[] = [];
  for (const row of rows.filter((x) => x.state !== "accepted" || LIVE_HANDOVER.includes(x.handover))) {
    await ctx.db.transaction(async (tx) => {
      if (await settle(tx, ctx.now, row.id)) await offerIn(tx, ctx.now, row.leaveId, null);
    });
    settled.push(row.id);
  }
  return { settled };
}
