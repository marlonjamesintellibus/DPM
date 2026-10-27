// Section 15, QA5: anything DPM cannot answer yet, and any topic it does not know. The prompt ends its
// topic list with it ("or other").
import type { Topic } from "./topic";

export const other = {
  id: "other",
  rule: null,
  prompt: null,
  // Section 18: the asks people try first
  suggest: ["What am I working on?", "What needs me today?"],
} as const satisfies Topic;
