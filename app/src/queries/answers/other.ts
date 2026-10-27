// A question DPM cannot answer yet (section 15, QA5): said plainly, with what needs them today.
import { needsMe } from "./needs-me";
import type { AnswerBuilder } from "./shared";

export const other: AnswerBuilder = async (conn, viewerId, question, now) => {
  const today = await needsMe(conn, viewerId, question, now);
  const lead = "I can't answer that yet. I can tell you what needs you, what is blocked, and how a project stands.";
  return { ...today, text: today.cards.length ? `${lead} Here is what needs you today.` : `${lead} Nothing needs you right now.` };
};
