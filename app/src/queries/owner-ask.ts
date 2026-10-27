// M37 as the person asked reads it (section 20, U5 and U7): who asked, what would change, and only the
// words that fed it (rule 9, visible quotes), never the rest of the author's message.
import { eq } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { ownerAskOf } from "../db/records";
import * as t from "../db/schema";
import type { OwnerAskRecord } from "../domain/machines/owner-ask";
import type { WorkItemState } from "../domain/status/rules";
import { firstName, shortDate, WORK_STATE_LABEL } from "./project";

const STEP_LABEL: Record<string, string> = { not_done: "Not done", in_progress: "In progress", handed_over: "Handed over" };

export type OwnerAskView = {
  record: OwnerAskRecord;
  author: string;
  project: { id: string; name: string };
  /** "#160 Feature store backfill", "Milestone Buyer pilot · Release 1", "New work" */
  what: string;
  /** "In progress to Done", "Forecast 30 Oct to 3 Nov", "Harvest docs cleanup, In progress" */
  change: string;
  /** The author's words that fed it, and only those. */
  quote: string | null;
  at: Date;
};

export async function describeOwnerAsk(conn: Conn, askId: string): Promise<OwnerAskView | null> {
  const [row] = await conn.select().from(t.ownerAsks).where(eq(t.ownerAsks.id, askId));
  if (!row) return null;
  const r = ownerAskOf(row);
  const [[author], [project], [capture], [item]] = await Promise.all([
    conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, r.authorId)),
    conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(eq(t.projects.id, r.projectId)),
    conn.select({ text: t.captures.text, messageAt: t.captures.messageAt }).from(t.captures).where(eq(t.captures.id, r.captureId)),
    conn.select({ draft: t.extractions.draft }).from(t.extractions).where(eq(t.extractions.id, r.extractionId)),
  ]);
  const quote = capture && item ? item.draft.spans.map((s) => capture.text.slice(s.start, s.end)).join(" … ") : null;
  let what = "New work";
  let change = `${r.title ?? ""}, ${WORK_STATE_LABEL[r.value as WorkItemState] ?? r.value}`;
  const target = r.target;
  if (target?.type === "work_item") {
    const [w] = await conn.select({ number: t.workItems.number, title: t.workItems.title }).from(t.workItems).where(eq(t.workItems.id, target.id));
    what = w ? `${w.number ?? ""} ${w.title}`.trim() : target.id;
    const label = (s: string | null) => (s ? (WORK_STATE_LABEL[s as WorkItemState] ?? s) : "None");
    change = target.field === "blocked_note" ? `Note: ${r.value}` : `${label(r.saw)} to ${label(r.value)}`;
  } else if (target?.type === "milestone") {
    const [m] = await conn.select({ name: t.milestones.name }).from(t.milestones).where(eq(t.milestones.id, target.id));
    what = `Milestone ${m?.name ?? target.id}`;
    const date = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? shortDate(s) : (s ?? "none"));
    change = `Forecast ${date(r.saw)} to ${date(r.value)}`;
  } else if (target?.type === "handover") {
    const [h] = await conn.select({ title: t.handoverSteps.title }).from(t.handoverSteps).where(eq(t.handoverSteps.id, target.id));
    what = `Handover ${h?.title ?? target.id}`;
    change = `${STEP_LABEL[r.saw ?? ""] ?? "Not done"} to ${STEP_LABEL[r.value] ?? r.value}`;
  }
  return { record: r, author: firstName(author?.name ?? r.authorId), project: project ?? { id: r.projectId, name: r.projectId }, what, change, quote, at: capture?.messageAt ?? row.createdAt };
}
