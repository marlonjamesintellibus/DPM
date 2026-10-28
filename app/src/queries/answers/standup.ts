// Phase J, M28: what "Start my standup" did, in DPM's own words (the standup started while the message was
// read; its id is in question.made). The questions follow under the reply, with their buttons. A refusal says
// why: one is already going, or today's is done (SU10), or it was asked for outside their own chat.
import { standupToday } from "../standup";
import type { AnswerBuilder } from "./shared";

export const standup: AnswerBuilder = async (conn, viewerId, question, now) => {
  const today = await standupToday(conn, viewerId, now);
  const say = (text: string) => ({ text, cards: [], more: null });
  if (today && question.made?.includes(today.id)) return say("Let's do your standup. Tap an answer or type your own. Skip moves on, and That's all ends it.");
  if (today?.state === "asking") return say('Your standup is already going. Answer its question, or say "That\'s all" to end it.');
  if (today?.state === "composed" || today?.state === "abandoned") return say("You've done your standup today. You can still send me an update any time.");
  return say("I run your standup only in your own chat with me.");
};
