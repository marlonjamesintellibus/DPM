// M35. Cover request (Ask to a teammate). Conversational plan, phase P (section 18), with the model check's four
// fixes (research/state-machines/js/models/coverRequest.mjs: suggestedWayOut, declineCancels, leaveProjectWithdraws,
// oneCoverPerItem). "I'm off next week" is saved as leave (D6); Atlas offers a cover for what the person has due while
// away, and they pick a teammate to ask for one or several items of one project (LV8):
//   (saved leave, something due) ──OFFER──▶ suggested
//   suggested ──PICK (the person going on leave)──▶ asked
//   suggested ──DISMISS (the person) | LAPSE (the leave starts) | LEAVE_OFF (cancelled or declined)──▶ withdrawn   final
//   asked ──ACCEPT (the teammate)──▶ accepted: a handover (M7) proposed, the PM told (CD19)                      final
//   asked ──DECLINE──▶ declined; the person is told and may pick someone else                                   final
//   asked ──DECLINE_ITEM (one of several, LV8)──▶ asked, without that item
//   asked ──TIMER coverAskHours──▶ unanswered; the person is told                                               final
//   asked ──LEAVE_OFF | LEFT_PROJECT (told to nobody) | DATES (nothing left due)──▶ withdrawn                     final
// An accepted cover's handover is a field: none, waiting (the leave is not approved yet, LV9), proposed (M7 started),
// cancelled (the leave was cancelled or declined after, LV4). Nothing here changes a record by itself (rule 1): the
// teammate's tap makes the cover (rule 10), and the person's tap sends the ask (rule 9).
import { config } from "../config";
import { defineMachine, transition, type Outcome } from "../machine";

export const COVER_STATES = ["suggested", "asked", "accepted", "declined", "unanswered", "withdrawn"] as const;
export type CoverState = (typeof COVER_STATES)[number];
export const OPEN_COVER: readonly CoverState[] = ["suggested", "asked"];

export const COVER_HANDOVERS = ["none", "waiting", "proposed", "cancelled"] as const;
export type CoverHandover = (typeof COVER_HANDOVERS)[number];
/** A cover that holds: its handover waits on the approval, or M7 has it. */
export const LIVE_HANDOVER: readonly CoverHandover[] = ["waiting", "proposed"];

/** One thing to cover: the person's own work item or milestone, on one project. */
export type CoverItem = { type: "work_item" | "milestone"; id: string; projectId: string };
export const itemKey = (i: Pick<CoverItem, "type" | "id">) => `${i.type}:${i.id}`;

/** Why an open request ended without an answer. */
export type CoverEnd = "dismissed" | "leave_started" | "leave_off" | "left_project" | "not_due";

export type CoverRecord = {
  id: string;
  leaveId: string;
  askerId: string;
  /** The save that offered it, so the chat shows it under that message; null when Atlas offered it again later. */
  captureId: string | null;
  /** Null while suggested: the pick names the teammate, the project and the items. */
  projectId: string | null;
  toId: string | null;
  items: CoverItem[];
  /** LV8: items the teammate said no to, one at a time, while the rest waited. */
  declined: CoverItem[];
  state: CoverState;
  handover: CoverHandover;
  handoverId: string | null;
  endedWhy: CoverEnd | null;
  askedAt: Date | null;
};

export type CoverEvent =
  | { type: "PICK"; toId: string; items: CoverItem[] }
  | { type: "DISMISS" }
  /** TIMER: the leave started with the offer still open. */
  | { type: "LAPSE" }
  | { type: "ACCEPT" }
  | { type: "DECLINE" }
  | { type: "DECLINE_ITEM"; item: Pick<CoverItem, "type" | "id"> }
  /** TIMER: coverAskHours passed with no answer. */
  | { type: "NO_ANSWER" }
  /** The leave was cancelled, withdrawn or declined (declineCancels): open requests end, live handovers are cancelled. */
  | { type: "LEAVE_OFF" }
  /** LV9: the leave was approved; a handover that waited starts. */
  | { type: "LEAVE_APPROVED" }
  /** LV3: the leave's dates changed, or an item is no longer due then; what is not due leaves the ask. */
  | { type: "DATES" }
  /** leaveProjectWithdraws: the person or the teammate can no longer read an item; told to nobody. */
  | { type: "LEFT_PROJECT" };

