// Section 15: what is blocked or stuck on the asker's projects.
import type { Topic } from "./topic";

export const blocked = {
  id: "blocked",
  // Phase R: "Wah a hold up di feed?", "Wah wi a wait pon?"; what waits on the asker is needs me
  rule: /\b(block|blocked|blocker|blockers|stuck|waiting on|hold(?:ing)? up|wait(?:ing)? pon(?! mi\b))\b/,
  prompt: "what is blocked or stuck",
  suggest: ["What needs me today?"],
} as const satisfies Topic;
