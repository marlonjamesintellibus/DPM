// Conversational plan, phase N: what waits for the asker's decision, oldest first: proposals on the BRAID
// log, kind change requests, statuses they set and Asks to them as an owner (M37). Anyone asks; each sees
// only their own (LD8: a decision with several approvers is listed for each until one decides, S11).
import type { Topic } from "./topic";

export const myDecisions = {
  id: "my_decisions",
  // "What needs a decision from me?", "What's waiting on my approval?", "What do I need to decide?".
  // Phase R: "Wah mi haffi decide?". Not "What needs me today?" or "What do I need to approve?" (needs me:
  // what they need to do, review or approve), which the rule tries after
  rule: /\b(?:decisions?|decide|deciding)\b.*\b(?:from me|on me|for me|by me|pon mi|fi mi)\b|\b(?:my|mi)\s+(?:decisions?|approvals?|sign[- ]?offs?)\b|\b(?:i|mi)\s+(?:need to|have to|must|should|haffi|affi|fi)\s+decide\b|\b(?:waiting|wait)\s+(?:on|for|pon)\s+(?:me|mi)\s+to\s+decide\b/,
  prompt: "what waits for their decision: proposals, kind changes, statuses they set and asks to them",
  suggest: ["What's at risk this week?", "What needs me today?"],
} as const satisfies Topic;
