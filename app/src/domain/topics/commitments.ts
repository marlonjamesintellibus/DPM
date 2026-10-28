// Phase E, CM12 (conversational plan, section 7): "What did I promise?" The asker's own open and due
// commitments (M22), and nobody else's: a commitment is private to its owner (CD3).
import type { Topic } from "./topic";

export const commitments = {
  id: "commitments",
  // Phase R: "Wah mi did promise?", "Wah mi seh mi wi do?"
  rule: /\b(what (?:did|have) i promised?|my promises|i promised|my commitments?|what i promised|what (?:did|have) i (?:say|said) i'?d do|wah mi (?:did )?promise|wah mi seh mi (?:wi|a go|ago) do)\b/,
  prompt: "what they promised to do: their own open and due commitments",
  suggest: ["What's due this week?", "What am I working on?"],
} as const satisfies Topic;
