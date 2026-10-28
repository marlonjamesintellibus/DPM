// Conversational plan, phase N: who on the asker's projects has not sent an update today (LD1 to LD3,
// LD5, LD6, LD9, LD10). Only where the asker is a PM or Lead, checked per project when it is answered;
// names only, never what anyone said. Today only (CD16).
import type { Topic } from "./topic";

export const notUpdated = {
  id: "not_updated",
  // "Who hasn't updated today?", "Who hasn't sent an update?", "Has everyone updated?", "Who's missing an
  // update?". Phase R: "A who nuh update yet?", "Who nuh sen dem update?"
  rule: /\b(?:who|anyone|anybody|somebody|someone)\s+(?:hasn't|hasnt|has not|haven't|havent|have not|didn't|didnt|did not|nuh|no)\s+(?:sent |sen |posted |given |done )?(?:(?:an|their|dem|a|any|his|her|today's)\s+)?(?:update|updated|updates)\b|\b(?:has|have|did)\s+(?:everyone|everybody|the team|all of them|unu)\s+(?:sent (?:an |their )?|sen (?:dem )?)?(?:update|updated|updates)\b|\bwho(?:'s| is| are)\s+missing\s+(?:an |their |today's )?updates?\b|\bmissing updates?\b|\bnot (?:yet )?updated\b|\bno update (?:yet|today)\b|\ba who nuh (?:update|sen)\b/,
  prompt: "who on their projects has not sent an update today (for a PM or Lead)",
  suggest: ["What needs a decision from me?", "What's at risk this week?"],
} as const satisfies Topic;

// LD10: a day the words ask about. Only today has an answer (CD16): DPM keeps no history of who missed
// which day
const SAYS_DAY =
  /\b(?:today|tiday|tideh|this morning|yesterday|yestiday|yestideh|last week|this week|dis week|last month|lately|so far|all week|every day|ever|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?)\b/;
const TODAY = /\b(?:today|tiday|tideh|this morning)\b/g;

/**
 * LD10: whether the newest words that say a day ask about one other than today ("And last week?", "Who
 * missed Monday?"). A follow-up that says no day reads the question it follows (CV8). `weekday` is
 * today's, so "Who hasn't updated this Tuesday?" on a Tuesday is today.
 */
export function asksAnotherDay(words: readonly string[], weekday: string): boolean {
  const said = words.map((w) => w.toLowerCase()).find((w) => SAYS_DAY.test(w));
  if (!said) return false;
  const rest = said.replace(TODAY, " ").replace(new RegExp(`\\b(?:this |on )?${weekday.toLowerCase()}\\b`, "g"), " ");
  return SAYS_DAY.test(rest);
}
