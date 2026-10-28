// "Catch me up" (conversational plan, phase P, section 18): the updates answer's facts from the start of the asker's
// leave, with what was handed over and where each thing stands now. The leave is the latest one decided that has
// begun and ended at most updatesMaxDays ago, or is still on (LV6: back early, it covers every day since it began).
// With no such leave, since their last saved update, at most updatesMaxDays back (LV5). Only projects they read now
// (LV7); every fact from the per-viewer queries (P10). Asking does not move the updates cursor's meaning: it is its
// own topic.
import { and, desc, eq, inArray } from "drizzle-orm";
import * as t from "../../db/schema";
import { leaveRecordOf } from "../../db/records";
import { config } from "../../domain/config";
import { addDays, DAY_MS, startOfDayIn } from "../../domain/dates";
import { DECIDED_LEAVE, type LeaveState } from "../../domain/machines/leave";
import type { Conn } from "../../db/conn";
import { handedOver } from "../cover";
import { clockTime, todayIn } from "../project";
import { newsSince } from "./updates";
import { capped, counted, dayDate, projectsAsked, type AnswerBuilder, type DraftCard } from "./shared";

/** LV6: a leave counts while it is on, and for updatesMaxDays after it ends; "ended" is a leave past. */
const AWAY_OR_BACK: readonly LeaveState[] = [...DECIDED_LEAVE, "ended"];

/** The leave the asker is catching up from, or null (LV5). */
async function leaveToCatchUp(conn: Conn, viewerId: string, now: Date) {
  const today = todayIn(now);
  const floor = addDays(today, -config.updatesMaxDays);
  const rows = await conn.select().from(t.leave).where(and(eq(t.leave.personId, viewerId), inArray(t.leave.state, [...AWAY_OR_BACK])));
  const fit = rows.map(leaveRecordOf).filter((l) => l.start <= today && l.end >= floor);
  return fit.sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
}

/** LV5: when they last saved an update, if it was within updatesMaxDays. */
async function lastUpdateAt(conn: Conn, viewerId: string, now: Date): Promise<Date | null> {
  const [row] = await conn
    .select({ at: t.captures.messageAt })
    .from(t.captures)
    .where(and(eq(t.captures.authorId, viewerId), eq(t.captures.state, "saved")))
    .orderBy(desc(t.captures.messageAt))
    .limit(1);
  return row && row.at > new Date(now.getTime() - config.updatesMaxDays * DAY_MS) && row.at < now ? row.at : null;
}

export const catchUp: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const named = views.length === 1 && projectId ? views[0] : null;
  const on = named ? ` on ${named.project.name}` : " on your projects";
  const leave = await leaveToCatchUp(conn, viewerId, now);
  const last = leave ? null : await lastUpdateAt(conn, viewerId, now);
  const since = leave ? startOfDayIn(leave.start, config.timeZone) : (last ?? new Date(now.getTime() - config.updatesMaxDays * DAY_MS));
  const sinceLabel = leave
    ? `since your leave began ${dayDate(leave.start)}`
    : last
      ? `since your last update, ${todayIn(last) === todayIn(now) ? clockTime(last) : `${dayDate(todayIn(last))}, ${clockTime(last)}`}`
      : `in the last ${config.updatesMaxDays} days`;
  const news = await newsSince(conn, viewerId, views, named !== null, since, now);
  const covered = leave ? (await handedOver(conn, viewerId, leave.id, now)).filter((h) => !named || h.project.id === named.project.id) : [];

  const cards: DraftCard[] = [
    ...covered.map((h) => ({ title: h.label, detail: `${h.project.name}: ${h.who} covered it. Now ${h.now}`, tag: "Handed over", href: `/projects/${h.project.id}` })),
    ...news.map((x) => x.card),
  ];
  const lead = sinceLabel[0].toUpperCase() + sinceLabel.slice(1);
  const handed = covered.length ? ` ${counted(covered.length, "thing was", "things were")} covered for you.` : "";
  if (!cards.length) return { text: `Nothing new${on} ${sinceLabel}.`, cards: [], more: null };
  return { text: `${lead}: ${counted(news.length, "update", "updates")}${on}.${handed}`, ...capped(cards, { label: "on your projects", href: "/projects" }) };
};
