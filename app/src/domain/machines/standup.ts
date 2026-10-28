// M28. Standup (Job). Conversational plan, section 12 (phase J); model checked 27 Oct
// (research/state-machines/js/models/standup.mjs) and built as its fixed variant: the timer reads the skip
// guard first and skips when the M23 rules fail (skipFirst, timerSkips); STOP, or the last SKIP, with nothing
// answered is abandoned, never an empty capture (emptyAbandons); "Start my standup" starts one from none,
// scheduled or skipped (startAfterSkip), and one per person per day counts standups that asked. Atlas asks
// two to four short questions built from the person's open work, rebuilt at each step (SU8); the answers
// become one capture the person reviews and saves as usual (M1, M2). Nothing here changes a record (rule 1).
//   (none) --SCHEDULE--> scheduled                                       phase F: nothing schedules one yet
//   scheduled --TIMER [an update today, or no open work]--> skipped     final unless START; the guard first
//   scheduled --TIMER [the M23 rules fail]--> skipped
//   scheduled --TIMER--> asking(1)
//   none | scheduled | skipped --START [own chat]--> asking(1)          "Start my standup" in the DPM chat (SU1)
//   asking(k) --ANSWER Stuck--> asking(k, "What's it waiting on?")       a follow-up, not counted in the n
//   asking(k) --ANSWER--> asking(k+1), or composed when k = n
//   asking(k) --SKIP--> asking(k+1), or composed when k = n, or abandoned when nothing was answered
//   asking(k) --STOP ("that's all")--> composed, or abandoned when nothing was answered          SU6
//   asking(k) --IDLE [config.standupIdleMinutes]--> composed, or abandoned when nothing was answered   SU7
// composed makes one capture (M1, M2) from the answers, each read with its question as context; that is
// the command's (commands/standup.ts). composed and abandoned are final: no arrow leaves them, so a second
// standup that day is refused (SU10).
import { config } from "../config";
import type { IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";

export const STANDUP_STATES = ["none", "scheduled", "asking", "composed", "skipped", "abandoned"] as const;
export type StandupState = (typeof STANDUP_STATES)[number];
export const STANDUP_FINAL: readonly StandupState[] = ["composed", "abandoned"];

/**
 * What a question asks about. blocked: their blocked work, still stuck? in_progress: done, still going, or
 * stuck? due: work or a milestone due today or tomorrow, still on? new: anything new blocking them? wait: what
 * the work they called stuck waits on. when: when they now expect what they said moves.
 */
export type QuestionKind = "blocked" | "in_progress" | "due" | "new" | "wait" | "when";

/** The answers a question offers as buttons; typed words that say one of them are that tap. */
export const TAP_ANSWERS = ["done", "still_going", "stuck", "moving", "still_stuck", "yes", "moves", "nothing"] as const;
export type TapAnswer = (typeof TAP_ANSWERS)[number];

export const TAP_LABEL: Record<TapAnswer, string> = {
  done: "Done",
  still_going: "Still going",
  stuck: "Stuck",
  moving: "Moving again",
  still_stuck: "Still stuck",
  yes: "Yes",
  moves: "No, it moves",
  nothing: "No",
};

/** Section 12: the tap answers each kind of question offers, in the order the buttons show them. */
export const TAPS: Record<QuestionKind, readonly TapAnswer[]> = {
  blocked: ["still_stuck", "moving", "done"],
  in_progress: ["done", "still_going", "stuck"],
  due: ["yes", "moves"],
  new: ["nothing"],
  wait: [],
  when: [],
};

/** The record a question is about, as the person could read it when it was asked (P10). */
export type StandupSubject = { type: "work_item" | "milestone"; id: string; projectId: string; label: string; number: string | null };

export type StandupQuestion = {
  /** Its place in the standup, from 1. A tap carries it, so a tap on an earlier question changes nothing (rule 6). */
  n: number;
  kind: QuestionKind;
  subject: StandupSubject | null;
  text: string;
  /** The message it is shown under in the chat: the one that started the standup, or the typed reply before it. */
  askedIn: string | null;
};

/** What they said: a tap (or words that say one), or their own words. by: the message typed words came in. */
export type StandupAnswer = { tap: TapAnswer | null; words: string | null; by: string | null };

/** A question that was asked and left: answered, or skipped (answer null). */
export type StandupStep = StandupQuestion & { answer: StandupAnswer | null };

/** How it left asking: the last question was answered or skipped, STOP, or the idle timer. */
export type StandupEnd = "answers" | "stop" | "idle";

export type StandupRecord = {
  id: string;
  personId: string;
  /** One per person per day, in the org time zone (SU10). */
  day: IsoDate;
  conversationId: string | null;
  state: StandupState;
  steps: StandupStep[];
  /** The question waiting for an answer (asking only). */
  current: StandupQuestion | null;
  /** When the current question was asked: the idle timer counts from here (SU7). */
  askedAt: Date | null;
  endedBy: StandupEnd | null;
};

export type StandupEvent =
  /** Phase F: Atlas schedules the day's standup. Nothing sends this yet (the M23 rules are not built). */
  | { type: "SCHEDULE" }
  /** Timer standup_time (config.standupTime), phase F. */
  | { type: "TIMER" }
  /** "Start my standup", or its button, in the person's own chat. */
  | { type: "START" }
  /** A tap, or typed words, for question n. */
  | { type: "ANSWER"; n: number; answer: StandupAnswer }
  | { type: "SKIP"; n: number }
  /** "That's all". */
  | { type: "STOP" }
  /** Timer standup_idle: config.standupIdleMinutes since the current question was asked. */
  | { type: "IDLE" };

type Ctx = {
  record: StandupRecord;
  actorId: string;
  now: Date;
  /** The question that follows, rebuilt now from their open work (SU8); null when there is none. */
  next?: StandupQuestion | null;
  /** TIMER: the skip guard (SU1, SU2) and the M23 rules (working day, not on leave, turned on, under the cap). */
  updatedToday?: boolean;
  hasOpenWork?: boolean;
  rulesPass?: boolean;
  /** START: the message came from their own chat, never a group (rules 3 and 8). */
  ownChat?: boolean;
};

/** SU7: the current question has waited config.standupIdleMinutes. */
export function standupIdle(r: Pick<StandupRecord, "state" | "askedAt">, now: Date): boolean {
  return r.state === "asking" && !!r.askedAt && now.getTime() - r.askedAt.getTime() >= config.standupIdleMinutes * 60_000;
}

const answered = (r: StandupRecord) => r.steps.filter((s) => s.answer !== null).length;

// Rule 10: their own standup, answered only by them
const person = (c: Ctx) => (c.actorId === c.record.personId ? null : "only the person whose standup it is can answer it");
// Rule 6: a button carries its question's number, so a tap on an earlier one, or one sent twice, changes nothing
const current = (c: Ctx, n: number) => (c.record.current?.n === n ? null : "that question was already answered");
const more = (c: Ctx) => (c.next ? null : "that was the last question");
const last = (c: Ctx) => (c.next ? "there is another question" : null);
// emptyAbandons: something answered is composed; nothing answered is abandoned, never an empty capture
const someAnswered = (c: Ctx) => (answered(c.record) > 0 ? null : "nothing was answered");
const noneAnswered = (c: Ctx) => (answered(c.record) > 0 ? "something was answered" : null);
const idle = (c: Ctx) => (standupIdle(c.record, c.now) ? null : `a question waits ${config.standupIdleMinutes} minutes`);
const skipGuard = (c: Ctx) => (c.updatedToday || !c.hasOpenWork ? null : "they have open work and no update today");

export const standupMachine = defineMachine<StandupState, StandupEvent, Ctx>({
  name: "standup",
  states: STANDUP_STATES,
  arrows: [
    { from: ["none"], on: "SCHEDULE", to: "scheduled" },
    // skipFirst: an update today, or no open work, is skipped before anything else is read (SU1, SU2)
    { from: ["scheduled"], on: "TIMER", to: "skipped", guard: skipGuard },
    // timerSkips: a day the M23 rules rule out ends the standup, so it never waits in scheduled (rule 5, SU9)
    { from: ["scheduled"], on: "TIMER", to: "skipped", guard: (c) => (c.rulesPass ? "the M23 rules pass" : null) },
    { from: ["scheduled"], on: "TIMER", to: "asking", guard: more },
    // startAfterSkip: a person who asks gets one, from none, scheduled or a skipped one that never asked (SU1)
    {
      from: ["none", "scheduled", "skipped"],
      on: "START",
      to: "asking",
      guard: (c) => person(c) ?? (c.ownChat === true ? null : "a standup runs only in your own chat") ?? more(c),
    },
    // The "Stuck" follow-up is a next question like any other; the command builds it (section 12)
    { from: ["asking"], on: "ANSWER", to: "asking", guard: (c, e) => person(c) ?? current(c, e.n) ?? more(c) },
    { from: ["asking"], on: "ANSWER", to: "composed", guard: (c, e) => person(c) ?? current(c, e.n) ?? last(c) },
    { from: ["asking"], on: "SKIP", to: "asking", guard: (c, e) => person(c) ?? current(c, e.n) ?? more(c) },
    { from: ["asking"], on: "SKIP", to: "composed", guard: (c, e) => person(c) ?? current(c, e.n) ?? last(c) ?? someAnswered(c) },
    { from: ["asking"], on: "SKIP", to: "abandoned", guard: (c, e) => person(c) ?? current(c, e.n) ?? last(c) ?? noneAnswered(c) },
    { from: ["asking"], on: "STOP", to: "composed", guard: (c) => person(c) ?? someAnswered(c) },
    { from: ["asking"], on: "STOP", to: "abandoned", guard: (c) => person(c) ?? noneAnswered(c) },
    { from: ["asking"], on: "IDLE", to: "composed", guard: (c) => idle(c) ?? someAnswered(c) },
    { from: ["asking"], on: "IDLE", to: "abandoned", guard: (c) => idle(c) ?? noneAnswered(c) },
  ],
});

export type StandupResult = { outcome: Outcome<StandupState>; record: StandupRecord };

/**
 * Applies one event. A refused event returns the record unchanged. An answer or a skip files the current
 * question as a step and asks the next one; leaving asking files nothing more, so what was asked and not
 * answered when they stopped is not asked again today (SU6).
 */
export function applyStandupEvent(record: StandupRecord, event: StandupEvent, ctx: Omit<Ctx, "record">): StandupResult {
  const outcome = transition(standupMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next = ctx.next ?? null;
  const asked = (r: StandupRecord): StandupRecord => (outcome.to === "asking" ? { ...r, current: next, askedAt: ctx.now } : { ...r, current: null, askedAt: null });
  const ended: StandupEnd | null = event.type === "STOP" ? "stop" : event.type === "IDLE" ? "idle" : "answers";
  const after = (r: StandupRecord): StandupRecord => ({ ...asked(r), state: outcome.to, endedBy: STANDUP_FINAL.includes(outcome.to) ? ended : null });
  switch (event.type) {
    case "ANSWER":
      return { outcome, record: after({ ...record, steps: [...record.steps, { ...record.current!, answer: event.answer }] }) };
    case "SKIP":
      return { outcome, record: after({ ...record, steps: [...record.steps, { ...record.current!, answer: null }] }) };
    case "STOP":
    case "IDLE":
      return { outcome, record: after(record) };
    default:
      return { outcome, record: { ...asked(record), state: outcome.to } };
  }
}

/** The day's standup before anything happened to it; nothing is stored unless an event moves it. */
export function draftStandup(fields: Pick<StandupRecord, "id" | "personId" | "day" | "conversationId">): StandupRecord {
  return { ...fields, state: "none", steps: [], current: null, askedAt: null, endedBy: null };
}

/** How many questions about their work were asked; follow-ups and "Anything new blocking you?" are not counted. */
export function workAsked(steps: readonly Pick<StandupStep, "kind">[]): number {
  return steps.filter((s) => s.kind === "blocked" || s.kind === "in_progress" || s.kind === "due").length;
}
