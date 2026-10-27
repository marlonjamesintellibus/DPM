// Phase S commands (conversational plan, section 21): feedback on an answer, "Help improve Atlas", and
// M36 eval candidates. A candidate holds the person's words only with their OK (LF1); turning the
// setting off deletes their logged candidates in the same transaction (LF2). Audit entries say what
// moved and why, never the words, so deleting a candidate leaves none of them behind.
import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { DAY_MS } from "../domain/dates";
import {
  applyEvalCandidateEvent,
  draftCandidate,
  type EvalCandidateDetail,
  type EvalCandidateEvent,
  type EvalCandidateRecord,
  type EvalCause,
} from "../domain/machines/eval-candidate";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, type CommandCtx } from "./core";

export const WRONG_MAX = 500;

/** The person's "Help improve Atlas" as it is now (rule 4: read when the event runs). */
async function allows(tx: Tx, personId: string): Promise<boolean> {
  const [p] = await tx.select({ on: t.people.helpImproveAtlas }).from(t.people).where(eq(t.people.id, personId));
  return p?.on ?? false;
}

function candidateOf(row: typeof t.evalCandidates.$inferSelect): EvalCandidateRecord {
  return {
    id: row.id,
    personId: row.personId,
    cause: row.cause,
    captureId: row.captureId,
    extractionId: row.extractionId,
    state: row.state,
    text: row.text,
    detail: row.detail,
    loggedAt: row.loggedAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    note: row.note,
    caseText: row.caseText,
    expected: row.expected,
  };
}

type Actor = { actorType: "person" | "system" | "rule"; actorId: string | null };

/** Moves a stored candidate by one event, with its version; refused events throw (rule 2). */
async function moveCandidate(tx: Tx, now: Date, row: typeof t.evalCandidates.$inferSelect, event: EvalCandidateEvent, ctx: { actor: Actor; allows: boolean; maintainer: boolean }) {
  const r = applyEvalCandidateEvent(candidateOf(row), event, { actorId: ctx.actor.actorId ?? "rule", allows: ctx.allows, maintainer: ctx.maintainer, now });
  const outcome = moved(r.outcome);
  const { id: _id, personId: _p, cause: _c, captureId: _cap, extractionId: _e, ...fields } = r.record;
  const rows = await tx
    .update(t.evalCandidates)
    .set({ ...fields, version: nextVersion(t.evalCandidates.version), updatedAt: now })
    .where(and(eq(t.evalCandidates.id, row.id), eq(t.evalCandidates.version, row.version)))
    .returning({ id: t.evalCandidates.id });
  expectOne(rows, `eval candidate ${row.id}`);
  await audit(tx, now, { ...ctx.actor, action: event.type, machine: "eval_candidate", subjectType: "eval_candidate", subjectId: row.id, fromState: outcome.from, toState: outcome.to, captureId: row.captureId, detail: { cause: row.cause } });
  return r.record;
}

export type NewCandidate = { cause: EvalCause; captureId: string; extractionId?: string | null; text: string; detail: EvalCandidateDetail };

/**
 * M36 LOGGED, inside the command that found it (an answer, a thumbs down, a move in review). With the
 * setting off nothing is stored (LF1): the counts come from the answers, feedback and reviews themselves.
 * A second log of the same cause for the same answer or item changes nothing (rule 6).
 */
export async function logCandidate(tx: Tx, now: Date, personId: string, input: NewCandidate): Promise<EvalCandidateRecord | null> {
  const draft = draftCandidate({ id: randomUUID(), personId, ...input });
  const r = applyEvalCandidateEvent(draft, { type: "LOGGED" }, { actorId: personId, allows: await allows(tx, personId), maintainer: false, now });
  if (!r.outcome.ok) return null;
  const dedupKey = `${input.cause}:${input.extractionId ?? input.captureId}`;
  const inserted = await tx
    .insert(t.evalCandidates)
    .values({ ...r.record, dedupKey, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: t.evalCandidates.dedupKey })
    .returning({ id: t.evalCandidates.id });
  if (!inserted.length) return null;
  await audit(tx, now, { actorType: "person", actorId: personId, action: "LOGGED", machine: "eval_candidate", subjectType: "eval_candidate", subjectId: r.record.id, fromState: "none", toState: "logged", captureId: input.captureId, extractionId: input.extractionId ?? null, detail: { cause: input.cause } });
  return r.record;
}

// ---- Feedback on an answer ----

export type Feedback = { rating: "up" | "down"; wrong?: string | null };

/**
 * A thumbs up or down on an answer, with "What was wrong?" on a thumbs down. One per person per answer;
 * giving it again changes it. An answer from days ago is accepted and tied to its own "as of" (LF6). A
 * thumbs down is a candidate for the eval set when the person allows it (LF1, LF4).
 */
