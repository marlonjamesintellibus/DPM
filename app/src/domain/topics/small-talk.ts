// Section 18, CQ12 and CQ13: a greeting, thanks or ok with nothing else in the message. The rule matches
// the whole message only, so "Morning! Finished #145." is an update. There are no facts, so Atlas has
// nothing to word: DPM's reply stands.
import type { Topic } from "./topic";

const GREETINGS = ["hi", "hello", "hey", "hiya", "yo", "good morning", "good afternoon", "good evening", "morning", "afternoon", "evening", "wha gwaan", "wah gwaan"];
const THANKS = ["thanks", "thank you", "thanks a lot", "thank you so much", "thx", "ty", "cheers", "ok", "okay", "k", "cool", "great", "nice", "perfect", "got it", "sounds good", "noted"];

/** A greeting gets the hello; anything else small (thanks, ok) gets "Any time." */
export const GREETING = new RegExp(`^(${GREETINGS.join("|")})\\b`);

export const smallTalk = {
  id: "small_talk",
  // One or more of the words, each maybe followed by "Atlas", apart by a space or punctuation ("hithanks"
  // is no word), and nothing else
  rule: new RegExp(`^(?:(?:${[...GREETINGS, ...THANKS].join("|")})(?:[\\s,]+atlas)?(?:[\\s,!.?:)]+|$))+$`),
  prompt: "only a greeting, thanks or ok, with nothing else said or asked",
  suggest: ["What am I working on?", "What needs me today?"],
  worded: false,
} as const satisfies Topic;
