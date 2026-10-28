// "What did I promise?" (phase E, CM12): the asker's own open and due commitments (M22), soonest first. Only
// ever the asker's (CD3): nobody else's is read, counted or hinted at. A record a promise names is said only
// while the asker can still open its project (P10, CM9). A named project keeps the promises about its records.
// Each card carries the promise's own buttons, so an open one can be marked done or dropped before it is due.
import { and, eq, inArray } from "drizzle-orm";
import * as t from "../../db/schema";
import { linkLabel } from "../../commands/commitment";
import { commitmentOf } from "../../db/records";
import { asksDrop, LIVE_COMMITMENT, type CommitmentRecord } from "../../domain/machines/commitment";
import { readableProjects, todayIn } from "../project";
import { capped, counted, dayDate, type AnswerBuilder, type DraftCard } from "./shared";

function tagOf(c: CommitmentRecord, today: string): string {
  if (c.stands === "asked") return "Still stands?";
  if (c.state === "checking") return "Due · checking in";
  if (c.state === "due" || c.dueOn < today) return "Due";
  return c.dueOn === today ? "Due today" : "Open";
}

export const commitments: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const today = todayIn(now);
  const rows = await conn.select().from(t.commitments).where(and(eq(t.commitments.ownerId, viewerId), inArray(t.commitments.state, [...LIVE_COMMITMENT])));
  const readable = await readableProjects(conn, viewerId);
  const named = projectId && readable.includes(projectId) ? projectId : null;
  const mine = rows
    .map(commitmentOf)
    .filter((c) => !named || c.link?.projectId === named)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
  const on = named ? ` about ${(await conn.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, named)))[0]?.name ?? "that project"}` : "";
  if (!mine.length) return { text: `You have no open promises${on}.`, cards: [], more: null };

  const cards: DraftCard[] = [];
  for (const c of mine) {
    const label = await linkLabel(conn, viewerId, c.link);
    const moved = c.moves ? `, moved ${counted(c.moves, "time", "times")}` : "";
    cards.push({
      title: c.what,
      detail: `Due ${dayDate(c.dueOn)}${moved}${label ? ` · ${label}` : ""}${asksDrop(c) ? ". Drop it if it no longer stands" : ""}`,
      tag: tagOf(c, today),
      href: c.captureId ? `/review/${c.captureId}` : "/?view=inbox",
      // The model's anyLive with OwnerSays: the owner ends or moves an open promise here, not only from a check-in
      promise: { id: c.id, mode: c.stands === "asked" ? "stands" : "check", dropFirst: asksDrop(c), today },
    });
  }
  const due = mine.filter((c) => c.state !== "open" || c.dueOn <= today).length;
  const lead = `You have ${counted(mine.length, "open promise", "open promises")}${on}${due ? `, ${due === mine.length ? (due === 1 ? "and it is due" : "all due") : `${due} due`}` : ""}.`;
  return { text: lead, ...capped(cards, { label: "promises", href: "/?view=inbox" }) };
};
