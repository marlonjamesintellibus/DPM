// DPM's answer to a question asked in the chat (machines doc, sections 15 and 17). Every fact comes from
// the asker's own data through the same per-viewer queries the screens use, so an answer shows nothing
// the asker could not open themselves (P10, QA3, QA5, MF12). The details are cards drawn from that data;
// the sentence over them is DPM's own here, and Atlas may reword it later (atlas/answer.ts). Each
// topic's answer is in queries/answers. Phase B: a line about something the asker can act on carries the
// acts its screen offers them now, each with the version they saw (AC3, AC5).
import type { Conn } from "../db/conn";
import type { Answer, AnswerCard, AskedQuestion } from "../domain/question";
import { lineActions } from "./acting";
import { ANSWERS } from "./answers";

/** DPM's answer to a checked question, as of now, in DPM's own words. */
export async function answerFor(conn: Conn, viewerId: string, question: AskedQuestion, now: Date): Promise<Answer> {
  const base = { topic: question.topic, wording: "rules" as const, asOf: now.toISOString() };
  const body = await ANSWERS[question.topic](conn, viewerId, question, now);
  const cards: AnswerCard[] = [];
  for (const { offer, ...card } of body.cards) {
    const actions = card.subject && offer ? await lineActions(conn, viewerId, card.subject, offer) : [];
    cards.push(actions.length ? { ...card, actions } : card);
  }
  return { ...base, ...body, cards };
}
