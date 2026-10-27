// What the asker is working on (section 18, CQ1 to CQ3): the work items they own that are not Done,
// Blocked first, then In progress, then To do, each by due date; the milestones they own that are not
// done; and the live BRAID entries they own. Read through getProject per project they can read, so
// work on a project they have left is never listed (CQ3), and each card opens its project.
import type { ProjectWorkItem } from "../project";
import { needsYou } from "./needs-me";
import { capped, dayDate, forecastText, listed, milestonesOf, projectsAsked, workOf, workTitle, type AnswerBuilder, type DraftCard } from "./shared";

const ORDER = ["blocked", "in_progress", "to_do"] as const;

/** Blocked first, then In progress, then To do, each by due date. Phase H lists someone else's work the same way. */
export function workOrder(a: ProjectWorkItem, b: ProjectWorkItem): number {
  return (
    ORDER.indexOf(a.state as (typeof ORDER)[number]) - ORDER.indexOf(b.state as (typeof ORDER)[number]) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    workTitle(a).localeCompare(workTitle(b))
  );
}

export const myWork: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const work = views.flatMap((v) =>
    workOf(v)
      .filter((w) => w.owner?.id === viewerId && w.state !== "done" && w.state !== "cancelled")
      .map((w) => ({ v, w })),
  );
  work.sort((a, b) => workOrder(a.w, b.w));
  const milestones = views.flatMap((v) => milestonesOf(v).filter((m) => m.owner?.id === viewerId && m.state !== "done").map((m) => ({ v, m })));
  milestones.sort((a, b) => a.m.forecastDate.localeCompare(b.m.forecastDate));
  const entries = views.flatMap((v) => v.braid.entries.filter((e) => e.owner?.id === viewerId && e.onLog).map((e) => ({ v, e })));

  const cards: DraftCard[] = [
    ...work.map(({ v, w }): DraftCard => ({
      title: workTitle(w),
      detail: `${v.project.name}: ${w.dueDate ? `due ${dayDate(w.dueDate)}` : "no due date"}${w.blockedNote ? `, ${w.blockedNote}` : ""}`,
      tag: w.stateLabel,
      href: `/projects/${v.project.id}`,
      subject: { type: "work_item", id: w.id, projectId: v.project.id },
      offer: ["mark_done", "unblock"],
    })),
    ...milestones.map(({ v, m }) => ({ title: m.name, detail: `${v.project.name}: ${forecastText(m)}`, tag: `Milestone · ${m.statusLabel}`, href: `/projects/${v.project.id}` })),
    ...entries.map(({ v, e }): DraftCard => ({
      title: e.title,
      detail: `${v.project.name}: ${e.stateLabel}`,
      tag: e.kindLabel,
      href: `/projects/${v.project.id}?view=table&log=${e.kind}`,
      subject: { type: "braid_entry", id: e.id, projectId: v.project.id },
    })),
  ];
  const on = views.length === 1 && projectId ? ` on ${views[0].project.name}` : "";
  if (!cards.length) {
    // CQ1: nothing is theirs, so say what needs them instead, if anything does
    const needs = await needsYou(conn, viewerId, now);
    const lead = `Nothing is assigned to you${on} right now.`;
    if (!needs.cards.length) return { text: lead, cards: [], more: null };
    return { text: `${lead} Here is what needs you.`, ...capped(needs.cards, { label: "in your inbox", href: "/?view=inbox" }) };
  }
  const open = listed([
    [work.length, "open work item", "open work items"],
    [milestones.length, "milestone", "milestones"],
    [entries.length, "entry on the BRAID log", "entries on the BRAID log"],
  ]);
  return { text: `You have ${open}${on}.`, ...capped(cards, { label: "on your projects", href: "/projects" }) };
};
