// Atlas words a reason for a set status (M11, phase 4). The rules draft holds the facts; Atlas
// may only reword them. Anything that adds a fact, a number or a person judgement is thrown away
// and the rules draft is used instead, so the owner always gets a draft.
import { saysHealthOrJudgement } from "../domain/atlas-checks/checks";
import type { Drafter, Usage } from "./extractor";

export const REASON_SYSTEM_PROMPT = `You are Atlas, inside Intellibus DPM. A project owner set a status for their project and needs a short reason.
You get the status and a list of facts DPM found on the project. Rewrite the facts as a reason the owner can send to their team.
- Use only the facts given. Add nothing: no new numbers, dates, causes, names or guesses.
- Keep every work item number (like #151) and every date and count that you use exactly as given.
- At most 3 short sentences, under 400 characters. Plain words. No em dashes. No bullet points.
- Never judge a person. Never mention health.
- Answer with the reason only.`;

export function reasonUserMessage(input: { projectName: string; status: string; facts: string }): string {
  return `Project: ${input.projectName}\nStatus set by the owner: ${input.status}\nFacts:\n${input.facts}`;
}

const numbers = (s: string) => new Set(s.match(/\d+/g) ?? []);
const refs = (s: string) => new Set(s.match(/#\d+/g) ?? []);

/** Why Atlas's wording cannot be used, or null when it only rewords the rules draft. */
export function reasonProblem(known: string, worded: string): string | null {
  const text = worded.trim();
  if (!text) return "empty";
  if (text.length > 500) return "too long";
  if ((text.match(/[.!?](\s|$)/g) ?? []).length > 3) return "more than 3 sentences";
  const knownNumbers = numbers(known);
  const knownRefs = refs(known);
  for (const r of refs(text)) if (!knownRefs.has(r)) return `names ${r}, which is not in the facts`;
  for (const n of numbers(text)) if (!knownNumbers.has(n)) return `adds the number ${n}`;
  if (saysHealthOrJudgement(text)) return "mentions health or judges a person";
  return null;
}

/** Plain punctuation for team writing: an em dash becomes a comma. */
export function plain(text: string): string {
  return text.replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim();
}

export type Worded = { text: string; by: "atlas"; model: string; usage: Usage | null } | { text: string; by: "rules"; fallback: string };

export async function wordReason(drafter: Drafter, input: { projectName: string; status: string; facts: string }): Promise<Worded> {
  try {
    const out = await drafter.draft(REASON_SYSTEM_PROMPT, reasonUserMessage(input));
    const text = plain(out.text);
    // The project name is known text too ("Forager 2.0")
    const problem = reasonProblem(`${input.projectName}\n${input.facts}`, text);
    if (problem) return { text: input.facts, by: "rules", fallback: problem };
    return { text, by: "atlas", model: out.model, usage: out.usage };
  } catch (e) {
    return { text: input.facts, by: "rules", fallback: e instanceof Error ? e.message : String(e) };
  }
}
