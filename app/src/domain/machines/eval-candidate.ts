// M36. Eval candidate (Ask, for a DPM maintainer). Conversational plan, section 21 (phase S); model
// checked 27 Oct (research/state-machines/js/models/evalCandidate.mjs). An answer DPM could not give
// ("other" or "unclear"), a thumbs down, or an item moved to another project in review is logged as a
// candidate for the eval set, so the team building DPM learns what to fix. The person's words are theirs
// (M1): a candidate holds them only while "Help improve Atlas" is on (LF1), turning it off deletes their
// logged candidates (LF2), and no final state keeps the original words. Counts are read from the answers,
// feedback and reviews themselves, so they are kept for everyone without a candidate.
import { config } from "../config";
import { DAY_MS } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";

export const EVAL_CANDIDATE_STATES = ["none", "logged", "in_eval_set", "dismissed", "deleted"] as const;
export type EvalCandidateState = (typeof EVAL_CANDIDATE_STATES)[number];

/** Why it was logged: an answer DPM could not give, a thumbs down, or a move in review. */
export const EVAL_CAUSES = ["other", "unclear", "thumbs_down", "moved"] as const;
export type EvalCause = (typeof EVAL_CAUSES)[number];

/** What DPM did with the words, for the maintainer to judge; never shown to anyone else. */
export type EvalCandidateDetail = {
  topic?: string;
  /** DPM's answer as given (its own sentence, or Atlas's wording). */
  answer?: string;
  /** "What was wrong?" with a thumbs down: the person's words too, so it goes with the text. */
  wrong?: string | null;
  /** A move in review: the item's kind and the projects it moved between. */
  kind?: string;
  fromProject?: string | null;
  toProject?: string | null;
};

export type EvalCandidateRecord = {
  id: string;
  /** Whose words it holds: the person who asked, gave the thumbs down, or moved the item. */
  personId: string;
  cause: EvalCause;
  captureId: string;
  extractionId: string | null;
  state: EvalCandidateState;
  /** The person's words. Only while logged; every final state drops them (dropText). */
  text: string | null;
  detail: EvalCandidateDetail | null;
  loggedAt: Date | null;
  /** The maintainer who accepted or dismissed it. There is no maintainer role yet: the usage script names one. */
  decidedBy: string | null;
  decidedAt: Date | null;
  /** DISMISS: why, for example "the answer was right" (LF4). */
  note: string | null;
  /** ACCEPT: the words with seed names and ids, and what Atlas should do; this is the eval case (LF3). */
  caseText: string | null;
  expected: string | null;
};

export type EvalCandidateEvent =
  | { type: "LOGGED" }
  | { type: "ACCEPT"; caseText: string; expected: string }
  | { type: "DISMISS"; note: string | null }
  /** Timer: evalCandidateDays after it was logged. */
  | { type: "EXPIRE" }
  /** LF2: the person turned "Help improve Atlas" off; runs with the setting, in the same transaction. */
  | { type: "OPTED_OUT" };

type Ctx = {
  record: EvalCandidateRecord;
  /** Who acts: the person for LOGGED and OPTED_OUT, the maintainer for ACCEPT and DISMISS. */
  actorId: string;
  /** The person's "Help improve Atlas", read when the event runs (rule 4). */
  allows: boolean;
  /** The actor is a DPM maintainer now (rule 4). */
  maintainer: boolean;
  now: Date;
};

export const CASE_TEXT_MAX = 2000;
const OFF = "Help improve Atlas is off, so only the counts are kept";

/** Rule 5: a candidate nobody decides is deleted after config.evalCandidateDays. */
export function candidateExpired(r: EvalCandidateRecord, now: Date): boolean {
  return r.state === "logged" && r.loggedAt !== null && now.getTime() - r.loggedAt.getTime() >= config.evalCandidateDays * DAY_MS;
}

// LF1: only the person's own words, and only with their OK
const loggedGuard = (c: Ctx) => (c.record.personId !== c.actorId ? "only the person's own words are logged" : c.allows ? null : OFF);

// Rule 4, LF2: a maintainer decides, and the person still allows it when they do
const deciderGuard = (c: Ctx) => (!c.maintainer ? "only a DPM maintainer decides a candidate" : c.allows ? null : "the person no longer allows it");

// LF3: the case enters the eval set with seed names and ids, and says what Atlas should have done
function acceptGuard(c: Ctx, e: Extract<EvalCandidateEvent, { type: "ACCEPT" }>): string | null {
  const refused = deciderGuard(c);
  if (refused) return refused;
  if (!e.caseText.trim()) return "give the words with seed names and ids";
  if (e.caseText.length > CASE_TEXT_MAX) return `the words are at most ${CASE_TEXT_MAX} characters`;
  return e.expected.trim() ? null : "say what Atlas should have done";
}

export const evalCandidateMachine = defineMachine<EvalCandidateState, EvalCandidateEvent, Ctx>({
  name: "eval_candidate",
  states: EVAL_CANDIDATE_STATES,
  arrows: [
    { from: ["none"], on: "LOGGED", to: "logged", guard: loggedGuard },
    { from: ["logged"], on: "ACCEPT", to: "in_eval_set", guard: acceptGuard },
    { from: ["logged"], on: "DISMISS", to: "dismissed", guard: deciderGuard },
    { from: ["logged"], on: "EXPIRE", to: "deleted", guard: (c) => (candidateExpired(c.record, c.now) ? null : `kept for ${config.evalCandidateDays} days`) },
    // LF2: added by the model check (fix optOut); the plan's table had no way out for it
    { from: ["logged"], on: "OPTED_OUT", to: "deleted", guard: (c) => (c.actorId !== c.record.personId ? "only the person turns it off" : c.allows ? "Help improve Atlas is still on" : null) },
  ],
});

export type EvalCandidateResult = { outcome: Outcome<EvalCandidateState>; record: EvalCandidateRecord };

/** Applies one event. A refused event returns the record unchanged; a final state keeps none of the person's words. */
export function applyEvalCandidateEvent(record: EvalCandidateRecord, event: EvalCandidateEvent, ctx: Omit<Ctx, "record">): EvalCandidateResult {
  const outcome = transition(evalCandidateMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next = { ...record, state: outcome.to };
  const forget = { text: null, detail: null };
  switch (event.type) {
    case "LOGGED":
      return { outcome, record: { ...next, loggedAt: ctx.now } };
    case "ACCEPT":
      return { outcome, record: { ...next, ...forget, caseText: event.caseText.trim(), expected: event.expected.trim(), decidedBy: ctx.actorId, decidedAt: ctx.now } };
    case "DISMISS":
      return { outcome, record: { ...next, ...forget, note: event.note?.trim() || null, decidedBy: ctx.actorId, decidedAt: ctx.now } };
    default:
      return { outcome, record: { ...next, ...forget } };
  }
}

/** A candidate about to be logged; nothing is stored unless LOGGED is allowed (LF1). */
export function draftCandidate(fields: { id: string; personId: string; cause: EvalCause; captureId: string; extractionId?: string | null; text: string; detail: EvalCandidateDetail }): EvalCandidateRecord {
  return {
    ...fields,
    extractionId: fields.extractionId ?? null,
    state: "none",
    loggedAt: null,
    decidedBy: null,
    decidedAt: null,
    note: null,
    caseText: null,
    expected: null,
  };
}
