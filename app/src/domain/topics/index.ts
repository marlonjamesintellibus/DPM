// Every question topic DPM answers (machines doc, sections 15 to 18). The checks, the rule, the prompt
// and the chat's suggestions all read these lists; queries/answers has an answer for each.
import { atRiskWeek } from "./at-risk-week";
import { blocked } from "./blocked";
import { correction } from "./correction";
import { due } from "./due";
import { mentions } from "./mentions";
import { myDecisions } from "./my-decisions";
import { myWork } from "./my-work";
import { needsMe } from "./needs-me";
import { notUpdated } from "./not-updated";
import { other } from "./other";
import { people } from "./people";
import { portfolio } from "./portfolio";
import { projectStatus } from "./project-status";
import { smallTalk } from "./small-talk";
import { standup } from "./standup";
import type { Topic } from "./topic";
import { unclear } from "./unclear";
import { undo } from "./undo";
import { updates } from "./updates";
import { why } from "./why";
import { whyFiled } from "./why-filed";
import { whoFree } from "./who-free";

/** In the order Atlas is shown them: the tool's topic enum and the prompt's topic list. */
export const TOPICS = [needsMe, myWork, due, blocked, projectStatus, updates, mentions, people, whoFree, notUpdated, myDecisions, atRiskWeek, portfolio, why, whyFiled, correction, undo, standup, smallTalk, other, unclear] as const;

/**
 * In the order the rule tries their words; the first that matches wins ("anything blocked today?" is
 * blocked). Small talk matches only a whole message, so it never takes a question's words. Section 18:
 * the new topics go before needs me, whose "today" would take "What's due today?" and "Any updates today?";
 * updates leaves to needs me what asks for their review or OK (QA1). Phase L: why_filed goes first, so "Why did
 * you file the blocker?" is not blocked, nor a why about the work. Phase C: why goes next, so "Why is Forager at
 * risk?" is not how it stands and "What's holding up #151?" is not blocked. Undo and corrections are
 * whole-message commands, read by ruleQuestion, and so is phase J's "Start my standup". Phase H: people goes
 * before blocked and my_work, so "Who owns the feed blocker?" and "What is Kemar working on?" are about a person;
 * after mentions, so "Who has mentioned me?" stays the asker's own. Phase N: its topics go after mentions too;
 * not_updated and my_decisions before updates and needs me, whose "updates" and "need" would take them;
 * who_free before people; portfolio before at_risk_week, so "Which projects are at risk?" lists the projects,
 * and both before project_status, whose "at risk" and "off track" would take them.
 */
export const BY_RULE = [smallTalk, whyFiled, why, mentions, notUpdated, myDecisions, whoFree, people, portfolio, atRiskWeek, blocked, due, updates, myWork, projectStatus, needsMe] as const;

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
