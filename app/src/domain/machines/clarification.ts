// M21. Clarification (Ask). Conversational plan, section 6 (phase D); model checked 27 Oct
// (research/state-machines/js/models/clarification.mjs) and built as its fixed variant: asked only in the
// author's own chat (AskIn "own"), in the chat only when there are 2 or 3 options (ProjectCap; with more,
// only the review card asks), and a question about a command, which has no review card to hand the choice
// to, closes on its timer (CommandTimerCloses: "Nothing was done; ask again"). When Atlas is unsure which
// project or record an item of an update means, or which line of the open answer a reply decides (AC6,
// AC7), DPM asks in the chat with the options as buttons. Answering only chooses: the item is routed or
// matched and still waits in the review, and a line becomes the M20 card the author confirms. Wave 4
// (CD50): a question whose words fit 2 or 3 of the asker's projects or people (EX5, PP2) is asked the same
// way, and choosing one answers it as if it had named that one; like a line's, it has no review card, so its
// timer closes it. Nothing here changes a record (rule 1).
//   (none) --ASK [own chat, 2 or 3 options]--> asked                        CHECKS_DONE
//   asked --ANSWER(option) [the author; an option still allowed now]--> resolved
//   asked --REVIEW_OPENED [about an item]--> handed_to_review               CL3
//   asked --EXPIRE [2 hours, about an item]--> handed_to_review
//   asked --EXPIRE [2 hours, about a line or a question]--> closed         the model check's fix; phase O's
//                                                                           call brief is a question so (MT9)
//   asked --CLOSE--> closed                                                 the capture is discarded or expires (CL6),
//                                                                           or a correction withdrew its item (CV10)
// The plan's "asked --ANSWERED(not an option)--> asked" is not an event: words that fit no option are not an
// answer, so they are read as a new message and the question stays as it is (CL1, CL2). An option that is no
// longer allowed (CL5) is a refused ANSWER, which leaves it asked too.
import { config } from "../config";
import { defineMachine, transition, type Outcome } from "../machine";
import type { AskedQuestion } from "../question";
import type { WordAct } from "./chat-command";

export const CLARIFICATION_STATES = ["none", "asked", "resolved", "handed_to_review", "closed"] as const;
export type ClarificationState = (typeof CLARIFICATION_STATES)[number];

/**
 * What it asks about. project: an item that is choose_project (M14). record: an update whose words fit 2 or
 * 3 records (a vague "Worked on the feed", plan phase J). line: a reply that decides a line of the open
 * answer and fits 2 or 3 of them (phase B, AC6, AC7). question: a question whose subject fits 2 or 3 of the
 * asker's own projects or people (CD50: EX5, PP2), and phase O's request for a call brief whose words fit 2 or 3
 * of their projects ("Prep me for the Sprouts call", MT9), asked as a question about projects.
 */
export type ClarifyAbout = "project" | "record" | "line" | "question";

/** CD50: what a question's options are: projects the asker may ask about (EX5), or people they share one with (PP2). */
export type QuestionFits = "project" | "person";

/**
 * One button: a project id, a record id, a line number as text, or a person's id, with the words the button
 * shows and the project it is in, so the chat shows only the options the author may still read (P10). A
 * question's options are in no one project (null): each is shown while it still fits what the asker reads.
 */
export type ClarifyOption = { id: string; label: string; projectId: string | null };

/** At most three options (section 6); with more, the review card asks (ProjectCap). */
export const MAX_OPTIONS = 3;

/**
 * How it left asked when it was not answered: the review was opened, its timer fired, the capture ended, or a
 * later correction withdrew the item it asks about (CV10).
 */
export type EndedBy = "review" | "timer" | "capture" | "corrected";

