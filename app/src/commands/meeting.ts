// Phase O commands (conversational plan, section 17): a meeting note is the recorder's capture, marked as a
// meeting with a project (M33). It is read once they confirm who was there and that they knew it was recorded,
// or say it is their own notes (MT4, CD17). Its read splits: the recorder's own items, decisions included, wait in
// their review (M3, then M15: two confirmations); each thing about an attendee goes to them as an M34 Ask, saved
// as theirs only when they confirm it, run as them and checked when it runs (rules 4 and 10). An item whose
// speaker Atlas is unsure of is held in the recorder's review until they say who (MT2); someone who is not a
// member of the item's project is never asked, and their item is the recorder's (MT1); someone on leave gets it
// when they are back, and its timer counts only days they are in (MT12). An Ask whose person left its project, or
// whose record is someone else's now, is withdrawn where that is first seen: the membership's LEAVE
// (withdrawOnLeave), their own answer, or the daily timer (E77, ownerAtConfirm). A second note of the same meeting
// may merge with the first, so nothing is asked twice, whichever is read first (MT7, CD18). Every move runs its
// machine and writes an audit entry. Atlas cannot speak first yet (phase F): what is asked of someone is a notice
// in their DPM chat plus an inbox item.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { attributedOf, loadCapture, loadWorld, meetingOf, persistAttributed, persistMeeting } from "../db/records";
import * as t from "../db/schema";
import type { CheckContext } from "../domain/atlas-checks/types";
import { config } from "../domain/config";
import type { Moved } from "../domain/machine";
import { FINAL_CAPTURE_STATES } from "../domain/machines/capture";
import {
  applyAttributedEvent,
  ATTRIBUTED_FINAL,
  attributedCauses,
  confirmedValue,
  promiseDay,
  sameAttributed,
  workingDaysIn,
  type AttributedEvent,
  type AttributedItemRecord,
  type AttributedState,
} from "../domain/machines/attributed-item";
import type { ExtractedItem } from "../domain/machines/extracted-item";
import { applyMeetingEvent, receiveMeeting, type MeetingEvent, type MeetingRecord, type MeetingState } from "../domain/machines/meeting";
import { mineDraft, splitMeeting, type SplitPart } from "../domain/meeting";
import type { ExtractedItemDraft } from "../domain/shared";
import { attributedSummary, awayOn, mayAttend, matchingMeeting } from "../queries/meeting";
import { clockTime, firstName, projectReader } from "../queries/project";
import { addItemToReview, applyWrite, createCaptureIn, expireMeetingCapture, type SaveScope } from "./capture";
import { openFromMeeting } from "./commitment";
import { audit, CommandRefused, moved, runCommand, todayOf, type CommandCtx } from "./core";
import { evaluateProject, syncInbox } from "./evaluate";
import { notice } from "./notices";
import { fieldNow, ownerNow } from "./owner-ask";

type MeetingRow = typeof t.meetings.$inferSelect;
type By = { actorType: "person" | "atlas" | "rule"; actorId: string | null };

function auditMeeting(tx: Tx, now: Date, m: MeetingRecord, outcome: Moved<MeetingState> | { event: "RECEIVED"; from: null; to: MeetingState }, by: By, detail: Record<string, unknown> = {}) {
  return audit(tx, now, {
    ...by,
    action: outcome.event,
    machine: "meeting",
    subjectType: "meeting",
    subjectId: m.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId: m.captureId,
    detail: { projectId: m.projectId, mode: m.mode, attendees: m.attendees, ...(m.mergedWith ? { mergedWith: m.mergedWith } : {}), ...detail },
  });
}

function auditItem(tx: Tx, now: Date, r: AttributedItemRecord, outcome: Moved<AttributedState> | { event: string; from: AttributedState; to: AttributedState }, by: By, detail: Record<string, unknown> = {}) {
  return audit(tx, now, {
    ...by,
    action: outcome.event,
    machine: "attributed_item",
    subjectType: "attributed_item",
    subjectId: r.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId: r.captureId,
    detail: { meetingId: r.meetingId, personId: r.personId, projectId: r.projectId, kind: r.kind, ...detail },
  });
}

const person = (id: string): By => ({ actorType: "person", actorId: id });
const RULE: By = { actorType: "rule", actorId: null };
const ATLAS: By = { actorType: "atlas", actorId: null };

