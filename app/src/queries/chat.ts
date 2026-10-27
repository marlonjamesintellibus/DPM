// The viewer's Today chat after an update (L18e, L18f): their latest capture and what Atlas made
// of it, counted per project. Only the viewer's own captures are read; the counts come from the
// same rule as the review footer, so chat and review never disagree.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { itemOf } from "../db/records";
import * as t from "../db/schema";
import type { CaptureState } from "../domain/machines/capture";
import { clockTime } from "./project";
import { countItems, countsLine } from "./review";

export type ChatSummaryRow = { projectId: string; name: string; changes: number; needsOk: number };

export type ChatCapture = {
  id: string;
  /** The author's own words: this query only ever returns the viewer's captures. */
  text: string;
  channel: "atlas" | "app";
  kind: "text" | "voice";
  durationSeconds: number | null;
  messageAt: Date;
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
};

/** D15: what Atlas told the viewer about their reports ("Alicia approved your risk: ..."), newest first. */
export type ChatNotice = { id: string; at: Date; time: string; text: string; subject: { type: string; id: string } };

export type ChatSummary = { viewerId: string; latest: ChatCapture | null; notices: ChatNotice[] };

const NOTICES_SHOWN = 10;

async function noticesFor(conn: Conn, viewerId: string): Promise<ChatNotice[]> {
  const rows = await conn.select().from(t.notices).where(eq(t.notices.personId, viewerId)).orderBy(desc(t.notices.at), desc(t.notices.id)).limit(NOTICES_SHOWN);
  return rows.map((n) => ({ id: n.id, at: n.at, time: clockTime(n.at), text: n.text, subject: { type: n.subjectType, id: n.subjectId } }));
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
      return failedStep === "transcribe"
        ? "I couldn't hear that voice note. Can you send it again, or type it?"
        : "Atlas could not read this. Try again or type the update.";
    case "nothing_to_update":
      return "Got it. Nothing in this one changes a project.";
    case "saved":
      return `Saved. ${counts}`;
    default:
      return `Got it. ${counts}`;
  }
}

/** The viewer's own updates, newest first, for the chat's conversation list (L1). */
export async function getConversations(conn: Conn, viewerId: string, limit = 12): Promise<{ id: string; title: string; kind: "text" | "voice"; messageAt: Date; time: string; state: CaptureState }[]> {
  const rows = await conn
    .select({ id: t.captures.id, text: t.captures.text, kind: t.captures.kind, messageAt: t.captures.messageAt, state: t.captures.state })
    .from(t.captures)
    .where(eq(t.captures.authorId, viewerId))
    .orderBy(desc(t.captures.messageAt), desc(t.captures.receivedAt))
    .limit(limit);
  return rows.map((r) => {
    const words = r.text.trim().split(/\s+/);
    const title = r.text.trim() ? words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "") : r.kind === "voice" ? "Voice note" : "Update";
    return { id: r.id, title, kind: r.kind, messageAt: r.messageAt, time: clockTime(r.messageAt), state: r.state };
  });
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

  const items = (await conn.select().from(t.extractions).where(eq(t.extractions.captureId, capture.id)).orderBy(t.extractions.ordinal)).map(itemOf);
  const counts = countItems(items);
  const ids = [...counts.perProject.keys()];
  const names = ids.length ? await conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(inArray(t.projects.id, ids)) : [];
  // Rows in the order the note first mentions each project, as the review groups them
  const order = items.map((i) => i.draft.projectId);
  const rows = ids
    .map((id) => ({ projectId: id, name: names.find((n) => n.id === id)?.name ?? id, ...counts.perProject.get(id)! }))
    .sort((a, b) => order.indexOf(a.projectId) - order.indexOf(b.projectId));

  return {
    viewerId,
    notices,
    latest: {
      id: capture.id,
      text: capture.text,
      channel: capture.channel,
      kind: capture.kind,
      durationSeconds: capture.durationSeconds,
      messageAt: capture.messageAt,
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
    },
  };
}