export type ClarificationRecord = {
  id: string;
  /** The message it asks about; at most one clarification per capture (section 6). */
  captureId: string;
  authorId: string;
  about: ClarifyAbout;
  /** project and record: the item it asks about (CD23: the first unsure one in the message). */
  extractionId: string | null;
  /** line: the answer whose lines it offers, the act the reply said and its reason. */
  command: { answerCaptureId: string; act: WordAct; reason: string | null } | null;
  /** question: what was asked, as the checks kept it, and what its options are; answered again with the one chosen. */
  question: { asked: AskedQuestion; fits: QuestionFits } | null;
  /** The words it asks about, as the author said them. */
  quote: string;
  options: ClarifyOption[];
  state: ClarificationState;
  /** The option chosen (resolved only). */
  chosen: string | null;
  /** A typed answer's message (CL2); null for a button. */
  answeredBy: string | null;
  endedBy: EndedBy | null;
  createdAt: Date;
  decidedAt: Date | null;
};

export type ClarificationEvent =
  /** CHECKS_DONE: the read found an item or a reply it is unsure about. */
  | { type: "ASK" }
  /** A button (it carries the capture id), or typed words that fit exactly one option (CL2, CL4). */
  | { type: "ANSWER"; option: string; answeredBy?: string | null }
  /** M2 OPEN_REVIEW: the review card holds the choice from here (CL3). */
  | { type: "REVIEW_OPENED" }
  /** Timer clarify_expiry: config.clarifyExpiryHours after it was asked (CD2). */
  | { type: "EXPIRE" }
  /** The capture is discarded or expires (CL6), or a correction withdrew its item (CV10, rule 5). */
  | { type: "CLOSE"; because?: "capture" | "corrected" };

type Ctx = {
  record: ClarificationRecord;
  actorId: string;
  now: Date;
  /** ASK: the message came from the author's own chat, never a group (rules 3 and 8). */
  ownChat?: boolean;
  /** ANSWER: the option is still one the author may choose, read now (rule 4, CL5). */
  allowed?: boolean;
};

/** Section 6, ProjectCap: asked in the chat only with 2 or 3 options. */
export const askable = (n: number) => n >= 2 && n <= MAX_OPTIONS;

/** Rule 5: a question nobody answers ends after config.clarifyExpiryHours. */
export function clarificationExpired(r: Pick<ClarificationRecord, "state" | "createdAt">, now: Date): boolean {
  return r.state === "asked" && now.getTime() - r.createdAt.getTime() >= config.clarifyExpiryHours * 3_600_000;
}

/** Rule 10: the question is the author's own, answered only by them. */
const authorGuard = (c: Ctx) => (c.actorId === c.record.authorId ? null : "only the person who sent the message can answer");

// The model check's fix: a review card holds an item's choice; nothing holds a line's, nor a question's (CD50)
const NO_REVIEW: Partial<Record<ClarifyAbout, string>> = { line: "a reply that decides a line has no review card", question: "a question has no review card" };
const hasReview = (c: Ctx) => NO_REVIEW[c.record.about] ?? null;
const noReview = (c: Ctx) => (NO_REVIEW[c.record.about] ? null : "an item's choice goes to its review");
const expired = (c: Ctx) => (clarificationExpired(c.record, c.now) ? null : `a question stays open ${config.clarifyExpiryHours} hours`);

function answerGuard(c: Ctx, e: Extract<ClarificationEvent, { type: "ANSWER" }>): string | null {
  if (!c.record.options.some((o) => o.id === e.option)) return "that is not one of the options";
  // CL5: an option cancelled, or on a project they left, since it was asked; the others still work
  return authorGuard(c) ?? (c.allowed === true ? null : "you can't choose that one any more");
}