export function giveFeedback(ctx: CommandCtx, captureId: string, feedback: Feedback): Promise<{ rating: "up" | "down"; wrong: string | null; logged: boolean }> {
  return runCommand(ctx, async (tx) => {
    const [capture] = await tx.select().from(t.captures).where(eq(t.captures.id, captureId));
    // Someone else's answer reads exactly like one that does not exist (P10)
    if (!capture || capture.authorId !== ctx.actorId || !capture.answer) throw new CommandRefused("no answer to give feedback on", "not_found");
    const wrong = feedback.rating === "down" ? feedback.wrong?.trim() || null : null;
    if (wrong && wrong.length > WRONG_MAX) throw new CommandRefused(`say what was wrong in at most ${WRONG_MAX} characters`);
    const answer = capture.answer;
    const values = { rating: feedback.rating, wrong, topic: answer.topic, answerAsOf: new Date(answer.asOf), updatedAt: ctx.now };
    const [before] = await tx.select().from(t.answerFeedback).where(and(eq(t.answerFeedback.captureId, captureId), eq(t.answerFeedback.personId, ctx.actorId)));
    if (before) {
      const rows = await tx
        .update(t.answerFeedback)
        .set({ ...values, version: nextVersion(t.answerFeedback.version) })
        .where(and(eq(t.answerFeedback.captureId, captureId), eq(t.answerFeedback.personId, ctx.actorId), eq(t.answerFeedback.version, before.version)))
        .returning({ v: t.answerFeedback.version });
      expectOne(rows, `feedback on ${captureId}`);
    } else await tx.insert(t.answerFeedback).values({ captureId, personId: ctx.actorId, ...values, createdAt: ctx.now });
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "FEEDBACK", subjectType: "capture", subjectId: captureId, captureId, detail: { rating: feedback.rating, before: before?.rating ?? null } });

    let logged = false;
    if (feedback.rating === "down") {
      const detail: EvalCandidateDetail = { topic: answer.topic, answer: answer.text, wrong };
      logged = !!(await logCandidate(tx, ctx.now, ctx.actorId, { cause: "thumbs_down", captureId, text: capture.text, detail }));
      if (!logged && (await allows(tx, ctx.actorId))) {
        // "What was wrong?" given after the thumbs down joins the candidate while it waits
        await tx
          .update(t.evalCandidates)
          .set({ detail, updatedAt: ctx.now })
          .where(and(eq(t.evalCandidates.dedupKey, `thumbs_down:${captureId}`), eq(t.evalCandidates.state, "logged"), eq(t.evalCandidates.personId, ctx.actorId)));
      }
    }
    return { rating: feedback.rating, wrong, logged };
  });
}

// ---- "Help improve Atlas" ----

/**
 * The person's own setting. Turning it off deletes every candidate of theirs still waiting, in this
 * transaction, so no maintainer reads their words after they said no (LF2). Accepted cases were
 * anonymised already and stay; dismissed ones kept none of their words.
 */
export function setHelpImproveAtlas(ctx: CommandCtx, on: boolean): Promise<{ on: boolean; deleted: number }> {
  return runCommand(ctx, async (tx) => {
    const rows = await tx.update(t.people).set({ helpImproveAtlas: on, updatedAt: ctx.now }).where(eq(t.people.id, ctx.actorId)).returning({ id: t.people.id });
    if (!rows.length) throw new CommandRefused(`no person ${ctx.actorId}`, "not_found");
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "SETTING", subjectType: "person", subjectId: ctx.actorId, detail: { helpImproveAtlas: on } });
    if (on) return { on, deleted: 0 };
    const waiting = await tx.select().from(t.evalCandidates).where(and(eq(t.evalCandidates.personId, ctx.actorId), eq(t.evalCandidates.state, "logged")));
    for (const row of waiting) await moveCandidate(tx, ctx.now, row, { type: "OPTED_OUT" }, { actor: { actorType: "person", actorId: ctx.actorId }, allows: false, maintainer: false });
    return { on, deleted: waiting.length };
  });
}

// ---- A maintainer decides (ACCEPT, DISMISS) ----

/**
 * There is no maintainer role in DPM yet (CD21): whoever runs `pnpm atlas:usage` against the database is
 * one, and names themselves. The person's OK is checked again when the decision runs (LF2).
 */
export type MaintainerCtx = { db: Db; now: Date; maintainer: string };

async function decide(ctx: MaintainerCtx, candidateId: string, event: Extract<EvalCandidateEvent, { type: "ACCEPT" | "DISMISS" }>): Promise<EvalCandidateRecord> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.evalCandidates).where(eq(t.evalCandidates.id, candidateId));
    if (!row) throw new CommandRefused(`no candidate ${candidateId}`, "not_found");
    return moveCandidate(tx, ctx.now, row, event, { actor: { actorType: "system", actorId: `maintainer:${ctx.maintainer}` }, allows: await allows(tx, row.personId), maintainer: true });
  });
}

/** LF3: the case enters the eval set with seed names and ids, and what Atlas should have done. */
export function acceptCandidate(ctx: MaintainerCtx, candidateId: string, accepted: { caseText: string; expected: string }): Promise<EvalCandidateRecord> {
  return decide(ctx, candidateId, { type: "ACCEPT", ...accepted });
}

/** LF3, LF4: dismissed with a note, or outright when it holds a client's data. */
export function dismissCandidate(ctx: MaintainerCtx, candidateId: string, note: string | null): Promise<EvalCandidateRecord> {
  return decide(ctx, candidateId, { type: "DISMISS", note });
}

/** Timer evalCandidateDays (rule 5): a candidate nobody decided is deleted, with the person's words. */
export function runEvalCandidateTimers(ctx: { db: Db; now: Date }): Promise<{ deleted: string[] }> {
  return ctx.db.transaction(async (tx) => {
    const cutoff = new Date(ctx.now.getTime() - config.evalCandidateDays * DAY_MS);
    const due = await tx.select().from(t.evalCandidates).where(and(eq(t.evalCandidates.state, "logged"), lte(t.evalCandidates.loggedAt, cutoff)));
    for (const row of due) await moveCandidate(tx, ctx.now, row, { type: "EXPIRE" }, { actor: { actorType: "rule", actorId: null }, allows: false, maintainer: false });
    return { deleted: due.map((r) => r.id) };
  });
}
