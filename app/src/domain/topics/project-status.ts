// Section 15: how a project stands, or how all of the asker's projects stand. Section 18: "Tell me about
// Forager" lands here too, and one named project gets its next milestone, its live blockers and risks,
// and what needs the asker on it.
import type { Topic } from "./topic";

export const projectStatus = {
  id: "project_status",
  rule: /\b(on track|at risk|off track|status|how is|how's|how are|tell me about)\b/,
  prompt: "how a project stands",
  suggest: ["What's blocked?", "What's due this week?"],
} as const satisfies Topic;