export const clarificationMachine = defineMachine<ClarificationState, ClarificationEvent, Ctx>({
  name: "clarification",
  states: CLARIFICATION_STATES,
  arrows: [
    // AskIn "own" and ProjectCap: the author's own chat, 2 or 3 options each the checks accept
    {
      from: ["none"],
      on: "ASK",
      to: "asked",
      guard: (c) => (c.ownChat !== true ? "asked only in the author's own chat" : askable(c.record.options.length) ? null : `asked in the chat only with 2 or ${MAX_OPTIONS} options`),
    },
    { from: ["asked"], on: "ANSWER", to: "resolved", guard: answerGuard },
    { from: ["asked"], on: "REVIEW_OPENED", to: "handed_to_review", guard: hasReview },
    { from: ["asked"], on: "EXPIRE", to: "handed_to_review", guard: (c) => expired(c) ?? hasReview(c) },
    { from: ["asked"], on: "EXPIRE", to: "closed", guard: (c) => expired(c) ?? noReview(c) },
    { from: ["asked"], on: "CLOSE", to: "closed" },
  ],
});

export type ClarificationResult = { outcome: Outcome<ClarificationState>; record: ClarificationRecord };

/** Applies one event. A refused event returns the record unchanged. */
export function applyClarificationEvent(record: ClarificationRecord, event: ClarificationEvent, ctx: Omit<Ctx, "record">): ClarificationResult {
  const outcome = transition(clarificationMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: ClarificationRecord = { ...record, state: outcome.to };
  switch (event.type) {
    case "ANSWER":
      return { outcome, record: { ...next, chosen: event.option, answeredBy: event.answeredBy ?? null, decidedAt: ctx.now } };
    case "REVIEW_OPENED":
      return { outcome, record: { ...next, endedBy: "review", decidedAt: ctx.now } };
    case "EXPIRE":
      return { outcome, record: { ...next, endedBy: "timer", decidedAt: ctx.now } };
    case "CLOSE":
      return { outcome, record: { ...next, endedBy: event.because ?? "capture", decidedAt: ctx.now } };
    default:
      return { outcome, record: next };
  }
}

/** A question about to be asked; nothing is stored unless ASK moves it. */
export function draftClarification(fields: Omit<ClarificationRecord, "state" | "chosen" | "answeredBy" | "endedBy" | "decidedAt" | "question"> & Partial<Pick<ClarificationRecord, "question">>): ClarificationRecord {
  return { question: null, ...fields, state: "none", chosen: null, answeredBy: null, endedBy: null, decidedAt: null };
}

// ---- What the chat says ----

/** "A", "A or B", "A, B or C". */
function either(labels: readonly string[]): string {
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}` : (labels[0] ?? "");
}

/** The words it asks about, cut to a line and without the end of the sentence. */
function said(quote: string): string {
  const q = quote.trim().replace(/[.!?]+$/, "");
  return q.length > 60 ? `${q.slice(0, q.lastIndexOf(" ", 60) > 20 ? q.lastIndexOf(" ", 60) : 60)}…` : q;
}

/** Phase O, MT9: a question asking which project a call brief is for ("Prep me for the Sprouts call"). */
const callBrief = (r: Pick<ClarificationRecord, "question">) => r.question?.asked.topic === "draft" && r.question.asked.draft === "prep";

/**
 * The question, in plain words: "For "Worked on the store feed", do you mean #151 Store sales feed access
 * or #152 Store feed connector?" Only the options it was asked with, which the author could read then.
 */
export function clarifyQuestion(r: Pick<ClarificationRecord, "about" | "quote" | "options" | "question">): string {
  const labels = r.options.map((o) => o.label);
  switch (r.about) {
    case "question":
      // CD50: the question is on screen just above; only which one is asked. Phase O, MT9: a call brief says so
      if (callBrief(r)) return `Which project is the call about: ${either(labels)}?`;
      return r.question?.fits === "person" ? `Who do you mean: ${either(labels)}?` : `Which project do you mean: ${either(labels)}?`;
    case "record":
      return `For "${said(r.quote)}", do you mean ${either(labels)}?`;
    case "project":
      return `Which project is "${said(r.quote)}" for: ${either(labels)}?`;
    case "line":
      return `Did you mean ${either(labels.map((l) => `"${l}"`))}?`;
  }
}

/** What the chat shows once it is no longer asked. `label` is the chosen option's, when the author may still read it. */
export function clarifyOutcomeText(r: Pick<ClarificationRecord, "state" | "about" | "endedBy" | "question">, label: string | null): string | null {
  switch (r.state) {
    case "resolved":
      if (r.about === "line") return label ? `Got it: "${label}".` : "Got it.";
      // CD50: the answer follows, as if the question had named it; phase O's call brief is drafted (MT9)
      if (r.about === "question") return label ? `Got it: ${label}.${callBrief(r) ? " Your brief follows." : ""}` : "Got it.";
      return `Got it${label ? `: ${label}` : ""}. It's in your review, waiting for your OK.`;
    case "handed_to_review":
      // CL3: the review card holds the choice
      return r.endedBy === "review" ? "Chosen in review." : "I left this for your review: choose it there.";
    case "closed":
      // CD50: a question's timer closes it quietly, with nothing done and nobody told
      if (r.endedBy === "timer") return r.about === "question" ? "Nothing was chosen; ask me again." : "Nothing was done; ask again.";
      return r.endedBy === "corrected" ? "You corrected this in a later message." : "Closed with the update.";
    default:
      return null;
  }
}

