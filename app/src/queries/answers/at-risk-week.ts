// What is at risk this week (conversational plan, phase N), on the project asked about or on all of the
// asker's, read through getProject (P10): milestones not done that are forecast past their target;
// milestones due this week (today to Sunday, as the due topic counts it) with blocked work in them; the
// blockers live on the BRAID log; and, once phase K lands, its open signals.
import { addDays, weekday, WEEKDAYS } from "../../domain/dates";
import type { Conn } from "../../db/conn";
import { shortDate, todayIn, type ProjectView } from "../project";
import { capped, counted, forecastText, listed, milestonesOf, projectsAsked, workOf, type AnswerBuilder, type DraftCard } from "./shared";

/**
 * Phase K's hook: the open signals (M29) on these projects that the asker may see, as answer lines,
 * worst first. Phase K is built alongside this phase; until it lands there are none. When it does, it
 * reads its own per-viewer query here (queries/signals.ts, signalsFor) and nothing else in this answer
 * changes; answer-leads.test.ts fails until it does.
 */
export async function openSignals(_conn: Conn, _viewerId: string, _views: readonly ProjectView[], _now: Date): Promise<DraftCard[]> {
  return [];
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
  // Phase K: open signals, once built
  const signals = await openSignals(conn, viewerId, views, now);

  const scope = views.length === 1 && projectId ? views[0].project.name : "your projects";
  const found = listed([
    [milestones.length, "milestone", "milestones"],
    [blockers.length, "live blocker", "live blockers"],
    [signals.length, "signal", "signals"],
  ]);
  if (!found) return { text: `Nothing on ${scope} is at risk this week: no milestone is forecast past its target or held up by blocked work, and no blocker is live.`, cards: [], more: null };
  return { text: `At risk this week on ${scope}: ${found}.`, ...capped([...milestones, ...blockers, ...signals], { label: "on your projects", href: "/projects" }) };
};
