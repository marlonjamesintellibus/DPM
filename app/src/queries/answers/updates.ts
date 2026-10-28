// What is new (section 18, CQ4 to CQ7, CQ16): since the asker last asked, at most updatesMaxDays back,
// their notices (D15), changes other people saved into their projects (told as review tells them),
// project statuses set or cleared, and new entries on the BRAID logs. Newest first, each dated by when
// it reached the project, so the cursor never skips one that waited for approval or review (CQ5). Only
// projects they can read now; their own saves are not news to them (CQ6), and no quote is shown, so
// words routed to another project never reach them through a change they can see (CQ7, rule 9).
import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../../db/conn";
import { itemOf } from "../../db/records";
import * as t from "../../db/schema";
import { config } from "../../domain/config";
import { DAY_MS } from "../../domain/dates";
import { ON_LOG_STATES } from "../../domain/machines/braid-entry";
import type { AnswerCard } from "../../domain/question";
import type { SettableStatus } from "../../domain/status/status";
import { clockTime, daysAgo, firstName, peopleById, STATUS_LABEL, todayIn, type ProjectView } from "../project";
import { loadTargetRecords, targetChange, targetTitle } from "../review";
import { capped, counted, dayDate, projectsAsked, type AnswerBuilder } from "./shared";

/**
 * The updates cursor (section 18): the time of the asker's latest answer about updates that covered
 * this scope (one about all their projects covers each of them), read from their own answered captures.
 * Clamped to updatesMaxDays back; "first" when that clamp is what it is (CQ4).
 */
export async function updatesSince(conn: Conn, viewerId: string, projectId: string | null, now: Date): Promise<{ at: Date; first: boolean }> {
  const floor = new Date(now.getTime() - config.updatesMaxDays * DAY_MS);
  const asked = (await conn.select({ question: t.captures.question, answer: t.captures.answer }).from(t.captures).where(eq(t.captures.authorId, viewerId)))
    .filter((c) => c.question?.topic === "updates" && c.answer && (c.question.projectId === null || c.question.projectId === projectId))
    .map((c) => new Date(c.answer!.asOf))
    .filter((at) => at < now && at > floor)
    .sort((a, b) => b.getTime() - a.getTime());
  return asked.length ? { at: asked[0], first: false } : { at: floor, first: true };
}

/** "9:41am" today; "yesterday" or "3 days ago" before. */
function when(at: Date, now: Date): string {
  const ago = daysAgo(at, now);
  return ago === "today" ? clockTime(at) : ago;
}

export const updates: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const named = views.length === 1 && projectId ? views[0] : null;
  const since = await updatesSince(conn, viewerId, named?.project.id ?? null, now);
  const news = await newsSince(conn, viewerId, views, named !== null, since.at, now);
  const sinceLabel = since.first ? `in the last ${config.updatesMaxDays} days` : `since ${todayIn(since.at) === todayIn(now) ? clockTime(since.at) : `${dayDate(todayIn(since.at))}, ${clockTime(since.at)}`}`;
  const on = named ? ` on ${named.project.name}` : since.first ? " on your projects" : "";
  // CQ5: asked twice in a row, "Nothing new since 9:41am."
  if (!news.length) return { text: `Nothing new${on} ${sinceLabel}.`, cards: [], more: null };
  const lead = sinceLabel[0].toUpperCase() + sinceLabel.slice(1);
  return { text: `${lead}: ${counted(news.length, "update", "updates")}${on || " on your projects"}.`, ...capped(news.map((x) => x.card), { label: "on your projects", href: "/projects" }) };
};

/**
 * What is new on these projects (the asker reads each now) after `sinceAt`, newest first: the updates answer's facts,
 * which phase P's catch-up reads from the start of a leave. named: one project was asked about, so a notice with no
 * project is left out.
 */
