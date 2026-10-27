// Section 15: what is blocked or stuck on the asker's projects.
import type { Topic } from "./topic";

export const blocked = {
  id: "blocked",
  rule: /\b(block|blocked|blocker|blockers|stuck|waiting on)\b/,
  prompt: "what is blocked or stuck",
  suggest: ["What needs me today?"],
} as const satisfies Topic;
