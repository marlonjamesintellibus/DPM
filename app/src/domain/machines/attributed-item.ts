// M34. Attributed item (Ask to the person it is about). Conversational plan, section 17 (phase O); model checked
// 27 Oct (research/state-machines/js/models/meeting.mjs) and built as its fixed variant. Something a meeting
// note says about an attendee (their work, their promise) changes nothing of theirs until they confirm it (rule
// 10): it goes to them as an Ask, and CONFIRM saves it as theirs, run as them and checked when it runs (rule 4).
// The model check's fixes: an item whose speaker Atlas is unsure of waits in the recorder's review until they
// say who it was (holdUnsure, MT2); only a member of the item's project is asked, and anyone else's item goes to
// the recorder, as MT1 does for people not in DPM (sendToMembers); leaving the project withdraws it
// (withdrawOnLeave); and its timer does not run while they are on leave (pauseOnLeave, MT12). The fix check of 28
// Oct added ownerAtConfirm (rules 4 and 10): an update is about the record's owner, so only its owner now confirms
// it; once the record is someone else's, the Ask is withdrawn, never confirmed as the person it first went to.
//   (none) --SPLIT--> held [speaker unsure] | mine [own notes, or not a member] | waiting [on leave] | proposed
//   held --FIX_SPEAKER(person) [the recorder, while the review is open]--> mine | waiting | proposed
//   held --REVIEW_ENDED [the recorder discards, or the review expires]--> withdrawn | expired       final
//   waiting --BACK [no longer on leave]--> proposed                       the timer starts
//   waiting | proposed --LEFT [no longer a member of its project]--> withdrawn                  final
//   waiting | proposed --REASSIGNED [an update whose record is no longer theirs]--> withdrawn   final
//   proposed --EDIT(their words) [the person]--> proposed
//   proposed --CONFIRM [the person, a member now; still the record's owner; the record as the note saw it]--> confirmed
//   proposed --DECLINE [the person]--> declined; the recorder is told "Kemar says that's not right"  final
//   proposed --EXPIRE [config.attributedExpiryDays working days they were in]--> expired          final
// mine is final here: the item is the recorder's own, in their review (a promise by someone not asked becomes a
// dependency there, MT1).
import { config } from "../config";
import { daysBetween, isWorkingDay, addDays, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { ExtractedItemDraft } from "../shared";
import type { CauseKey } from "./inbox-item";

export const ATTRIBUTED_STATES = ["none", "held", "waiting", "proposed", "confirmed", "declined", "expired", "mine", "withdrawn"] as const;
export type AttributedState = (typeof ATTRIBUTED_STATES)[number];
/** Open: held in the recorder's review, waiting for someone back from leave, or asked. */
export const ATTRIBUTED_OPEN: readonly AttributedState[] = ["held", "waiting", "proposed"];
export const ATTRIBUTED_FINAL: readonly AttributedState[] = ["confirmed", "declined", "expired", "mine", "withdrawn"];

/** update: a change to the attendee's own record. commitment: their promise (phase E, M22). */
export type AttributedKind = "update" | "commitment";

/** MT7, CD18: a later note of the same meeting, merged with this one, said it too; its recorder is told as well. */
export type AlsoFrom = { recorderId: string; captureId: string; meetingId: string };

export type AttributedItemRecord = {
  id: string;
  meetingId: string;
  /** The recorder's capture it came from; only its quote is shown to the person (rule 9). */
  captureId: string;
  recorderId: string;
  /** Whose it is: the owner of the record, or who made the promise. Null while held with nobody named (MT2). */
  personId: string | null;
  /** The item's project (MT8): only a member of it is asked (sendToMembers, P10). */
  projectId: string;
  kind: AttributedKind;
  /** As the server checks left it: the change and the value it saw, or the promise and its day. */
  draft: ExtractedItemDraft;
  /** The words that fed it, the only words of the note the person sees (rule 9). */
  quote: string;
  state: AttributedState;
  /** EDIT: their own words, a promise's what or an update's value. */
  wording: string | null;
  /** EDIT: a promise's new day. */
  dueOn: IsoDate | null;
  /** When it reached them: the expiry counts the working days they were in from here (MT12). */
  askedOn: IsoDate | null;
  decidedOn: IsoDate | null;
  /** Why they declined (optional), or why it was withdrawn. */
  reason: string | null;
  alsoFrom: AlsoFrom[];
};

export type AttributedEvent =
  | { type: "SPLIT" }
  /** MT2: the recorder says who said it (or that it was them). */
  | { type: "FIX_SPEAKER"; personId: string }
  /** The recorder's review ended with it still held: discarded, or expired (M2). */
  | { type: "REVIEW_ENDED"; how: "discarded" | "expired" }
  /** MT12: they are back from leave. */
  | { type: "BACK" }
  | { type: "EDIT"; value: string; dueOn?: IsoDate | null }
  | { type: "CONFIRM" }
  | { type: "DECLINE"; reason?: string | null }
  | { type: "EXPIRE" }
  /** E77: they left the item's project. */
  | { type: "LEFT" }
  /** ownerAtConfirm: the record an update is about is someone else's now (or gone). */
  | { type: "REASSIGNED" };

type Ctx = {
  record: AttributedItemRecord;
  /** Who acts; null for Atlas, a rule or a timer. */
  actorId: string | null;
  today: IsoDate;
  /** SPLIT: the note was read as the recorder's own notes (CD17). */
  ownNotes?: boolean;
  /** SPLIT: Atlas was sure who said it (MT2). */
  sure?: boolean;
  /** The person (for FIX_SPEAKER, the one named) is a member of the item's project now (P10, rule 4). */
  member?: boolean;
  /** The person is on leave today (MT12). */
  away?: boolean;
  /** FIX_SPEAKER: the recorder's review is still open. */
  reviewOpen?: boolean;
  /** CONFIRM and REASSIGNED of an update: who owns its record now; null when it is gone (rules 4 and 10). */
  owner?: string | null;
  /** CONFIRM of an update: the field as it is now, compared with what the note saw (NeverOverwriteUnseen). */
  current?: string | null;
  /** EXPIRE: working days they were in since it reached them. */
  inDays?: number;
};

/** An update whose record has another owner now, or is gone: it is no longer the person's to confirm. */
const notTheirs = (c: Ctx) => c.record.kind === "update" && c.owner !== c.record.personId;
const byPerson = (c: Ctx) => (c.actorId !== null && c.actorId === c.record.personId ? null : `only ${c.record.personId ? "the person it is about" : "someone named"} answers this`);
const byRecorder = (c: Ctx) => (c.actorId !== null && c.actorId === c.record.recorderId ? null : "only the person who recorded it");
const yes = (v: boolean | undefined, why: string) => (v === true ? null : why);
const no = (v: boolean | undefined, why: string) => (v === false ? null : why);

// Where an item about someone goes once its speaker is settled: the model's deliver
const deliver = (c: Ctx, recorderNamed: boolean) => ({
  mine: () => (recorderNamed || c.member === false ? null : "a member of the project is asked"),
  waiting: () => (recorderNamed ? "the recorder's own item is theirs" : (yes(c.member, "not a member of its project") ?? yes(c.away, "they are in"))),
  proposed: () => (recorderNamed ? "the recorder's own item is theirs" : (yes(c.member, "not a member of its project") ?? no(c.away, "they are on leave"))),
});

function confirmGuard(c: Ctx): string | null {
  const refused = byPerson(c);
  if (refused) return refused;
  // Rule 4: the right is checked when it runs, whatever the Ask showed
  if (c.member !== true) return "you are no longer on this project";
  // ownerAtConfirm (rule 10): the note said it of the record's owner; whoever owns it now is the one to say so
  if (notTheirs(c)) return "it is no longer yours";
  const d = c.record.draft;
  if (c.record.kind === "update" && d.target && c.current !== d.target.oldValue) return `it is ${c.current ?? "empty"} now, not ${d.target.oldValue ?? "empty"} as the note saw it`;
  const due = promiseDay(c.record);
  if (c.record.kind === "commitment" && due && daysBetween(c.today, due) < 0) return "that day has passed; give a new day";
  return null;
}

function editGuard(c: Ctx, e: Extract<AttributedEvent, { type: "EDIT" }>): string | null {
  const refused = byPerson(c);
  if (refused) return refused;
  if (!e.value.trim()) return "say it in your words";
  if (e.dueOn && daysBetween(c.today, e.dueOn) < 0) return "a new day is a day still to come";
  return null;
}

export const attributedItemMachine = defineMachine<AttributedState, AttributedEvent, Ctx>({
  name: "attributed_item",
  states: ATTRIBUTED_STATES,
  arrows: [
    // CD17: a note read as the recorder's own notes sends nothing to anyone
    { from: ["none"], on: "SPLIT", to: "mine", guard: (c) => yes(c.ownNotes, "read for its attendees") },
    // The model's fix holdUnsure (NoAskOnAGuess): nothing goes to another person while Atlas is unsure who said it
    { from: ["none"], on: "SPLIT", to: "held", guard: (c) => no(c.ownNotes, "own notes") ?? no(c.sure, "Atlas is sure who said it") },
    { from: ["none"], on: "SPLIT", to: "mine", guard: (c) => no(c.ownNotes, "own notes") ?? yes(c.sure, "unsure") ?? deliver(c, false).mine() },
    { from: ["none"], on: "SPLIT", to: "waiting", guard: (c) => no(c.ownNotes, "own notes") ?? yes(c.sure, "unsure") ?? deliver(c, false).waiting() },
    { from: ["none"], on: "SPLIT", to: "proposed", guard: (c) => no(c.ownNotes, "own notes") ?? yes(c.sure, "unsure") ?? deliver(c, false).proposed() },
    ...(["mine", "waiting", "proposed"] as const).map((to) => ({
      from: ["held"] as AttributedState[],
      on: "FIX_SPEAKER" as const,
      to,
      guard: (c: Ctx, e: Extract<AttributedEvent, { type: "FIX_SPEAKER" }>) => byRecorder(c) ?? yes(c.reviewOpen, "the review has ended") ?? deliver(c, e.personId === c.record.recorderId)[to](),
    })),
    { from: ["held"], on: "REVIEW_ENDED", to: "withdrawn", guard: (_, e) => (e.how === "discarded" ? null : "expired") },
    { from: ["held"], on: "REVIEW_ENDED", to: "expired", guard: (_, e) => (e.how === "expired" ? null : "discarded") },
    // MT12: back from leave, it reaches them and its timer starts
    { from: ["waiting"], on: "BACK", to: "proposed", guard: (c) => no(c.away, "still on leave") },
    // The model's fix withdrawOnLeave (E77): an open Ask names the project's records, so only a member holds one
    { from: ["waiting", "proposed"], on: "LEFT", to: "withdrawn", guard: (c) => no(c.member, "still a member") },
    // The fix ownerAtConfirm: an Ask about a record that changed hands is withdrawn, never answered by its old owner
    { from: ["waiting", "proposed"], on: "REASSIGNED", to: "withdrawn", guard: (c) => (notTheirs(c) ? null : "still theirs") },
    { from: ["proposed"], on: "EDIT", to: "proposed", guard: editGuard },
    { from: ["proposed"], on: "CONFIRM", to: "confirmed", guard: confirmGuard },
    { from: ["proposed"], on: "DECLINE", to: "declined", guard: byPerson },
    // The model's fix pauseOnLeave (NeverExpiresWhileAway): the days counted are days they were in, never today away
    {
      from: ["proposed"],
      on: "EXPIRE",
      to: "expired",
      guard: (c) => no(c.away, "on leave today") ?? ((c.inDays ?? 0) >= config.attributedExpiryDays ? null : `waiting ${c.inDays ?? 0} of ${config.attributedExpiryDays} working days`),
    },
  ],
});

export type AttributedResult = { outcome: Outcome<AttributedState>; record: AttributedItemRecord };

/** Applies one event. A refused event returns the record unchanged. */
export function applyAttributedEvent(record: AttributedItemRecord, event: AttributedEvent, ctx: Omit<Ctx, "record">): AttributedResult {
  const outcome = transition(attributedItemMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: AttributedItemRecord = { ...record, state: outcome.to };
  // It reaches them: the timer counts from today (MT12)
  if (outcome.to === "proposed" && record.state !== "proposed") next.askedOn = ctx.today;
  switch (event.type) {
    case "FIX_SPEAKER":
      return { outcome, record: { ...next, personId: event.personId, draft: { ...next.draft, speaker: { personId: event.personId, sure: true } } } };
    case "EDIT":
      return { outcome, record: { ...next, wording: event.value.trim(), dueOn: event.dueOn ?? record.dueOn } };
    case "CONFIRM":
      return { outcome, record: { ...next, decidedOn: ctx.today } };
    case "DECLINE":
      return { outcome, record: { ...next, decidedOn: ctx.today, reason: event.reason?.trim() || null } };
    case "LEFT":
      return { outcome, record: { ...next, reason: "they left the project" } };
    case "REASSIGNED":
      return { outcome, record: { ...next, reason: "it is no longer theirs" } };
    case "REVIEW_ENDED":
      return { outcome, record: { ...next, reason: event.how === "discarded" ? "the note was discarded" : "the note's review expired" } };
    default:
      return { outcome, record: next };
  }
}

/** A promise's day: theirs if they gave a new one, else as the note said it. */
export function promiseDay(r: Pick<AttributedItemRecord, "kind" | "dueOn" | "draft">): IsoDate | null {
  return r.kind === "commitment" ? (r.dueOn ?? r.draft.commitment?.dueOn ?? null) : null;
}

/** What CONFIRM saves: their words when they edited it, else the note's. */
export function confirmedValue(r: Pick<AttributedItemRecord, "kind" | "wording" | "draft">): string {
  if (r.kind === "commitment") return r.wording ?? r.draft.commitment?.what ?? "";
  return r.wording ?? r.draft.target?.newValue ?? "";
}

/**
 * MT12, the model's pauseOnLeave: the working days after it reached them, up to today, on which they were not on
 * leave. `away(day)` says whether they were on leave that day.
 */
export function workingDaysIn(from: IsoDate, today: IsoDate, away: (day: IsoDate) => boolean): number {
  let n = 0;
  for (let d = addDays(from, 1); daysBetween(d, today) >= 0; d = addDays(d, 1)) if (isWorkingDay(d) && !away(d)) n++;
  return n;
}

/** M10: an Ask in front of the person it is about. */
export function attributedCauses(r: Pick<AttributedItemRecord, "id" | "state" | "personId">): CauseKey[] {
  return r.state === "proposed" && r.personId ? [`attributed:${r.id}`] : [];
}

/**
 * MT7, CD18: the same thing said about the same person in two notes of one meeting: a change to the same field
 * of the same record to the same value, or a promise about the same record (or none) by the same day.
 */
export function sameAttributed(a: Pick<AttributedItemRecord, "personId" | "kind" | "draft">, b: Pick<AttributedItemRecord, "personId" | "kind" | "draft">): boolean {
  if (!a.personId || a.personId !== b.personId || a.kind !== b.kind) return false;
  if (a.kind === "update") {
    const [x, y] = [a.draft.target, b.draft.target];
    return !!x && !!y && x.id === y.id && x.field === y.field && x.newValue === y.newValue;
  }
  const [x, y] = [a.draft.commitment, b.draft.commitment];
  return !!x && !!y && (x.link?.id ?? null) === (y.link?.id ?? null) && x.dueOn === y.dueOn;
}
