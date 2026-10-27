// Section 18: what the asker is working on, their own open work (CQ1 to CQ3).
import type { Topic } from "./topic";

export const myWork = {
  id: "my_work",
  // Phase R: "Wah mi a work pon?", "Wah deh pon mi plate?", "fi mi work"
  rule: /\b(working on|my work|my tasks?|my plate|my items|my issues|assigned to me|on my list|work(?:ing)? pon|mi a (?:work|do)|mi (?:work|tasks?|plate|items|list)|fi mi (?:work|tasks?|items))\b/,
  prompt: "what they are working on: their own open work",
  suggest: ["What's due this week?", "What needs me today?"],
} as const satisfies Topic;
