// The viewer's Today chat after an update (L18e, L18f): their latest capture and what Atlas made
// of it, counted per project. Only the viewer's own captures are read; the counts come from the
// same rule as the review footer, so chat and review never disagree.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { itemOf } from "../db/records";
import * as t from "../db/schema";
import type { Answer } from "../domain/question";
import type { CaptureState } from "../domain/machines/capture";
import { weekday } from "../domain/dates";
import { clockTime, daysAgo, NOT_YOURS, shortDate, todayIn, type NotYours } from "./project";
import { countItems, countsLine } from "./review";

export type ChatSummaryRow = {
  projectId: string;
  name: string;
  changes: number;
  needsOk: number;
};

export type ChatCapture = {
  id: string;
  /** The author's own words: this query only ever returns the viewer's captures. */
  text: string;
  channel: "atlas" | "app";
  kind: "text" | "voice";
  durationSeconds: number | null;
  messageAt: Date;
  /** When DPM got it: "Still working on it…" after a few seconds of thinking (section 17). */
  receivedAt: Date;
  /** "8:58am" */
  time: string;
  state: CaptureState;
  rows: ChatSummaryRow[];
  /** Items for "You" (leave) and items that fit no project, both private to the author. */
  personal: number;
  notFiled: number;
  changes: number;
  projects: number;
  needsOk: number;
  needsProject: number;
  /** "Got it. 9 updates for 2 projects; 4 need your OK." */
  line: string;
  /** Section 15: DPM's answer, when the message asked something, as given then. */
  answer: Answer | null;
  /** Phase S: their thumbs up or down on that answer, and what was wrong. */
  feedback: { rating: "up" | "down"; wrong: string | null } | null;
};

/** D15: what Atlas told the viewer about their reports ("Alicia approved your risk: ..."), newest first. */
export type ChatNotice = {
  id: string;
  at: Date;
  time: string;
  text: string;
  subject: { type: string; id: string };
};

export type ChatSummary = {
  viewerId: string;
  latest: ChatCapture | null;
  notices: ChatNotice[];
};

const NOTICES_SHOWN = 10;

async function noticesFor(conn: Conn, viewerId: string): Promise<ChatNotice[]> {
  const rows = await conn.select().from(t.notices).where(eq(t.notices.personId, viewerId)).orderBy(desc(t.notices.at), desc(t.notices.id)).limit(NOTICES_SHOWN);
  return rows.map((n) => ({
    id: n.id,
    at: n.at,
    time: clockTime(n.at),
    text: n.text,
    subject: { type: n.subjectType, id: n.subjectId },
  }));
}

// What Atlas says in the chat while it reads, and when a read ends with nothing to review (E4, E18, D1)
function chatLine(state: CaptureState, failedStep: "transcribe" | "read" | null, counts: string): string {
  switch (state) {
    case "received":
    case "transcribing":
    case "transcribe_wait":
    case "reading":
    case "retry_wait":
      return "Reading your update…";
    case "failed":
      return failedStep === "transcribe" ? "I couldn't hear that voice note. Can you send it again, or type it?" : "Atlas could not read this. Try again or type the update.";
    case "nothing_to_update":
      return "Got it. Nothing in this one changes a project.";
    case "answered":
      return ""; // the answer is the reply
    case "saved":
      return `Saved. ${counts}`;
    default:
      return `Got it. ${counts}`;
  }
}

/** Section 16: a conversation as the list shows it. */
export type ConversationRow = {
  id: string;
  title: string;
  channel: "app" | "atlas";
  state: "active" | "archived";
  lastMessageAt: Date;
  /** "9:27am" today, "yesterday", "Mon 19 Oct" before that */
  when: string;
  version: number;
};

function whenLabel(at: Date, now: Date): string {
  const ago = daysAgo(at, now);
  if (ago === "today") return clockTime(at);
  if (ago === "yesterday") return "Yesterday";
  return `${weekday(todayIn(at)).slice(0, 3)} ${shortDate(todayIn(at))}`;
}

function rowOf(c: typeof t.conversations.$inferSelect, now: Date): ConversationRow {
  return {
    id: c.id,
    title: c.title,
    channel: c.channel,
    state: c.state === "archived" ? "archived" : "active",
    lastMessageAt: c.lastMessageAt,
    when: whenLabel(c.lastMessageAt, now),
    version: c.version,
  };
}

/** The viewer's conversations, newest first; archived ones apart. Only ever their own (section 16). */
export async function getConversationList(conn: Conn, viewerId: string, now: Date): Promise<{ active: ConversationRow[]; archived: ConversationRow[] }> {
  const rows = await conn.select().from(t.conversations).where(eq(t.conversations.ownerId, viewerId)).orderBy(desc(t.conversations.lastMessageAt), desc(t.conversations.id));
  const all = rows.map((c) => rowOf(c, now));
  return {
    active: all.filter((c) => c.state === "active"),
    archived: all.filter((c) => c.state === "archived"),
  };
}

export type ThreadNotice = ChatNotice;
export type Thread = {
  found: true;
  conversation: ConversationRow;
  turns: ChatCapture[];
  notices: ThreadNotice[];
};

/**
 * One conversation with every message in it and Atlas's reply to each, oldest first, and the notices
 * that belong to it (CV14): one about something reported in this conversation, or, with no such link,
 * those shown in the viewer's newest conversation. Someone else's conversation is not found (CV2).
 */
