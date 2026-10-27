// Every question topic DPM answers (machines doc, sections 15 to 18). The checks, the rule, the prompt
// and the chat's suggestions all read these lists; queries/answers has an answer for each.
import { blocked } from "./blocked";
import { due } from "./due";
import { mentions } from "./mentions";
import { myWork } from "./my-work";
import { needsMe } from "./needs-me";
import { other } from "./other";
import { projectStatus } from "./project-status";
import { smallTalk } from "./small-talk";
import type { Topic } from "./topic";
import { unclear } from "./unclear";
import { updates } from "./updates";

/** In the order Atlas is shown them: the tool's topic enum and the prompt's topic list. */
export const TOPICS = [needsMe, myWork, due, blocked, projectStatus, updates, mentions, smallTalk, other, unclear] as const;

/**
 * In the order the rule tries their words; the first that matches wins ("anything blocked today?" is
 * blocked). Small talk matches only a whole message, so it never takes a question's words. Section 18:
 * the new topics go before needs me, whose "today" would take "What's due today?" and "Any updates today?".
 */
export const BY_RULE = [smallTalk, mentions, blocked, due, updates, myWork, projectStatus, needsMe] as const;

export type QuestionTopic = (typeof TOPICS)[number]["id"];
export const QUESTION_TOPICS = TOPICS.map((t) => t.id) as readonly QuestionTopic[];

/** Section 17: the follow-ups under an answer; a topic DPM no longer knows gets other's. */
export function suggestionsAfter(topic: string): string[] {
  return [...topicById(topic).suggest];
}

/** A topic by its id; one DPM no longer knows is other. */
export function topicById(topic: string): Topic {
  return TOPICS.find((t) => t.id === topic) ?? other;
}
