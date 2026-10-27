// Phase L (conversational plan, section 14): "Why did you file that?" For the asker's own update items
// only: where each went and why (the routing reason and the deciding words), and for a BRAID item, the
// entry it matched. A read; someone else's item gets "I can only tell you about your own updates." (UN7)
import type { Topic } from "./topic";

export const whyFiled = {
  id: "why_filed",
  // "Why did you file that?", "Why did #151 go to Forager?", "Why was that put in Store Insights?". Only
  // when Atlas did the filing ("you") or it is about what they said ("that", "#151", "my blocker"): "Why
  // did Forager go to at risk?" or "Why was the launch put on hold?" are why questions about the work (phase C)
  rule: /\bwhy\s+(?:did|was|were|has|have|is|are|'d)?\s*(?:you\b.*\b(?:file|filed|put|route|routed|log|logged|send|sent)\b|(?:that|this|it|those|these|#\d+|my\s+(?:\w+\s+)?(?:update|item|items|blocker|risk|issue|decision|note|message))\s+(?:get\s+|been\s+)?(?:filed|put|routed|logged|sent|go|went|gone|end(?:ed)?\s+up)\b)/,
  prompt: "why Atlas filed their update or an item of it where it did (\"Why did you file that?\")",
  suggest: ["What am I working on?", "Any updates?"],
} as const satisfies Topic;
