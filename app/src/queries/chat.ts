// The viewer's Today chat after an update (L18e, L18f): their latest capture and what Atlas made
// of it, counted per project. Only the viewer's own captures are read; the counts come from the
// same rule as the review footer, so chat and review never disagree.
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { itemOf } from "../db/records";
import * as t from "../db/schema";
import type { Answer } from "../domain/question";
import type { CaptureState } from "../domain/machines/capture";
import { commandButton, commandOutcomeText, commandQuestion, type ChatCommandState, type CommandAct } from "../domain/machines/chat-command";
import { clarifyOutcomeText, clarifyQuestion, type ClarificationState, type ClarifyAbout } from "../domain/machines/clarification";
import { asksDrop, LIVE_COMMITMENT } from "../domain/machines/commitment";
import { weekday } from "../domain/dates";
import { clockTime, daysAgo, NOT_YOURS, projectReader, shortDate, todayIn, type NotYours } from "./project";
import { optionsShown } from "./clarification";
import { countItems, countsLine, readSetAside, withSetAside } from "./review";
import { undoReply } from "./answers/undo";
import { draftViewOf, type DraftView } from "./drafts";
import { meetingViewOf, type MeetingView } from "./meeting";
import { composedRead, standupViewOf, type StandupView } from "./standup";
import { awayViewOf, describeCoverAsk, type AwayView } from "./cover";
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
  /** Phase P: the message said leave; what is due while away, who was asked or covers each thing, and who could be. */
  away: AwayView | null;
  /** Phase G, M25: the draft this message asked for, as it stands. */
  draft: DraftView | null;
  /** Phase O, M33: this message is a meeting note; who was there, and how each part about someone stands. */
  meeting: MeetingView | null;
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
  /**
   * Phase E, M22: on the newest notice about the viewer's own promise, while it waits on them: a check-in that is
   * out (Done, New date, Drop) or CM11's question ("It still stands", Drop). dropFirst: CD24, after 3 moves.
   */
  promise?: { id: string; mode: "check" | "stands"; dropFirst: boolean; today: string };
  /** Phase E: under a check-in or CM11's question once answered, what came of it ("Marked done."). */
  promiseOutcome?: string;
  /** Phase P, M35: on the newest notice asking the viewer to cover, while it still waits on them: its items, to answer here. */
  cover?: { id: string; items: { key: string; label: string }[] };
};

export type ChatSummary = {
  viewerId: string;
  latest: ChatCapture | null;
  notices: ChatNotice[];
};

const NOTICES_SHOWN = 10;

