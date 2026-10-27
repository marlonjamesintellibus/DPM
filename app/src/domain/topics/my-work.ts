// Section 18: what the asker is working on, their own open work (CQ1 to CQ3).
import type { Topic } from "./topic";

export const myWork = {
  id: "my_work",
  rule: /\b(working on|my work|my tasks?|my plate|my items|my issues|assigned to me|on my list)\b/,
  prompt: "what they are working on: their own open work",
  suggest: ["What's due this week?", "What needs me today?"],
} as const satisfies Topic;
