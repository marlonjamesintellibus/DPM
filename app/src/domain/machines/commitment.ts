// M22. Commitment (Ask, then Stage). Conversational plan, phase E (section 7), with the model check's fixes
// (research/state-machines/js/models/commitment.mjs, fixes anyLive and recordAtSave). "I'll send Kyle the access
// request tomorrow" is the author's own promise: an item in their review (M3) that opens a commitment when they
// save it. At the end of its due day it is due; a check-in goes out on the next working day they are in (CM7,
// CM8); no reply after config.commitmentCheckIns check-ins lapses it. Private to its owner (CD3): nobody else
// reads it, and only the owner, or the drawn rule on its linked work item, moves it (rule 10).
//   (saved item) ──SAVE──▶ open ──TIMER due (end of the due day)──▶ due ──CHECK_IN──▶ checking
//   open | due | checking ──DONE──▶ done        final (the owner, a saved update that says so, or its linked work Done)
//   open | due | checking ──DROP──▶ dropped     final (the owner)
//   open | due | checking ──NEW_DATE──▶ open    the move counted (CM10); check-ins start again
//   checking ──TIMER no reply (fewer than commitmentCheckIns sent)──▶ checking, ready for the next check-in
//   checking ──TIMER no reply (commitmentCheckIns sent)──▶ lapsed   final, shown to the owner only
// CM11's question ("#208 was cancelled; does it still stand?") is a field, asked once, that any answer answers.
// CD51 (W4-D2): only a promise to deliver its linked work ends when that work is Done; one only about it ("I'll
// walk Andre through #208") is asked CM11's question instead ("#208 is Done; does it still stand?").
import { config } from "../config";
import { daysBetween, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { CauseKey } from "./inbox-item";

export const COMMITMENT_STATES = ["open", "due", "checking", "done", "dropped", "lapsed"] as const;
export type CommitmentState = (typeof COMMITMENT_STATES)[number];
/** The model's fix anyLive: DONE, DROP, a new date and CM5's match work from each of these. */
export const LIVE_COMMITMENT: readonly CommitmentState[] = ["open", "due", "checking"];
export const FINAL_COMMITMENT: readonly CommitmentState[] = ["done", "dropped", "lapsed"];

/** The record or BRAID entry the words named ("the access request for #151"); only one the owner can open (CM9). */
export type CommitmentLink = { type: "work_item" | "milestone" | "braid_entry"; id: string; projectId: string };

/** Who ended it: the owner, the rule on its linked work item going Done, or no reply to its check-ins. */
export type CommitmentEnd = "owner" | "work_done" | "no_reply";

export type CommitmentRecord = {
  id: string;
  ownerId: string;
  /** The message and item it was saved from; null for one from before DPM kept them (the seed). */
  captureId: string | null;
  extractionId: string | null;
  /** What was promised, in plain words: "Send Kyle the access request". */
  what: string;
  /** The day it is due by; due at its end, in the org time zone. */
  dueOn: IsoDate;
  link: CommitmentLink | null;
  state: CommitmentState;
  /** CM10: how many times it moved to a new date. */
  moves: number;
  /** Check-ins sent since it was last due (a new date starts the count again). */
  checkIns: number;
  /** A check-in is out and waits for a reply. */
  checkInOut: boolean;
  /** The day the last check-in went out; its reply timer fires when that day ends. */
  checkInOn: IsoDate | null;
  /** CM11: asked whether it still stands, once its linked work was cancelled; kept once they say it does. */
  stands: "asked" | "kept" | null;
  savedOn: IsoDate;
  endedOn: IsoDate | null;
  endedBy: CommitmentEnd | null;
};

export type CommitmentEvent =
  /** by: the owner (a button, a reply, or a saved update that says it is done, CM6), or the rule on its linked work. */
  | { type: "DONE"; by: "owner" | "work_done" }
  | { type: "DROP" }
  /** CM5, CM10: the owner's new date; the same promise said again with a new date is one too. */
  | { type: "NEW_DATE"; dueOn: IsoDate }
  /** CM11: the owner says it still stands. */
  | { type: "KEEP" }
  /** TIMER: the due day ended. */
  | { type: "DUE" }
  /** The morning job sends a check-in (a notice in their chat plus an inbox item until phase F). */
  | { type: "CHECK_IN" }
  /** TIMER: the day a check-in went out ended with no reply. */
  | { type: "NO_REPLY" }
  /** Rule, CM11: the linked work item was cancelled, or, CD51, is Done and the promise does not deliver it. */
  | { type: "WORK_ENDED" }
  /** Rule, CM9: the owner left the linked record's project; the commitment stays theirs, the link goes. */
  | { type: "UNLINK" };

type Ctx = {
  record: CommitmentRecord;
  /** Who acts; null for a timer or a rule. */
  actorId: string | null;
  today: IsoDate;
  /** CM7, CM8: today is a working day, and the owner is not on leave. */
  ownerIn: boolean;
  /** The linked work item's state now, read when it runs (rule 4); null for no link or another kind. */
  linked: string | null;
};

const byOwner = (c: Ctx) => (c.actorId !== null && c.actorId === c.record.ownerId ? null : "only its owner");
const dayEnded = (c: Ctx, day: IsoDate | null) => day !== null && daysBetween(day, c.today) > 0;

// CD51: words that say the promise is to deliver the linked work itself, so its work going Done keeps it
const DELIVERS =
  /\b(?:finish(?:ed)?|complete[ds]?|wrap(?:ped)?\s+(?:it\s+|this\s+|that\s+)?up|(?:get|have)\s+(?:it\s+|this\s+|that\s+)?done|close\s+(?:it\s+)?out|ship(?:ped)?|land(?:ed)?|deliver(?:ed)?|hand(?:ed)?\s+(?:it\s+)?over|release[ds]?|deploy(?:ed)?|merge[ds]?|submit(?:ted)?|fix(?:ed)?|resolve[ds]?|implement(?:ed)?|build|built|a\s+go\s+done|mi\s+(?:wi|will)\s+done)\b/i;

/** CD51: the promise is to deliver its linked work ("Finish the #208 backfill"), not only about it. */
export function deliversLinkedWork(what: string): boolean {
  return DELIVERS.test(what);
}

function doneGuard(c: Ctx, e: Extract<CommitmentEvent, { type: "DONE" }>): string | null {
  if (e.by === "owner") return byOwner(c);
  // The drawn rule on the linked record: a person's word about it is never enough (rule 10)
  if (c.actorId !== null) return "only the rule on its linked work";
  if (c.record.link?.type !== "work_item" || c.linked !== "done") return "its linked work is not Done";
  return deliversLinkedWork(c.record.what) ? null : "it is only about its linked work, so it asks whether it still stands";
}

function newDateGuard(c: Ctx, e: Extract<CommitmentEvent, { type: "NEW_DATE" }>): string | null {
  const refused = byOwner(c);
  if (refused) return refused;
  if (daysBetween(c.today, e.dueOn) < 0) return "a new date is a day still to come";
  return e.dueOn === c.record.dueOn && c.record.state === "open" ? "it is already due then" : null;
}

const checkInGuard = (c: Ctx) => (c.ownerIn ? null : "not on a working day they are in");
const keepGuard = (c: Ctx) => byOwner(c) ?? (c.record.stands === "asked" ? null : "nothing asked whether it stands");
/** CM11 and CD51: the linked work ended in a way that leaves the promise open to question. */
export function linkEndAsks(what: string, linked: string | null): boolean {
  return linked === "cancelled" || (linked === "done" && !deliversLinkedWork(what));
}
const endedGuard = (c: Ctx) =>
  c.record.link?.type === "work_item" && linkEndAsks(c.record.what, c.linked) && c.record.stands === null ? null : "its linked work did not end that way, or it was asked already";

// A self-loop on each live state: the field moves, the state does not
const each = <E extends CommitmentEvent["type"]>(on: E, guard: (c: Ctx) => string | null) => LIVE_COMMITMENT.map((s) => ({ from: [s], on, to: s, guard }));

export const commitmentMachine = defineMachine<CommitmentState, CommitmentEvent, Ctx>({
  name: "commitment",
  states: COMMITMENT_STATES,
  arrows: [
    { from: LIVE_COMMITMENT, on: "DONE", to: "done", guard: doneGuard },
    { from: LIVE_COMMITMENT, on: "DROP", to: "dropped", guard: byOwner },
    { from: LIVE_COMMITMENT, on: "NEW_DATE", to: "open", guard: newDateGuard },
    ...each("KEEP", keepGuard),
    { from: ["open"], on: "DUE", to: "due", guard: (c) => (dayEnded(c, c.record.dueOn) ? null : "its due day has not ended") },
    { from: ["due"], on: "CHECK_IN", to: "checking", guard: checkInGuard },
    {
      from: ["checking"],
      on: "CHECK_IN",
      to: "checking",
      guard: (c) => checkInGuard(c) ?? (c.record.checkInOut ? "a check-in is already out" : c.record.checkIns >= config.commitmentCheckIns ? "every check-in was sent" : null),
    },
    // The no-reply timer: the last check-in lapses it; an earlier one makes room for the next (the model's fix)
    {
      from: ["checking"],
      on: "NO_REPLY",
      to: "lapsed",
      guard: (c) => (c.record.checkInOut && dayEnded(c, c.record.checkInOn) && c.record.checkIns >= config.commitmentCheckIns ? null : "not the last check-in, or not ended"),
    },
    { from: ["checking"], on: "NO_REPLY", to: "checking", guard: (c) => (c.record.checkInOut && dayEnded(c, c.record.checkInOn) ? null : "no check-in out, or its day has not ended") },
    ...each("WORK_ENDED", endedGuard),
    // CM9 on any commitment, ended ones too: it never names a record its owner can no longer open
    ...COMMITMENT_STATES.map((s) => ({ from: [s], on: "UNLINK" as const, to: s, guard: (c: Ctx) => (c.record.link ? null : "no link") })),
  ],
});

/** The context a command reads now: today, whether the owner is in, and the linked work item's state. */
export type CommitmentCtx = Omit<Ctx, "record">;

export type CommitmentResult = { outcome: Outcome<CommitmentState>; record: CommitmentRecord };

/** Applies one event to a commitment. A refused event returns the record unchanged. */
export function applyCommitmentEvent(record: CommitmentRecord, event: CommitmentEvent, ctx: CommitmentCtx): CommitmentResult {
  const outcome = transition(commitmentMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: CommitmentRecord = { ...record, state: outcome.to };
  // An end withdraws any check-in that is out and closes CM11's question with it
  const end = (by: CommitmentEnd): CommitmentRecord => ({ ...next, checkInOut: false, stands: record.stands === "asked" ? null : record.stands, endedOn: ctx.today, endedBy: by });
  switch (event.type) {
    case "DONE":
      return { outcome, record: end(event.by) };
    case "DROP":
      return { outcome, record: end("owner") };
    case "NEW_DATE":
      // A new date says it still stands (CM11), counts as a move (CM10), and starts the check-ins again
      return { outcome, record: { ...next, dueOn: event.dueOn, moves: record.moves + 1, checkIns: 0, checkInOut: false, checkInOn: null, stands: record.stands === "asked" ? "kept" : record.stands } };
    case "KEEP":
      return { outcome, record: { ...next, stands: "kept" } };
    case "DUE":
      return { outcome, record: next };
    case "CHECK_IN":
      return { outcome, record: { ...next, checkIns: record.checkIns + 1, checkInOut: true, checkInOn: ctx.today } };
    case "NO_REPLY":
      return { outcome, record: outcome.to === "lapsed" ? { ...end("no_reply") } : { ...next, checkInOut: false } };
    case "WORK_ENDED":
      return { outcome, record: { ...next, stands: "asked" } };
    case "UNLINK":
      return { outcome, record: { ...next, link: null } };
  }
}

export function isLive(r: Pick<CommitmentRecord, "state">): boolean {
  return LIVE_COMMITMENT.includes(r.state);
}

/** CD24, CM10: the check-in asks whether to drop it once it has moved this often. */
export function asksDrop(r: Pick<CommitmentRecord, "moves">): boolean {
  return r.moves >= config.commitmentDropAfterMoves;
}

/**
 * M10: what is in front of the owner. A check-in that is out waits for Done, a new date or Drop; CM11's question
 * waits for "it still stands" or Drop. Nobody else ever has an item for it (CD3).
 */
export function commitmentCauses(r: CommitmentRecord): CauseKey[] {
  const out: CauseKey[] = [];
  if (r.state === "checking" && r.checkInOut) out.push(`commitment_check:${r.id}`);
  if (isLive(r) && r.stands === "asked") out.push(`commitment_stands:${r.id}`);
  return out;
}

/**
 * A typed answer to a check-in or to CM11's question, as DPM's rule reads it with no model. A bare "yes" answers
 * the question asked last: "Did you send it?" (done) or, CM11, "Does your promise still stand?" (keep).
 */
export type ReplyInWords = { act: "done" } | { act: "drop" } | { act: "keep" } | { act: "yes" } | { act: "date"; dueOn: IsoDate };

// Phase R: as the team says them too ("mi done", "mek it Friday")
const SAYS_YES = /^(?:yes|yeah|yep|yup|it does|yes it does)$/;
const SAYS_DONE = /^(?:yes|yeah|yep|yup|ok|okay)?[,\s]*(?:done|did it|i did|i did it|sent|sent it|i sent it|it'?s done|all done|finished|completed|mi done|mi do it|done already|done now)$/;
const SAYS_DROP = /^(?:no[,\s]+)?(?:drop|drop it|drop that|cancel it|scrap it|forget it|never ?mind|not needed|no longer needed|it'?s not needed)$/;
const SAYS_KEEP = /^(?:yes[,\s]+)?(?:it still stands|still stands|it stands|keep it|keep)$/;
const SAYS_DATE = /^(?:(?:not yet|no|nah|not done)[,.\s]+)?(?:(?:move|push|change|mek|make)(?: it)?(?: to)?|new date:?|by|i'?ll do it|do it)?\s*(.+)$/;

/**
 * Phase E: a short reply in the chat that answers the check-in waiting on its owner ("done", "drop it", "keep it",
 * "move it to Friday"), read by DPM's rule against the message day. Null for anything else: a longer message is
 * read by Atlas as usual, and an update that says it was done is proposed as done in its review (CM6).
 */
export function readCheckInReply(text: string, dayOf: (words: string) => { date: IsoDate; start: number; end: number } | null): ReplyInWords | null {
  const said = text.trim().toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  if (!said || said.includes("?") || said.split(" ").length > 7) return null;
  if (SAYS_YES.test(said)) return { act: "yes" };
  if (SAYS_DONE.test(said)) return { act: "done" };
  if (SAYS_DROP.test(said)) return { act: "drop" };
  if (SAYS_KEEP.test(said)) return { act: "keep" };
  const rest = SAYS_DATE.exec(said)?.[1];
  const day = rest ? dayOf(rest) : null;
  // Only a day and small words around it: "send it to Kyle Friday" is an update for Atlas, not a new date
  const left = day && rest ? `${rest.slice(0, day.start)} ${rest.slice(day.end)}` : "";
  return day && /^(?:[\s,]|\b(?:on|by|for|the|then|instead|please|pls|ok)\b)*$/.test(left) ? { act: "date", dueOn: day.date } : null;
}

/** A new commitment, as Save opens it (M22 SAVE). CM11, CD51: one about cancelled or Done work is saved with its question asked. */
export function openCommitment(fields: Pick<CommitmentRecord, "id" | "ownerId" | "captureId" | "extractionId" | "what" | "dueOn" | "link" | "savedOn"> & { standsAsked?: boolean }): CommitmentRecord {
  const { standsAsked, ...rest } = fields;
  return { ...rest, state: "open", moves: 0, checkIns: 0, checkInOut: false, checkInOn: null, stands: standsAsked && rest.link?.type === "work_item" ? "asked" : null, endedOn: null, endedBy: null };
}
