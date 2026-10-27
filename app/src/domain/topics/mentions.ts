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

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * CQ9 (decision CD29): whether these words name the person. Their full name always counts, in any case;
 * their first name, written as a name (capitalised), counts only where no other member of that project
 * shares it.
 */
export function namesPerson(quote: string, name: string, firstNameShared: boolean): boolean {
  if (new RegExp(`\\b${escaped(name)}\\b`, "i").test(quote)) return true;
  const first = name.split(" ")[0];
  return !firstNameShared && first !== name && new RegExp(`\\b${escaped(first)}\\b`).test(quote);
}
