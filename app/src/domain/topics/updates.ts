// Section 18: what changed on the asker's projects since they last asked (CQ4 to CQ7, CQ16).
import type { Topic } from "./topic";

export const updates = {
  id: "updates",
  // QA1: never what waits for them ("What updates need my review?" is needs me, which the rule tries after)
  // Phase R: "Wha gwaan wid Forager?" (alone it is small talk, which the rule tries first), "Anyting new?"
  rule: /^(?!.*\b(need|needs|needed|review|reviews|approve|waiting for me|inbox|mi fi|mi haffi|wait pon mi)\b).*\b(updates|any update|anything new|what's new|whats new|what is new|what changed|what's changed|what has changed|news|catch me up|anyting new|wah new|wha new|wah change|wha change|(?:gwaan|gwan|a gwaan|a gwan|happen|appen) (?:wid|with|pon)|wah a gwaan|wha a gwaan)\b/,
  prompt: "what is new or changed since they last asked",
  suggest: ["Who has mentioned me?", "What needs me today?"],
} as const satisfies Topic;
