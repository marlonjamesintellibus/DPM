// DPM's answer to a question asked in the chat (machines doc, sections 15 and 17). Every fact comes from
// the asker's own data through the same per-viewer queries the screens use, so an answer shows nothing
// the asker could not open themselves (P10, QA3, QA5, MF12). The details are cards drawn from that data;
// the sentence over them is DPM's own here, and Atlas may reword it later (atlas/answer.ts). Each
// topic's answer is in queries/answers. Phase B: a line about something the asker can act on carries the
// acts its screen offers them now, each with the version they saw (AC3, AC5). CD50: a topic whose words
// fit 2 or 3 of the asker's projects or people also says which, for M21 to ask (commands/clarification.ts).
import type { Conn } from "../db/conn";
import type { QuestionFits } from "../domain/machines/clarification";
import type { Answer, AnswerCard, AskedQuestion, Which } from "../domain/question";
import { lineActions } from "./acting";
import { ANSWERS } from "./answers";
import { clientViews } from "./client-view";
import { sharedPeople } from "./people";
import { readableProjects } from "./project";

/** DPM's answer to a checked question, as of now, in DPM's own words. */
export async function answerFor(conn: Conn, viewerId: string, question: AskedQuestion, now: Date): Promise<Answer> {
  return (await answerOrWhich(conn, viewerId, question, now)).answer;
}

/** answerFor, and CD50: which of 2 or 3 projects or people the words could mean, when the topic says so. */
export async function answerOrWhich(conn: Conn, viewerId: string, question: AskedQuestion, now: Date): Promise<{ answer: Answer; which: Which | null }> {
  const base = { topic: question.topic, wording: "rules" as const, asOf: now.toISOString() };
  const { which, ...body } = await ANSWERS[question.topic](conn, viewerId, question, now);
  const cards: AnswerCard[] = [];
  for (const { offer, ...card } of body.cards) {
    const actions = card.subject && offer ? await lineActions(conn, viewerId, card.subject, offer) : [];
    cards.push(actions.length ? { ...card, actions } : card);
  }
  return { answer: { ...base, ...body, cards }, which: which ?? null };
}

/**
 * CD50, P10: what a question's option may be now, read as the topic that asked reads it. A project: those
 * the asker reads as a member, or, with none, the client views they are given (EX4, as explain_project
 * decides). A person: someone they share a project with now (CD9). Anything else is never shown or chosen.
 */
export async function fitsReadBy(conn: Conn, viewerId: string, fits: QuestionFits): Promise<Set<string>> {
  if (fits === "person") return new Set((await sharedPeople(conn, viewerId)).map((p) => p.id));
  const readable = await readableProjects(conn, viewerId);
  return new Set(readable.length ? readable : (await clientViews(conn, viewerId)).map((v) => v.project.id));
}
