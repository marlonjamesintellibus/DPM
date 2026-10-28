// Conversational plan, phase N: who could pick up a piece of work ("Who can pick up #151?"): the
// teammates on its project with how much open and past due work each has and their leave, through phase
// H's rule for what one person may see of another (CD9, queries/people.ts). Facts only, no judgement of
// who should (PP6): DPM's words are the whole reply, so nothing is worded over them.
import { asThing } from "./people";
import type { Topic } from "./topic";

/** The work after the words that ask who could take it: "#151", "the store feed". */
const FREE = new RegExp(
  String.raw`\b(?:who\s+(?:can|could|would|is free to|is able to|has time to|has room to|has capacity to)|who's\s+(?:free to|able to)|a who\s+(?:can|could|fi))\s+(?:pick up|pick it up|take on|take over|take|tek|cover|help with|work on|handle)\b\s*(.*?)[?.!]*$`,
);

export const whoFree = {
  id: "who_free",
  // "Who can pick up #151?", "Who could take the store feed?", "Who's free?", "Who has time to cover #152?".
  // Phase R: "A who can tek #151?". Not "Who will work on #151?", which asks whose it is (people, PP5)
  rule: new RegExp(`${FREE.source}|\\bwho(?:'s| is| are)\\s+free\\b|\\bwho has (?:time|room|capacity|bandwidth)\\b`),
  prompt: "who on the team could pick up a piece of work, with how much each has",
  suggest: ["What's due this week?", "What's blocked?"],
  // PP6: facts only; Atlas does not word a choice of person over them
  worded: false,
} as const satisfies Topic;

/** The work "Who can pick up ..." asks after, without its article: "#151", "store feed"; null when none is said. */
export function freePhrase(asked: string): string | null {
  const m = FREE.exec(asked.toLowerCase().replace(/[‘’]/g, "'").trim());
  return m?.[1] ? asThing(m[1].replace(/^(?:it|that|this|that one)\b\s*/, "")) : null;
}
