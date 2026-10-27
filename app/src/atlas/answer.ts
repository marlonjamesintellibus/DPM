// Atlas words the reply to a question asked in the chat (machines doc, section 17). DPM found the
// answer in the asker's own data and shows its details as cards; Atlas only writes the 1 to 3 sentences
// over them. Anything that adds a number, a #reference, a judgement or health is thrown away and DPM's
// own sentence is used, as for a status reason (M11). Phase R, CD20: the reply is standard English,
// whatever language the question was asked in.
import type { Answer } from "../domain/question";
import type { Drafter } from "./extractor";
import { plain, reasonProblem, type Worded } from "./reason";

export const ANSWER_SYSTEM_PROMPT = `You are Atlas, the assistant inside Intellibus DPM, a project manager for small delivery teams.
A team member asked you something in the chat. DPM looked the answer up in their own data: you get DPM's one-line answer and the things DPM shows under your words.
Write the reply that goes above them, as you would say it to them.
- Answer what they asked, in 1 to 3 short sentences. If they asked for a list, say what the list is and that it is below; do not repeat every item.
- Call things by their names ("the store sales feed blocker"). Never call them cards, rows or links.
- Use only the facts given. Add nothing: no new numbers, dates, names, causes or guesses. Keep every #number, time and count you use exactly as given.
- Reply in standard English, even when they asked in Jamaican English or Patois. Never correct, translate or remark on how they wrote.
- Speak to them as "you". Plain words. No em dashes, no bullet points, no headings. Under 400 characters.
- Never judge a person. Never mention health.
- Answer with the reply only.`;

/** What Atlas is shown: the question, DPM's sentence and the cards, nothing else (MF12). */
export function answerUserMessage(asked: string, answer: Answer): string {
  const cards = answer.cards.map((c) => `- ${c.title}${c.detail ? `: ${c.detail}` : ""}${c.tag ? ` (${c.tag})` : ""}`).join("\n");
  return `Question: ${asked}\nDPM's answer: ${answer.rulesText ?? answer.text}\nShown under your reply:\n${cards || "(nothing)"}${answer.more ? `\nAlso: ${answer.more.label}` : ""}`;
}

/** The facts Atlas's words are checked against: everything it was shown. */
function known(asked: string, answer: Answer): string {
  return answerUserMessage(asked, answer);
}

export async function wordAnswer(drafter: Drafter, asked: string, answer: Answer): Promise<Worded> {
  const rules = answer.rulesText ?? answer.text;
  try {
    const out = await drafter.draft(ANSWER_SYSTEM_PROMPT, answerUserMessage(asked, answer));
    const text = plain(out.text);
    const problem = reasonProblem(known(asked, answer), text);
    if (problem) return { text: rules, by: "rules", fallback: problem };
    return { text, by: "atlas", model: out.model, usage: out.usage };
  } catch (e) {
    return { text: rules, by: "rules", fallback: e instanceof Error ? e.message : String(e) };
  }
}
