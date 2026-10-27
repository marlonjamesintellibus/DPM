// Section 15, QA1: what the asker needs to do, review or approve.
import type { Topic } from "./topic";

export const needsMe = {
  id: "needs_me",
  // Phase R, JA6: "Weh mi fi do today?", "Wah mi haffi approve?", "Wah a wait pon mi?"
  rule: /\b(need|needs|needed|review|reviews|inbox|to do|todo|waiting for me|approve|my day|today|tiday|tideh|mi fi|mi haffi|mi affi|wait pon mi|waiting pon mi)\b/,
  prompt: "what they need to do, review or approve",
  suggest: ["What's blocked?", "How are my projects doing?"],
} as const satisfies Topic;
