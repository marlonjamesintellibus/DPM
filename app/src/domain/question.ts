// Questions asked in the update chat (machines doc, section 15). When Atlas reads a message it also
// says whether the message asks something: the words asked, a topic, and a project if one is named.
// What Atlas says is untrusted, like a proposal: checkQuestion keeps only a known topic, a project the
// asker is in, and words that are in the message. The answer itself is never written by Atlas; it is
// read from the asker's own data (queries/answer.ts).
import type { CheckContext } from "./atlas-checks/types";
import { BY_RULE, QUESTION_TOPICS, type QuestionTopic } from "./topics";
import { smallTalk } from "./topics/small-talk";

// Each topic is defined in domain/topics, its answer in queries/answers
export { QUESTION_TOPICS, type QuestionTopic };

/** What Atlas said was asked, before the checks. */
export type RawQuestion = { asked: string; topic: string; projectId: string | null };

/** A question that passed the checks: safe to answer from the asker's data. */
export type AskedQuestion = { asked: string; topic: QuestionTopic; projectId: string | null };

/** QA3, QA6: only the asker's own projects; QA5: an unknown topic is "other"; the words must be theirs. */
export function checkQuestion(raw: RawQuestion | null | undefined, ctx: Pick<CheckContext, "text" | "projects">): AskedQuestion | null {
  if (!raw) return null;
  const topic = (QUESTION_TOPICS as readonly string[]).includes(raw.topic) ? (raw.topic as QuestionTopic) : "other";
  const projectId = raw.projectId && ctx.projects.some((p) => p.id === raw.projectId) ? raw.projectId : null;
  const asked = raw.asked.trim() && ctx.text.includes(raw.asked.trim()) ? raw.asked.trim() : ctx.text.trim();
  return { asked, topic, projectId };
}

const FOLLOW_UP = /^(and|what about|how about)\b/i;
// Section 18: "Tell me about Forager" asks too
const ASKING = /^(what|what's|whats|which|who|whom|whose|when|where|why|how|is|are|am|was|were|do|does|did|has|have|any|anything|should|shall|will|would|could|can|tell me)\b/i;
// QA4: "Can you mark #145 done?" asks for a change, so it is an update, not a question
const ASKS_FOR_A_CHANGE = /\b(mark|set|move|change|update|add|log|close|resolve|approve|assign)\b.*\b(#\d+|done|blocked|to\b)/i;

/** The topic a question is about, from its words: what the rule can tell without a model. */
export function topicOf(text: string): QuestionTopic {
  // A curly apostrophe, as phones type it, reads as a straight one: "what’s new" is "what's new"
  const t = text.toLowerCase().replace(/[‘’]/g, "'");
  return BY_RULE.find((topic) => topic.rule.test(t))?.id ?? "other";
}

/**
 * QA8: without a model, a message of one sentence that asks something is a question; anything else
 * is left to the model (and fails as not connected when there is none). Names a project only when its
 * name or alias is in the words.
 */
export function ruleQuestion(ctx: Pick<CheckContext, "text" | "projects" | "earlier">): AskedQuestion | null {
  const text = ctx.text.trim();
  // CQ12, CQ13: small talk is the whole message or nothing ("Morning! Finished #145." is an update)
  if (smallTalk.rule.test(text.toLowerCase())) return { asked: text, topic: "small_talk", projectId: null };
  // CV8, CV9: "and on Store Insights?" takes its topic from the question before it in this conversation
  if (FOLLOW_UP.test(text) && !ASKS_FOR_A_CHANGE.test(text) && (text.endsWith("?") || text.split(/\s+/).length <= 6) && !/[.!]\s/.test(text)) {
    // Section 18: small talk is no question to follow, so "Thanks!" in between changes nothing
    const before = [...(ctx.earlier ?? [])].reverse().find((t) => t.asked && t.asked.topic !== "small_talk")?.asked;
    const lower_ = text.toLowerCase();
    const named = ctx.projects.find((p) => [p.name, ...p.aliases].some((n) => n && lower_.includes(n.toLowerCase())));
    if (!before) return { asked: text, topic: "unclear", projectId: null };
    const topic = (QUESTION_TOPICS as readonly string[]).includes(before.topic) ? (before.topic as QuestionTopic) : "other";
    return { asked: text, topic, projectId: named?.id ?? null };
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  if (sentences.length !== 1) return null;
  if (!(text.endsWith("?") || ASKING.test(text)) || ASKS_FOR_A_CHANGE.test(text)) return null;
  const lower = text.toLowerCase();
  const project = ctx.projects.find((p) => [p.name, ...p.aliases].some((n) => n && lower.includes(n.toLowerCase())));
  return { asked: text, topic: topicOf(text), projectId: project?.id ?? null };
}

/**
 * One thing an answer is about, drawn from the asker's data, never from the model (section 17). An item
 * that needs their OK can be accepted from the card; every card opens what it is about.
 */
export type AnswerCard = {
  title: string;
  detail: string | null;
  /** A short label: "Needs your OK · Medium confidence", "Blocker", "At risk" */
  tag: string | null;
  href: string;
  accept?: { captureId: string; itemId: string };
};

/**
 * What DPM answered, kept with the message and shown "as of" the time it was given (P11, QA10).
 * text is DPM's own sentence (rules) or Atlas's wording of the same facts (atlas); pending while
 * Atlas writes it (section 17).
 */
export type Answer = {
  topic: QuestionTopic;
  text: string;
  wording: "pending" | "atlas" | "rules";
  cards: AnswerCard[];
  /** MF11: what did not fit, and where it is. */
  more: { label: string; href: string } | null;
  asOf: string;
  /** DPM's own sentence, kept when Atlas words it, so the facts it was checked against are on record. */
  rulesText?: string;
};
