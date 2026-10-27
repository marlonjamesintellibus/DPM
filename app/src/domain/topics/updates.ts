// Section 18: what changed on the asker's projects since they last asked (CQ4 to CQ7, CQ16).
import type { Topic } from "./topic";

export const updates = {
  id: "updates",
  rule: /\b(updates|any update|anything new|what's new|whats new|what is new|what changed|what's changed|what has changed|news|catch me up)\b/,
  prompt: "what is new or changed since they last asked",
  suggest: ["Who has mentioned me?", "What needs me today?"],
} as const satisfies Topic;
