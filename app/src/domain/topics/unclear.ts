// Section 16, CV9: a follow-up whose subject cannot be told, because nothing earlier in the
// conversation says it. The follow-up rule gives it, and the prompt has its own line for it.
import type { Topic } from "./topic";

export const unclear = {
  id: "unclear",
  rule: null,
  prompt: null,
  suggest: ["What needs me today?", "What's blocked?"],
} as const satisfies Topic;