async function nameOf(tx: Tx, personId: string | null): Promise<string> {
  if (!personId) return "Someone";
  const [p] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, personId));
  return p ? firstName(p.name) : "Someone";
}

/** The words an item came from, as the recorder's note says them: the only words its person sees (rule 9). */
const quoteOf = (text: string, d: ExtractedItemDraft) => d.spans.map((s) => text.slice(s.start, s.end)).join(" … ");

// ---- The recorder: a note marked as a meeting, and who was there (M33) ----

export type NewMeetingNote = {
  text: string;
  projectId: string;
  kind?: "text" | "voice";
  durationSeconds?: number | null;
  /** Who the recorder already named as there; confirmed with ATTENDEES_CONFIRMED. */
  attendees?: readonly string[];
  conversationId?: string | null;
  messageId?: string | null;
};

/**
 * RECEIVED: the note is stored as the recorder's capture (M1, private to them) in their chat, and its meeting waits
 * for who was there. Only a project they read now (P10). A repeat of the same message is the same note (E1).
 */
export function createMeetingNote(ctx: CommandCtx, input: NewMeetingNote): Promise<{ captureId: string; meetingId: string; conversationId: string | null; duplicate: boolean }> {
  return runCommand(ctx, async (tx) => {
    if (!(await projectReader(tx, ctx.actorId)).mayRead(input.projectId)) throw new CommandRefused("choose one of your projects", "not_found");
    const created = await createCaptureIn(tx, ctx, {
      channel: "app",
      kind: input.kind ?? "text",
      text: input.text,
      durationSeconds: input.durationSeconds ?? null,
      messageAt: ctx.now,
      receivedAt: ctx.now,
      messageId: input.messageId ?? null,
      conversationId: input.conversationId ?? null,
    });
    const id = `mtg-${created.captureId}`;
    if (created.duplicate) return { ...created, meetingId: id };
    const allowed = new Set((await mayAttend(tx, input.projectId, ctx.actorId)).map((p) => p.id));
    const record = receiveMeeting({ id, captureId: created.captureId, recorderId: ctx.actorId, projectId: input.projectId, attendees: (input.attendees ?? []).filter((p) => allowed.has(p)), receivedOn: todayOf(ctx.now) });
    await persistMeeting(tx, record, null, ctx.now);
    await auditMeeting(tx, ctx.now, record, { event: "RECEIVED", from: null, to: "received" }, person(ctx.actorId));
    return { ...created, meetingId: id };
  });
}

async function ownMeeting(tx: Tx, actorId: string, meetingId: string): Promise<MeetingRow> {
  const [row] = await tx.select().from(t.meetings).where(eq(t.meetings.id, meetingId));
  // The note is its recorder's alone (M1): anyone else's reads as not found
  if (!row || row.recorderId !== actorId) throw new CommandRefused("no such meeting note", "not_found");
  return row;
}

/**
 * ATTENDEES_CONFIRMED: the recorder names who was there (members or contacts of the project, MT3) and says they
 * knew it was recorded (MT4). merge: MT7's offer taken, when an earlier note of the same meeting is there now.
 * The read starts once this commits (readCapture).
 */
export function confirmAttendees(ctx: CommandCtx, meetingId: string, input: { attendees: readonly string[]; told: boolean; merge?: boolean }): Promise<MeetingRecord> {
  return runCommand(ctx, async (tx) => {
    const row = await ownMeeting(tx, ctx.actorId, meetingId);
    const m = meetingOf(row);
    // Rule 4: the project is read for the recorder now
    if (!(await projectReader(tx, ctx.actorId)).mayRead(m.projectId)) throw new CommandRefused("you can no longer read this project", "not_found");
    const allowed = new Set((await mayAttend(tx, m.projectId, m.recorderId)).map((p) => p.id));
    const [capture] = await tx.select({ at: t.captures.messageAt }).from(t.captures).where(eq(t.captures.id, m.captureId));
    // MT7, P10: only a note whose recorder this one names as there, and which named this recorder, is merged with
    const mergeWith = input.merge ? ((await matchingMeeting(tx, m, capture.at, input.attendees))?.id ?? null) : null;
    const r = applyMeetingEvent(m, { type: "ATTENDEES_CONFIRMED", attendees: input.attendees, told: input.told, mergeWith }, { actorId: ctx.actorId, today: todayOf(ctx.now), mayAttend: (p) => allowed.has(p) });
    const outcome = moved(r.outcome);
    await persistMeeting(tx, r.record, row.version, ctx.now);
    await auditMeeting(tx, ctx.now, r.record, outcome, person(ctx.actorId));
    return r.record;
  });
}

