// Phase O, meetings (conversational plan, section 17): what the screens and the read show of a meeting note and
// of what it says about each attendee. The note is the recorder's (M1): only they see its card, its attendees and
// how each part stands. Someone it says something about sees only the words that fed that item (rule 9), never
// the rest of the note. Records are named only on projects the viewer can read now (P10).
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { attributedOf, leaveRecordOf, meetingOf } from "../db/records";
import * as t from "../db/schema";
import type { MeetingContext } from "../domain/atlas-checks/types";
import { daysBetween, type IsoDate } from "../domain/dates";
import { confirmedValue, promiseDay, type AttributedItemRecord, type AttributedState } from "../domain/machines/attributed-item";
import type { LeaveRecord, LeaveState } from "../domain/machines/leave";
import { sameMeeting, type MeetingRecord, type MeetingState } from "../domain/machines/meeting";
import { dayDate } from "./answers/shared";
import { clockTime, firstName, projectReader, WORK_STATE_LABEL } from "./project";

/**
 * Phase O: what a meeting note's read is given (CheckContext.meeting): its project and who was there, once the
 * recorder confirmed them or said it is their own notes. null for any other message, and for a note still waiting.
 */
export async function meetingContextOf(conn: Conn, captureId: string): Promise<MeetingContext | null> {
  const [row] = await conn.select().from(t.meetings).where(eq(t.meetings.captureId, captureId));
  if (!row?.mode) return null;
  const people = row.attendees.length ? await conn.select({ id: t.people.id, name: t.people.name, orgRole: t.people.orgRole }).from(t.people).where(inArray(t.people.id, row.attendees)) : [];
  return {
    projectId: row.projectId,
    mode: row.mode,
    attendees: people.sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ personId: p.id, name: p.name, inDpm: p.orgRole !== null })),
  };
}

