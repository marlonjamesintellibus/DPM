// Conversational plan, phase N: who on the asker's projects has not sent an update today (LD1 to LD3,
// LD5, LD6, LD9, LD10). Only where the asker is a PM or Lead, checked per project when it is answered;
// names only, never what anyone said. Today only (CD16).
import type { Topic } from "./topic";

export const notUpdated = {
  id: "not_updated",
  // "Who hasn't updated today?", "Who hasn't sent an update?", "Has everyone updated?", "Who's missing an
  // update?". Phase R: "A who nuh update yet?", "Who nuh sen dem update?". Never about a record: "Who
  // hasn't updated #151?", "Is #151 not updated?" and "Who didn't update the forecast?" are not
  rule: /^(?!.*#\d)(?:.*\b(?:who|anyone|anybody|somebody|someone)\s+(?:hasn't|hasnt|has not|haven't|havent|have not|didn't|didnt|did not|nuh|no)\s+(?:sent |sen |posted |given |done )?(?:(?:an|their|dem|a|any|his|her|today's)\s+)?(?:update|updated|updates)\b(?!\s+(?:the|di|it|that|its|this)\b(?!\s+(?:week|morning|month)\b))|.*\b(?:has|have|did)\s+(?:everyone|everybody|the team|all of them|unu)\s+(?:sent (?:an |their )?|sen (?:dem )?)?(?:update|updated|updates)\b|.*\bwho(?:'s| is| are)\s+missing\s+(?:an |their |today's )?updates?\b|.*\bmissing updates?\b|.*\b(?:who|who's|anyone|anybody|someone|everyone|people)\b.*\bnot (?:yet )?updated\b|.*\bno update (?:yet|today)\b|.*\ba who nuh (?:update|sen)\b)/,
  prompt: "who on their projects has not sent an update today (for a PM or Lead)",
  suggest: ["What needs a decision from me?", "What's at risk this week?"],
} as const satisfies Topic;

// LD10: a day the words ask about. Only today has an answer (CD16): DPM keeps no history of who missed
// which day. "So far" and "yet" say no day of their own: "Who hasn't updated so far today?" is today
const TODAY = /\b(?:today|tiday|tideh|this morning)\b/g;
const OTHER_DAY =
  /\b(?:yesterday|yestiday|yestideh|last week|this week|dis week|last month|all week|every day|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?)\b/;
/** A stretch of days, unless the same words say today. */
const HISTORY = /\b(?:lately|ever)\b/;
const SAYS_DAY = new RegExp(`${TODAY.source}|${OTHER_DAY.source}|${HISTORY.source}`);

/**
 * LD10: whether the newest words that say a day ask about one other than today ("And last week?", "Who
 * missed Monday?"). A follow-up that says no day reads the question it follows (CV8). `weekday` is
 * today's, so "Who hasn't updated this Tuesday?" on a Tuesday is today.
 */
export function asksAnotherDay(words: readonly string[], weekday: string): boolean {
  const said = words.map((w) => w.toLowerCase()).find((w) => SAYS_DAY.test(w));
  if (!said) return false;
  const rest = said.replace(TODAY, " ").replace(new RegExp(`\\b(?:this |on )?${weekday.toLowerCase()}\\b`, "g"), " ");
  return OTHER_DAY.test(rest) || (rest === said && HISTORY.test(rest));
}
