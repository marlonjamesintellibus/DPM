// M20. Chat command (Ask). Conversational plan, section 4 (phase B); model checked 27 Oct
// (research/state-machines/js/models/chatCommand.mjs) and built as its fixed variant: a reply's referent
// is checked against the asker's lines now (ReferentCheck "lines_now"), and CONFIRM checks the right
// before the version, so someone who left is never told who decided. A command is one act on one line
// of an answer: a decision that belongs to a person with a right (approve, decline, resolve, give a
// reason) or a change to their own work (mark done, unblock). A reply in words ("Approve the Kyle risk")
// makes a card the asker confirms or cancels; a button on an answer line is a command confirmed in the
// same tap. done runs the screen's own command (commands/chat-command.ts); nothing here changes a record.
import { config } from "../config";
import { defineMachine, transition, type Outcome } from "../machine";
import type { ResolveOutcome } from "./braid-entry";

export const CHAT_COMMAND_STATES = ["none", "proposed", "done", "refused", "cancelled", "expired"] as const;
export type ChatCommandState = (typeof CHAT_COMMAND_STATES)[number];

/** What a command does, as the line's own screen offers it. */
export const COMMAND_ACTS = ["approve", "decline", "resolve", "mark_done", "unblock", "give_reason"] as const;
export type CommandAct = (typeof COMMAND_ACTS)[number];

/**
 * The acts a reply in words may take: decisions that belong to a person with a right. A change to a
 * record said in words ("Mark the second one done") is a normal proposal and goes through review.
 */
export const WORD_ACTS = ["approve", "decline", "resolve", "give_reason"] as const satisfies readonly CommandAct[];
export type WordAct = (typeof WORD_ACTS)[number];

/** The record a line is about. A set status and its reason live on the project. */
export type CommandSubject = { type: "braid_entry" | "work_item" | "project"; id: string; projectId: string };

/**
 * What approve and decline answer on a BRAID entry: the proposed entry itself (M15 APPROVE, DECLINE), a
 * member's proposed outcome (section 20, U3: RESOLVE with it, or KEEP_OPEN) or "it's cleared" (S13:
 * RESOLVE, or KEEP_OPEN).
 */
export type CommandProposal = "entry" | "outcome" | "clear";

/** One act a line offers, with the record's version in the answer (AC3, AC5). */
export type LineAction = { act: CommandAct; version: number; proposal?: CommandProposal; outcome?: ResolveOutcome };

/** Words the act carries: a decline's reason, or a status reason with the entries it links (M9). */
export type CommandInput = { reason?: string; entryIds?: readonly string[]; draftedByAtlas?: boolean; edited?: boolean };

/** What the card names, as the asker could read it when the command was made. */
export type CommandAbout = { kind: string | null; name: string; project: string };

/** Why it was refused when it ran: the right first, then the version, then the screen command's own rules. */
export type RefusedWhy = "right_lost" | "changed" | "refused";

