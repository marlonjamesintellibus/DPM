// What every topic's answer is made with (machines doc, sections 15 and 17): the shape it returns, the
// card cap, and the projects a question covers, read per viewer (P10).
import type { Conn } from "../../db/conn";
import type { Answer, AnswerCard, AskedQuestion } from "../../domain/question";
import { getProject, readableProjects, type ProjectView } from "../project";

/** DPM's sentence and the cards; answerFor adds the topic and the time it was given. */
export type Body = Pick<Answer, "text" | "cards" | "more">;

/** One topic's answer to a checked question, from the asker's own data, as of now. */
export type AnswerBuilder = (conn: Conn, viewerId: string, question: AskedQuestion, now: Date) => Promise<Body>;

const SHOWN = 8;

export function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** MF11: at most 8 cards; past that, 7 and a count of the rest with where to find them. */
export function capped(cards: AnswerCard[], where: { label: string; href: string }): Pick<Answer, "cards" | "more"> {
  if (cards.length <= SHOWN) return { cards, more: null };
  return { cards: cards.slice(0, SHOWN - 1), more: { label: `${cards.length - SHOWN + 1} more ${where.label}`, href: where.href } };
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
