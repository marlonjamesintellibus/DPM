// M28 Standup (conversational plan, phase J): "Start my standup", or its button, starts the person's standup
// in their own chat. Atlas asks two to four short questions from their open work, rebuilt at each step (SU8),
// with tap answers where it can; a typed reply in that conversation is the answer to the question waiting
// (SU4, SU5: a voice note is transcribed first), "Skip" moves on and "That's all" ends it (SU6). The last
// answer, STOP or the idle timer composes what was answered into one capture (M1, M2), read as usual and
// reviewed and saved by the person; with nothing answered it is abandoned (SU7). The save checks rights and
// versions as for any update (SU3), and asks the owner of a record that is no longer theirs (rule 10). One
// standup per person per day (SU10). Atlas starting one by itself waits on phase F: nothing sends SCHEDULE or
// TIMER yet. Nothing here changes a record (rule 1).
import { and, eq, isNull, lte, ne, or } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import * as t from "../db/schema";
import { config } from "../domain/config";
import type { Moved } from "../domain/machine";
import { isOwnChat } from "../domain/machines/clarification";
import { applyStandupEvent, draftStandup, TAPS, type StandupAnswer, type StandupEvent, type StandupQuestion, type StandupRecord, type StandupState, type StandupStep, type TapAnswer } from "../domain/machines/standup";
import { composeText, followUp, nextQuestion, readTypedReply } from "../domain/standup";
import { standup as standupTopic } from "../domain/topics/standup";
import { firstName } from "../queries/project";
import { coveredToday, openWorkOf, standupOf } from "../queries/standup";
import { createCaptureIn } from "./capture";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, todayOf, type CommandCtx } from "./core";

type Row = typeof t.standups.$inferSelect;
type Actor = { actorType: "person" | "rule"; actorId: string | null };

/** What a move did: the standup as it is now, and the capture its answers became when it was composed. */
export type StandupRun = { record: StandupRecord; composed: string | null };

function auditMove(tx: Tx, now: Date, r: StandupRecord, outcome: Moved<StandupState>, by: Actor, detail: Record<string, unknown> = {}) {
  return audit(tx, now, {
    ...by,
    action: outcome.event,
    machine: "standup",
    subjectType: "standup",
    subjectId: r.id,
    fromState: outcome.from,
    toState: outcome.to,
    detail: { day: r.day, ...(r.current ? { asked: r.current.n } : {}), ...detail },
  });
}

/**
 * SU8: the question that follows, rebuilt from their open work as their own reads show it now. "Stuck" asks
 * what it waits on, and "No, it moves" when they now expect it, while the work is still theirs to ask about.
 */
async function nextFor(tx: Tx, now: Date, r: StandupRecord, steps: readonly StandupStep[], askedIn: string | null): Promise<StandupQuestion | null> {
  const open = await openWorkOf(tx, r.personId, now);
  const last = steps.at(-1);
  const follow = last?.answer ? followUp(last, last.answer) : null;
  const draft = follow && open.some((w) => w.id === follow.subject?.id) ? follow : nextQuestion(open, steps, r.day, config.standupMaxQuestions, await coveredToday(tx, r.personId, now));
  return draft ? { ...draft, n: steps.length + 1, askedIn } : null;
}

/**
 * composed --> one capture (M1, M2) from the answers, in the move that composed it, in the conversation it
 * asked in. Its message id is the standup's, so it is made once only (rule 6). Read after this commits.
 */
async function compose(tx: Tx, now: Date, r: StandupRecord): Promise<string> {
  const [person] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, r.personId));
  const { text } = composeText(firstName(person.name), r.steps);
  const created = await createCaptureIn(tx, { now, actorId: r.personId }, { channel: "app", kind: "text", text, messageAt: now, receivedAt: now, messageId: `standup-${r.id}`, conversationId: r.conversationId });
  return created.captureId;
}