export type ChatCommandRecord = {
  id: string;
  askerId: string;
  /** tap: a button on an answer line. words: a reply Atlas read, confirmed on a card. */
  via: "tap" | "words";
  /** The message it came from: the reply in words, or the answer whose button was tapped. */
  captureId: string;
  /** The answer it acts on, and which of its lines (1 is the first). */
  answerCaptureId: string;
  line: number;
  act: CommandAct;
  subject: CommandSubject;
  proposal: CommandProposal | null;
  outcome: ResolveOutcome | null;
  about: CommandAbout;
  /** The version the asker saw, in the answer's line (AC3). */
  seenVersion: number;
  input: CommandInput | null;
  state: ChatCommandState;
  refusedWhy: RefusedWhy | null;
  /** The words a refusal is shown with; worked out by the command when it runs (AC1 to AC3). */
  refusal: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Where the line's record stands for the asker when the command runs (rule 4): read now, never from the answer. */
export type Standing = {
  /** They hold the right for this act now, on a project they can still read. */
  right: boolean;
  /** The record's version now; null when it is gone. */
  version: number | null;
  /** The screen command's own refusal, when it ran and said no ("a decline needs a reason"). */
  refusedBy?: string | null;
};

export type ChatCommandEvent =
  /** A reply in words, read by Atlas and kept by DPM's checks: a card. */
  | { type: "PROPOSE" }
  /** A button on an answer line, confirmed in the same tap. */
  | { type: "TAP"; input?: CommandInput | null }
  | { type: "CONFIRM"; input?: CommandInput | null }
  | { type: "CANCEL" }
  /** Timer command_expiry: config.commandExpiryMinutes after the card was made (CD2, AC10). */
  | { type: "EXPIRE" };

type Ctx = {
  record: ChatCommandRecord;
  actorId: string;
  now: Date;
  /** PROPOSE: the line's record is one the asker may read now (the per-viewer query run again, AC9). */
  readable: boolean;
  /** TAP and CONFIRM: where the record stands now. */
  standing: Standing;
};

export const OUT_OF_DATE = "that answer is out of date";

/** Rule 5: a card nobody answers expires after config.commandExpiryMinutes. */
export function commandExpired(r: Pick<ChatCommandRecord, "state" | "createdAt">, now: Date): boolean {
  return r.state === "proposed" && now.getTime() - r.createdAt.getTime() >= config.commandExpiryMinutes * 60_000;
}

/** Rule 10: a command is the asker's own decision, confirmed only by them. */
const askerGuard = (c: Ctx) => (c.actorId === c.record.askerId ? null : "only the person who asked can confirm or cancel it");

// A decline says why, and a status reason has words and links an entry on the log (M9, D17); the card
// stays open until they are given, so a missing link is never a refusal that spends the line's button
function needsWords(c: Ctx, input: CommandInput | null | undefined): string | null {
  const said = (input?.reason ?? c.record.input?.reason ?? "").trim();
  if (c.record.act === "give_reason" && !said) return "write the reason first";
  if (c.record.act === "give_reason" && !(input?.entryIds ?? c.record.input?.entryIds ?? []).length) return "link at least one BRAID entry on the log, or add one to the log first";
  if (c.record.act === "decline" && c.record.proposal === "entry" && !said) return "say why you decline";
  return null;
}

/**
 * Why it cannot run now, in the model check's order (AC1 before AC2 and AC3): the right held now, then
 * the version seen, then the screen command's own rules. Null when it can run.
 */
export function runProblem(record: Pick<ChatCommandRecord, "seenVersion">, standing: Standing): RefusedWhy | null {
  if (!standing.right) return "right_lost";
  if (standing.version !== record.seenVersion) return "changed";
  return standing.refusedBy ? "refused" : null;
}

// A refusal is final whatever words came with it; words missing on one that can run leave it waiting
const runs = (c: Ctx, e: { input?: CommandInput | null }) => askerGuard(c) ?? (runProblem(c.record, c.standing) ? "it cannot run now" : needsWords(c, e.input));
const refuses = (c: Ctx) => askerGuard(c) ?? (runProblem(c.record, c.standing) ? null : "it can run");

export const chatCommandMachine = defineMachine<ChatCommandState, ChatCommandEvent, Ctx>({
  name: "chat_command",
  states: CHAT_COMMAND_STATES,
  arrows: [
    // AC6, AC9 and the model check's fix lines_now: only a line of the open answer (checked before this),
    // whose record the asker may still read; otherwise it is not a command, and the reply names nothing
    { from: ["none"], on: "PROPOSE", to: "proposed", guard: (c) => askerGuard(c) ?? (c.readable ? null : OUT_OF_DATE) },
    { from: ["none"], on: "TAP", to: "done", guard: runs },
    { from: ["none"], on: "TAP", to: "refused", guard: refuses },
    { from: ["proposed"], on: "CONFIRM", to: "done", guard: runs },
    { from: ["proposed"], on: "CONFIRM", to: "refused", guard: refuses },
    { from: ["proposed"], on: "CANCEL", to: "cancelled", guard: askerGuard },
    { from: ["proposed"], on: "EXPIRE", to: "expired", guard: (c) => (commandExpired(c.record, c.now) ? null : `a card stays open ${config.commandExpiryMinutes} minutes`) },
  ],
});

export type ChatCommandResult = { outcome: Outcome<ChatCommandState>; record: ChatCommandRecord };

/** Applies one event. A refused event returns the record unchanged; refusal words are the caller's to add. */
export function applyChatCommandEvent(record: ChatCommandRecord, event: ChatCommandEvent, ctx: Omit<Ctx, "record">): ChatCommandResult {
  const outcome = transition(chatCommandMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: ChatCommandRecord = { ...record, state: outcome.to };
  switch (event.type) {
    case "TAP":
    case "CONFIRM": {
      const input = event.input ? { ...record.input, ...event.input } : record.input;
      return { outcome, record: { ...next, input, decidedAt: ctx.now, refusedWhy: outcome.to === "refused" ? runProblem(record, ctx.standing) : null } };
    }
    case "CANCEL":
    case "EXPIRE":
      return { outcome, record: { ...next, decidedAt: ctx.now } };
    default:
      return { outcome, record: next };
  }
}

/** A command about to be made; nothing is stored unless PROPOSE or TAP moves it. */
export function draftCommand(fields: Omit<ChatCommandRecord, "state" | "refusedWhy" | "refusal" | "decidedAt" | "proposal" | "outcome" | "input"> & Partial<Pick<ChatCommandRecord, "proposal" | "outcome" | "input">>): ChatCommandRecord {
  return { proposal: null, outcome: null, input: null, ...fields, state: "none", refusedWhy: null, refusal: null, decidedAt: null };
}

// ---- What the chat says about a command ----

const VERB: Record<CommandAct, string> = {
  approve: "approve",
  decline: "decline",
  resolve: "resolve",
  mark_done: "mark this done",
  unblock: "unblock",
  give_reason: "give a reason for this",
};

/** AC1: "You can no longer approve this." Names nothing they could not read. */
export function rightLostText(act: CommandAct): string {
  return `You can no longer ${VERB[act]}${act === "mark_done" || act === "give_reason" ? "" : " this"}.`;
}

const what = (about: CommandAbout) => `${about.kind ? `${about.kind} ` : ""}"${about.name}" on ${about.project}`;

/** The card's question: "Approve risk "Store sales feed access" on Forager 2.0?" */
export function commandQuestion(r: Pick<ChatCommandRecord, "act" | "proposal" | "outcome" | "about">): string {
  switch (r.act) {
    case "approve":
      if (r.proposal === "outcome") return `Mark ${what(r.about)} ${r.outcome}?`;
      return r.proposal === "clear" ? `Resolve ${what(r.about)}?` : `Approve ${what(r.about)}?`;
    case "decline":
      return r.proposal === "entry" ? `Decline ${what(r.about)}?` : `Keep ${what(r.about)} open?`;
    case "resolve":
      return `Resolve ${what(r.about)}?`;
    case "mark_done":
      return `Mark "${r.about.name}" on ${r.about.project} done?`;
    case "unblock":
      return `Unblock "${r.about.name}" on ${r.about.project}?`;
    case "give_reason":
      return `Give this reason for ${r.about.project}'s status?`;
  }
}

/** The button that confirms it, as the screen labels the same act. */
export function commandButton(r: Pick<ChatCommandRecord, "act" | "proposal" | "outcome">): string {
  switch (r.act) {
    case "approve":
      return r.proposal === "outcome" ? `Mark ${r.outcome}` : r.proposal === "clear" ? "Resolve" : "Approve";
    case "decline":
      return r.proposal === "entry" ? "Decline" : "Keep open";
    case "resolve":
      return "Resolve";
    case "mark_done":
      return "Mark done";
    case "unblock":
      return "Unblock";
    case "give_reason":
      return "Save reason";
  }
}

/** What the chat says once it ran. */
export function doneText(r: Pick<ChatCommandRecord, "act" | "proposal" | "outcome">): string {
  switch (r.act) {
    case "approve":
      return r.proposal === "outcome" ? `Marked ${r.outcome}.` : r.proposal === "clear" ? "Resolved." : "Approved.";
    case "decline":
      return r.proposal === "entry" ? "Declined." : "Kept open.";
    case "resolve":
      return "Resolved.";
    case "mark_done":
      return "Marked done.";
    case "unblock":
      return "Unblocked.";
    case "give_reason":
      return "Reason saved.";
  }
}

/** What the chat shows for a command, in any state. */
export function commandOutcomeText(r: Pick<ChatCommandRecord, "state" | "act" | "proposal" | "outcome" | "refusal">): string | null {
  switch (r.state) {
    case "done":
      return doneText(r);
    case "refused":
      return r.refusal;
    case "cancelled":
      return "Cancelled. Nothing changed.";
    case "expired":
      return "This expired. Nothing changed.";
    default:
      return null;
  }
}
