// Phase J, M28 (conversational plan, section 12): "Start my standup" starts the person's standup in their
// own chat, as its button does. It is their own command, like "Undo that", so it counts only as the whole
// message; a longer message that mentions a standup is read as usual. DPM's reply says whether it started,
// and the questions follow under it: there are no facts for Atlas to word.
import type { Topic } from "./topic";

export const standup = {
  id: "standup",
  // Phase R: "Mek wi do di standup" too
  rule: /^(?:(?:please|pls|atlas|ok|okay|hi|hey|morning)[\s,]+)?(?:(?:can we |let'?s |lets |mek wi |make we )?(?:start|do|run|begin)(?: (?:my|the|our|di|mi))? stand-?up|stand-?up(?: time)?)(?: (?:now|please|pls|atlas))?[\s.!?]*$/,
  prompt: "only \"Start my standup\" or \"Let's do my standup\": start their standup in this chat, with nothing else said",
  suggest: [],
  worded: false,
} as const satisfies Topic;
