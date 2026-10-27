// Section 15, QA5: anything DPM cannot answer yet, and any topic it does not know. The prompt ends its
// topic list with it ("or other").
import type { Topic } from "./topic";

export const other = {
  id: "other",
  rule: null,
  prompt: null,
  suggest: ["What needs me today?", "What's blocked?"],
} as const satisfies Topic;
