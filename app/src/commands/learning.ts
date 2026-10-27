// Phase S commands (conversational plan, section 21): feedback on an answer, "Help improve Atlas", and
// M36 eval candidates. The person's words, in a candidate or in "What was wrong?", are kept only with
// their OK (LF1); turning the setting off deletes their logged candidates and what they said was wrong
// in the same transaction (LF2). Audit entries say what moved and why, never the words, so deleting a
// candidate leaves none of them behind.
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import * as t from "../db/schema";
import { GROUPS, ORG, PEOPLE, PROJECTS } from "../db/seed/snapshot";
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

/**
 * The person's "Help improve Atlas" as it is now (rule 4: read when the event runs). The row is locked
 * until the transaction ends, so turning it off cannot commit between this read and the words being
 * stored, which its own transaction would then miss (LF2).
 */
async function allows(tx: Tx, personId: string): Promise<boolean> {
  const [p] = await tx.select({ on: t.people.helpImproveAtlas }).from(t.people).where(eq(t.people.id, personId)).for("update");
  return p?.on ?? false;
}

/** A person's name whole and each part of it, as the LF3 check matches them. */
const namesOf = (person: string) => [person, ...person.split(/\s+/).filter((part) => part.length >= 3)];

/** LF3: every name the seed uses; an eval case may name only these. */
const SEED_NAMES = new Set(
  [ORG.name, ...PEOPLE.flatMap((p) => namesOf(p.name)), ...PROJECTS.flatMap((p) => [p.name, ...p.aliases, p.customer ?? ""]), ...GROUPS.map((g) => g.name)].map((n) => n.toLowerCase()),
);

