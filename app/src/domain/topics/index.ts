// Every question topic DPM answers (machines doc, sections 15 to 18). The checks, the rule, the prompt
// and the chat's suggestions all read these lists; queries/answers has an answer for each.
import { blocked } from "./blocked";
import { needsMe } from "./needs-me";
import { other } from "./other";
import { projectStatus } from "./project-status";
import { unclear } from "./unclear";

/** In the order Atlas is shown them: the tool's topic enum and the prompt's topic list. */
export const TOPICS = [needsMe, blocked, projectStatus, other, unclear] as const;

/** In the order the rule tries their words; the first that matches wins ("anything blocked today?" is blocked). */
export const BY_RULE = [blocked, projectStatus, needsMe] as const;

export type QuestionTopic = (typeof TOPICS)[number]["id"];
export const QUESTION_TOPICS = TOPICS.map((t) => t.id) as readonly QuestionTopic[];

/** Section 17: the follow-ups under an answer; a topic DPM no longer knows gets other's. */
export function suggestionsAfter(topic: string): string[] {
  return [...(TOPICS.find((t) => t.id === topic) ?? other).suggest];
}