export async function getThread(conn: Conn, viewerId: string, conversationId: string, now: Date): Promise<Thread | NotYours> {
  const [c] = await conn.select().from(t.conversations).where(eq(t.conversations.id, conversationId));
  if (!c || c.ownerId !== viewerId) return NOT_YOURS;
  const captures = await conn
    .select()
    .from(t.captures)
    .where(and(eq(t.captures.conversationId, conversationId), eq(t.captures.authorId, viewerId)))
    .orderBy(t.captures.messageAt, t.captures.receivedAt);
  const turns: ChatCapture[] = [];
  for (const capture of captures) turns.push(await chatCaptureOf(conn, capture));
  const [newest] = await conn
    .select({ id: t.conversations.id })
    .from(t.conversations)
    .where(and(eq(t.conversations.ownerId, viewerId), eq(t.conversations.state, "active")))
    .orderBy(desc(t.conversations.lastMessageAt), desc(t.conversations.id))
    .limit(1);
  const notices: ThreadNotice[] = [];
  for (const n of await noticesFor(conn, viewerId)) {
    const home = await noticeHome(conn, viewerId, n);
    if (home === conversationId || (home === null && newest?.id === conversationId)) notices.push(n);
  }
  return { found: true, conversation: rowOf(c, now), turns, notices };
}

/** The conversation a notice belongs to: where the viewer reported the entry it is about, if anywhere. */
async function noticeHome(conn: Conn, viewerId: string, n: ChatNotice): Promise<string | null> {
  if (n.subject.type !== "braid_entry") return null;
  const sources = await conn
    .select({
      conversationId: t.captures.conversationId,
      at: t.captures.messageAt,
    })
    .from(t.braidSources)
    .innerJoin(t.captures, eq(t.captures.id, t.braidSources.captureId))
    .where(and(eq(t.braidSources.originEntryId, n.subject.id), eq(t.braidSources.personId, viewerId)))
    .orderBy(desc(t.captures.messageAt));
  return sources[0]?.conversationId ?? null;
}

/** The viewer's latest update, or the one they picked; only ever their own (M1). */
export async function getChatSummary(conn: Conn, viewerId: string, captureId?: string): Promise<ChatSummary> {
  const [capture] = await conn
    .select()
    .from(t.captures)
    .where(captureId ? and(eq(t.captures.authorId, viewerId), eq(t.captures.id, captureId)) : eq(t.captures.authorId, viewerId))
    .orderBy(desc(t.captures.messageAt), desc(t.captures.receivedAt))
    .limit(1);
  const notices = await noticesFor(conn, viewerId);
  if (!capture) return { viewerId, latest: null, notices };
  return { viewerId, notices, latest: await chatCaptureOf(conn, capture) };
}

/** An answer kept before section 17 had lines, not cards; it reads as cards, in DPM's own words. */
function answerOf(stored: unknown): Answer | null {
  if (!stored || typeof stored !== "object") return null;
  const a = stored as Partial<Answer> & { lines?: { label: string; href: string }[] };
  if (Array.isArray(a.cards)) return a as Answer;
  return {
    topic: "other",
    text: a.text ?? "",
    wording: "rules",
    cards: (a.lines ?? []).map((l) => ({ title: l.label, detail: null, tag: null, href: l.href })),
    more: null,
    asOf: a.asOf ?? new Date(0).toISOString(),
  };
}

/** Phase S: the viewer's own "Help improve Atlas", off until they turn it on. */
export async function helpImproveAtlas(conn: Conn, viewerId: string): Promise<boolean> {
  const [p] = await conn.select({ on: t.people.helpImproveAtlas }).from(t.people).where(eq(t.people.id, viewerId));
  return p?.on ?? false;
}

/** Phase S: the author's own feedback on the answer; only ever theirs. */
async function feedbackOf(conn: Conn, captureId: string, authorId: string): Promise<ChatCapture["feedback"]> {
  const [f] = await conn
    .select({ rating: t.answerFeedback.rating, wrong: t.answerFeedback.wrong })
    .from(t.answerFeedback)
    .where(and(eq(t.answerFeedback.captureId, captureId), eq(t.answerFeedback.personId, authorId)));
  return f ?? null;
}

/** One message and what Atlas made of it, counted per project as the review counts them. */
async function chatCaptureOf(conn: Conn, capture: typeof t.captures.$inferSelect): Promise<ChatCapture> {
  const items = (await conn.select().from(t.extractions).where(eq(t.extractions.captureId, capture.id)).orderBy(t.extractions.ordinal)).map(itemOf);
  const counts = countItems(items);
  const ids = [...counts.perProject.keys()];
  const names = ids.length ? await conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(inArray(t.projects.id, ids)) : [];
  // Rows in the order the note first mentions each project, as the review groups them
  const order = items.map((i) => i.draft.projectId);
  const rows = ids
    .map((id) => ({
      projectId: id,
      name: names.find((n) => n.id === id)?.name ?? id,
      ...counts.perProject.get(id)!,
    }))
    .sort((a, b) => order.indexOf(a.projectId) - order.indexOf(b.projectId));

  return {
    id: capture.id,
    text: capture.text,
    channel: capture.channel,
    kind: capture.kind,
    durationSeconds: capture.durationSeconds,
    messageAt: capture.messageAt,
    receivedAt: capture.receivedAt,
    time: clockTime(capture.messageAt),
    state: capture.state,
    rows,
    personal: counts.personal,
    notFiled: counts.notFiled,
    changes: counts.changes,
    projects: counts.projects,
    needsOk: counts.needsOk,
    needsProject: counts.needsProject,
    line: chatLine(capture.state, capture.failedStep, countsLine(counts, "; ")),
    answer: answerOf(capture.answer),
    feedback: capture.answer ? await feedbackOf(conn, capture.id, capture.authorId) : null,
  };
}