/** One move of the standup in its row, with what it causes: the next question, or the capture it became. */
async function move(tx: Tx, now: Date, row: Row, event: StandupEvent, by: Actor, shownIn: string | null): Promise<StandupRun> {
  const seen = standupOf(row);
  const filed = event.type === "ANSWER" || event.type === "SKIP" ? [...seen.steps, { ...seen.current!, answer: event.type === "ANSWER" ? event.answer : null }] : seen.steps;
  const where = shownIn ?? row.shownIn;
  const next = event.type === "ANSWER" || event.type === "SKIP" ? await nextFor(tx, now, seen, filed, where) : null;
  const r = applyStandupEvent(seen, event, { actorId: by.actorId ?? seen.personId, now, next });
  const outcome = moved(r.outcome);
  const composed = r.record.state === "composed" ? await compose(tx, now, r.record) : null;
  const rows = await tx
    .update(t.standups)
    .set({ state: r.record.state, steps: r.record.steps, current: r.record.current, askedAt: r.record.askedAt, endedBy: r.record.endedBy, shownIn: where, ...(composed ? { captureId: composed } : {}), version: nextVersion(t.standups.version), updatedAt: now })
    .where(and(eq(t.standups.id, row.id), eq(t.standups.version, row.version)))
    .returning({ id: t.standups.id });
  expectOne(rows, `standup ${row.id}`);
  await auditMove(tx, now, r.record, outcome, by, { ...(event.type === "ANSWER" ? { tap: event.answer.tap, typed: !!event.answer.words } : {}), ...(composed ? { captureId: composed } : {}) });
  return { record: r.record, composed };
}

export type Started = { record: StandupRecord; started: boolean };

/**
 * START, while "Start my standup" is read: from none, or from a scheduled or skipped standup (phase F), in
 * their own chat only (rules 3 and 8). One per person per day: a standup that asked today, whether it is
 * still asking, composed or abandoned, has no START arrow, so a second is refused (SU10). With no open work
 * it asks only "Anything blocking you?" (SU1).
 */
export async function startStandup(tx: Tx, now: Date, capture: { id: string; authorId: string; conversationId: string | null; channel: "app" | "atlas" }): Promise<Started> {
  const day = todayOf(now);
  const [row] = await tx.select().from(t.standups).where(and(eq(t.standups.personId, capture.authorId), eq(t.standups.day, day)));
  const seen = row ? standupOf(row) : draftStandup({ id: `su-${capture.authorId}-${day}`, personId: capture.authorId, day, conversationId: capture.conversationId });
  // Rules 3 and 8: which Atlas chat it came from is the conversation's (phase I's groups are other chats)
  const [conversation] = capture.conversationId ? await tx.select({ atlasChatId: t.conversations.atlasChatId }).from(t.conversations).where(eq(t.conversations.id, capture.conversationId)) : [];
  const fresh = { ...seen, conversationId: capture.conversationId };
  const next = seen.state === "none" || seen.state === "scheduled" || seen.state === "skipped" ? await nextFor(tx, now, fresh, [], capture.id) : null;
  const r = applyStandupEvent(fresh, { type: "START" }, { actorId: capture.authorId, now, next, ownChat: isOwnChat(capture.channel, conversation?.atlasChatId) });
  if (!r.outcome.ok) return { record: seen, started: false };
  const values = { state: r.record.state, conversationId: capture.conversationId, startedBy: capture.id, steps: r.record.steps, current: r.record.current, askedAt: r.record.askedAt, shownIn: capture.id, updatedAt: now };
  if (row) {
    const rows = await tx
      .update(t.standups)
      .set({ ...values, version: nextVersion(t.standups.version) })
      .where(and(eq(t.standups.id, row.id), eq(t.standups.version, row.version)))
      .returning({ id: t.standups.id });
    expectOne(rows, `standup ${row.id}`);
  } else {
    // Two "Start my standup" at once: one row per person per day, so the second starts nothing (SU10)
    const inserted = await tx
      .insert(t.standups)
      .values({ id: r.record.id, personId: r.record.personId, day, ...values, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: t.standups.id });
    if (!inserted.length) return { record: seen, started: false };
  }
  await auditMove(tx, now, r.record, r.outcome as Moved<StandupState>, { actorType: "person", actorId: capture.authorId }, { captureId: capture.id });
  return { record: r.record, started: true };
}

/** Their own standup; anyone else's reads as not found (P10). */
async function ownStandup(tx: Tx, actorId: string, id: string): Promise<Row> {
  const [row] = await tx.select().from(t.standups).where(eq(t.standups.id, id));
  if (!row || row.personId !== actorId) throw new CommandRefused("no such standup", "not_found");
  return row;
}

