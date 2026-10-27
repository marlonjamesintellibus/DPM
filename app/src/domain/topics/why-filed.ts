// Phase L (conversational plan, section 14): "Why did you file that?" For the asker's own update items
// only: where each went and why (the routing reason and the deciding words), and for a BRAID item, the
// entry it matched. A read; someone else's item gets "I can only tell you about your own updates." (UN7)
import type { Topic } from "./topic";

export const whyFiled = {
  id: "why_filed",
  // "Why did you file that?", "Why did #151 go to Forager?", "Why was that put in Store Insights?"
  rule: /\bwhy\b.*\b(?:file|filed|filing|put|route|routed|log|logged|sen[dt]|(?:go|went|gone)\s+(?:to|in|into|on|under))\b/,
  prompt: "why Atlas filed their update or an item of it where it did (\"Why did you file that?\")",
  suggest: ["What am I working on?", "Any updates?"],
} as const satisfies Topic;