/**
 * What the command reads now (rule 4). due: the keys of the person's own items due while away, on projects they
 * read now. taken: keys in another asked request or a live cover (oneCoverPerItem). teammateReads: the keys the
 * teammate named in a PICK, or the request's teammate, may read now. teammateAway: the project shows the teammate on
 * leave then (LV2). askerReads: the person still reads every item of the request.
 */
type Ctx = {
  record: CoverRecord;
  /** Who acts; null for a timer or a rule. */
  actorId: string | null;
  now: Date;
  leaveLive: boolean;
  leaveApproved: boolean;
  leaveStarted: boolean;
  due: readonly string[];
  taken: readonly string[];
  teammateReads: readonly string[];
  teammateAway: boolean;
  askerReads: boolean;
};

const byAsker = (c: Ctx) => (c.actorId !== null && c.actorId === c.record.askerId ? null : "only the person going on leave");
const byTeammate = (c: Ctx) => (c.actorId !== null && c.actorId === c.record.toId ? null : "only the teammate asked");
const byRule = (c: Ctx) => (c.actorId === null ? null : "only a timer or a rule");
const keys = (items: readonly Pick<CoverItem, "type" | "id">[]) => items.map(itemKey);
const leaveOn = (c: Ctx) => (c.leaveLive ? null : "the leave is off");

function pickGuard(c: Ctx, e: Extract<CoverEvent, { type: "PICK" }>): string | null {
  const refused = byAsker(c) ?? leaveOn(c);
  if (refused) return refused;
  if (c.leaveStarted) return "your leave has started";
  if (!e.items.length) return "pick at least one thing to cover";
  // LV8: one request lists one project's items, so one teammate who reads all of them
  if (new Set(e.items.map((i) => i.projectId)).size > 1) return "ask for one project at a time";
  if (!keys(e.items).every((k) => c.due.includes(k))) return "that is not yours, or not due while you're away";
  if (e.toId === c.record.askerId) return "pick someone else";
  // P10: the same words as for a name nobody has, so nothing is learnt about the project (PP1)
  if (!keys(e.items).every((k) => c.teammateReads.includes(k))) return "I can't ask them about that";
  if (c.teammateAway) return "they are away then";
  if (keys(e.items).some((k) => c.taken.includes(k))) return "someone is already asked, or covers it";
  return null;
}

const acceptGuard = (c: Ctx) => byTeammate(c) ?? leaveOn(c) ?? (c.askerReads && keys(c.record.items).every((k) => c.teammateReads.includes(k)) ? null : "that is no longer on a project you share");

function declineItemGuard(c: Ctx, e: Extract<CoverEvent, { type: "DECLINE_ITEM" }>): string | null {
  const refused = byTeammate(c);
  if (refused) return refused;
  if (!keys(c.record.items).includes(itemKey(e.item))) return "that is not in this request";
  return c.record.items.length > 1 ? null : "it is the only thing asked: decline the request";
}

function noAnswerGuard(c: Ctx): string | null {
  const at = c.record.askedAt;
  return byRule(c) ?? (at && c.now.getTime() - at.getTime() >= config.coverAskHours * 3_600_000 ? null : "not asked that long ago");
}

/** LV3: some item left the due list; the ask keeps the rest, or ends when none is left. */
const notDue = (c: Ctx) => keys(c.record.items).filter((k) => !c.due.includes(k));
const datesGuard = (keepsSome: boolean) => (c: Ctx) => {
  const refused = byRule(c);
  if (refused) return refused;
  const gone = notDue(c).length;
  if (!gone) return "everything asked is still due then";
  const left = c.record.items.length - gone;
  return keepsSome === left > 0 ? null : keepsSome ? "nothing asked is due then any more" : "something asked is still due then";
};

const leftGuard = (c: Ctx) => byRule(c) ?? (c.askerReads && keys(c.record.items).every((k) => c.teammateReads.includes(k)) ? "both still read every item" : null);
const offGuard = (c: Ctx) => byRule(c) ?? (c.leaveLive ? "the leave is still on" : null);