/** OWN_NOTES_ONLY (MT4, CD17): the attendees were not told, so it is read as the recorder's own notes only. */
export function readAsOwnNotes(ctx: CommandCtx, meetingId: string): Promise<MeetingRecord> {
  return runCommand(ctx, async (tx) => {
    const row = await ownMeeting(tx, ctx.actorId, meetingId);
    const r = applyMeetingEvent(meetingOf(row), { type: "OWN_NOTES_ONLY" }, { actorId: ctx.actorId, today: todayOf(ctx.now) });
    const outcome = moved(r.outcome);
    await persistMeeting(tx, r.record, row.version, ctx.now);
    await auditMeeting(tx, ctx.now, r.record, outcome, person(ctx.actorId));
    return r.record;
  });
}

// ---- Hooks into the capture's own job (M2) ----

/** What M2's guards read for a capture: a meeting note waiting for its attendees, one that expired, or ready. */
export async function meetingGate(tx: Tx, captureId: string): Promise<"waiting" | "expired" | "ready" | undefined> {
  const [row] = await tx.select({ state: t.meetings.state }).from(t.meetings).where(eq(t.meetings.captureId, captureId));
  if (!row) return undefined;
  return row.state === "received" ? "waiting" : row.state === "expired" ? "expired" : "ready";
}

/** MT2: the note's items held for who said it; M2's Save waits for them. */
export async function heldCount(tx: Tx, captureId: string): Promise<number> {
  return (await tx.select({ id: t.attributedItems.id }).from(t.attributedItems).where(and(eq(t.attributedItems.captureId, captureId), eq(t.attributedItems.state, "held")))).length;
}

/** One move of M33 by Atlas or a rule, when it is drawn from where the meeting is. */
async function moveMeeting(tx: Tx, now: Date, row: MeetingRow, event: MeetingEvent, by: By, ctx: { settled?: boolean } = {}): Promise<MeetingRecord | null> {
  const r = applyMeetingEvent(meetingOf(row), event, { actorId: by.actorId, today: todayOf(now), ...ctx });
  if (!r.outcome.ok) return null;
  await persistMeeting(tx, r.record, row.version, now);
  await auditMeeting(tx, now, r.record, r.outcome, by);
  return r.record;
}

/** M2 failed after its tries: so does its meeting (rule 5). */
export async function meetingReadFailed(tx: Tx, now: Date, captureId: string): Promise<void> {
  const [row] = await tx.select().from(t.meetings).where(eq(t.meetings.captureId, captureId));
  if (row) await moveMeeting(tx, now, row, { type: "READ_FAILED" }, ATLAS);
}

/**
 * M33 PROPOSALS_READY, then the split, in the read's transaction: each item about an attendee becomes an M34 Ask
 * (SPLIT decides held, waiting, proposed or mine), and what is the recorder's own comes back for their review,
 * an item that became theirs (mine) in its recorder's form (mineDraft). MT7: an Ask that another note of the
 * same meeting, merged with this one either way, already made is not made again; that one names this recorder
 * too. Returns the recorder's drafts and how many are held for who said it.
 */
