// DPM's answer to a question asked in the chat (machines doc, sections 15 and 17). Every fact comes from
// the asker's own data through the same per-viewer queries the screens use, so an answer shows nothing
// the asker could not open themselves (P10, QA3, QA5, MF12). The details are cards drawn from that data;
// the sentence over them is DPM's own here, and Atlas may reword it later (atlas/answer.ts). Each
// topic's answer is in queries/answers.
import type { Conn } from "../db/conn";
import type { Answer, AskedQuestion } from "../domain/question";
import { ANSWERS } from "./answers";

/** DPM's answer to a checked question, as of now, in DPM's own words. */
export async function answerFor(conn: Conn, viewerId: string, question: AskedQuestion, now: Date): Promise<Answer> {
  const base = { topic: question.topic, wording: "rules" as const, asOf: now.toISOString() };
  return { ...base, ...(await ANSWERS[question.topic](conn, viewerId, question, now)) };
}