export const coverMachine = defineMachine<CoverState, CoverEvent, Ctx>({
  name: "cover_request",
  states: COVER_STATES,
  arrows: [
    { from: ["suggested"], on: "PICK", to: "asked", guard: pickGuard },
    { from: ["suggested"], on: "DISMISS", to: "withdrawn", guard: byAsker },
    { from: ["suggested"], on: "LAPSE", to: "withdrawn", guard: (c) => byRule(c) ?? (c.leaveStarted ? null : "the leave has not started") },
    { from: ["asked"], on: "ACCEPT", to: "accepted", guard: acceptGuard },
    { from: ["asked"], on: "DECLINE", to: "declined", guard: byTeammate },
    { from: ["asked"], on: "DECLINE_ITEM", to: "asked", guard: declineItemGuard },
    { from: ["asked"], on: "NO_ANSWER", to: "unanswered", guard: noAnswerGuard },
    { from: OPEN_COVER, on: "LEAVE_OFF", to: "withdrawn", guard: offGuard },
    // An accepted cover stays accepted; its handover is cancelled through M7 (LV4)
    { from: ["accepted"], on: "LEAVE_OFF", to: "accepted", guard: (c) => offGuard(c) ?? (LIVE_HANDOVER.includes(c.record.handover) ? null : "no handover to cancel") },
    { from: ["accepted"], on: "LEAVE_APPROVED", to: "accepted", guard: (c) => byRule(c) ?? (c.record.handover === "waiting" && c.leaveApproved ? null : "no handover waits on the approval") },
    { from: ["asked"], on: "DATES", to: "asked", guard: datesGuard(true) },
    { from: ["asked"], on: "DATES", to: "withdrawn", guard: datesGuard(false) },
    { from: ["asked"], on: "LEFT_PROJECT", to: "withdrawn", guard: leftGuard },
  ],
});

/** The context a command reads now; the record goes in by itself. */
export type CoverCtx = Omit<Ctx, "record">;

export type CoverResult = { outcome: Outcome<CoverState>; record: CoverRecord };

/** Applies one event to a cover request. A refused event returns the record unchanged. */
export function applyCoverEvent(record: CoverRecord, event: CoverEvent, ctx: CoverCtx): CoverResult {
  const outcome = transition(coverMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: CoverRecord = { ...record, state: outcome.to };
  const ended = (why: CoverEnd): CoverRecord => ({ ...next, endedWhy: why });
  switch (event.type) {
    case "PICK":
      return { outcome, record: { ...next, toId: event.toId, projectId: event.items[0].projectId, items: event.items.map((i) => ({ type: i.type, id: i.id, projectId: i.projectId })), askedAt: ctx.now } };
    case "DISMISS":
      return { outcome, record: ended("dismissed") };
    case "LAPSE":
      return { outcome, record: ended("leave_started") };
    case "ACCEPT":
      return { outcome, record: { ...next, handover: ctx.leaveApproved ? "proposed" : "waiting" } };
    case "DECLINE":
    case "NO_ANSWER":
      return { outcome, record: next };
    case "DECLINE_ITEM": {
      const k = itemKey(event.item);
      return { outcome, record: { ...next, items: record.items.filter((i) => itemKey(i) !== k), declined: [...record.declined, ...record.items.filter((i) => itemKey(i) === k)] } };
    }
    case "LEAVE_OFF":
      return { outcome, record: record.state === "accepted" ? { ...next, handover: "cancelled" } : ended("leave_off") };
    case "LEAVE_APPROVED":
      return { outcome, record: { ...next, handover: "proposed" } };
    case "DATES":
      return { outcome, record: outcome.to === "withdrawn" ? ended("not_due") : { ...next, items: record.items.filter((i) => ctx.due.includes(itemKey(i))) } };
    case "LEFT_PROJECT":
      return { outcome, record: ended("left_project") };
  }
}

/** A new offer, as Atlas makes it after a leave is saved with something due while away. */
export function offerCover(fields: Pick<CoverRecord, "id" | "leaveId" | "askerId" | "captureId">): CoverRecord {
  return { ...fields, projectId: null, toId: null, items: [], declined: [], state: "suggested", handover: "none", handoverId: null, endedWhy: null, askedAt: null };
}

/** oneCoverPerItem: the items in an asked request or a live cover, which another request may not name. */
export function takenBy(records: readonly Pick<CoverRecord, "id" | "state" | "handover" | "items">[], except: string | null = null): string[] {
  return records.filter((r) => r.id !== except && (r.state === "asked" || (r.state === "accepted" && LIVE_HANDOVER.includes(r.handover)))).flatMap((r) => keys(r.items));
}

/** M10: an asked request is an inbox item for the teammate alone. */
export function coverCauses(r: Pick<CoverRecord, "id" | "state" | "toId">): string[] {
  return r.state === "asked" && r.toId ? [`cover_ask:${r.id}`] : [];
}