export async function splitMeetingNote(tx: Tx, now: Date, capture: Pick<typeof t.captures.$inferSelect, "id" | "authorId" | "text">, drafts: readonly ExtractedItemDraft[], ctx: CheckContext): Promise<{ own: ExtractedItemDraft[]; held: number }> {
  const [row] = await tx.select().from(t.meetings).where(eq(t.meetings.captureId, capture.id));
  if (!row || !ctx.meeting) return { own: [...drafts], held: 0 };
  let current = row;
  const step = async (event: MeetingEvent) => {
    const r = await moveMeeting(tx, now, current, event, ATLAS);
    if (r) [current] = await tx.select().from(t.meetings).where(eq(t.meetings.id, row.id));
  };
  if (current.state === "transcribing") await step({ type: "TRANSCRIBED" });
  if (current.state === "reading") await step({ type: "PROPOSALS_READY" });
  const m = meetingOf(current);
  const today = todayOf(now);
  // MT7, CD18: what a note of the same meeting already asked: the earlier one this merged with, or a later one that
  // merged with this one and was read first (it merges once this one's attendees are confirmed, before its read)
  const later = (await tx.select({ id: t.meetings.id }).from(t.meetings).where(eq(t.meetings.mergedWith, m.id))).map((r) => r.id);
  const linked = [...(m.mergedWith ? [m.mergedWith] : []), ...later];
  const earlier = linked.length ? (await tx.select().from(t.attributedItems).where(inArray(t.attributedItems.meetingId, linked))).map((r) => ({ row: r, record: attributedOf(r) })) : [];
  const nameIn = (id: string | null) => (id ? (ctx.meeting!.attendees.find((a) => a.personId === id)?.name ?? ctx.projects.flatMap((p) => p.people).find((p) => p.personId === id)?.name ?? null) : null);
  const projectName = (id: string) => ctx.projects.find((p) => p.id === id)?.name ?? "the project";
  const own: ExtractedItemDraft[] = [];
  let held = 0;
  for (const part of splitMeeting(drafts, { recorderId: m.recorderId, meeting: ctx.meeting, projects: ctx.projects })) {
    if (part.to === "own") {
      own.push(part.draft);
      continue;
    }
    const pid = part.personId;
    const record: AttributedItemRecord = {
      id: `att-${capture.id}-${part.draft.ordinal}`,
      meetingId: m.id,
      captureId: capture.id,
      recorderId: m.recorderId,
      personId: pid,
      projectId: part.projectId,
      kind: part.kind,
      draft: part.draft,
      quote: quoteOf(capture.text, part.draft),
      state: "none",
      wording: null,
      dueOn: null,
      askedOn: null,
      decidedOn: null,
      reason: null,
      alsoFrom: [],
    };
    // MT3: someone named who was not there is asked nothing; their promise is the recorder's to report (U2)
    const member = pid ? m.attendees.includes(pid) && (await projectReader(tx, pid)).mayRead(part.projectId) : false;
    const away = pid ? (await awayOn(tx, pid))(today) : false;
    const r = applyAttributedEvent(record, { type: "SPLIT" }, { actorId: null, today, ownNotes: m.mode === "own", sure: part.sure, member, away });
    const outcome = moved(r.outcome);
    // MT7, CD18: the other note already asked them this; it is not asked twice
    const same = r.record.state === "proposed" || r.record.state === "waiting" ? earlier.find((e) => ["waiting", "proposed", "confirmed", "declined"].includes(e.record.state) && sameAttributed(e.record, r.record)) : undefined;
    if (same) {
      const joined = { ...same.record, alsoFrom: [...same.record.alsoFrom, { recorderId: m.recorderId, captureId: capture.id, meetingId: m.id }] };
      await persistAttributed(tx, joined, same.row.version, now);
      await auditItem(tx, now, joined, { event: "MERGED", from: same.record.state, to: same.record.state }, ATLAS, { from: m.id });
      continue;
    }
    await persistAttributed(tx, r.record, null, now);
    await auditItem(tx, now, r.record, outcome, ATLAS, { sure: part.sure, member, away });
    if (r.record.state === "mine") own.push(mineDraft(part, { recorderId: m.recorderId, personId: pid, name: nameIn(pid), project: { id: part.projectId, name: projectName(part.projectId) } }));
    if (r.record.state === "held") held++;
    if (r.record.state === "proposed") await deliver(tx, now, r.record);
  }
  return { own, held };
}

/** It reaches the person: an inbox item and a notice in their DPM chat, until phase F lets Atlas speak first. */
async function deliver(tx: Tx, now: Date, r: AttributedItemRecord): Promise<void> {
  await syncItems(tx, now, r, false);
  const [project] = await tx.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, r.projectId));
  const summary = await attributedSummary(tx, r, r.personId!);
  if (!summary) return;
  const by = await nameOf(tx, r.recorderId);
  await notice(tx, now, [r.personId!], `${by}'s meeting note on ${project.name} says this is yours: ${summary}. Is that right? Confirm or decline it in your inbox.`, { type: "attributed_item", id: r.id, projectId: r.projectId, act: "asked" });
}

