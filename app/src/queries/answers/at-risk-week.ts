// What is at risk this week (conversational plan, phase N), on the project asked about or on all of the
// asker's, read through getProject (P10): milestones not done that are forecast past their target;
// milestones due this week (today to Sunday, as the due topic counts it) with blocked work in them; the
// blockers live on the BRAID log; and phase K's open signals raised to the asker.
import { and, desc, eq } from "drizzle-orm";
import { addDays, weekday, WEEKDAYS } from "../../domain/dates";
import type { Conn } from "../../db/conn";
import * as t from "../../db/schema";
import { shortDate, todayIn, type ProjectView } from "../project";
import { signalsFor } from "../signals";
import { capped, counted, forecastText, listed, milestonesOf, projectsAsked, workOf, type AnswerBuilder, type DraftCard } from "./shared";

/**
 * Phase K's open signals (M29) on these projects, as answer lines: only those raised to the asker now that
 * still hold, read through K's own per-viewer query (signalsFor: rule 4, SG9, P10), newest first. Each links
 * the asker's inbox item it sits in, where they accept or dismiss it.
 */
export async function openSignals(conn: Conn, viewerId: string, views: readonly ProjectView[], now: Date): Promise<DraftCard[]> {
  const cards: DraftCard[] = [];
  for (const v of views) {
    // SG10: one inbox item per project per day, so the signals are read a day at a time, as the inbox reads them
    const days = await conn
      .selectDistinct({ day: t.signals.stageOn })
      .from(t.signals)
      .where(and(eq(t.signals.projectId, v.project.id), eq(t.signals.state, "raised")));
    for (const { day } of days.sort((a, b) => b.day.localeCompare(a.day))) {
      const shown = await signalsFor(conn, viewerId, v.project.id, day, now);
      if (!shown.length) continue;
      const [item] = await conn
        .select({ id: t.inboxItems.id })
        .from(t.inboxItems)
        .where(and(eq(t.inboxItems.ownerId, viewerId), eq(t.inboxItems.causeKey, `signals:${v.project.id}@${day}`)))
        .orderBy(desc(t.inboxItems.episode))
        .limit(1);
      for (const s of shown) {
        cards.push({
          title: s.text,
          detail: `${v.project.name}: Atlas noticed it on ${shortDate(day)}`,
          tag: "Atlas noticed",
          href: item ? `/?view=inbox&item=${encodeURIComponent(item.id)}` : "/?view=inbox",
        });
      }
    }
  }
  return cards;
}

export const atRiskWeek: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  // As portfolio says it: with no projects there is nothing to be at risk on
  if (!views.length) return { text: "You are not in any projects yet.", cards: [], more: null };
  const today = todayIn(now);
  const sunday = addDays(today, (7 - WEEKDAYS.indexOf(weekday(today))) % 7);

  const milestones: DraftCard[] = [];
  const blockers: DraftCard[] = [];
  for (const v of views) {
    for (const m of milestonesOf(v).filter((x) => x.state !== "done")) {
      const late = m.forecastDate > m.targetDate;
      const held = workOf(v).filter((w) => w.milestoneId === m.id && w.state === "blocked");
      const dueThisWeek = m.targetDate >= today && m.targetDate <= sunday;
      if (!late && !(dueThisWeek && held.length)) continue;
      milestones.push({
        title: m.name,
        detail: `${v.project.name}: ${forecastText(m)}${held.length ? `, ${counted(held.length, "work item", "work items")} in it blocked` : ""}`,
        tag: `Milestone · ${m.statusLabel}`,
        href: `/projects/${v.project.id}`,
      });
    }
    for (const e of v.braid.entries.filter((x) => x.kind === "blocker" && x.onLog)) {
      const first = e.sources[0]?.at;
      blockers.push({
        title: e.title,
        detail: `${v.project.name}: ${counted(e.reportCount, "report", "reports")}${first ? `, since ${shortDate(todayIn(first))}` : ""}`,
        tag: "Blocker",
        href: `/projects/${v.project.id}?view=table&log=blocker`,
        subject: { type: "braid_entry", id: e.id, projectId: v.project.id },
        offer: ["resolve"],
      });
    }
  }
  // Phase K: what Atlas noticed and raised to the asker
  const signals = await openSignals(conn, viewerId, views, now);

  const scope = views.length === 1 && projectId ? views[0].project.name : "your projects";
  const found = listed([
    [milestones.length, "milestone", "milestones"],
    [blockers.length, "live blocker", "live blockers"],
    [signals.length, "thing Atlas noticed", "things Atlas noticed"],
  ]);
  if (!found) return { text: `Nothing on ${scope} is at risk this week: no milestone is forecast past its target or held up by blocked work, and no blocker is live.`, cards: [], more: null };
  return { text: `At risk this week on ${scope}: ${found}.`, ...capped([...milestones, ...blockers, ...signals], { label: "on your projects", href: "/projects" }) };
};
