// M22 commands (conversational plan, phase E): Save opens a commitment from the author's promise, or moves the
// live one it matches (CM5), or ends the one an update says is done (CM6); the owner answers a check-in with
// Done, a new date or Drop, or says it still stands (CM11); the rules move it when its linked work goes Done or
// is cancelled, or the owner leaves its project (CM9); the minute timer makes it due, sends check-ins on a
// working day the owner is in (CM7, CM8), and lapses it unanswered. Every move runs the machine
// (domain/machines/commitment.ts), checked now (rule 4), and writes an audit entry.
// Atlas cannot speak first yet (phase F): a check-in is a notice in the owner's DPM chat plus an inbox item.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Conn, Tx } from "../db/conn";
import { commitmentOf, leaveRecordOf, loadWorld, orgTagsOf, persistCommitment } from "../db/records";
import * as t from "../db/schema";
import type { PlannedCommitment } from "../domain/capture-save";
import { config } from "../domain/config";
import { isIsoDate, isWorkingDay, weekday, type IsoDate } from "../domain/dates";
import type { Moved } from "../domain/machine";
import {
  applyCommitmentEvent,
  asksDrop,
  commitmentCauses,
  isLive,
  LIVE_COMMITMENT,
  openCommitment,
  readCheckInReply,
  type CommitmentEvent,
  type CommitmentLink,
  type CommitmentRecord,
  type CommitmentState,
} from "../domain/machines/commitment";
import { onLeaveUntil } from "../domain/machines/leave";
import { readPromiseDate } from "../domain/atlas-checks/resolve-dates";
import { isCandidate, type World } from "../domain/machines/membership";
import { clockOf, shortDate } from "../queries/project";
import { audit, CommandRefused, moved, runCommand, todayOf, type CommandCtx } from "./core";
import { syncInbox } from "./evaluate";
import { notice } from "./notices";

type Row = typeof t.commitments.$inferSelect;
type By = { actorType: "person" | "rule"; actorId: string | null };