/** M10: the Ask in front of its person while it is asked; answered by them, it closes as acted. */
async function syncItems(tx: Tx, now: Date, r: AttributedItemRecord, byPerson: boolean): Promise<void> {
  const items = await tx.select().from(t.inboxItems).where(eq(t.inboxItems.causeKey, `attributed:${r.id}`));
  await syncInbox(tx, now, items, new Map(attributedCauses(r).map((k) => [k, [r.personId!]])), byPerson && r.personId ? { actorId: r.personId } : {});
}

/** M2 discarded or expired with items still held (MT2): they end with it; nothing of them reached anyone. */
export async function endHeldItems(tx: Tx, now: Date, captureId: string, how: "discarded" | "expired", actorId: string | null): Promise<void> {
  const rows = await tx.select().from(t.attributedItems).where(and(eq(t.attributedItems.captureId, captureId), eq(t.attributedItems.state, "held")));
  for (const row of rows) {
    const r = applyAttributedEvent(attributedOf(row), { type: "REVIEW_ENDED", how }, { actorId, today: todayOf(now) });
    if (!r.outcome.ok) continue;
    await persistAttributed(tx, r.record, row.version, now);
    await auditItem(tx, now, r.record, r.outcome, actorId ? person(actorId) : RULE);
  }
}

/** M33 DONE: the recorder's review is final, and every Ask the note made is too. */
export async function settleMeeting(tx: Tx, now: Date, captureId: string): Promise<void> {
  const [row] = await tx.select().from(t.meetings).where(eq(t.meetings.captureId, captureId));
  if (!row || row.state !== "split") return;
  const [capture] = await tx.select({ state: t.captures.state }).from(t.captures).where(eq(t.captures.id, captureId));
  const parts = await tx.select({ state: t.attributedItems.state }).from(t.attributedItems).where(eq(t.attributedItems.meetingId, row.id));
  const settled = FINAL_CAPTURE_STATES.includes(capture.state) && parts.every((p) => ATTRIBUTED_FINAL.includes(p.state));
  if (settled) await moveMeeting(tx, now, row, { type: "DONE" }, RULE, { settled });
}

// ---- The recorder fixes who said it (MT2) ----

/**
 * FIX_SPEAKER, while the review is open: the recorder says who said a held item, themselves or someone who was
 * there. It then goes to that person (or waits for them, MT12), or joins the recorder's review as theirs (mine).
 * MT3: someone on the project or one of its contacts whom the recorder did not list may be named too; naming
 * them is the recorder adding them, for this item.
 */
export function fixSpeaker(ctx: CommandCtx, attributedId: string, personId: string): Promise<AttributedItemRecord> {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.attributedItems).where(eq(t.attributedItems.id, attributedId));
    if (!row || row.recorderId !== ctx.actorId) throw new CommandRefused("no such item", "not_found");
    const [meeting] = await tx.select().from(t.meetings).where(eq(t.meetings.id, row.meetingId));
    const listed = personId === row.recorderId || meeting.attendees.includes(personId);
    if (!listed && !(await mayAttend(tx, meeting.projectId, row.recorderId)).some((p) => p.id === personId)) throw new CommandRefused("choose yourself or someone who was there: on the project, or one of its contacts");
    const [capture] = await tx.select({ state: t.captures.state }).from(t.captures).where(eq(t.captures.id, row.captureId));
    const today = todayOf(ctx.now);
    const member = (await projectReader(tx, personId)).mayRead(row.projectId);
    const away = (await awayOn(tx, personId))(today);
    const r = applyAttributedEvent(attributedOf(row), { type: "FIX_SPEAKER", personId }, { actorId: ctx.actorId, today, member, away, reviewOpen: capture.state === "proposed" || capture.state === "reviewing" });
    const outcome = moved(r.outcome);
    await persistAttributed(tx, r.record, row.version, ctx.now);
    await auditItem(tx, ctx.now, r.record, outcome, person(ctx.actorId), { member, away, ...(listed ? {} : { added: true }) });
    if (r.record.state === "mine") {
      const [project] = await tx.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(eq(t.projects.id, row.projectId));
      const [named] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, personId));
      const part: Extract<SplitPart, { to: "attributed" }> = { to: "attributed", draft: r.record.draft, kind: r.record.kind, personId, projectId: row.projectId, sure: true };
      await addItemToReview(tx, ctx.now, row.captureId, mineDraft(part, { recorderId: row.recorderId, personId, name: named?.name ?? null, project }));
    }
    if (r.record.state === "proposed") await deliver(tx, ctx.now, r.record);
    return r.record;
  });
}

