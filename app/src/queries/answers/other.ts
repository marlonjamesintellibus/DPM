// A question DPM cannot answer yet (section 15, QA5): said plainly, with what needs them today.
// Section 18: it lists everything Atlas can answer now.
import { needsMe } from "./needs-me";
import type { AnswerBuilder } from "./shared";

export const other: AnswerBuilder = async (conn, viewerId, question, now) => {
  const today = await needsMe(conn, viewerId, question, now);
  const lead =
    "I can't answer that yet. I can tell you what you're working on, what's due, what needs you, what is blocked, how a project stands, what a project is, any updates, who mentioned you, and why something is as it is.";
  return { ...today, text: today.cards.length ? `${lead} Here is what needs you today.` : `${lead} Nothing needs you right now.` };
};