async function noticesFor(conn: Conn, viewerId: string, now: Date = new Date()): Promise<ChatNotice[]> {
  const all = await conn.select().from(t.notices).where(eq(t.notices.personId, viewerId)).orderBy(desc(t.notices.at), desc(t.notices.id)).limit(NOTICES_SHOWN);
  // CD64 (W4-D14), P10: a notice about a project names its records; once the viewer cannot read that project
  // (they left it), it is no longer shown, whatever it was about (a meeting's Ask, a cover, a promise's link)
  const reader = all.some((n) => n.projectId) ? await projectReader(conn, viewerId) : null;
  const rows = all.filter((n) => !n.projectId || reader!.mayRead(n.projectId));
  const out: ChatNotice[] = rows.map((n) => ({
    id: n.id,
    at: n.at,
    time: clockTime(n.at),
    text: n.text,
    subject: { type: n.subjectType, id: n.subjectId },
  }));
  // Phase E: the buttons go on the newest notice about each promise of theirs that waits on them now
  const promiseIds = [...new Set(out.filter((n) => n.subject.type === "commitment").map((n) => n.subject.id))];
  const promises = promiseIds.length ? await conn.select().from(t.commitments).where(and(inArray(t.commitments.id, promiseIds), eq(t.commitments.ownerId, viewerId))) : [];
  for (const row of promises) {
    const mode = row.state === "checking" && row.checkInOut ? "check" : LIVE_COMMITMENT.includes(row.state) && row.stands === "asked" ? "stands" : null;
    const newest = out.find((n) => n.subject.type === "commitment" && n.subject.id === row.id);
    if (!newest) continue;
    if (mode) newest.promise = { id: row.id, mode, dropFirst: mode === "check" && asksDrop(row), today: todayIn(now) };
    // A question that was answered says what came of it, as Atlas's other questions do (notice ids carry their act).
    // M22 NO_REPLY: a check-in whose day ended unanswered is still checking, waiting for the next one, and says
    // nothing; only a new date takes a promise from checking back to open or due
    else {
      const due = `${weekday(row.dueOn).slice(0, 3)} ${shortDate(row.dueOn)}`;
      const ended = row.state === "done" ? "Marked done." : row.state === "dropped" ? "Dropped." : null;
      if (newest.id.startsWith(`ntc-${row.id}-check_in`)) newest.promiseOutcome = ended ?? (row.state === "open" || row.state === "due" ? `Now due ${due}.` : undefined);
      else if (newest.id.startsWith(`ntc-${row.id}-stands`)) newest.promiseOutcome = ended ?? (LIVE_COMMITMENT.includes(row.state) && row.stands === "kept" ? `Kept. Due ${due}.` : undefined);
    }
  }
  // Phase P, M35: the answer buttons go on the newest ask to cover that still waits on the viewer, as in their inbox
  for (const id of [...new Set(out.filter((n) => n.subject.type === "cover_request").map((n) => n.subject.id))]) {
    const ask = await describeCoverAsk(conn, viewerId, id, now);
    const newest = out.find((n) => n.subject.type === "cover_request" && n.subject.id === id && n.id.startsWith(`ntc-${id}-ask-`));
    if (ask?.state === "asked" && newest && (await conn.select({ toId: t.coverRequests.toId }).from(t.coverRequests).where(eq(t.coverRequests.id, id)))[0]?.toId === viewerId) {
      newest.cover = { id, items: ask.items.map((i) => ({ key: i.key, label: i.label })) };
    }
  }
  return out;
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
  for (const n of await noticesFor(conn, viewerId, now)) {
    const home = await noticeHome(conn, viewerId, n);
    if (home === conversationId || (home === null && newest?.id === conversationId)) notices.push(n);
  }
  return { found: true, conversation: rowOf(c, now), turns, notices };
}

/**
 * The conversation a notice belongs to: where the viewer reported the entry it is about, if anywhere. Phase E: a
 * notice about their promise belongs where they made it.
 */
async function noticeHome(conn: Conn, viewerId: string, n: ChatNotice): Promise<string | null> {
  // Phase P: what the person going on leave is told about their asks belongs where they last said that leave
  if (n.subject.type === "cover_request") {
    const [request] = await conn.select({ leaveId: t.coverRequests.leaveId }).from(t.coverRequests).where(and(eq(t.coverRequests.id, n.subject.id), eq(t.coverRequests.askerId, viewerId)));
    if (!request) return null;
    const [said] = await conn
      .select({ conversationId: t.captures.conversationId })
      .from(t.extractions)
      .innerJoin(t.captures, eq(t.captures.id, t.extractions.captureId))
      .where(and(eq(t.captures.authorId, viewerId), or(sql`${t.extractions.draft}->'leave'->>'leaveId' = ${request.leaveId}`, sql`'lv-' || ${t.extractions.id} = ${request.leaveId}`)))
      .orderBy(desc(t.captures.messageAt))
      .limit(1);
    return said?.conversationId ?? null;
  }
  if (n.subject.type === "commitment") {
    const [row] = await conn
      .select({ conversationId: t.captures.conversationId })
      .from(t.commitments)
      .innerJoin(t.captures, eq(t.captures.id, t.commitments.captureId))
      .where(and(eq(t.commitments.id, n.subject.id), eq(t.commitments.ownerId, viewerId)));
    return row?.conversationId ?? null;
  }
  // Phase O: what came of a meeting note's part belongs with the note, for its recorder; the person it was about
  // has no message of theirs there, so theirs shows in their newest conversation
  if (n.subject.type === "attributed_item" || n.subject.type === "meeting") {
    const table = n.subject.type === "meeting" ? t.meetings : t.attributedItems;
    const [row] = await conn
      .select({ conversationId: t.captures.conversationId })
      .from(table)
      .innerJoin(t.captures, eq(t.captures.id, table.captureId))
      .where(and(eq(table.id, n.subject.id), eq(t.captures.authorId, viewerId)));
    return row?.conversationId ?? null;
  }
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
  const notices = await noticesFor(conn, viewerId, now);
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
    away: await awayViewOf(conn, capture, items, now),
    draft: await draftViewOf(conn, capture),
    meeting: await meetingViewOf(conn, capture),
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