// ---- No longer theirs: withdrawn (E77, ownerAtConfirm) ----

/**
 * The model's withdrawOnLeave (E77) and the fix check's ownerAtConfirm (rules 4 and 10): an open Ask whose person
 * is no longer a member of its project, or an update whose record is someone else's now (or gone), is withdrawn,
 * and leaves their inbox. null when it still stands. Nothing is filed, and nobody else is asked: the new owner was
 * not named in the meeting, so the recorder sees it withdrawn on the note's card and may report it again.
 */
async function withdrawIfNotTheirs(tx: Tx, now: Date, row: typeof t.attributedItems.$inferSelect): Promise<AttributedItemRecord | null> {
  const r0 = attributedOf(row);
  if ((r0.state !== "waiting" && r0.state !== "proposed") || !r0.personId) return null;
  const member = (await projectReader(tx, r0.personId)).mayRead(r0.projectId);
  const owner = r0.kind === "update" && r0.draft.target ? await ownerNow(tx, r0.draft.target) : null;
  const event: AttributedEvent | null = !member ? { type: "LEFT" } : r0.kind === "update" && owner !== r0.personId ? { type: "REASSIGNED" } : null;
  if (!event) return null;
  const r = applyAttributedEvent(r0, event, { actorId: null, today: todayOf(now), member, owner });
  if (!r.outcome.ok) return null;
  await persistAttributed(tx, r.record, row.version, now);
  await auditItem(tx, now, r.record, r.outcome, RULE, r0.kind === "update" ? { owner } : {});
  await syncItems(tx, now, r.record, false);
  return r.record;
}

/**
 * E77, the model's withdrawOnLeave: in the transaction that takes someone off a project (M13 LEAVE), their open
 * Asks there are withdrawn, so an open Ask is only ever a member's (OpenAsksOnlyToMembers). DPM has no command
 * for leaving yet (membership comes from the Atlas group, D2): whatever changes it calls this; until then their
 * own answer and the daily timer withdraw it, and the chat stops showing its notice once they cannot read the
 * project (P10).
 */
export async function withdrawOnLeave(tx: Tx, now: Date, personId: string, projectId: string): Promise<string[]> {
  const rows = await tx
    .select()
    .from(t.attributedItems)
    .where(and(eq(t.attributedItems.personId, personId), eq(t.attributedItems.projectId, projectId), inArray(t.attributedItems.state, ["waiting", "proposed"])));
  const withdrawn: string[] = [];
  for (const row of rows) {
    const r = await withdrawIfNotTheirs(tx, now, row);
    if (!r) continue;
    withdrawn.push(r.id);
    await settleMeeting(tx, now, r.captureId);
  }
  return withdrawn;
}

// ---- The person it is about: confirm, edit or decline (M34) ----

export type AttributedRun = { record: AttributedItemRecord; message: string };

/** What an Ask that ended says, to its person, when they answer it again: a repeat changes nothing (rule 6). */
function endedText(r: AttributedItemRecord): string {
  switch (r.state) {
    case "confirmed":
      return "You confirmed this already.";
    case "declined":
      return "You said this wasn't right already.";
    case "expired":
      return "This was not answered in time, so it was not filed.";
    default:
      return "This is no longer asked of you.";
  }
}

