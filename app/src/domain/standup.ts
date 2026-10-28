// What a standup asks and what its answers propose (conversational plan, section 12, phase J; M28 in
// machines/standup.ts). Pure: the command reads the person's open work through the per-viewer queries and
// passes it in, so a question only ever names work of theirs on a project they can read now (P10, SU8).
//   Questions, in order, at most config.standupMaxQuestions: blocked work (still stuck?), work In progress
//   (done, still going, or stuck?), work or a milestone due today or tomorrow (still on?), then "Anything new
//   blocking you?", which always has the last place. "Stuck" asks "What's it waiting on?" next, and "No, it
//   moves" asks "When do you now expect it?"; neither counts in the n.
//   A tap answer is a proposal at high confidence with its question as the quote ("Done" on #208 is #208
//   In progress to Done), compared at save with what the question showed (SU3). Typed answers DPM cannot read
//   as a tap are Atlas's, each read with its question. A question about a project the person can no longer
//   read is left out of everything shown or read after it, with its answer (P10).
import type { CheckContext, RawProposal } from "./atlas-checks/types";
import { daysBetween, weekday, type IsoDate } from "./dates";
import { WORD_ACTS } from "./machines/chat-command";
import { TAP_LABEL, TAPS, workAsked, type QuestionKind, type StandupAnswer, type StandupQuestion, type StandupStep, type StandupSubject, type TapAnswer } from "./machines/standup";
import { ruleQuestion } from "./question";
import type { SourceSpan } from "./shared";
import type { WorkItemState } from "./status/rules";

/** One piece of the person's open work, as their per-viewer read shows it now. */
export type OpenWork = StandupSubject & {
  /** A work item's state; a milestone is open until done. */
  state: WorkItemState | "milestone";
  /** When it is expected: a work item's forecast or due date, a milestone's forecast. */
  due: IsoDate | null;
  blockedNote: string | null;
};

/** A question before it has its place and the message it is shown under. */
export type QuestionDraft = Omit<StandupQuestion, "n" | "askedIn">;

const AS_ASKED: Record<"blocked" | "in_progress" | "due", (w: OpenWork) => boolean> = {
  blocked: (w) => w.state === "blocked",
  in_progress: (w) => w.state === "in_progress",
  // Today or tomorrow; work already asked about as blocked or In progress is not asked twice
  due: (w) => (w.state === "to_do" || w.state === "milestone") && w.due !== null,
};

const byDue = (a: OpenWork, b: OpenWork) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.label.localeCompare(b.label);

/** "Wed 21 Oct" */
function dayLabel(date: IsoDate): string {
  const [, m, d] = date.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `${weekday(date).slice(0, 3)} ${Number(d)} ${month}`;
}

/** The words of a question about one piece of work, in plain words, from its data only (rule 2). */
export function questionText(kind: QuestionKind, w: Pick<OpenWork, "label" | "due" | "blockedNote"> | null, onlyOne = false): string {
  switch (kind) {
    case "blocked":
      return `${w!.label} is Blocked${w!.blockedNote ? ` (${w!.blockedNote})` : ""}. Still stuck?`;
    case "in_progress":
      return `${w!.label} is In progress. Done, still going, or stuck?`;
    case "due":
      return `Is ${w!.label} still on for ${dayLabel(w!.due!)}?`;
    case "wait":
      return "What's it waiting on?";
    case "when":
      return "When do you now expect it?";
    case "new":
      // SU1: with no work asked about, there is nothing "new" to compare with
      return onlyOne ? "Anything blocking you?" : "Anything new blocking you?";
  }
}

/**
 * SU8: the next question, from their open work as read now. Work already asked about today is not asked again.
 * A standup the person starts asks from all of it, whatever they said earlier today (CD12: it does not ask
 * only about what a same-day update left out). At most `max` questions, and "Anything new blocking you?"
 * always has the last place; null once it has been asked.
 */
export function nextQuestion(open: readonly OpenWork[], steps: readonly Pick<StandupStep, "kind" | "subject">[], today: IsoDate, max: number): QuestionDraft | null {
  if (steps.some((s) => s.kind === "new")) return null;
  const asked = new Set(steps.flatMap((s) => (s.subject ? [s.subject.id] : [])));
  if (workAsked(steps) < max - 1) {
    // Section 12: due today or tomorrow; work already late is not "still on" for a day gone by
    const soon = (w: OpenWork) => w.due !== null && daysBetween(today, w.due) >= 0 && daysBetween(today, w.due) <= 1;
    const fresh = open.filter((w) => !asked.has(w.id));
    for (const kind of ["blocked", "in_progress", "due"] as const) {
      const w = fresh.filter((x) => AS_ASKED[kind](x) && (kind !== "due" || soon(x))).sort(byDue)[0];
      if (w) return { kind, subject: subjectOf(w), text: questionText(kind, w) };
    }
  }
  return { kind: "new", subject: null, text: questionText("new", null, workAsked(steps) === 0) };
}