export async function newsSince(conn: Conn, viewerId: string, views: readonly ProjectView[], named: boolean, sinceAt: Date, now: Date): Promise<{ at: Date; card: AnswerCard }[]> {
  const ids = views.map((v) => v.project.id);
  const nameOf = new Map(views.map((v) => [v.project.id, v.project.name]));
  const fresh = (at: Date) => at > sinceAt && at <= now;
  const news: { at: Date; card: AnswerCard }[] = [];

  // Notices to them (D15), about projects they can still read
  for (const n of await conn.select().from(t.notices).where(eq(t.notices.personId, viewerId))) {
    if (!fresh(n.at) || (n.projectId ? !ids.includes(n.projectId) : named)) continue;
    const where = n.projectId ? nameOf.get(n.projectId)! : "You";
    news.push({ at: n.at, card: { title: n.text, detail: `${where}: ${when(n.at, now)}`, tag: "For you", href: n.projectId ? `/projects/${n.projectId}?view=table` : "/?view=chat" } });
  }

  if (ids.length) {
    // Changes other people saved into these projects, told as review tells them; never leave (it is personal)
    const applied = (
      await conn
        .select({ row: t.extractions, authorId: t.captures.authorId })
        .from(t.extractions)
        .innerJoin(t.captures, eq(t.captures.id, t.extractions.captureId))
        .where(and(eq(t.extractions.state, "applied"), inArray(t.extractions.projectId, ids)))
    ).filter(({ row, authorId }) => authorId !== viewerId && row.kind === "update" && row.draft.target && row.draft.target.type !== "leave" && row.appliedAt && fresh(row.appliedAt));
    const records = await loadTargetRecords(conn, applied.map((a) => a.row.draft));
    const people = await peopleById(conn, [...applied.map((a) => a.authorId)]);
    for (const { row, authorId } of applied) {
      const who = firstName(people.get(authorId)?.name ?? "Someone");
      news.push({
        at: row.appliedAt!,
        card: { title: `${who}: ${targetTitle(row.draft.target!, records, who)}`, detail: `${nameOf.get(row.projectId!)}: ${targetChange(itemOf(row), records)}`, tag: `Update · ${when(row.appliedAt!, now)}`, href: `/projects/${row.projectId}` },
      });
    }

    // A status someone else set or cleared, or the plan cleared (M9)
    const moves = (await conn.select().from(t.auditEntries).where(and(eq(t.auditEntries.machine, "set_status"), inArray(t.auditEntries.subjectId, ids)))).filter(
      (a) => a.subjectType === "project" && fresh(a.at) && a.actorId !== viewerId,
    );
    const movers = await peopleById(conn, moves.map((a) => a.actorId));
    for (const a of moves) {
      const name = nameOf.get(a.subjectId)!;
      const who = a.actorId ? firstName(movers.get(a.actorId)?.name ?? "Someone") : null;
      const set = (a.detail?.setStatus ?? a.detail?.status) as SettableStatus | undefined;
      let title: string | null = null;
      if (a.action === "OWNER_SETS" && a.toState !== "calculated_only" && set) title = `${who ?? "Someone"} set ${name} ${STATUS_LABEL[set]}`;
      else if (a.action === "OWNER_SETS" && a.toState === "calculated_only") title = `${who ?? "Someone"} cleared the set status on ${name}`;
      else if (a.action === "CALCULATED_CHANGED" && a.toState === "calculated_only" && a.fromState !== "calculated_only") title = `The set status on ${name} ended: the plan agrees with it now`;
      if (title) news.push({ at: a.at, card: { title, detail: `${name}: ${when(a.at, now)}`, tag: "Status", href: `/projects/${a.subjectId}` } });
    }
  }

  // New entries on the BRAID logs, dated by when they went on the log (CQ5): a risk approved at 9:50 is
  // new at 9:50, though it was reported at 9:30. An entry with no such move on record (the seed) is
  // dated by its first report.
  const live = views.flatMap((v) => v.braid.entries.filter((e) => e.onLog).map((e) => ({ v, e })));
  const wentOn = new Map<string, { at: Date; actorId: string | null }>();
  const onLog = (state: string | null) => (ON_LOG_STATES as readonly (string | null)[]).includes(state);
  if (live.length) {
    const moves = await conn
      .select()
      .from(t.auditEntries)
      .where(and(eq(t.auditEntries.machine, "braid_entry"), inArray(t.auditEntries.subjectId, live.map((x) => x.e.id))));
    for (const a of moves.sort((x, y) => x.at.getTime() - y.at.getTime())) {
      if (onLog(a.toState) && !onLog(a.fromState) && !wentOn.has(a.subjectId)) wentOn.set(a.subjectId, { at: a.at, actorId: a.actorId });
    }
  }
  for (const { v, e } of live) {
    const first = e.sources[0];
    const logged = wentOn.get(e.id) ?? (first ? { at: first.at, actorId: null } : null);
    // CQ6: not news when they reported it, or put it on the log themselves
    if (!first || !logged || !fresh(logged.at) || first.person.id === viewerId || e.reportedBy?.id === viewerId || logged.actorId === viewerId) continue;
    news.push({
      at: logged.at,
      card: { title: e.title, detail: `${v.project.name}: new ${e.kindLabel.toLowerCase()} from ${firstName(first.person.name)}, ${when(logged.at, now)}`, tag: e.kindLabel, href: `/projects/${v.project.id}?view=table&log=${e.kind}` },
    });
  }

  news.sort((a, b) => b.at.getTime() - a.at.getTime() || a.card.title.localeCompare(b.card.title));
  return news;
}
