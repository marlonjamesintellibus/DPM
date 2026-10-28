// M33. Meeting capture (Job), extends M2. Conversational plan, section 17 (phase O); model checked 27 Oct
// (research/state-machines/js/models/meeting.mjs) and built as its fixed variant. A meeting note (a voice note
// or a pasted transcript, marked as a meeting, with a project) is the recorder's capture (M1, M2), and is read
// only once the recorder has said who was there and that they knew it was recorded (ATTENDEES_CONFIRMED). When
// they were not told, it is read as the recorder's own notes only (the model's fix ownNotes, MT4, CD17). The
// read splits its items (domain/meeting.ts): the recorder's own go to their review (M3), each thing about an
// attendee goes to that attendee as an M34 Ask (rule 10), and decisions go through the recorder's review first,
// then to the deciders as M15 proposals (the model's fix reviewDecisions: two confirmations).
//   received --ATTENDEES_CONFIRMED [the recorder; they knew it was recorded]--> transcribing
//   received --OWN_NOTES_ONLY [the recorder]--> transcribing                 MT4, CD17: the recorder's own notes
//   received --EXPIRE [config.reviewExpiryDays, attendees never confirmed]--> expired       final
//   transcribing --TRANSCRIBED--> reading                                     as M2
//   reading --PROPOSALS_READY--> split
//   transcribing | reading --READ_FAILED [M2 failed after its tries]--> failed     final; M2 can fail while
//                                                          transcribing a voice note too ("as M2", section 17)
//   split --DONE [every part saved, confirmed, declined or expired]--> done  final
// M2 itself waits in received while its meeting does (its START is refused), and ends expired with it: both are
// arrows of this machine, read by captureMachine's guards.
import { config } from "../config";
import { daysBetween, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";

export const MEETING_STATES = ["received", "transcribing", "reading", "split", "done", "failed", "expired"] as const;
export type MeetingState = (typeof MEETING_STATES)[number];
export const MEETING_FINAL: readonly MeetingState[] = ["done", "failed", "expired"];

/** meeting: read for everyone in it. own: the attendees were not told, so it is the recorder's own notes (CD17). */
export type MeetingMode = "meeting" | "own";

export type MeetingRecord = {
  id: string;
  /** The recorder's capture: the note itself, private to them (M1). */
  captureId: string;
  recorderId: string;
  /** The project the recorder marked it with; items are still routed per project (MT8). */
  projectId: string;
  /** Who was there, as the recorder confirmed them; never the recorder. Members or contacts of the project. */
  attendees: string[];
  mode: MeetingMode | null;
  /** MT7, CD18: the earlier note of the same meeting this one merged with; what that one sent is not sent again. */
  mergedWith: string | null;
  state: MeetingState;
  receivedOn: IsoDate;
};

export type MeetingEvent =
  /** The recorder confirms who was there, and that they knew it was recorded. merge: MT7's offer, taken. */
  | { type: "ATTENDEES_CONFIRMED"; attendees: readonly string[]; told: boolean; mergeWith?: string | null }
  /** MT4, CD17: the attendees were not told; it is read as the recorder's own notes only. */
  | { type: "OWN_NOTES_ONLY" }
  /** Timer: the attendees were never confirmed. */
  | { type: "EXPIRE" }
  | { type: "TRANSCRIBED" }
  | { type: "PROPOSALS_READY" }
  | { type: "READ_FAILED" }
  /** Every part of the split is settled. */
  | { type: "DONE" };

type Ctx = {
  record: MeetingRecord;
  /** Who acts; null for Atlas, a rule or a timer. */
  actorId: string | null;
  today: IsoDate;
  /** DONE: the recorder's review is final, and every attributed item is too. */
  settled?: boolean;
  /** ATTENDEES_CONFIRMED: the people who may attend, members and contacts of the project now (P10, MT3). */
  mayAttend?: (personId: string) => boolean;
};

const byRecorder = (c: Ctx) => (c.actorId !== null && c.actorId === c.record.recorderId ? null : "only the person who recorded it");

function confirmGuard(c: Ctx, e: Extract<MeetingEvent, { type: "ATTENDEES_CONFIRMED" }>): string | null {
  const refused = byRecorder(c);
  if (refused) return refused;
  // MT4: a recording the attendees did not know about is never read as theirs
  if (!e.told) return "they must have known it was recorded; otherwise read it as your own notes";
  const others = e.attendees.filter((p) => p !== c.record.recorderId);
  if (!others.length) return "say who else was there, or read it as your own notes";
  if (!c.mayAttend) return "who may attend is needed";
  return others.every((p) => c.mayAttend!(p)) ? null : "everyone there must be on the project or one of its contacts";
}

export const meetingMachine = defineMachine<MeetingState, MeetingEvent, Ctx>({
  name: "meeting",
  states: MEETING_STATES,
  arrows: [
    { from: ["received"], on: "ATTENDEES_CONFIRMED", to: "transcribing", guard: confirmGuard },
    // The model's fix ownNotes: a drawn way to read a note whose attendees were not told (NotToldReadAsOwnNotes)
    { from: ["received"], on: "OWN_NOTES_ONLY", to: "transcribing", guard: byRecorder },
    {
      from: ["received"],
      on: "EXPIRE",
      to: "expired",
      guard: (c) => (daysBetween(c.record.receivedOn, c.today) >= config.reviewExpiryDays ? null : `waiting ${daysBetween(c.record.receivedOn, c.today)} of ${config.reviewExpiryDays} days`),
    },
    { from: ["transcribing"], on: "TRANSCRIBED", to: "reading" },
    { from: ["reading"], on: "PROPOSALS_READY", to: "split" },
    { from: ["reading", "transcribing"], on: "READ_FAILED", to: "failed" },
    { from: ["split"], on: "DONE", to: "done", guard: (c) => (c.settled === true ? null : "a part of it is still open") },
  ],
});

export type MeetingResult = { outcome: Outcome<MeetingState>; record: MeetingRecord };

/** Applies one event. A refused event returns the record unchanged. */
export function applyMeetingEvent(record: MeetingRecord, event: MeetingEvent, ctx: Omit<Ctx, "record">): MeetingResult {
  const outcome = transition(meetingMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: MeetingRecord = { ...record, state: outcome.to };
  switch (event.type) {
    case "ATTENDEES_CONFIRMED":
      return { outcome, record: { ...next, mode: "meeting", attendees: [...new Set(event.attendees.filter((p) => p !== record.recorderId))].sort(), mergedWith: event.mergeWith ?? null } };
    case "OWN_NOTES_ONLY":
      return { outcome, record: { ...next, mode: "own", mergedWith: null } };
    default:
      return { outcome, record: next };
  }
}

/** A note just marked as a meeting, waiting for its attendees. */
export function receiveMeeting(fields: Pick<MeetingRecord, "id" | "captureId" | "recorderId" | "projectId" | "attendees" | "receivedOn">): MeetingRecord {
  return { ...fields, attendees: [...new Set(fields.attendees.filter((p) => p !== fields.recorderId))].sort(), mode: null, mergedWith: null, state: "received" };
}

/**
 * MT7, CD18: whether a new note (a) is of the same meeting as another's note (b): the same project, from someone
 * else, said within config.meetingMatchMinutes of each other. Only a note that was read for its attendees (not
 * own notes) is one to merge with: own notes sent nothing. And only one whose recorder named a's recorder as
 * there (fix check, 28 Oct, M1 and P10): a note is its recorder's alone, so someone who was not at that meeting
 * never learns of it, nor when it was sent. Once a's recorder says who was there (attendees), b's recorder must be
 * among them too; before that (the card offering the merge) attendees is null.
 */
export function sameMeeting(
  a: { projectId: string; recorderId: string; at: Date; attendees: readonly string[] | null },
  b: { projectId: string; recorderId: string; at: Date; attendees: readonly string[]; mode: MeetingMode | null; state: MeetingState },
): boolean {
  if (a.projectId !== b.projectId || a.recorderId === b.recorderId || b.mode !== "meeting") return false;
  if (b.state === "failed" || b.state === "expired") return false;
  if (!b.attendees.includes(a.recorderId) || (a.attendees && !a.attendees.includes(b.recorderId))) return false;
  return Math.abs(a.at.getTime() - b.at.getTime()) <= config.meetingMatchMinutes * 60_000;
}