/**
 * CL5: an option no longer allowed is refused, naming nothing (P10). An item's question can also be answered
 * on its review card; a line's and a question's have none, so it says to ask again.
 */
export function optionGoneText(about: ClarifyAbout): string {
  return `You can't choose that one any more. Pick another, or ${NO_REVIEW[about] ? "ask me again" : "choose it in the review"}.`;
}

// ---- A typed answer, read against the options only (CL2) ----

// Words that say which one without naming it, or are only the shape of an answer
const FILLER = new Set(
  "i i'm im mean meant it it's its is was that that's thats this the a an one ones please yes yeah yep no nah ok okay oh sorry for on of about my mi di de dat".split(" "),
);
const ORDINAL: Record<string, number> = { first: 1, "1st": 1, "1": 1, second: 2, "2nd": 2, "2": 2, third: 3, "3rd": 3, "3": 3, last: -1 };
const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}#]+/u).filter(Boolean);

/**
 * CL2: a typed reply answers the question only when it is short and every word that names something is in
 * exactly one option ("the connector one", "#152", "Store Insights"), or it names a place ("the second
 * one"). Anything else is a new message (CL1), read as usual, and the question stays open. `options` are the
 * ones the chat shows, those the author may still read (P10), so "the second one" counts as they see them.
 */
export function readTypedAnswer(text: string, options: readonly ClarifyOption[], aliases: Readonly<Record<string, readonly string[]>> = {}): string | null {
  const t = text.trim();
  // One short sentence at most: an update that happens to name an option is not an answer
  if (!t || t.length > 80 || /[.!?;]\s+\S/.test(t)) return null;
  const words = wordsOf(t).filter((w) => !FILLER.has(w));
  if (!words.length || words.length > 5) return null;
  if (words.length === 1 && words[0] in ORDINAL) {
    const n = ORDINAL[words[0]];
    return (n === -1 ? options.at(-1) : options[n - 1])?.id ?? null;
  }
  const fits = options.filter((o) => {
    const own = new Set([...wordsOf(o.label), ...(aliases[o.id] ?? []).flatMap(wordsOf)]);
    return words.every((w) => own.has(w));
  });
  return fits.length === 1 ? fits[0].id : null;
}

/**
 * Rules 3 and 8: the author's own chat. DPM's chat is, and in the Atlas app only the direct chat ("dm", the
 * conversation's atlasChatId); any other Atlas chat, a project group once phase I is built, is not. A message
 * from Atlas with no conversation to say which chat is not either.
 */
export function isOwnChat(channel: string, atlasChatId: string | null | undefined): boolean {
  return channel === "app" || (channel === "atlas" && atlasChatId === "dm");
}