/** One answer by the person it is about, checked now (rule 4); `then` writes what it causes in the same transaction. */
function answer(ctx: CommandCtx, id: string, event: AttributedEvent, done: string, then?: (tx: Tx, before: AttributedItemRecord, after: AttributedItemRecord) => Promise<void>): Promise<AttributedRun> {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.attributedItems).where(eq(t.attributedItems.id, id));
    // Rule 10, P10: it is theirs alone; anyone else's reads as not found
    if (!row || row.personId !== ctx.actorId) throw new CommandRefused("no such item", "not_found");
    const before = attributedOf(row);
    if (ATTRIBUTED_FINAL.includes(before.state)) return { record: before, message: endedText(before) };
    // Rule 4, E77, ownerAtConfirm: no longer on its project, or the record is someone else's now: it is withdrawn
    // here, in the answer's transaction, and nothing is filed
    const gone = await withdrawIfNotTheirs(tx, ctx.now, row);
    if (gone) {
      await settleMeeting(tx, ctx.now, before.captureId);
      return { record: gone, message: gone.reason === "they left the project" ? "You are no longer on this project, so this was withdrawn. Nothing was filed." : "This is no longer yours, so it was withdrawn. Nothing was filed." };
    }
    const today = todayOf(ctx.now);
    const member = (await projectReader(tx, ctx.actorId)).mayRead(before.projectId);
    const target = before.kind === "update" ? (before.draft.target ?? null) : null;
    const [current, owner] = target ? [await fieldNow(tx, target), await ownerNow(tx, target)] : [null, null];
    const r = applyAttributedEvent(before, event, { actorId: ctx.actorId, today, member, away: (await awayOn(tx, ctx.actorId))(today), current, owner });
    const outcome = moved(r.outcome);
    if (then) await then(tx, before, r.record);
    await persistAttributed(tx, r.record, row.version, ctx.now);
    await auditItem(tx, ctx.now, r.record, outcome, person(ctx.actorId), event.type === "EDIT" ? { wording: r.record.wording, dueOn: r.record.dueOn } : event.type === "DECLINE" ? { reason: r.record.reason } : {});
    await syncItems(tx, ctx.now, r.record, true);
    await settleMeeting(tx, ctx.now, before.captureId);
    return { record: r.record, message: done };
  });
}

/**
 * CONFIRM: saved as theirs, run as them. An update goes through its record's machine as Save writes it (applyWrite,
 * with the recorder's words as its source); a promise opens their commitment (phase E, M22).
 */
export function confirmAttributed(ctx: CommandCtx, id: string): Promise<AttributedRun> {
  return answer(ctx, id, { type: "CONFIRM" }, "Saved as yours.", async (tx, _before, after) => {
    if (after.kind === "commitment") {
      const c = after.draft.commitment!;
      const link = c.link ? { type: c.link.type, id: c.link.id, projectId: c.link.projectId } : null;
      await openFromMeeting(tx, ctx.now, { attributedId: after.id, ownerId: ctx.actorId, what: confirmedValue(after), dueOn: promiseDay(after)!, link });
      return;
    }
    const target = after.draft.target!;
    if (target.type === "leave") throw new CommandRefused("leave is only ever your own to ask for");
    const loaded = await loadCapture(tx, after.captureId);
    if (!loaded) throw new CommandRefused("the note this came from is gone");
    const value = confirmedValue(after);
    const item: ExtractedItem = { id: after.id, draft: after.draft, state: "accepted", confidence: after.draft.confidence, value, saw: target.oldValue, conflict: null, withdrawn: null, touched: true };
    // Phase L, M30: confirming is their own decision, not a save of the recorder's, so no receipt is kept
    const scope: SaveScope = { tx, now: ctx.now, authorId: ctx.actorId, capture: loaded.row, world: await loadWorld(tx), byId: new Map([[item.id, item]]), blockLinks: new Map(), receipt: { records: new Map(), told: [] } };
    await applyWrite(scope, { itemId: item.id, target: { type: target.type, id: target.id, field: target.field }, key: `${target.type}:${target.id}:${target.field}`, expected: target.oldValue, value });
    await evaluateProject(tx, after.projectId, ctx.now, { actorId: ctx.actorId });
  });
}

/** EDIT, then CONFIRM: their own words (a promise's what, or an update's value), and a promise's new day. */
export function editAttributed(ctx: CommandCtx, id: string, input: { value: string; dueOn?: string | null }): Promise<AttributedRun> {
  return answer(ctx, id, { type: "EDIT", value: input.value, dueOn: input.dueOn ?? null }, "Changed. Confirm it when it's right.");
}