/** MT3: who may be named as there: the project's members and contacts, never the recorder. */
export async function mayAttend(conn: Conn, projectId: string, recorderId: string): Promise<{ id: string; name: string; tie: string }[]> {
  const [members, contacts] = await Promise.all([
    conn
      .select({ id: t.people.id, name: t.people.name, title: t.people.title })
      .from(t.projectMemberships)
      .innerJoin(t.people, eq(t.people.id, t.projectMemberships.personId))
      .where(and(eq(t.projectMemberships.projectId, projectId), eq(t.projectMemberships.state, "member"))),
    conn
      .select({ id: t.people.id, name: t.people.name, tie: t.projectContacts.tie })
      .from(t.projectContacts)
      .innerJoin(t.people, eq(t.people.id, t.projectContacts.personId))
      .where(eq(t.projectContacts.projectId, projectId)),
  ]);
  const all = [...members.map((m) => ({ id: m.id, name: m.name, tie: m.title ?? "member" })), ...contacts.map((c) => ({ id: c.id, name: c.name, tie: c.tie }))];
  return all.filter((p, i) => p.id !== recorderId && all.findIndex((q) => q.id === p.id) === i).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * MT7, CD18: an earlier note of the same meeting from someone else, which this one may merge with. Only one the
 * recorder can know of: on the project they marked theirs with, which they read now (P10).
 */
export async function matchingMeeting(conn: Conn, meeting: MeetingRecord, at: Date): Promise<{ id: string; recorder: string; time: string } | null> {
  const rows = await conn
    .select({ m: t.meetings, at: t.captures.messageAt, recorder: t.people.name })
    .from(t.meetings)
    .innerJoin(t.captures, eq(t.captures.id, t.meetings.captureId))
    .innerJoin(t.people, eq(t.people.id, t.meetings.recorderId))
    .where(eq(t.meetings.projectId, meeting.projectId));
  const first = rows
    .filter((r) => r.m.id !== meeting.id && r.at <= at && sameMeeting({ projectId: meeting.projectId, recorderId: meeting.recorderId, at }, { ...meetingOf(r.m), at: r.at }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (!first || !(await projectReader(conn, meeting.recorderId)).mayRead(meeting.projectId)) return null;
  return { id: first.m.id, recorder: firstName(first.recorder), time: clockTime(first.at) };
}

// ---- What an attributed item says ----

/**
 * One line for what it would save, as the person it is about would read it, with their own words once they
 * edited it: "Send Kyle the buyer list, by Fri 23 Oct", "#160 Feature store backfill: In progress to Done".
 * null when the record is on a project the reader cannot read now (P10).
 */
export async function attributedSummary(conn: Conn, r: AttributedItemRecord, readerId: string): Promise<string | null> {
  if (r.kind === "commitment") {
    const due = promiseDay(r);
    return `${confirmedValue(r)}${due ? `, by ${dayDate(due)}` : ""}`;
  }
  if (!(await projectReader(conn, readerId)).mayRead(r.projectId)) return null;
  const target = r.draft.target;
  if (!target) return null;
  const value = confirmedValue(r);
  const said = (v: string | null) => (v ? (target.field === "forecast" ? `forecast ${dayDate(v)}` : (WORK_STATE_LABEL[v as keyof typeof WORK_STATE_LABEL] ?? v)) : "none");
  let label: string | null = null;
  if (target.type === "work_item") {
    const [row] = await conn.select({ number: t.workItems.number, title: t.workItems.title }).from(t.workItems).where(eq(t.workItems.id, target.id));
    label = row ? `${row.number ? `${row.number} ` : ""}${row.title}` : null;
  } else if (target.type === "milestone") {
    label = (await conn.select({ name: t.milestones.name }).from(t.milestones).where(eq(t.milestones.id, target.id)))[0]?.name ?? null;
  } else if (target.type === "handover") {
    label = (await conn.select({ title: t.handoverSteps.title }).from(t.handoverSteps).where(eq(t.handoverSteps.id, target.id)))[0]?.title ?? null;
  }
  if (!label) return null;
  return target.field === "forecast" ? `${label}: ${said(value)}` : `${label}: ${said(target.oldValue)} to ${said(value)}`;
}

// ---- The person it is about ----

export type AttributedDetail = {
  record: AttributedItemRecord;
  recorder: string;
  project: { id: string; name: string };
  /** When the note was said. */
  at: Date;
  summary: string;
  /** Only the words that fed it (rule 9). */
  quote: string;
  /** MT7: the other recorders whose notes said it too. */
  alsoFrom: string[];
  /** A promise's day as it stands; the screen offers a new one when it passed. */
  dueOn: IsoDate | null;
};

/** What the person it is about sees, only while it is theirs and on a project they read now (P10). */
export async function describeAttributed(conn: Conn, id: string, viewerId: string): Promise<AttributedDetail | null> {
  const [row] = await conn.select().from(t.attributedItems).where(eq(t.attributedItems.id, id));
  if (!row || row.personId !== viewerId) return null;
  const r = attributedOf(row);
  if (!(await projectReader(conn, viewerId)).mayRead(r.projectId)) return null;
  const [[capture], [project], recorders] = await Promise.all([
    conn.select({ at: t.captures.messageAt }).from(t.captures).where(eq(t.captures.id, r.captureId)),
    conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(eq(t.projects.id, r.projectId)),
    conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, [r.recorderId, ...r.alsoFrom.map((a) => a.recorderId)])),
  ]);
  const name = (pid: string) => firstName(recorders.find((p) => p.id === pid)?.name ?? "Someone");
  const summary = await attributedSummary(conn, r, viewerId);
  if (!summary || !project) return null;
  return { record: r, recorder: name(r.recorderId), project, at: capture.at, summary, quote: r.quote, alsoFrom: r.alsoFrom.map((a) => name(a.recorderId)), dueOn: promiseDay(r) };
}

// ---- The recorder ----

/** One part of the note as its recorder sees it: what it says, about whom, and how it stands. */
export type MeetingPart = { id: string; title: string; who: string | null; state: AttributedState; outcome: string };

export type MeetingView = {
  id: string;
  state: MeetingState;
  mode: "meeting" | "own" | null;
  project: { id: string; name: string } | null;
  attendees: { id: string; name: string }[];
  /** received: who may be named as there (MT3), and the earlier note of the same meeting to merge with (MT7). */
  candidates: { id: string; name: string; tie: string }[];
  merge: { id: string; recorder: string; time: string } | null;
  mergedWith: string | null;
  parts: MeetingPart[];
  /** How it ended, when it did without being read. */
  ended: string | null;
};

function outcomeOf(r: AttributedItemRecord, who: string | null): string {
  const them = who ?? "They";
  switch (r.state) {
    case "held":
      return "Who said this? Choose it in your review.";
    case "waiting":
      return `${them} is on leave; it goes to them when they are back.`;
    case "proposed":
      return `Sent to ${who ?? "them"} to confirm.`;
    case "confirmed":
      return `${them} confirmed it${r.wording ? ", in their words" : ""}.`;
    case "declined":
      return `${them} says that's not right${r.reason ? `: "${r.reason}"` : "."}`;
    case "expired":
      return r.askedOn ? `${them} didn't answer, so it was not filed.` : "Not filed: your review ended first.";
    case "mine":
      // MT1, MT3, CD17: someone not in DPM, not there, or not told is never asked; the recorder reviews it
      return r.kind === "commitment" && r.personId && r.personId !== r.recorderId ? "In your review, as a dependency: nobody is asked to confirm it." : "In your review.";
    case "withdrawn":
      return `Withdrawn: ${r.reason ?? "it no longer applies"}.`;
    default:
      return "";
  }
}

/** The card under a meeting note, for its recorder only: the attendees to confirm, then how each part stands. */
export async function meetingViewOf(conn: Conn, capture: Pick<typeof t.captures.$inferSelect, "id" | "authorId" | "messageAt">): Promise<MeetingView | null> {
  const [row] = await conn.select().from(t.meetings).where(and(eq(t.meetings.captureId, capture.id), eq(t.meetings.recorderId, capture.authorId)));
  if (!row) return null;
  const m = meetingOf(row);
  const reader = await projectReader(conn, m.recorderId);
  const readable = reader.mayRead(m.projectId);
  const [project] = readable ? await conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(eq(t.projects.id, m.projectId)) : [];
  const people = m.attendees.length ? await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, m.attendees)) : [];
  // MT7: this note's parts, and those an earlier note of the same meeting already sent, which it merged with
  const rows = await conn
    .select()
    .from(t.attributedItems)
    .where(or(eq(t.attributedItems.meetingId, m.id), sql`${t.attributedItems.alsoFrom} @> ${JSON.stringify([{ meetingId: m.id }])}::jsonb`))
    .orderBy(t.attributedItems.createdAt, t.attributedItems.id);
  const names = new Map((await conn.select({ id: t.people.id, name: t.people.name }).from(t.people)).map((p) => [p.id, firstName(p.name)]));
  const parts: MeetingPart[] = [];
  for (const a of rows.map(attributedOf)) {
    if (!reader.mayRead(a.projectId)) continue;
    const who = a.personId ? (names.get(a.personId) ?? null) : null;
    const title = (await attributedSummary(conn, { ...a, wording: null, dueOn: null }, m.recorderId)) ?? a.quote;
    parts.push({ id: a.id, title, who, state: a.state, outcome: outcomeOf(a, who) });
  }
  const received = m.state === "received";
  return {
    id: m.id,
    state: m.state,
    mode: m.mode,
    project: project ?? null,
    attendees: people.sort((a, b) => a.name.localeCompare(b.name)),
    candidates: received && readable ? await mayAttend(conn, m.projectId, m.recorderId) : [],
    merge: received && readable ? await matchingMeeting(conn, m, capture.messageAt) : null,
    mergedWith: m.mergedWith,
    parts,
    ended: m.state === "expired" ? "Not read: nobody confirmed who was there, so nothing in it was used." : m.state === "failed" ? "Atlas could not read this note. Send it again." : null,
  };
}

