// Section 15: how a project stands, or how all of the asker's projects stand. Section 18: "Tell me about
// Forager" lands here too, and one named project gets its next milestone, its live blockers and risks,
// and what needs the asker on it.
import type { Topic } from "./topic";

export const projectStatus = {
  id: "project_status",
  // Phase R: "How Forager a go?", "Forager pon track?", "Tell mi bout GQ"
  rule: /\b(on track|pon track|at risk|off track|status|how is|how's|how are|tell me about|tell mi (?:bout|about)|how tings)\b|\bhow (?:\S+ ){1,4}a (?:go|gwaan|gwan)\s*\??$/,
  prompt: "how a project stands",
  suggest: ["What's blocked?", "What's due this week?"],
} as const satisfies Topic;
