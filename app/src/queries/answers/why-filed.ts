// Phase L (conversational plan, section 14): "Why did you file that?" For the asker's own update only (M1:
// the capture is theirs): where each item went, the routing reason and the deciding words (`routingReason`
// and the quote), and for a BRAID item the entry it matched. A record the asker names that no item of theirs
// touches gets "I can only tell you about your own updates." (UN7), whoever's it is, so it hints at nothing.
// An item in a project they can no longer open is left out, with its match (P10).
import { desc, eq, inArray } from "drizzle-orm";
import { itemOf } from "../../db/records";
import * as t from "../../db/schema";
import type { ExtractedItem } from "../../domain/machines/extracted-item";
import type { AnswerCard } from "../../domain/question";
import { clockTime, KIND_LABEL, projectReader } from "../project";
import { loadTargetRecords, targetChange, targetTitle } from "../review";
import { capped, type AnswerBuilder } from "./shared";

export const NOT_YOURS_TO_EXPLAIN = "I can only tell you about your own updates.";
const GONE: readonly string[] = ["rejected", "withdrawn"];

export const whyFiled: AnswerBuilder = async (conn, viewerId, { asked }) => {
  const reader = await projectReader(conn, viewerId);
  const captures = await conn.select().from(t.captures).where(eq(t.captures.authorId, viewerId)).orderBy(desc(t.captures.messageAt), desc(t.captures.receivedAt));
  const withItems: { capture: (typeof captures)[number]; items: ExtractedItem[] }[] = [];
  for (const capture of captures) {
    const items = (await conn.select().from(t.extractions).where(eq(t.extractions.captureId, capture.id)).orderBy(t.extractions.ordinal)).map(itemOf).filter((i) => !GONE.includes(i.state));
    if (items.length) withItems.push({ capture, items });
  }
  // "Why did #151 go to Forager?": the asker's own latest item about that number, or nobody's they may hear about
  const number = /#\d+/.exec(asked)?.[0] ?? null;
  let chosen = withItems[0];
  if (number) {
    const ids = (await conn.select({ id: t.workItems.id }).from(t.workItems).where(eq(t.workItems.number, number))).map((w) => w.id);
    chosen = withItems
      .map(({ capture, items }) => ({ capture, items: items.filter((i) => i.draft.target && ids.includes(i.draft.target.id)) }))
      .find((x) => x.items.length)!;
    if (!chosen) return { text: NOT_YOURS_TO_EXPLAIN, cards: [], more: null };
  }
  if (!chosen) return { text: NOT_YOURS_TO_EXPLAIN, cards: [], more: null };

  const { capture } = chosen;
  const items = chosen.items.filter((i) => i.draft.projectId === null || reader.mayRead(i.draft.projectId));
  if (!items.length) return { text: NOT_YOURS_TO_EXPLAIN, cards: [], more: null };
  const [author] = await conn.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, viewerId));
  const records = await loadTargetRecords(conn, items.map((i) => i.draft));
  const projectIds = [...new Set(items.flatMap((i) => (i.draft.projectId ? [i.draft.projectId] : [])))];
  const projects = projectIds.length ? await conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(inArray(t.projects.id, projectIds)) : [];
  const entryIds = [...new Set(items.flatMap((i) => (i.draft.braid?.matchEntryId ? [i.draft.braid.matchEntryId] : [])))];
  const entries = new Map<string, { title: string; projectId: string }>();
  for (const id of entryIds) {
    const [e] = await conn.select({ title: t.braidEntries.title, projectId: t.braidEntries.projectId }).from(t.braidEntries).where(eq(t.braidEntries.id, id));
    if (e && reader.mayRead(e.projectId)) entries.set(id, e);
  }

  const cards: AnswerCard[] = items.map((i) => {
    const d = i.draft;
    const where = d.scope === "personal" ? "You" : d.projectId ? (projects.find((p) => p.id === d.projectId)?.name ?? "Your project") : "Only you";
    const quote = d.spans.map((s) => `"${capture.text.slice(s.start, s.end)}"`).join(", ");
    const why =
      d.scope === "personal"
        ? "Kept for you: leave is personal, never on a project"
        : d.routing === "routed"
          ? `Filed in ${where} because: ${d.routingReason}`
          : d.routing === "choose_project"
            ? "Waiting for you to pick a project"
            : "Not filed: only you see it";
    const matched = d.braid?.matchEntryId ? entries.get(d.braid.matchEntryId) : undefined;
    const match = !d.braid
      ? ""
      : d.braid.match === "same_as" && matched
        ? ` It's the same as "${matched.title}" on the log.`
        : d.braid.match === "related_to" && matched
          ? ` It's linked to "${matched.title}".`
          : d.kind === "braid_new"
            ? " It's a new entry."
            : "";
    const title = d.target ? `${targetTitle(d.target, records, author?.name ?? "")}: ${targetChange(i, records)}` : `${KIND_LABEL[d.braid!.kind]}: ${d.braid!.title}`;
    return { title, detail: `${why}. You said ${quote}.${match}`, tag: where, href: `/review/${capture.id}` };
  });
  return { text: `Here's where each part of your ${clockTime(capture.messageAt)} update went, and why.`, ...capped(cards, { label: "in the review", href: `/review/${capture.id}` }) };
};
