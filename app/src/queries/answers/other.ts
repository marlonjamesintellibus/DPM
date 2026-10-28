// A question DPM cannot answer yet (section 15, QA5): said plainly, with what needs them today.
// Section 18: it lists everything Atlas can answer now (phase H: what someone else has; phase N: the
// questions for leads).
import { needsMe } from "./needs-me";
import type { AnswerBuilder } from "./shared";

export const other: AnswerBuilder = async (conn, viewerId, question, now) => {
  const today = await needsMe(conn, viewerId, question, now);
  const lead =
    "I can't answer that yet. I can tell you what you're working on, what's due, what needs you, what is blocked, how a project stands, what a project is, any updates, who mentioned you, why something is as it is, what someone on your projects is working on, who could pick up some work, what needs your decision, what is at risk this week, which projects are off track, and who hasn't updated today.";
  return { ...today, text: today.cards.length ? `${lead} Here is what needs you today.` : `${lead} Nothing needs you right now.` };
};
