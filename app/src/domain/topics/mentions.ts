// Section 18: who named the asker, in words the asker may see (CQ8 to CQ11).
import type { Topic } from "./topic";

export const mentions = {
  id: "mentions",
  // Only about the asker: "Did Kemar mention the deadline?" asks about a person, which is not in this plan
  // Phase R: "Anybody mention mi?", "Who call mi name?", "Dem a talk bout mi?"; not "mi name" alone ("A mi
  // name deh pon #151?" asks whose work it is)
  rule: /\b(mention me|mentions me|mentioned me|mentioning me|my mentions|any mentions|mentions of me|mentions for me|(?:was|were|have|has) i (?:been )?(?:mentioned|named)|named me|talked about me|talking about me|mention(?:ed|s)? mi|call(?:ed)? mi name|talk(?:ed|ing)? (?:bout|about) mi)\b/,
  prompt: "who mentioned them",
  suggest: ["Any updates?", "What needs me today?"],
} as const satisfies Topic;

// The rule for names lives in domain/names.ts, shared with routing (W-D4)
export { namesPerson } from "../names";