/** What a button under question n does: a tap answer, Skip, or That's all. */
export type StandupTap = { act: "answer"; tap: TapAnswer } | { act: "skip" } | { act: "stop" };

/**
 * A button under a question. It carries the question's number, so a tap on an earlier question, or one sent
 * twice, changes nothing and says so (rule 6); a tap after the standup ended says how it ended. A tap the
 * question does not offer is refused.
 */
export function tapStandup(ctx: CommandCtx, standupId: string, n: number, tap: StandupTap): Promise<StandupRun> {
  return runCommand(ctx, async (tx) => {
    const row = await ownStandup(tx, ctx.actorId, standupId);
    if (row.state !== "asking") throw new CommandRefused(row.state === "composed" ? "your standup is done; its answers are below" : "your standup has ended");
    if (row.current?.n !== n) throw new CommandRefused("that question was already answered");
    const by: Actor = { actorType: "person", actorId: ctx.actorId };
    if (tap.act === "stop") return move(tx, ctx.now, row, { type: "STOP" }, by, null);
    if (tap.act === "skip") return move(tx, ctx.now, row, { type: "SKIP", n }, by, null);
    if (!TAPS[row.current.kind].includes(tap.tap)) throw new CommandRefused("that question does not take that answer");
    return move(tx, ctx.now, row, { type: "ANSWER", n, answer: { tap: tap.tap, words: null, by: null } }, by, null);
  });
}

/** A typed reply: whether the standup took it as its answer, and the capture it composed, if it did. */
export type TypedRun = { standupId: string; answered: boolean; composed: string | null };

/**
 * A reply in the conversation where their standup is asking is the answer to the question waiting: a tap's
 * words are that tap, "skip" skips, "that's all" stops, and anything else is their own words, read by Atlas
 * with the question when the standup is composed (SU4). "Start my standup" again is read as itself. A standup
 * past its idle time ends when touched, as the timer would a minute later, and the reply is read as a new
 * message (answered false). null when no standup asks there.
 */
export async function answerStandupInWords(tx: Tx, now: Date, reply: { id: string; authorId: string; conversationId: string | null; text: string }): Promise<TypedRun | null> {
  if (!reply.conversationId || standupTopic.rule.test(reply.text.trim().toLowerCase())) return null;
  const [row] = await tx
    .select()
    .from(t.standups)
    .where(and(eq(t.standups.personId, reply.authorId), eq(t.standups.conversationId, reply.conversationId), eq(t.standups.state, "asking"), or(isNull(t.standups.startedBy), ne(t.standups.startedBy, reply.id))));
  if (!row?.current) return null;
  const r = standupOf(row);
  if (r.askedAt && now.getTime() - r.askedAt.getTime() >= config.standupIdleMinutes * 60_000) {
    const ended = await move(tx, now, row, { type: "IDLE" }, { actorType: "rule", actorId: null }, null);
    return { standupId: row.id, answered: false, composed: ended.composed };
  }
  const said = readTypedReply(reply.text, row.current.kind);
  const by: Actor = { actorType: "person", actorId: reply.authorId };
  const event: StandupEvent =
    said.act === "stop" ? { type: "STOP" } : said.act === "skip" ? { type: "SKIP", n: row.current.n } : { type: "ANSWER", n: row.current.n, answer: { ...(said.answer as StandupAnswer), by: reply.id } };
  const done = await move(tx, now, row, event, by, reply.id);
  return { standupId: row.id, answered: true, composed: done.composed };
}

/** Timer standup_idle (rule 5, SU7): a question left config.standupIdleMinutes composes what was answered, or abandons. */
export function runStandupTimers(ctx: { db: Db; now: Date }): Promise<{ composed: string[]; ended: string[] }> {
  return ctx.db.transaction(async (tx) => {
    const cutoff = new Date(ctx.now.getTime() - config.standupIdleMinutes * 60_000);
    const due = await tx.select().from(t.standups).where(and(eq(t.standups.state, "asking"), lte(t.standups.askedAt, cutoff)));
    const composed: string[] = [];
    for (const row of due) {
      const r = await move(tx, ctx.now, row, { type: "IDLE" }, { actorType: "rule", actorId: null }, null);
      if (r.composed) composed.push(r.composed);
    }
    return { composed, ended: due.map((r) => r.id) };
  });
}
