// The answer for each topic in domain/topics (sections 15 to 18). Keyed by topic, so a topic without an
// answer does not build.
import type { QuestionTopic } from "../../domain/question";
import { blocked } from "./blocked";
import { needsMe } from "./needs-me";
import { other } from "./other";
import { standing } from "./project-status";
import type { AnswerBuilder } from "./shared";
import { unclear } from "./unclear";

export const ANSWERS: Record<QuestionTopic, AnswerBuilder> = {
  needs_me: needsMe,
  blocked,
  project_status: standing,
  other,
  unclear,
};
