// What every topic's answer is made with (machines doc, sections 15 and 17): the shape it returns, the
// card cap, and the projects a question covers, read per viewer (P10).
import type { Conn } from "../../db/conn";
import { weekday, type IsoDate } from "../../domain/dates";
import type { CommandAct } from "../../domain/machines/chat-command";
import type { Answer, AnswerCard, AskedQuestion } from "../../domain/question";
import { getProject, readableProjects, shortDate, type ProjectMilestone, type ProjectView, type ProjectWorkItem } from "../project";

/**
 * A card as a topic builds it. Phase B: `offer` says which acts its line is for (Approve and Decline on a
 * proposal, Mark done on work); answerFor turns it into what the asker may do on it now (`actions`).
 */
export type DraftCard = AnswerCard & { offer?: readonly CommandAct[] };

/** DPM's sentence and the cards; answerFor adds the topic and the time it was given. */
export type Body = Pick<Answer, "text" | "more"> & { cards: DraftCard[] };

/** One topic's answer to a checked question, from the asker's own data, as of now. */
export type AnswerBuilder = (conn: Conn, viewerId: string, question: AskedQuestion, now: Date) => Promise<Body>;

const SHOWN = 8;

export function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** MF11: at most 8 cards; past that, 7 and a count of the rest with where to find them. */
export function capped<C extends AnswerCard>(cards: C[], where: { label: string; href: string }): { cards: C[]; more: Answer["more"] } {
  if (cards.length <= SHOWN) return { cards, more: null };
  return { cards: cards.slice(0, SHOWN - 1), more: { label: `${cards.length - SHOWN + 1} more ${where.label}`, href: where.href } };
}

/** "1 work item, 2 milestones and 1 entry": the parts that are not zero, joined as a sentence says them. */
export function listed(parts: readonly [number, string, string][]): string {
  const said = parts.filter(([n]) => n > 0).map(([n, one, many]) => counted(n, one, many));
  return said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : (said[0] ?? "");
}

/** "Fri 23 Oct" */
export function dayDate(date: IsoDate): string {
  return `${weekday(date).slice(0, 3)} ${shortDate(date)}`;
}

/** CQ19: "forecast Fri 30 Oct, later than its target Wed 28": the target is said only when it differs. */
export function forecastText(m: Pick<ProjectMilestone, "forecastDate" | "targetDate">): string {
  if (m.forecastDate === m.targetDate) return `forecast ${dayDate(m.forecastDate)}`;
  const target = dayDate(m.targetDate);
  // The month is said once when both dates share it
  const short = target.split(" ")[2] === dayDate(m.forecastDate).split(" ")[2] ? target.split(" ").slice(0, 2).join(" ") : target;
  return `forecast ${dayDate(m.forecastDate)}, ${m.forecastDate > m.targetDate ? "later" : "earlier"} than its target ${short}`;
}

/** Every work item on a project, in its threads or in none. */
export function workOf(v: ProjectView): ProjectWorkItem[] {
  return [...v.threads.flatMap((th) => th.workItems), ...v.unthreaded.workItems];
}

/** Every milestone on a project, in its threads or in none. */
export function milestonesOf(v: ProjectView): ProjectMilestone[] {
  return [...v.threads.flatMap((th) => th.milestones), ...v.unthreaded.milestones];
}

/** "#145 Google Trends connector" */
export function workTitle(w: Pick<ProjectWorkItem, "number" | "title">): string {
  return `${w.number ? `${w.number} ` : ""}${w.title}`;
}

/** The projects a question is about: the one it names if the asker is in it, otherwise all of theirs. */
export async function projectsAsked(conn: Conn, viewerId: string, projectId: string | null, now: Date): Promise<ProjectView[]> {
  const readable = await readableProjects(conn, viewerId);
  const ids = projectId && readable.includes(projectId) ? [projectId] : readable;
  const views: ProjectView[] = [];
  for (const id of [...ids].sort()) {
    const v = await getProject(conn, viewerId, id, now);
    if (v.found) views.push(v);
  }
  return views;
}
