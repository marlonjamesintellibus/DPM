// How a project stands (section 15; section 17 for the cards): the displayed status of the project asked
// about, or of each of the asker's, with the reason when one is set (QA3: only projects they are in).
import type { AnswerCard } from "../../domain/question";
import { projectsAsked, type AnswerBuilder } from "./shared";

export const standing: AnswerBuilder = async (conn, viewerId, { projectId }, now) => {
  const views = await projectsAsked(conn, viewerId, projectId, now);
  const cards = views.map((v): AnswerCard => {
    const set = v.displayed.from === "set" && v.setStatus ? `Set by ${v.setStatus.setBy?.name.split(" ")[0] ?? "its owner"}${v.reason ? `: ${v.reason.text}` : ""}; the plan says ${v.calculated.label}` : null;
    const waiting = v.setStatus?.waitingForReason ? `Set ${v.setStatus.label} with no reason yet; the plan says ${v.calculated.label}` : null;
    return { title: v.project.name, detail: set ?? waiting ?? `Worked out from the plan`, tag: v.displayed.label, href: `/projects/${v.project.id}` };
  });
  if (!cards.length) return { text: "You are not in any projects yet.", cards: [], more: null };
  if (cards.length === 1) return { text: `${cards[0].title} is ${cards[0].tag}.`, cards, more: null };
  return { text: `Here is how your ${cards.length} projects stand.`, cards, more: null };
};
