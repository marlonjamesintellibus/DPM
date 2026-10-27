// What is due (conversational plan, phase A, "Added: the due topic"; CQ17 to CQ19): the asker's work
// items due in the window that are not Done, and the next milestone by forecast on each of their
// projects, with its status. A named project gives its due work whoever owns it, still only what the
// asker can read. The window comes from the asker's own words, never from Atlas: today, tomorrow, this
// week (today to Sunday, in the org time zone) or next week; this week when they say none.
import { addDays, weekday, WEEKDAYS, type IsoDate } from "../../domain/dates";
import type { AnswerCard } from "../../domain/question";
import { firstName, todayIn, type ProjectMilestone, type ProjectView } from "../project";
import { capped, counted, dayDate, forecastText, milestonesOf, projectsAsked, workOf, workTitle, type AnswerBuilder } from "./shared";

type Window = { from: IsoDate; to: IsoDate; label: string; late: boolean };

/** CQ17: the window the words ask about; one that starts today also takes what is past due and not Done. */
export function dueWindow(asked: string, today: IsoDate): Window {
  const words = asked.toLowerCase();
  const sunday = addDays(today, (7 - WEEKDAYS.indexOf(weekday(today))) % 7);
  if (/\btomorrow\b/.test(words)) return { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow", late: false };
  if (/\bnext week\b/.test(words)) return { from: addDays(sunday, 1), to: addDays(sunday, 7), label: "next week", late: false };
  if (/\btoday\b/.test(words)) return { from: today, to: today, label: "today", late: true };
  return { from: today, to: sunday, label: "this week", late: true };
}

/** Not done, nor missed: a milestone that can still come. */
const ahead = (m: ProjectMilestone) => m.state === "planned" || m.state === "in_progress";

export const due: AnswerBuilder = async (conn, viewerId, { asked, projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const named = views.length === 1 && projectId ? views[0] : null;
  const today = todayIn(now);
  const window = dueWindow(asked, today);

  // CQ18: the next milestone on each project asked about; never one from another project
  const next = views.flatMap((v) => {
    const left = milestonesOf(v).filter(ahead).sort((a, b) => a.forecastDate.localeCompare(b.forecastDate) || a.name.localeCompare(b.name));
    return left.length ? [{ v, m: left[0] }] : [];
  });
  const milestoneCard = ({ v, m }: { v: ProjectView; m: ProjectMilestone }): AnswerCard => ({
    title: m.name,
    detail: `${v.project.name}: ${forecastText(m)}`,
    tag: `Next milestone · ${m.statusLabel}`,
    href: `/projects/${v.project.id}`,
  });
  const scope = named ? named.project.name : "your projects";

  if (/\bmilestones?\b/.test(asked.toLowerCase())) {
    if (!next.length) return { text: `No milestones left on ${scope}.`, cards: [], more: null };
    const [first] = next;
    const text = next.length === 1 ? `The next milestone on ${first.v.project.name} is ${first.m.name}, ${forecastText(first.m)}.` : `Here is the next milestone on each of ${scope}.`;
    return { text, cards: next.map(milestoneCard), more: null };
  }

  const work = views
    .flatMap((v) =>
      workOf(v)
        .filter((w) => (named || w.owner?.id === viewerId) && w.state !== "done" && w.state !== "cancelled" && w.dueDate)
        .map((w) => ({ v, w, late: w.dueDate! < today })),
    )
    .filter(({ w, late }) => (late && window.late) || (w.dueDate! >= window.from && w.dueDate! <= window.to))
    .sort((a, b) => a.w.dueDate!.localeCompare(b.w.dueDate!) || workTitle(a.w).localeCompare(workTitle(b.w)));
  const cards: AnswerCard[] = [
    ...work.map(({ v, w, late }) => ({
      title: workTitle(w),
      detail: `${v.project.name}: ${w.stateLabel}, due ${dayDate(w.dueDate!)}${named && w.owner && w.owner.id !== viewerId ? `, ${firstName(w.owner.name)}` : ""}`,
      tag: late ? "Late" : w.statusLabel,
      href: `/projects/${v.project.id}`,
    })),
    ...next.map(milestoneCard),
  ];
  const late = work.filter((x) => x.late).length;
  const inWindow = work.length - late;
  const whose = named ? `on ${named.project.name}` : "of yours";
  const lead = `${inWindow ? `${counted(inWindow, "work item", "work items")} ${whose} ${inWindow === 1 ? "is" : "are"}` : `Nothing ${whose} is`} due ${window.label}${late ? `, and ${counted(late, "work item is", "work items are")} late` : ""}.`;
  const tail = next.length === 1 ? ` The next milestone is ${next[0].m.name}, ${forecastText(next[0].m)}.` : next.length > 1 ? ` The next milestone on each project is below.` : "";
  return { text: `${lead}${tail}`, ...capped(cards, { label: "on your projects", href: "/projects" }) };
};
