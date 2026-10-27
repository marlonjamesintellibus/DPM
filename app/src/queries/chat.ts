// The viewer's Today chat after an update (L18e, L18f): their latest capture and what Atlas made
// of it, counted per project. Only the viewer's own captures are read; the counts come from the
// same rule as the review footer, so chat and review never disagree.
import { desc, eq, inArray } from "drizzle-orm";
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
  channel: "whatsapp" | "app" | "atlas";
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

export type ChatSummary = { viewerId: string; latest: ChatCapture | null };

export async function getChatSummary(conn: Conn, viewerId: string): Promise<ChatSummary> {
  const [capture] = await conn
    .select()
    .from(t.captures)
    .where(eq(t.captures.authorId, viewerId))
    .orderBy(desc(t.captures.messageAt), desc(t.captures.receivedAt))
    .limit(1);
  if (!capture) return { viewerId, latest: null };

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
      line: `${capture.state === "saved" ? "Saved" : "Got it"}. ${countsLine(counts, "; ")}`,
    },
  };
}