/** MT2: the items of a note held for who said it, with whom the recorder may name, for the review. */
export type HeldItem = { id: string; quote: string; title: string; choices: { id: string; name: string }[] };

export async function heldForReview(conn: Conn, captureId: string, viewerId: string): Promise<HeldItem[]> {
  const [row] = await conn.select().from(t.meetings).where(and(eq(t.meetings.captureId, captureId), eq(t.meetings.recorderId, viewerId)));
  if (!row) return [];
  const held = (await conn.select().from(t.attributedItems).where(and(eq(t.attributedItems.meetingId, row.id), eq(t.attributedItems.state, "held")))).map(attributedOf);
  if (!held.length) return [];
  const people = row.attendees.length ? await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, row.attendees)) : [];
  const choices = [{ id: viewerId, name: "Me" }, ...people.sort((a, b) => a.name.localeCompare(b.name))];
  return Promise.all(held.map(async (a) => ({ id: a.id, quote: a.quote, title: (await attributedSummary(conn, a, viewerId)) ?? a.quote, choices })));
}

// ---- Leave (MT12) ----

const WAS_AWAY: readonly LeaveState[] = ["approved", "handover_in_progress", "covered", "uncovered", "active", "ended"];

/** Whether a person was away on a day, by their decided leave: today's and the days the timer counts (MT12). */
export async function awayOn(conn: Conn, personId: string): Promise<(day: IsoDate) => boolean> {
  const leaves: LeaveRecord[] = (await conn.select().from(t.leave).where(eq(t.leave.personId, personId))).map(leaveRecordOf);
  return (day) => leaves.some((l) => WAS_AWAY.includes(l.state) && daysBetween(l.start, day) >= 0 && daysBetween(day, l.end) >= 0);
}
