// Phase P (conversational plan, section 18): "Catch me up" after time away. The updates topic's facts from the
// start of their leave, with what was handed over and where each thing stands now (LV5 to LV7).
import type { Topic } from "./topic";

export const catchUp = {
  id: "catch_up",
  // "I'm back, what did I miss?", "Catch me up on Forager". Phase R: "Wah mi miss?"
  rule: /\b(catch me up|catch up on|what did i miss|what have i missed|what i missed|while i was (?:away|out|off)|since i was (?:away|out|off)|wah mi (?:did )?miss|wha mi (?:did )?miss)\b/,
  prompt: "catching up after time away: what changed since their leave began, and what was handed over",
  suggest: ["What needs me today?", "What am I working on?"],
} as const satisfies Topic;