/** LF3: the names DPM holds that the seed does not (its people, projects, customers, groups and orgs), longest first. */
async function notSeedNames(tx: Tx): Promise<string[]> {
  const people = await tx.select({ name: t.people.name }).from(t.people);
  const projects = await tx.select({ name: t.projects.name, aliases: t.projects.aliases, customer: t.projects.customer }).from(t.projects);
  const groups = await tx.select({ name: t.groups.name }).from(t.groups);
  const orgs = await tx.select({ name: t.orgs.name }).from(t.orgs);
  const all = [...people.flatMap((p) => namesOf(p.name)), ...projects.flatMap((p) => [p.name, ...p.aliases, p.customer ?? ""]), ...groups.map((g) => g.name), ...orgs.map((o) => o.name)];
  return [...new Set(all.filter((n) => n.trim() && !SEED_NAMES.has(n.toLowerCase())))].sort((a, b) => b.length - a.length);
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

type Actor = { actorType: "person" | "atlas" | "system" | "rule"; actorId: string | null };
type MoveCtx = { actor: Actor; allows: boolean; maintainer: boolean; notSeed?: readonly string[] };

/** Moves a stored candidate by one event, with its version; an arrow that is not drawn throws. */
async function moveCandidate(tx: Tx, now: Date, row: typeof t.evalCandidates.$inferSelect, event: EvalCandidateEvent, ctx: MoveCtx) {
  const r = applyEvalCandidateEvent(candidateOf(row), event, { actorId: ctx.actor.actorId ?? "rule", allows: ctx.allows, maintainer: ctx.maintainer, notSeed: ctx.notSeed ?? [], now });
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

const dedupKeyOf = (cause: EvalCause, id: string) => `${cause}:${id}`;

/**
 * M36 LOGGED, inside the command that found it (an answer, a thumbs down, a move in review). With the
 * setting off nothing is stored (LF1): the counts come from the answers, feedback and reviews themselves.
 * A second log of the same cause for the same answer or item changes nothing while the first is waiting
 * or decided (rule 6). The words are always the person's; `by` is who found it, the person or Atlas's job.
 */
export async function logCandidate(tx: Tx, now: Date, personId: string, input: NewCandidate, by: Actor = { actorType: "person", actorId: personId }): Promise<EvalCandidateRecord | null> {
  const draft = draftCandidate({ id: randomUUID(), personId, ...input });
  const r = applyEvalCandidateEvent(draft, { type: "LOGGED" }, { actorId: personId, allows: await allows(tx, personId), maintainer: false, notSeed: [], now });
  if (!r.outcome.ok) return null;
  // The unique key leaves deleted candidates out (schema, eval_candidates_dedup_live)
  const inserted = await tx
    .insert(t.evalCandidates)
    .values({ ...r.record, dedupKey: dedupKeyOf(input.cause, input.extractionId ?? input.captureId), createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: t.evalCandidates.id });
  if (!inserted.length) return null;
  await audit(tx, now, { ...by, action: "LOGGED", machine: "eval_candidate", subjectType: "eval_candidate", subjectId: r.record.id, fromState: "none", toState: "logged", captureId: input.captureId, extractionId: input.extractionId ?? null, detail: { cause: input.cause } });
  return r.record;
}

/** The person's thumbs down on this answer still waiting for a maintainer, if any. */
async function waitingThumbsDown(tx: Tx, personId: string, captureId: string) {
  const [row] = await tx
    .select()
    .from(t.evalCandidates)
    .where(and(eq(t.evalCandidates.dedupKey, dedupKeyOf("thumbs_down", captureId)), eq(t.evalCandidates.state, "logged"), eq(t.evalCandidates.personId, personId)));
  return row ?? null;
}

// ---- Feedback on an answer ----

export type Feedback = { rating: "up" | "down"; wrong?: string | null };

/**
 * A thumbs up or down on an answer, with "What was wrong?" on a thumbs down. One per person per answer;
 * giving it again changes it. An answer from days ago is accepted and tied to its own "as of" (LF6). A
 * thumbs down is a candidate for the eval set when the person allows it (LF1, LF4), and changing it to a
 * thumbs up takes the candidate back. "What was wrong?" is their words too, so it is kept only while
 * "Help improve Atlas" is on (LF1); with it off the thumbs down alone is kept and `wrong` comes back null.
 */
export function giveFeedback(ctx: CommandCtx, captureId: string, feedback: Feedback): Promise<{ rating: "up" | "down"; wrong: string | null; logged: boolean }> {
  return runCommand(ctx, async (tx) => {
    const [capture] = await tx.select().from(t.captures).where(eq(t.captures.id, captureId));
    // Someone else's answer reads exactly like one that does not exist (P10)
    if (!capture || capture.authorId !== ctx.actorId || !capture.answer) throw new CommandRefused("no answer to give feedback on", "not_found");
    const said = feedback.rating === "down" ? feedback.wrong?.trim() || null : null;
    if (said && said.length > WRONG_MAX) throw new CommandRefused(`say what was wrong in at most ${WRONG_MAX} characters`);
    const on = await allows(tx, ctx.actorId);
    const wrong = on ? said : null;
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

    const me: Actor = { actorType: "person", actorId: ctx.actorId };
    const waiting = await waitingThumbsDown(tx, ctx.actorId, captureId);
    // LF4: a thumbs down changed to a thumbs up leaves no complaint for a maintainer to judge
    if (feedback.rating === "up") {
      if (waiting) await moveCandidate(tx, ctx.now, waiting, { type: "WITHDRAWN" }, { actor: me, allows: on, maintainer: false });
      return { rating: feedback.rating, wrong, logged: false };
    }
    const detail: EvalCandidateDetail = { topic: answer.topic, answer: answer.text, wrong };
    if (!waiting) {
      const logged = !!(await logCandidate(tx, ctx.now, ctx.actorId, { cause: "thumbs_down", captureId, text: capture.text, detail }));
      return { rating: feedback.rating, wrong, logged };
    }
    // "What was wrong?" given after the thumbs down joins the candidate while it waits, as any change does:
    // with its version, so a maintainer's decision started before it is stale, and an audit entry
    if ((waiting.detail?.wrong ?? null) !== wrong) {
      const rows = await tx
        .update(t.evalCandidates)
        .set({ detail, version: nextVersion(t.evalCandidates.version), updatedAt: ctx.now })
        .where(and(eq(t.evalCandidates.id, waiting.id), eq(t.evalCandidates.version, waiting.version)))
        .returning({ id: t.evalCandidates.id });
      expectOne(rows, `eval candidate ${waiting.id}`);
      await audit(tx, ctx.now, { ...me, action: "WRONG_GIVEN", machine: "eval_candidate", subjectType: "eval_candidate", subjectId: waiting.id, fromState: "logged", toState: "logged", captureId, detail: { cause: waiting.cause } });
    }
    return { rating: feedback.rating, wrong, logged: false };
  });
}

// ---- "Help improve Atlas" ----

/**
 * The person's own setting. Turning it off deletes every candidate of theirs still waiting and every
 * "What was wrong?" they gave, in this transaction, so no maintainer reads their words after they said no
 * (LF2); their thumbs stay, for the counts. Accepted cases were anonymised already and stay; dismissed
 * ones kept none of their words.
 */
export function setHelpImproveAtlas(ctx: CommandCtx, on: boolean): Promise<{ on: boolean; deleted: number; cleared: number }> {
  return runCommand(ctx, async (tx) => {
    // The update locks the person's row, so a candidate being logged waits for this to commit (LF2)
    const rows = await tx.update(t.people).set({ helpImproveAtlas: on, updatedAt: ctx.now }).where(eq(t.people.id, ctx.actorId)).returning({ id: t.people.id });
    if (!rows.length) throw new CommandRefused(`no person ${ctx.actorId}`, "not_found");
    let deleted = 0;
    let cleared = 0;
    if (!on) {
      const waiting = await tx.select().from(t.evalCandidates).where(and(eq(t.evalCandidates.personId, ctx.actorId), eq(t.evalCandidates.state, "logged")));
      for (const row of waiting) await moveCandidate(tx, ctx.now, row, { type: "OPTED_OUT" }, { actor: { actorType: "person", actorId: ctx.actorId }, allows: false, maintainer: false });
      deleted = waiting.length;
      const said = await tx
        .update(t.answerFeedback)
        .set({ wrong: null, version: nextVersion(t.answerFeedback.version), updatedAt: ctx.now })
        .where(and(eq(t.answerFeedback.personId, ctx.actorId), isNotNull(t.answerFeedback.wrong)))
        .returning({ captureId: t.answerFeedback.captureId });
      cleared = said.length;
    }
    await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "SETTING", subjectType: "person", subjectId: ctx.actorId, detail: { helpImproveAtlas: on, deleted, cleared } });
    return { on, deleted, cleared };
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
    const notSeed = event.type === "ACCEPT" ? await notSeedNames(tx) : [];
    return moveCandidate(tx, ctx.now, row, event, { actor: { actorType: "system", actorId: `maintainer:${ctx.maintainer}` }, allows: await allows(tx, row.personId), maintainer: true, notSeed });
  });
}

/**
 * LF3: the case enters the eval set anonymised, with seed names and ids, and what Atlas should have done.
 * The person's own words, or a name DPM holds that the seed does not, are refused.
 */
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
