// Phase L, M30 (conversational plan, section 14): "Undo that" takes back the asker's last saved update.
// It is the asker's own command, like the Undo button on a saved message, so it counts only as the whole
// message ("Undo that", "Take it back please"); a longer message that says undo is read as an update. DPM
// reports what the undo job did in its own words: there are no facts for Atlas to word.
import type { Topic } from "./topic";

export const undo = {
  id: "undo",
  // Phase R: "Tek dat back" too
  rule: /^(?:(?:please|pls|atlas)[\s,]+)?(?:undo|take (?:that|it|this) back|tek (?:dat|it|dis) back|reverse (?:that|it|this))(?:\s+(?:that|it|this|dat|my last (?:update|save|message)|the last (?:update|save|message)))?(?:[\s,]+(?:please|pls|atlas))?[\s.!]*$/,
  prompt: "only \"Undo that\" or \"Take that back\": undo their last saved update, with nothing else said",
  suggest: ["What am I working on?", "What needs me today?"],
  worded: false,
} as const satisfies Topic;
