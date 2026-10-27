// Conversational plan, phase A, "Added: the due topic": what is due in a window, and the next
// milestones by forecast (CQ17 to CQ19).
import type { Topic } from "./topic";

export const due = {
  id: "due",
  rule: /\b(due|deadlines?|next milestones?|milestones? left|upcoming milestones?)\b/,
  prompt: "what is due, or when the next milestone is",
  suggest: ["What am I working on?", "What's blocked?"],
} as const satisfies Topic;
