// The answer for each topic in domain/topics (sections 15 to 18). Keyed by topic, so a topic without an
// answer does not build.
import type { QuestionTopic } from "../../domain/question";
import { blocked } from "./blocked";
import { due } from "./due";
import { mentions } from "./mentions";
import { myWork } from "./my-work";
import { needsMe } from "./needs-me";
import { other } from "./other";
import { standing } from "./project-status";
import type { AnswerBuilder } from "./shared";
import { smallTalk } from "./small-talk";
import { unclear } from "./unclear";
import { updates } from "./updates";

export const ANSWERS: Record<QuestionTopic, AnswerBuilder> = {
  needs_me: needsMe,
  my_work: myWork,
  due,
  blocked,
  project_status: standing,
  updates,
  mentions,
  small_talk: smallTalk,
  other,
  unclear,
};
