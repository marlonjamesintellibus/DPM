// A follow-up with nothing before it to follow (section 16, CV9): no data, only how to ask.
import type { AnswerBuilder } from "./shared";

export const unclear: AnswerBuilder = async () => ({ text: "I'm not sure what you mean. Ask the whole question, for example: What's blocked on Forager?", cards: [], more: null });
