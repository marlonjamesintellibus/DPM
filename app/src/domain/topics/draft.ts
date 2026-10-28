// Phase G, M25 (conversational plan, section 9): "Draft my standup", "Draft a client status for Forager" and
// "Draft the weekly summary for Forager" ask Atlas to write a draft from DPM's facts, shown as a card the person
// edits and copies. Like "Start my standup" it is the person's own command, so it counts only as the whole
// message, and which draft it is comes from the words (draftKindOf), never from Atlas. DPM's reply says what
// the draft holds or why there is none; the draft itself is the card, so there is nothing for Atlas to word.
import type { Topic } from "./topic";

export const draft = {
  id: "draft",
  // A first look only: draftKindOf reads the whole message and says which draft (domain/drafts.ts)
  rule: /^(?:(?:please|pls|atlas|ok|okay|hi|hey)[\s,]+)?(?:(?:can|could|would) you |pls |please )?(?:draft|write(?: up)?|prep(?:are)?|put together)\b/,
  prompt: 'only "Draft my standup", "Draft a client status for Forager" or "Draft the weekly summary for Forager": write a draft for them to edit and copy, with nothing else said',
  suggest: [],
  worded: false,
} as const satisfies Topic;
