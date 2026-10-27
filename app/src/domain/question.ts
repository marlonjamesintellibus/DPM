// Questions asked in the update chat (machines doc, section 15). When Atlas reads a message it also
// says whether the message asks something: the words asked, a topic, and a project if one is named.
// What Atlas says is untrusted, like a proposal: checkQuestion keeps only a known topic, a project the
// asker is in, and words that are in the message. The answer itself is never written by Atlas; it is
// read from the asker's own data (queries/answer.ts).
import type { CheckContext } from "./atlas-checks/types";

export const QUESTION_TOPICS = ["needs_me", "blocked", "project_status", "other"] as const;
export type QuestionTopic = (typeof QUESTION_TOPICS)[number];

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

const ASKING = /^(what|what's|whats|which|who|whom|whose|when|where|why|how|is|are|am|was|were|do|does|did|has|have|any|anything|should|shall|will|would|could|can)\b/i;
// QA4: "Can you mark #145 done?" asks for a change, so it is an update, not a question
const ASKS_FOR_A_CHANGE = /\b(mark|set|move|change|update|add|log|close|resolve|approve|assign)\b.*\b(#\d+|done|blocked|to\b)/i;

/** The topic a question is about, from its words: what the rule can tell without a model. */
export function topicOf(text: string): QuestionTopic {
  const t = text.toLowerCase();
  if (/\b(block|blocked|blocker|blockers|stuck|waiting on)\b/.test(t)) return "blocked";
  if (/\b(on track|at risk|off track|status|how is|how's|how are)\b/.test(t)) return "project_status";
  if (/\b(need|needs|needed|review|reviews|inbox|to do|todo|waiting for me|approve|my day|today)\b/.test(t)) return "needs_me";
  return "other";
}

/**
 * QA8: without a model, a message of one sentence that asks something is a question; anything else
 * is left to the model (and fails as not connected when there is none). Names a project only when its
 * name or alias is in the words.
 */
export function ruleQuestion(ctx: Pick<CheckContext, "text" | "projects">): AskedQuestion | null {
  const text = ctx.text.trim();
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  if (sentences.length !== 1) return null;
  if (!(text.endsWith("?") || ASKING.test(text)) || ASKS_FOR_A_CHANGE.test(text)) return null;
  const lower = text.toLowerCase();
  const project = ctx.projects.find((p) => [p.name, ...p.aliases].some((n) => n && lower.includes(n.toLowerCase())));
  return { asked: text, topic: topicOf(text), projectId: project?.id ?? null };
}

/** What DPM answered, kept with the message and shown "as of" the time it was given (P11, QA10). */
export type Answer = { text: string; lines: { label: string; href: string }[]; asOf: string };
