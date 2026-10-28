// The viewer's Today chat after an update (L18e, L18f): their latest capture and what Atlas made
// of it, counted per project. Only the viewer's own captures are read; the counts come from the
// same rule as the review footer, so chat and review never disagree.
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { itemOf } from "../db/records";
import * as t from "../db/schema";
import type { Answer } from "../domain/question";
import type { CaptureState } from "../domain/machines/capture";
import { commandButton, commandOutcomeText, commandQuestion, type ChatCommandState, type CommandAct } from "../domain/machines/chat-command";
import { clarifyOutcomeText, clarifyQuestion, type ClarificationState, type ClarifyAbout } from "../domain/machines/clarification";
import { weekday } from "../domain/dates";
import { clockTime, daysAgo, NOT_YOURS, shortDate, todayIn, type NotYours } from "./project";
import { optionsShown } from "./clarification";
import { countItems, countsLine, readSetAside, withSetAside } from "./review";
import { undoReply } from "./answers/undo";
import { composedRead, standupViewOf, type StandupView } from "./standup";
import { undoViewOf, type UndoView } from "./undo";

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
  /** Phase B: the cards a reply in words made (M20), and what Atlas said when it made none (AC6, AC7, AC9). */
  commands: ChatCommandView[];
  commandNote: string | null;
  /** Phase B: the buttons already pressed on this answer's lines, with what happened (AC4: once only). */
  taps: TapView[];
  /** Phase L, M30: on a saved update, whether Undo may still work, or when it was undone. */
  undo: UndoView | null;
  /** Phase D, M21: the question Atlas asked about this message, as it stands. */
  clarification: ClarifyView | null;
  /** Phase D, CL2: this message answered a question by its words; what came of it. */
  answered: string | null;
  /** Phase J, M28: the standup questions asked after this message, the one waiting, and how it ended. */
  standup: StandupView | null;
  /** Phase J: this message is a standup's answers, put together by DPM; the chat shows it as Atlas's, not as theirs. */
  fromStandup: boolean;
};

/**
 * A question in the chat: the buttons while it is asked, each one the viewer may still read (P10), and what
 * happened once it is not.
 */
export type ClarifyView = {
  id: string;
  /** CD50: a question's is asked before its answer, which comes once one is chosen. */
  about: ClarifyAbout;
  state: ClarificationState;
  question: string;
  options: { id: string; label: string }[];
  outcome: string | null;
};

/** A command's card in the chat: its question and button while it waits, what happened once it ended. */
export type ChatCommandView = {
  id: string;
  state: ChatCommandState;
  act: CommandAct;
  question: string;
  button: string;
  /** A decline says why, and a status reason has words: the box, filled with what they said. */
  asksWords: boolean;
  words: string | null;
  /** Give a reason: the entries it links, by title (M9). */
  links: string[];
  /** Done, refused, cancelled or expired, in words. */
  outcome: string | null;
  /** AC2, AC3: refused because it changed; the question to ask again for a fresh answer. */
  askAgain: string | null;
};