/** "Stuck" asks what it waits on; "No, it moves" asks when they now expect it (section 12). */
export function followUp(step: Pick<StandupStep, "kind" | "subject">, answer: StandupAnswer): QuestionDraft | null {
  if (!step.subject) return null;
  if (answer.tap === "stuck" && step.kind === "in_progress") return { kind: "wait", subject: step.subject, text: questionText("wait", null) };
  if (answer.tap === "moves" && step.kind === "due") return { kind: "when", subject: step.subject, text: questionText("when", null) };
  return null;
}

function subjectOf(w: OpenWork): StandupSubject {
  return { type: w.type, id: w.id, projectId: w.projectId, label: w.label, number: w.number, saw: w.saw };
}

// ---- Typed words ----

/** A typed reply while a standup asks: an answer (a tap when the words say one), SKIP or STOP. */
export type TypedReply = { act: "answer"; answer: StandupAnswer } | { act: "skip" } | { act: "stop" };

// Phase R: the team's own words too ("mi done", "nuh yet", "nutten")
const STOP = /^(?:that'?s (?:all|it)(?: for (?:now|today))?|stop|end(?: it| the standup| my standup)?|done for (?:now|today)|nothing else|no more|dat (?:a|is) all|a dat)$/;
const SKIP = /^(?:skip(?: (?:it|this|this one|that|that one))?|next(?: one| question)?|pass)$/;
const SAYS: Record<TapAnswer, RegExp> = {
  done: /^(?:(?:it'?s |it is |mi |it )?(?:done|finished|finish|complete|completed)(?: it)?|(?:i )?finished it)$/,
  still_going: /^(?:still going|going|still (?:working )?on it|still working|in progress|not (?:done )?yet|nuh yet|not finished|still a work pon it|a work pon it)$/,
  stuck: /^(?:stuck|(?:i'?m |mi |it'?s )?(?:stuck|blocked))$/,
  moving: /^(?:moving(?: again)?|unblocked|it'?s moving|not stuck|no(?:,? it'?s moving)?|nah|nope)$/,
  still_stuck: /^(?:still stuck|still blocked|yes|yeah|yep|ya|yuh|stuck|blocked)$/,
  yes: /^(?:yes|yeah|yep|ya|yuh|still on|on track|it'?s on)$/,
  moves: /^(?:no(?:,? it moves)?|nah|nope|it moves|it'?s moving|moves|it slips|slipping|nuh)$/,
  nothing: /^(?:no|nah|nope|nothing(?: new)?|none|nutten|nothing so|all good|no blockers?|nuh)$/,
};

/**
 * What typed words say to the question on screen. A tap's words, as the whole message, are that tap ("done",
 * "still going", "mi done"); "that's all" stops and "skip" skips. Anything else is their own words, read by
 * Atlas with the question when the standup is composed (SU4: "Not that, but #212 is done").
 */
export function readTypedReply(text: string, kind: QuestionKind): TypedReply {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[\s.!]+$/, "");
  if (STOP.test(t)) return { act: "stop" };
  if (SKIP.test(t)) return { act: "skip" };
  const tap = TAPS[kind].find((a) => SAYS[a].test(t)) ?? null;
  return { act: "answer", answer: { tap, words: tap ? null : text.trim(), by: null } };
}

// Phase B's word acts as a reply starts them ("Approve the second one", "Yes, decline it")
const WORD_ACT = /^(?:(?:yes|yeah|ok|okay|please|pls)[\s,]+)?(?:approve|accept|decline|reject|turn down|resolve|close)\b/;

/**
 * SU4: their own question or command while a standup asks is read as itself, never as the answer, so it gets
 * its reply and runs: a question ("What am I working on?"), "Undo that", a correction ("GQ also means the
 * Guild"), or a word act on the answer open in the chat (phase B: "Approve the second one"). By the rules, as
 * "Start my standup" is: what they cannot tell is an answer, read with its question (SU4: "Not that, but #212
 * is done"). Words that say a tap, "skip" or "that's all" are read before this, so "No" stays an answer.
 */
export function isOwnMessage(ctx: Pick<CheckContext, "text" | "projects" | "openAnswer">): boolean {
  const t = ctx.text.trim().toLowerCase().replace(/[‘’]/g, "'");
  if (t.endsWith("?")) return true;
  // Without the conversation before it: "and #212 is done" follows nothing here, so it is an answer
  const asked = ruleQuestion({ text: ctx.text, projects: ctx.projects });
  if (asked && asked.topic !== "small_talk" && asked.topic !== "other" && asked.topic !== "unclear") return true;
  const acts = ctx.openAnswer?.lines.some((l) => l.acts.some((a) => (WORD_ACTS as readonly string[]).includes(a))) ?? false;
  return acts && WORD_ACT.test(t);
}

// ---- The composed capture ----

/** One answered question in the composed text: where its line starts ("Atlas: "), and where its question and its answer are. */
export type ComposedLine = { step: StandupStep; start: number; question: SourceSpan; answer: SourceSpan };

/** The text of the capture a standup composes, and where each question and answer is in it. */
export type Composed = { text: string; lines: ComposedLine[] };

/**
 * composed --> one capture (M1, M2) from the answers. Each answered question is two lines: Atlas's question,
 * then the answer in the person's name. A skipped question is left out. The text is the capture's, stored
 * as composed and never edited, so the spans stay valid.
 */
export function composeText(firstName: string, steps: readonly StandupStep[]): Composed {
  let text = "";
  const lines: ComposedLine[] = [];
  for (const step of steps) {
    if (!step.answer) continue;
    if (text) text += "\n";
    const start = text.length;
    text += "Atlas: ";
    const question = { start: text.length, end: text.length + step.text.length };
    text += `${step.text}\n${firstName}: `;
    const reply = step.answer.words ?? TAP_LABEL[step.answer.tap!];
    const answer = { start: text.length, end: text.length + reply.length };
    text += reply;
    lines.push({ step, start, question, answer });
  }
  return { text, lines };
}

/**
 * P10: the lines about work on a project the person may read now, and those about no record. A question about
 * a project they have since left is left out with its answer, as the chat leaves it out (SU8): not shown in
 * the review, and never read by Atlas. Positions stay those of the stored text.
 */
export function readableLines({ text, lines }: Composed, mayRead: (projectId: string) => boolean): Composed {
  return { text, lines: lines.filter((l) => !l.step.subject || mayRead(l.step.subject.projectId)) };
}

/** The text as it is shown: its lines only, and where a span of the stored text is in it (null for one in a line left out). */
export type ShownText = { text: string; at: (span: SourceSpan) => SourceSpan | null };

/** What a composed text shows of its lines (readableLines): the stored text itself when every line is kept. */
export function shownText({ text, lines }: Composed): ShownText {
  let shown = "";
  const moves: { from: number; to: number; by: number }[] = [];
  for (const line of lines) {
    if (shown) shown += "\n";
    moves.push({ from: line.start, to: line.answer.end, by: shown.length - line.start });
    shown += text.slice(line.start, line.answer.end);
  }
  return {
    text: shown,
    at: (span) => {
      const m = moves.find((x) => x.from <= span.start && span.end <= x.to);
      return m ? { start: span.start + m.by, end: span.end + m.by } : null;
    },
  };
}

/** What DPM proposes from the taps, the typed answers Atlas reads, and where the checks look for quotes. */
export type StandupRead = {
  tapped: RawProposal[];
  /** The question and answer pairs Atlas reads, as they are in the text; null when every answer was a tap. */
  typed: string | null;
  /** Check 2: quotes are looked for only here, so no answer Atlas reads is quoted as DPM's own question. */
  quoteIn: SourceSpan[];
  /** Section 20, U1: the words they typed; only these can be set aside as not used, never DPM's questions or a tap. */
  ownWords: SourceSpan[];
  /** SU3: what the questions Atlas reads answers to showed of their records, by record id and field. */
  saw: Record<string, Record<string, string | null>>;
};

const said = (text: string, span: SourceSpan) => text.slice(span.start, span.end);

/**
 * Section 12: a tap answer is a proposal at high confidence with its question as the quote. "Stuck" is
 * Blocked, with what it waits on as the note when they said it (then those words are the quote, so a blocker
 * report from them is linked to the work, M5); "No, it moves" is a forecast read from when they now expect it
 * (check 5 reads the date from those words). Still going, still stuck, yes and no change nothing. Each is
 * compared at save with what its question showed (SU3). Typed words go to Atlas with their question, and so
 * does what a wait answer names, for a blocker report.
 */
export function readComposed({ text, lines }: Composed): StandupRead {
  const tapped: RawProposal[] = [];
  const typed: SourceSpan[] = [];
  const quoteIn: SourceSpan[] = [];
  const saw: StandupRead["saw"] = {};
  const followed = (i: number, kind: QuestionKind) => (lines[i + 1]?.step.kind === kind && lines[i + 1].step.subject?.id === lines[i].step.subject?.id ? lines[i + 1] : null);
  lines.forEach((line, i) => {
    const { step } = line;
    const s = step.subject;
    const tap = step.answer!.tap;
    if (s && (!tap || step.kind === "wait")) saw[s.id] = s.saw;
    const proposal = (quote: SourceSpan, field: string, newValue: string | null, rationale: string, note?: string): RawProposal => ({
      kind: "update",
      projectId: s!.projectId,
      routingReason: { basis: "target", evidence: s!.number ?? s!.label, label: s!.label },
      targetId: s!.id,
      field,
      newValue,
      ...(note ? { note } : {}),
      ...(field in s!.saw ? { shownValue: s!.saw[field] } : {}),
      quote: said(text, quote),
      confidence: "high",
      rationale,
    });
    if (step.kind === "when") {
      // The date is in their words; check 5 reads it, and drops the item when there is none
      if (s && step.answer!.words) {
        tapped.push(proposal(line.answer, "forecast", null, "You said when you now expect it, in your standup."));
        quoteIn.push(line.answer);
      }
      return;
    }
    if (step.kind === "wait") {
      // The note went on the Blocked proposal below; Atlas reads it again only for a blocker report
      typed.push({ start: lines[i - 1]?.start ?? line.start, end: line.answer.end });
      quoteIn.push(line.answer);
      return;
    }
    if (!tap) {
      typed.push({ start: line.start, end: line.answer.end });
      quoteIn.push(line.answer);
      return;
    }
    // "No" to anything new blocking them, still going, still stuck and still on change nothing; a move's change comes from its "when"
    if (!s || !(tap === "done" || tap === "moving" || tap === "stuck")) return;
    const label = `You answered "${TAP_LABEL[tap]}" in your standup.`;
    const wait = tap === "stuck" ? followed(i, "wait") : null;
    const note = wait?.step.answer?.words ?? null;
    if (note) {
      tapped.push(proposal(wait!.answer, "state", "blocked", "You said it's stuck, and what it waits on, in your standup.", note));
      return;
    }
    tapped.push(proposal(line.question, "state", tap === "done" ? "done" : tap === "moving" ? "in_progress" : "blocked", label, tap === "stuck" ? TAP_LABEL.stuck : undefined));
    quoteIn.push(line.question);
  });
  const ownWords = lines.filter((l) => l.step.answer!.words).map((l) => l.answer);
  return { tapped, typed: typed.length ? typed.map((sp) => said(text, sp)).join("\n") : null, quoteIn, ownWords, saw };
}

const fieldKey = (p: Pick<RawProposal, "targetId" | "field">) => `${p.targetId}.${p.field}`;

/**
 * What Atlas proposes from the typed answers, as DPM takes it. A field DPM's own taps already propose a change
 * to is DPM's: Atlas reading "Stuck" again from a wait answer's context is dropped, since two items on one
 * field never save together (S3), and so is a blocked note DPM's Blocked already carries. A change to a record
 * a question was about is compared at save with what that question showed (SU3).
 */
export function atlasProposals(read: Pick<StandupRead, "tapped" | "saw">, proposals: readonly RawProposal[]): RawProposal[] {
  const taken = new Set(read.tapped.flatMap((p) => [fieldKey(p), ...(p.note ? [fieldKey({ targetId: p.targetId, field: "blocked_note" })] : [])]));
  return proposals
    .filter((p) => p.kind !== "update" || !taken.has(fieldKey(p)))
    .map((p) => {
      const shown = p.kind === "update" && p.targetId && p.field ? read.saw[p.targetId] : undefined;
      return shown && p.field! in shown ? { ...p, shownValue: shown[p.field!] } : p;
    });
}

/** The question an answer was given to, for the chat: "Done", or nothing when the words are their own message. */
export function answerLabel(answer: StandupAnswer | null): string | null {
  if (!answer) return "Skipped";
  return answer.tap && !answer.by ? TAP_LABEL[answer.tap] : null;
}