/** MT5, DECLINE: not filed, and the recorder (and any recorder it merged with, MT7) is told "Kemar says that's not right". */
export function declineAttributed(ctx: CommandCtx, id: string, reason?: string | null): Promise<AttributedRun> {
  return answer(ctx, id, { type: "DECLINE", reason: reason ?? null }, "Not filed. The person who recorded it is told.", async (tx, _before, after) => {
    const by = await nameOf(tx, ctx.actorId);
    for (const recorderId of [after.recorderId, ...after.alsoFrom.map((a) => a.recorderId)]) {
      const summary = await attributedSummary(tx, after, recorderId);
      await notice(tx, ctx.now, [recorderId], `${by} says that's not right${summary ? `: ${summary}` : ""}.${after.reason ? ` "${after.reason}"` : ""}`, { type: "attributed_item", id: after.id, projectId: after.projectId, act: "declined" });
    }
  });
}

// ---- Timers ----

/**
 * The meeting timers (rule 5), cheap when nothing waits: a note whose attendees were never confirmed expires after
 * config.reviewExpiryDays, and its recorder is told; an Ask waiting for someone on leave reaches them when they are
 * back (MT12); one whose person left its project, or whose record is someone else's now, is withdrawn (E77,
 * ownerAtConfirm); one nobody answered in config.attributedExpiryDays working days they were in expires unfiled,
 * and its recorder is told; and a meeting whose every part is settled is done.
 */
export function runMeetingTimers(ctx: { db: Db; now: Date }): Promise<{ id: string; to: string }[]> {
  const today = todayOf(ctx.now);
  return ctx.db.transaction(async (tx) => {
    const moves: { id: string; to: string }[] = [];
    for (const row of await tx.select().from(t.meetings).where(eq(t.meetings.state, "received"))) {
      const r = await moveMeeting(tx, ctx.now, row, { type: "EXPIRE" }, RULE);
      if (!r) continue;
      await expireMeetingCapture(tx, ctx.now, r.captureId);
      const [capture] = await tx.select({ at: t.captures.messageAt }).from(t.captures).where(eq(t.captures.id, r.captureId));
      await notice(tx, ctx.now, [r.recorderId], `Your meeting note from ${clockTime(capture.at)} was not read: nobody confirmed who was there in ${config.reviewExpiryDays} days. Send it again to use it.`, { type: "meeting", id: r.id, projectId: r.projectId, act: "expired" });
      moves.push({ id: r.id, to: r.state });
    }
    const open = await tx.select().from(t.attributedItems).where(inArray(t.attributedItems.state, ["waiting", "proposed"]));
    const captures = new Set<string>();
    for (const row of open) {
      // E77, ownerAtConfirm: whatever the membership's LEAVE or their own answer did not withdraw yet
      const gone = await withdrawIfNotTheirs(tx, ctx.now, row);
      if (gone) {
        moves.push({ id: gone.id, to: gone.state });
        captures.add(gone.captureId);
        continue;
      }
      const r0 = attributedOf(row);
      const pid = r0.personId!;
      const wasAway = await awayOn(tx, pid);
      const away = wasAway(today);
      const event: AttributedEvent = r0.state === "waiting" ? { type: "BACK" } : { type: "EXPIRE" };
      const inDays = r0.askedOn ? workingDaysIn(r0.askedOn, today, wasAway) : 0;
      const r = applyAttributedEvent(r0, event, { actorId: null, today, member: true, away, inDays });
      if (!r.outcome.ok) continue;
      await persistAttributed(tx, r.record, row.version, ctx.now);
      await auditItem(tx, ctx.now, r.record, r.outcome, RULE, event.type === "EXPIRE" ? { inDays } : {});
      await syncItems(tx, ctx.now, r.record, false);
      if (r.record.state === "proposed") await deliver(tx, ctx.now, r.record);
      if (r.record.state === "expired") {
        const who = await nameOf(tx, pid);
        for (const recorderId of [r.record.recorderId, ...r.record.alsoFrom.map((a) => a.recorderId)]) {
          const summary = await attributedSummary(tx, r.record, recorderId);
          await notice(tx, ctx.now, [recorderId], `${who} didn't answer in ${config.attributedExpiryDays} working days, so this was not filed${summary ? `: ${summary}` : ""}.`, { type: "attributed_item", id: r.record.id, projectId: r.record.projectId, act: "expired" });
        }
      }
      moves.push({ id: r.record.id, to: r.record.state });
      captures.add(r.record.captureId);
    }
    for (const captureId of captures) await settleMeeting(tx, ctx.now, captureId);
    return moves;
  });
}