export type TapView = { line: number; act: CommandAct; state: ChatCommandState; message: string; askAgain: string | null };

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
  const feedback = await feedbackFor(conn, viewerId, captures);
  for (const capture of captures) turns.push(await chatCaptureOf(conn, capture, feedback.get(capture.id) ?? null, now));
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
export async function getChatSummary(conn: Conn, viewerId: string, captureId?: string, now: Date = new Date()): Promise<ChatSummary> {
  const [capture] = await conn
    .select()
    .from(t.captures)
    .where(captureId ? and(eq(t.captures.authorId, viewerId), eq(t.captures.id, captureId)) : eq(t.captures.authorId, viewerId))
    .orderBy(desc(t.captures.messageAt), desc(t.captures.receivedAt))
    .limit(1);
  const notices = await noticesFor(conn, viewerId);
  if (!capture) return { viewerId, latest: null, notices };
  const feedback = await feedbackFor(conn, viewerId, [capture]);
  return { viewerId, notices, latest: await chatCaptureOf(conn, capture, feedback.get(capture.id) ?? null, now) };
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

/** Phase S: the viewer's own feedback on the answers among their messages, in one read; only ever theirs. */
async function feedbackFor(conn: Conn, viewerId: string, captures: (typeof t.captures.$inferSelect)[]): Promise<Map<string, NonNullable<ChatCapture["feedback"]>>> {
  const ids = captures.filter((c) => c.answer).map((c) => c.id);
  const rows = ids.length
    ? await conn
        .select({ captureId: t.answerFeedback.captureId, rating: t.answerFeedback.rating, wrong: t.answerFeedback.wrong })
        .from(t.answerFeedback)
        .where(and(eq(t.answerFeedback.personId, viewerId), inArray(t.answerFeedback.captureId, ids)))
    : [];
  return new Map(rows.map((f) => [f.captureId, { rating: f.rating, wrong: f.wrong }]));
}

// Section 20, U1: what was set aside counts while the update can still be reviewed, and once saved
const SHOWS_SET_ASIDE: readonly CaptureState[] = ["proposed", "reviewing", "saved"];

async function summaryOf(conn: Conn, capture: typeof t.captures.$inferSelect, items: Parameters<typeof readSetAside>[2], counts: string): Promise<string> {
  return SHOWS_SET_ASIDE.includes(capture.state) ? withSetAside(counts, await readSetAside(conn, capture, items)) : counts;
}

/** Phase L: a refused undo says why under the saved message, as "Undo that" would (UN1, UN2), so it outlives the click. */
async function undoOf(conn: Conn, capture: typeof t.captures.$inferSelect, now: Date): Promise<UndoView> {
  const view = await undoViewOf(conn, capture.authorId, capture.id, now);
  if (view.state !== "refused") return view;
  return { ...view, note: (await undoReply(conn, capture.authorId, view.jobId, now)).text };
}

/** One message and what Atlas made of it, counted per project as the review counts them, with the author's feedback on its answer. */
async function chatCaptureOf(conn: Conn, capture: typeof t.captures.$inferSelect, feedback: ChatCapture["feedback"], now: Date): Promise<ChatCapture> {
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
  const commands = await commandsOf(conn, capture);
  // Phase J: a standup's answers, as its author may read them now (P10)
  const standupText = (await composedRead(conn, capture.id))?.shown.text ?? null;

  return {
    id: capture.id,
    text: standupText ?? capture.text,
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
    line: chatLine(capture.state, capture.failedStep, await summaryOf(conn, capture, items, countsLine(counts, "; "))),
    answer: answerOf(capture.answer),
    feedback,
    ...commands,
    undo: capture.state === "saved" ? await undoOf(conn, capture, now) : null,
    ...(await clarificationsOf(conn, capture, commands.commands.length > 0)),
    standup: await standupViewOf(conn, capture),
    fromStandup: standupText !== null,
  };
}

/**
 * Phase D: the question asked about this message, and what came of one this message answered by its words
 * (CL2); only the author's own. An option, or a chosen one, on a project they can no longer read is not named.
 * A reply that answered by making its own card (CL1) shows that card, so it does not say "Got it" too; nor
 * does a reply that chose for a question, whose answer it shows (CD50).
 */
async function clarificationsOf(conn: Conn, capture: typeof t.captures.$inferSelect, ownCards: boolean): Promise<Pick<ChatCapture, "clarification" | "answered">> {
  const rows = await conn
    .select()
    .from(t.clarifications)
    .where(and(eq(t.clarifications.authorId, capture.authorId), or(eq(t.clarifications.captureId, capture.id), eq(t.clarifications.answeredBy, capture.id))));
  if (!rows.length) return { clarification: null, answered: null };
  const view = async (r: (typeof rows)[number]) => {
    const options = await optionsShown(conn, capture.authorId, { ...r, question: r.question ?? null });
    const chosen = options.find((o) => o.id === r.chosen)?.label ?? null;
    return { options, outcome: clarifyOutcomeText(r, chosen) };
  };
  const asked = rows.find((r) => r.captureId === capture.id);
  const answering = rows.find((r) => r.answeredBy === capture.id);
  const shown = asked ? await view(asked) : null;
  return {
    clarification:
      asked && shown
        ? { id: asked.id, about: asked.about, state: asked.state, question: clarifyQuestion({ ...asked, options: shown.options }), options: shown.options.map((o) => ({ id: o.id, label: o.label })), outcome: shown.outcome }
        : null,
    answered: answering && !ownCards && !(answering.about === "question" && capture.answer) ? (await view(answering)).outcome : null,
  };
}

/** Phase B: the commands made from this message, and the buttons pressed on its answer; only the author's own. */
async function commandsOf(conn: Conn, capture: typeof t.captures.$inferSelect): Promise<Pick<ChatCapture, "commands" | "commandNote" | "taps">> {
  const rows = await conn
    .select()
    .from(t.chatCommands)
    .where(and(eq(t.chatCommands.askerId, capture.authorId), or(eq(t.chatCommands.captureId, capture.id), eq(t.chatCommands.answerCaptureId, capture.id))))
    .orderBy(t.chatCommands.line, t.chatCommands.createdAt);
  // What was asked, to ask again when the picture changed (AC2)
  const askedIn = async (answerCaptureId: string) => {
    const [a] = await conn.select({ question: t.captures.question, text: t.captures.text }).from(t.captures).where(eq(t.captures.id, answerCaptureId));
    return a ? (a.question?.asked ?? a.text) : null;
  };
  const commands: ChatCommandView[] = [];
  const taps: TapView[] = [];
  for (const r of rows) {
    const askAgain = r.refusedWhy === "changed" ? await askedIn(r.answerCaptureId) : null;
    if (r.via === "tap" && r.answerCaptureId === capture.id) {
      taps.push({ line: r.line, act: r.act, state: r.state, message: commandOutcomeText(r) ?? "", askAgain });
      continue;
    }
    if (r.via !== "words" || r.captureId !== capture.id) continue;
    const ids = r.act === "give_reason" ? (r.input?.entryIds ?? []) : [];
    const titles = ids.length ? await conn.select({ id: t.braidEntries.id, title: t.braidEntries.title }).from(t.braidEntries).where(inArray(t.braidEntries.id, [...ids])) : [];
    commands.push({
      id: r.id,
      state: r.state,
      act: r.act,
      question: commandQuestion(r),
      button: commandButton(r),
      asksWords: r.act === "give_reason" || (r.act === "decline" && r.proposal === "entry"),
      words: r.input?.reason ?? null,
      links: ids.map((id) => titles.find((x) => x.id === id)?.title ?? id),
      outcome: commandOutcomeText(r),
      askAgain,
    });
  }
  return { commands, commandNote: capture.commandNote, taps };
}