const dayDate = (d: IsoDate) => `${weekday(d).slice(0, 3)} ${shortDate(d)}`;
/** "Send Kyle the request" said back as a question: "send Kyle the request". */
export const lowerFirst = (s: string) => (s.length > 1 && s[1] !== s[1].toUpperCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

async function auditMove(tx: Tx, now: Date, r: CommitmentRecord, m: Moved<CommitmentState> | { event: "SAVE"; from: null; to: CommitmentState }, by: By, detail: Record<string, unknown> = {}) {
  await audit(tx, now, {
    ...by,
    action: m.event,
    machine: "commitment",
    subjectType: "commitment",
    subjectId: r.id,
    fromState: m.from,
    toState: m.to,
    captureId: r.captureId,
    extractionId: r.extractionId,
    detail: { dueOn: r.dueOn, moves: r.moves, checkIns: r.checkIns, ...detail },
  });
}

/**
 * M10 for one commitment: a check-in that is out, or CM11's question, is an inbox item for its owner alone (CD3).
 * byOwner: the owner's own answer removed the cause, so the item closes as acted.
 */
async function syncItems(tx: Tx, now: Date, r: CommitmentRecord, byOwner: boolean): Promise<void> {
  const keys = [`commitment_check:${r.id}`, `commitment_stands:${r.id}`];
  const items = await tx.select().from(t.inboxItems).where(inArray(t.inboxItems.causeKey, keys));
  const desired = new Map(commitmentCauses(r).map((k) => [k, [r.ownerId]]));
  await syncInbox(tx, now, items, desired, byOwner ? { actorId: r.ownerId } : {});
}

/** Writes one move: the record, its audit entry, and the owner's inbox. */
async function write(tx: Tx, now: Date, row: Row | null, r: CommitmentRecord, m: Parameters<typeof auditMove>[3], by: By, detail?: Record<string, unknown>) {
  await persistCommitment(tx, r, row?.version ?? null, now);
  await auditMove(tx, now, r, m, by, detail);
  await syncItems(tx, now, r, by.actorId === r.ownerId);
}

/**
 * The linked record's label, only while the owner can open its project now (P10, the model's
 * CheckInHoldsOnlyWhatOwnerMaySee): "#151 Store sales feed access", "Trend model", "Store sales feed access".
 */
export async function linkLabel(conn: Conn, ownerId: string, link: CommitmentLink | null, world?: World): Promise<string | null> {
  if (!link) return null;
  const w = world ?? (await loadWorld(conn));
  if (!isCandidate(ownerId, await orgTagsOf(conn, ownerId), link.projectId, w)) return null;
  if (link.type === "work_item") {
    const [row] = await conn.select({ number: t.workItems.number, title: t.workItems.title }).from(t.workItems).where(eq(t.workItems.id, link.id));
    return row ? `${row.number ? `${row.number} ` : ""}${row.title}` : null;
  }
  if (link.type === "milestone") return (await conn.select({ name: t.milestones.name }).from(t.milestones).where(eq(t.milestones.id, link.id)))[0]?.name ?? null;
  return (await conn.select({ title: t.braidEntries.title }).from(t.braidEntries).where(eq(t.braidEntries.id, link.id)))[0]?.title ?? null;
}

/** The linked work item's state now, for DONE by the rule and CM11; null for no link or another kind. */
async function linkedState(tx: Tx, link: CommitmentLink | null): Promise<string | null> {
  if (link?.type !== "work_item") return null;
  return (await tx.select({ state: t.workItems.state }).from(t.workItems).where(eq(t.workItems.id, link.id)))[0]?.state ?? null;
}

/** CM7, CM8: today is a working day, and the owner is not on leave today. */
async function ownerIn(tx: Tx, ownerId: string, today: IsoDate): Promise<boolean> {
  if (!isWorkingDay(today)) return false;
  const leaves = (await tx.select().from(t.leave).where(eq(t.leave.personId, ownerId))).map(leaveRecordOf);
  return onLeaveUntil(leaves, today) === null;
}

async function ctxFor(tx: Tx, now: Date, r: CommitmentRecord, actorId: string | null) {
  const today = todayOf(now);
  return { actorId, today, ownerIn: await ownerIn(tx, r.ownerId, today), linked: await linkedState(tx, r.link) };
}

// ---- Save (M22 SAVE, in the save's own transaction) ----

/**
 * Save: the author's promises open commitments, the same promise moves the live one it matches to its new day
 * (CM5, NEW_DATE as the owner), and a done item ends the live one it names (CM6). The link is checked when it
 * runs: one to a project the author can no longer read is dropped, and the promise kept (CM9, rule 4).
 */
export async function applyCommitmentsAtSave(tx: Tx, now: Date, capture: { id: string; authorId: string }, planned: readonly PlannedCommitment[], world: World): Promise<void> {
  const by: By = { actorType: "person", actorId: capture.authorId };
  const orgTags = await orgTagsOf(tx, capture.authorId);
  for (const p of planned) {
    const id = p.act === "done" ? p.commitmentId : p.matchId;
    if (id) {
      const [row] = await tx.select().from(t.commitments).where(eq(t.commitments.id, id));
      if (!row || row.ownerId !== capture.authorId) throw new CommandRefused("that promise is not one of yours", "not_found");
      const record = commitmentOf(row);
      const event: CommitmentEvent = p.act === "done" ? { type: "DONE", by: "owner" } : { type: "NEW_DATE", dueOn: p.dueOn };
      const r = applyCommitmentEvent(record, event, await ctxFor(tx, now, record, capture.authorId));
      // savedBy: the save that moved or ended it, so its undo can say this stays (queries/undo.ts, keptPromisesOfSave)
      await write(tx, now, row, r.record, moved(r.outcome), by, { itemId: p.itemId, from: p.act === "done" ? "update" : "same_promise", savedBy: capture.id });
      continue;
    }
    if (p.act !== "promise") continue;
    const link = p.link && isCandidate(capture.authorId, orgTags, p.link.projectId, world) ? { type: p.link.type, id: p.link.id, projectId: p.link.projectId } : null;
    const record = openCommitment({ id: `cm-${p.itemId}`, ownerId: capture.authorId, captureId: capture.id, extractionId: p.itemId, what: p.what, dueOn: p.dueOn, link, savedOn: todayOf(now), standsAsked: p.standsAsked });
    await write(tx, now, null, record, { event: "SAVE", from: null, to: "open" }, by, { link: link?.id ?? null, standsAsked: record.stands === "asked" });
    if (record.stands === "asked") await askStands(tx, now, record, await linkedState(tx, record.link));
  }
}

/**
 * Phase O, M34 CONFIRM: a promise a meeting note says someone made opens their commitment once they confirm it,
 * as theirs (rule 10): saved by them, private to them (CD3). It names no message of theirs, so the recorder's
 * undo never drops it, and its link is kept only on a project they can read now (CM9). Returns its id.
 */
export async function openFromMeeting(tx: Tx, now: Date, p: { attributedId: string; ownerId: string; what: string; dueOn: IsoDate; link: CommitmentLink | null }): Promise<string> {
  const world = await loadWorld(tx);
  const link = p.link && isCandidate(p.ownerId, await orgTagsOf(tx, p.ownerId), p.link.projectId, world) ? p.link : null;
  const record = openCommitment({ id: `cm-${p.attributedId}`, ownerId: p.ownerId, captureId: null, extractionId: null, what: p.what, dueOn: p.dueOn, link, savedOn: todayOf(now) });
  await write(tx, now, null, record, { event: "SAVE", from: null, to: "open" }, { actorType: "person", actorId: p.ownerId }, { link: link?.id ?? null, meetingItem: p.attributedId });
  return record.id;
}

/**
 * Phase L with phase E, as CD34: undoing a save drops the commitments it opened that are still open and were never
 * moved, through M22's own DROP as their owner. One moved, due or ended since is the owner's later doing, and stays.
 */
export async function dropCommitmentsOfSave(tx: Tx, now: Date, authorId: string, captureId: string): Promise<void> {
  const rows = await tx.select().from(t.commitments).where(and(eq(t.commitments.captureId, captureId), eq(t.commitments.state, "open"), eq(t.commitments.moves, 0)));
  for (const row of rows) {
    const record = commitmentOf(row);
    const r = applyCommitmentEvent(record, { type: "DROP" }, await ctxFor(tx, now, record, authorId));
    if (r.outcome.ok) await write(tx, now, row, r.record, r.outcome, { actorType: "person", actorId: authorId }, { undone: true });
  }
}

// ---- The owner's answers ----

export type CheckInAnswer = { act: "done" } | { act: "drop" } | { act: "date"; dueOn: IsoDate } | { act: "keep" };

const EVENT: Record<CheckInAnswer["act"], (a: CheckInAnswer) => CommitmentEvent> = {
  done: () => ({ type: "DONE", by: "owner" }),
  drop: () => ({ type: "DROP" }),
  date: (a) => ({ type: "NEW_DATE", dueOn: (a as Extract<CheckInAnswer, { act: "date" }>).dueOn }),
  keep: () => ({ type: "KEEP" }),
};

/** What the owner is told when an answer lands, in the chat and on the button. */
export function answeredText(r: CommitmentRecord, act: CheckInAnswer["act"]): string {
  switch (act) {
    case "done":
      return `Marked done: ${r.what}.`;
    case "drop":
      return `Dropped: ${r.what}.`;
    case "date":
      return `Moved to ${dayDate(r.dueOn)}: ${r.what}.`;
    case "keep":
      return `Kept: ${r.what}. I'll check on it when it's due.`;
  }
}

// The machine's reasons, as the owner is told them
const REFUSED: Record<string, string> = {
  "it is already due then": "It is already due that day.",
  "a new date is a day still to come": "Pick a day from today on.",
  "nothing asked whether it stands": "Nothing is asking about that promise now.",
};

/**
 * The owner answers a check-in (Done, a new date, Drop), CM11's question (it still stands, or Drop), or acts
 * from "What did I promise?" (the model's OwnerSays). Only the owner, checked now (rule 10). Rule 6: every
 * answer carries its command id (the button's own, or the reply's message), and the same id again changes
 * nothing and says what the first did; a commitment that ended since is refused and changes nothing.
 */
export function answerCommitment(ctx: CommandCtx, commitmentId: string, answer: CheckInAnswer, commandId: string): Promise<{ record: CommitmentRecord; message: string }> {
  return runCommand(ctx, (tx) => answerIn(tx, ctx.now, ctx.actorId, commitmentId, answer, commandId));
}

export async function answerIn(tx: Tx, now: Date, actorId: string, commitmentId: string, answer: CheckInAnswer, commandId: string): Promise<{ record: CommitmentRecord; message: string }> {
  const [row] = await tx.select().from(t.commitments).where(eq(t.commitments.id, commitmentId));
  // CD3: someone else's commitment is not found, whatever its id
  if (!row || row.ownerId !== actorId) throw new CommandRefused("Not found, or not yours to see", "not_found");
  const record = commitmentOf(row);
  // Rule 6: a command already run (a second tap, a retried request) changes nothing; the first one's answer stands
  const [seen] = await tx
    .select({ detail: t.auditEntries.detail })
    .from(t.auditEntries)
    .where(and(eq(t.auditEntries.subjectType, "commitment"), eq(t.auditEntries.subjectId, commitmentId), sql`${t.auditEntries.detail}->>'commandId' = ${commandId}`))
    .limit(1);
  if (seen) return { record, message: answeredText(record, (seen.detail as { answer: CheckInAnswer["act"] }).answer) };
  if (answer.act === "date" && !isIsoDate(answer.dueOn)) throw new CommandRefused("a new date is a day, for example 2026-10-23");
  if (!isLive(record)) throw new CommandRefused(`That promise is already ${record.state === "lapsed" ? "closed" : record.state}.`);
  const r = applyCommitmentEvent(record, EVENT[answer.act](answer), await ctxFor(tx, now, record, actorId));
  if (!r.outcome.ok) throw new CommandRefused(REFUSED[r.outcome.reason] ?? r.outcome.reason);
  await write(tx, now, row, r.record, r.outcome, { actorType: "person", actorId }, { answer: answer.act, commandId });
  return { record: r.record, message: answeredText(r.record, answer.act) };
}

/** The newest question about a commitment in its owner's chat: a check-in, or CM11's (notice ids carry their act). */
async function askedAt(tx: Tx, ownerId: string, id: string): Promise<{ check: Date | null; stands: Date | null }> {
  const rows = await tx.select({ id: t.notices.id, at: t.notices.at }).from(t.notices).where(and(eq(t.notices.personId, ownerId), eq(t.notices.subjectType, "commitment"), eq(t.notices.subjectId, id)));
  const newest = (act: string) => rows.filter((n) => n.id.startsWith(`ntc-${id}-${act}`)).reduce<Date | null>((a, n) => (a && a >= n.at ? a : n.at), null);
  return { check: newest("check_in_"), stands: newest("stands-") };
}

/**
 * SU4 with CM6 and M28: the time of the newest other question waiting on the author in this conversation (M21's
 * clarification, the standup's question, a command card to confirm), which a reply there answers first.
 */
async function otherQuestionAt(tx: Tx, authorId: string, conversationId: string, replyId: string): Promise<Date | null> {
  const [clarified] = await tx
    .select({ at: t.clarifications.createdAt })
    .from(t.clarifications)
    .where(and(eq(t.clarifications.authorId, authorId), eq(t.clarifications.conversationId, conversationId), eq(t.clarifications.state, "asked"), ne(t.clarifications.captureId, replyId)));
  const [standup] = await tx
    .select({ at: t.standups.askedAt })
    .from(t.standups)
    .where(and(eq(t.standups.personId, authorId), eq(t.standups.conversationId, conversationId), eq(t.standups.state, "asking")));
  const [command] = await tx
    .select({ at: t.chatCommands.createdAt })
    .from(t.chatCommands)
    .innerJoin(t.captures, eq(t.captures.id, t.chatCommands.captureId))
    .where(and(eq(t.captures.authorId, authorId), eq(t.captures.conversationId, conversationId), eq(t.chatCommands.state, "proposed")));
  const times = [clarified?.at, standup?.at, command?.at].filter((x): x is Date => !!x);
  return times.length ? new Date(Math.max(...times.map((x) => x.getTime()))) : null;
}

/**
 * Phase E: a short reply that answers the one check-in or CM11 question waiting on its author, read by DPM's rule
 * with no model ("done", "drop it", "keep it", "move it to Friday"), in the conversation where its notice shows.
 * Null when it is not such a reply, or when none or several wait there: it is then read as a new message. SU4:
 * only when that question is the one Atlas asked last there; a standup's question or a clarification asked after
 * it takes the reply. One saved before DPM kept where it was said (the seed) shows in the newest conversation,
 * so typed words never answer it, its buttons do; it still makes a reply ambiguous. A bare "yes" answers the
 * row's question asked last: done for a check-in, it still stands for CM11's. A refusal (a day already past) is
 * said back, and nothing changes. The reply's message is the command id (rule 6).
 */
export async function answerCheckInInWords(tx: Tx, now: Date, capture: { id: string; authorId: string; text: string; messageAt: Date; conversationId: string | null }): Promise<{ id: string; note: string } | null> {
  if (!capture.conversationId) return null;
  const reply = readCheckInReply(capture.text, (words) => readPromiseDate(words, capture.messageAt));
  if (!reply) return null;
  const waiting = (await tx.select().from(t.commitments).where(and(eq(t.commitments.ownerId, capture.authorId), inArray(t.commitments.state, [...LIVE_COMMITMENT])))).filter(
    (r) => (reply.act !== "keep" && r.state === "checking" && r.checkInOut) || r.stands === "asked",
  );
  // Where each one's notice shows: where it was said, or (said before DPM kept that) wherever is newest
  const shown: { row: Row; home: string | null }[] = [];
  for (const row of waiting) {
    const [made] = row.captureId ? await tx.select({ conversationId: t.captures.conversationId }).from(t.captures).where(eq(t.captures.id, row.captureId)) : [];
    const home = made?.conversationId ?? null;
    if (home === null || home === capture.conversationId) shown.push({ row, home });
  }
  if (shown.length !== 1 || shown[0].home === null) return null;
  const { row } = shown[0];
  const asked = await askedAt(tx, row.ownerId, row.id);
  const check = row.state === "checking" && row.checkInOut ? asked.check : null;
  const stands = row.stands === "asked" ? asked.stands : null;
  const last = [check, stands].reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
  const other = await otherQuestionAt(tx, capture.authorId, capture.conversationId, capture.id);
  if (!last || (other && other >= last)) return null;
  // CM11: "yes" to "Does your promise still stand?" keeps it; to "Did you send it?" it is done
  const act = reply.act === "yes" ? (stands && (!check || stands > check) ? "keep" : "done") : reply.act;
  const answer: CheckInAnswer = reply.act === "date" ? { act: "date", dueOn: reply.dueOn } : { act: act as Exclude<CheckInAnswer["act"], "date"> };
  try {
    return { id: row.id, note: (await answerIn(tx, now, capture.authorId, row.id, answer, capture.id)).message };
  } catch (e) {
    if (e instanceof CommandRefused) return { id: row.id, note: e.reason };
    throw e;
  }
}

// ---- The rules and the timer ----

/** CD55: a notice that names the linked record belongs to its project, so it is hidden once the owner leaves it (P10). */
const namedProject = (r: Pick<CommitmentRecord, "link">, label: string | null): string | null => (label && r.link ? r.link.projectId : null);

/** CM11's question, or CD51's when the work is Done and the promise was only about it. */
async function askStands(tx: Tx, now: Date, r: CommitmentRecord, linked: string | null): Promise<void> {
  const label = (await linkLabel(tx, r.ownerId, r.link)) ?? "The work it was about";
  const ended = linked === "done" ? "is Done" : "was cancelled";
  await notice(tx, now, [r.ownerId], `${label} ${ended}. Does your promise still stand: ${r.what}?`, { type: "commitment", id: r.id, projectId: namedProject(r, label), act: "stands" });
}

/** The check-in: "Did you send Kyle the access request? You said you would by Wed 21 Oct." (CD24 after 3 moves). */
export async function checkInText(conn: Conn, r: CommitmentRecord): Promise<string> {
  const label = await linkLabel(conn, r.ownerId, r.link);
  const again = r.checkIns > 1 ? "Checking again: " : "";
  const about = label ? ` (${label})` : "";
  const drop = asksDrop(r) ? ` It has moved ${r.moves} times. If it no longer stands, drop it.` : "";
  return `${again}Did you ${lowerFirst(r.what)}${about}? You said you would by ${dayDate(r.dueOn)}.${drop}`;
}

/**
 * The drawn rules on a commitment's link, run after a change to its project (evaluate) and by the timer: its
 * linked work going Done ends a promise to deliver it as done (the model's WorkDone); going cancelled, or Done
 * under a promise only about it (CD51), asks once whether it still stands (CM11); and an owner who left the
 * project keeps it without the link (CM9). Each is told in their chat.
 */
async function followLinks(tx: Tx, now: Date, rows: readonly Row[], world: World): Promise<void> {
  const rule: By = { actorType: "rule", actorId: null };
  for (const row of rows) {
    let record = commitmentOf(row);
    let version: Row | null = row;
    const step = async (event: CommitmentEvent, then?: (r: CommitmentRecord) => Promise<void>) => {
      const r = applyCommitmentEvent(record, event, await ctxFor(tx, now, record, null));
      if (!r.outcome.ok) return;
      await write(tx, now, version, r.record, r.outcome, rule);
      // The next step reads the row as this one left it
      [version] = await tx.select().from(t.commitments).where(eq(t.commitments.id, row.id));
      const before = record;
      record = r.record;
      if (then) await then(before);
    };
    if (record.link && !isCandidate(record.ownerId, await orgTagsOf(tx, record.ownerId), record.link.projectId, world)) await step({ type: "UNLINK" });
    if (!isLive(record)) continue;
    await step({ type: "DONE", by: "work_done" }, async (before) => {
      const named = await linkLabel(tx, before.ownerId, before.link, world);
      await notice(tx, now, [record.ownerId], `${named ?? "Its work"} is Done, so I marked your promise done: ${record.what}.`, { type: "commitment", id: record.id, projectId: namedProject(before, named), act: "work_done" });
    });
    if (isLive(record)) await step({ type: "WORK_ENDED" }, async () => askStands(tx, now, record, await linkedState(tx, record.link)));
  }
}

/** M22 after a change to a project (commands/evaluate.ts): the rules on every commitment linked into it. */
export async function followLinksInto(tx: Tx, now: Date, projectId: string): Promise<void> {
  const rows = await tx.select().from(t.commitments).where(eq(t.commitments.linkProjectId, projectId));
  if (rows.length) await followLinks(tx, now, rows, await loadWorld(tx));
}

/**
 * The minute timer: the link rules, then the day ends (TIMER due; TIMER no reply, which lapses after
 * config.commitmentCheckIns check-ins, or makes room for the next), then the morning job sends the check-ins
 * due from config.commitmentCheckInTime on a working day the owner is in (CM7, CM8). Safe to run again: each
 * arrow's guard reads the day, so a move happens once.
 */
export function runCommitmentTimers(ctx: { db: Db; now: Date }): Promise<{ id: string; event: string; to: CommitmentState }[]> {
  return ctx.db.transaction(async (tx) => {
    const moves: { id: string; event: string; to: CommitmentState }[] = [];
    const linked = await tx.select().from(t.commitments).where(inArray(t.commitments.state, [...LIVE_COMMITMENT]));
    await followLinks(tx, ctx.now, linked.filter((r) => r.linkId), await loadWorld(tx));
    const rule: By = { actorType: "rule", actorId: null };
    const morning = clockOf(ctx.now) >= config.commitmentCheckInTime;
    for (const first of await tx.select().from(t.commitments).where(inArray(t.commitments.state, [...LIVE_COMMITMENT]))) {
      let row = first;
      for (const type of ["DUE", "NO_REPLY", "CHECK_IN"] as const) {
        if (type === "CHECK_IN" && !morning) continue;
        const record = commitmentOf(row);
        const r = applyCommitmentEvent(record, { type }, await ctxFor(tx, ctx.now, record, null));
        if (!r.outcome.ok) continue;
        await write(tx, ctx.now, row, r.record, r.outcome, rule);
        moves.push({ id: record.id, event: type, to: r.outcome.to });
        if (type === "CHECK_IN") {
          const named = await linkLabel(tx, r.record.ownerId, r.record.link);
          await notice(tx, ctx.now, [record.ownerId], await checkInText(tx, r.record), { type: "commitment", id: record.id, projectId: namedProject(r.record, named), act: `check_in_${r.record.checkIns}` });
        }
        if (r.outcome.to === "lapsed") {
          await notice(tx, ctx.now, [record.ownerId], `No reply about "${record.what}", so I've stopped checking on it. It stays in your promises as closed.`, { type: "commitment", id: record.id, projectId: null, act: "lapsed" });
          break;
        }
        [row] = await tx.select().from(t.commitments).where(eq(t.commitments.id, row.id));
      }
    }
    return moves;
  });
}

/** The owner's commitments, newest first; nobody else's (CD3). */
export async function commitmentsOf(conn: Conn, ownerId: string, states: readonly CommitmentState[] = LIVE_COMMITMENT): Promise<CommitmentRecord[]> {
  const rows = await conn.select().from(t.commitments).where(and(eq(t.commitments.ownerId, ownerId), inArray(t.commitments.state, [...states])));
  return rows.map(commitmentOf).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
}
