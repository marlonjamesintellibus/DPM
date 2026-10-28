// How a project stands (section 15; section 17 for the cards): the displayed status of the project asked
// about, or of each of the asker's, with the reason when one is set (QA3: only projects they are in).
// Section 18: one named project also gives its next milestone with the forecast, its live blockers and
// risks, and what needs the asker on it ("Tell me about Forager").
import type { AnswerCard } from "../../domain/question";
import type { ProjectView } from "../project";
import { needsYou } from "./needs-me";
import { capped, counted, forecastText, milestonesOf, projectsAsked, type AnswerBuilder } from "./shared";

/** A project's card: its displayed status, and who set it and why, or that the plan works it out. Phase N's portfolio reads it too. */
export function statusCard(v: ProjectView): AnswerCard {
  const set = v.displayed.from === "set" && v.setStatus ? `Set by ${v.setStatus.setBy?.name.split(" ")[0] ?? "its owner"}${v.reason ? `: ${v.reason.text}` : ""}; the plan says ${v.calculated.label}` : null;
  const waiting = v.setStatus?.waitingForReason ? `Set ${v.setStatus.label} with no reason yet; the plan says ${v.calculated.label}` : null;
  return { title: v.project.name, detail: set ?? waiting ?? `Worked out from the plan`, tag: v.displayed.label, href: `/projects/${v.project.id}` };
}

export const standing: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const cards = views.map(statusCard);
  if (!cards.length) return { text: "You are not in any projects yet.", cards: [], more: null };
  if (cards.length > 1) return { text: `Here is how your ${cards.length} projects stand.`, cards, more: null };
  const lead = `${cards[0].title} is ${cards[0].tag}.`;
  if (!projectId) return { text: lead, cards, more: null };

  const v = views[0];
  const next = milestonesOf(v)
    .filter((m) => m.state === "planned" || m.state === "in_progress")
    .sort((a, b) => a.forecastDate.localeCompare(b.forecastDate) || a.name.localeCompare(b.name))[0];
  const live = (kind: string) => v.braid.entries.filter((e) => e.kind === kind && e.onLog).length;
  const [blockers, risks] = [live("blocker"), live("risk")];
  const needs = await needsYou(conn, viewerId, now, v.project.id);
  const more: AnswerCard[] = [
    ...(next ? [{ title: next.name, detail: `${v.project.name}: ${forecastText(next)}`, tag: `Next milestone · ${next.statusLabel}`, href: `/projects/${v.project.id}` }] : []),
    {
      title: `${counted(blockers, "blocker", "blockers")} and ${counted(risks, "risk", "risks")} on the log`,
      detail: `${v.project.name}: live on the BRAID log`,
      tag: "BRAID log",
      href: `/projects/${v.project.id}?view=table`,
    },
  ];
  const parts = [
    lead,
    next ? `The next milestone is ${next.name}, ${forecastText(next)}.` : "No milestones left on it.",
    `${counted(blockers, "blocker", "blockers")} and ${counted(risks, "risk", "risks")} are live, and ${needs.cards.length ? `${counted(needs.cards.length, "thing needs", "things need")} you on it` : "nothing on it needs you"}.`,
  ];
  // MF11: the project, its milestone and its log come first, so what is cut is only what needs them
  return { text: parts.join(" "), ...capped([...cards, ...more, ...needs.cards], { label: "in your inbox", href: "/?view=inbox" }) };
};
