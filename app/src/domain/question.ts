// Questions asked in the update chat (machines doc, section 15). When Atlas reads a message it also
// says whether the message asks something: the words asked, a topic, and a project if one is named.
// What Atlas says is untrusted, like a proposal: checkQuestion keeps only a known topic, a project the
// asker is in, and words that are in the message. The answer itself is never written by Atlas; it is
// read from the asker's own data (queries/answer.ts).
import { namesProject, numbersOf } from "./atlas-checks/checks";
import { draftKindOf, type DraftKind } from "./drafts";
import type { CheckContext, EarlierTurn } from "./atlas-checks/types";
import type { CommandSubject, LineAction } from "./machines/chat-command";
import { BY_RULE, QUESTION_TOPICS, type QuestionTopic } from "./topics";
import { checkCorrection, ruleCorrection, type Correction, type RawCorrection } from "./topics/correction";
import { aboutAsker, aboutOther, aboutProject } from "./topics/people";
import { GREETING, smallTalk } from "./topics/small-talk";
import { subjectById, subjectIn, type WhySubject } from "./topics/why";
import { standup } from "./topics/standup";
import { undo } from "./topics/undo";

// Each topic is defined in domain/topics, its answer in queries/answers
export { QUESTION_TOPICS, type QuestionTopic };

/** What Atlas said was asked, before the checks. Phase C: subjectId, what a why question is about. */
export type RawQuestion = { asked: string; topic: string; projectId: string | null; subjectId?: string | null; correction?: RawCorrection | null };

/** A question that passed the checks: safe to answer from the asker's data. */
export type AskedQuestion = {
  asked: string;
  topic: QuestionTopic;
  projectId: string | null;
  /** CV8, CQ14: the words of the earlier questions a follow-up follows, newest first, the asker's own. */
  follows?: string[];
  /** Phase C: what a why question is about, in a project the asker can read (WY1); only on topic why. */
  subject?: WhySubject;
  /** Phase L, M31: what a correction proposes, after the checks; missing when nothing in it could be checked. */
  correction?: Correction;
  /** Phase L: what the asker's command made while their message was read (the undo job of "Undo that"). */
  made?: string[];
  /** Phase G: which draft a whole-message request asks for, read from the words by DPM (draftKindOf). */
  draft?: DraftKind;
};

/**
 * QA3, QA6: only the asker's own projects; QA5: an unknown topic is "other"; the words must be theirs.
 * CQ13: small talk only when the whole message is, so a greeting with an update is the update alone.
 */
export function checkQuestion(
  raw: RawQuestion | null | undefined,
  ctx: Pick<CheckContext, "text" | "projects" | "earlier"> & Partial<Pick<CheckContext, "author">>,
): AskedQuestion | null {
  if (!raw) return null;
  // Phase G: a whole message that asks for a draft is that request, whatever topic Atlas read, and the words
  // say which draft; Atlas saying draft for anything else is dropped, as for "Start my standup"
  const kind = draftKindOf(ctx.text);
  if (raw.topic === "draft" && !kind) return null;
  if (kind) {
    const asked = ctx.text.trim();
    const named = raw.projectId && ctx.projects.some((p) => p.id === raw.projectId) ? raw.projectId : (namedProject(asked, ctx.projects)?.id ?? null);
    return { asked, topic: "draft", projectId: named, draft: kind };
  }
  const said = (QUESTION_TOPICS as readonly string[]).includes(raw.topic) ? (raw.topic as QuestionTopic) : "other";
  if (said === "small_talk" && !smallTalk.rule.test(ctx.text.trim().toLowerCase())) return null;
  // Phase L: "Undo that" is the asker's command only as the whole message, whatever Atlas read
  if (said === "undo" && !undo.rule.test(ctx.text.trim().toLowerCase())) return null;
  // Phase J: and "Start my standup" is the person's own command too
  if (said === "standup" && !standup.rule.test(ctx.text.trim().toLowerCase())) return null;
  const named = raw.projectId && ctx.projects.some((p) => p.id === raw.projectId) ? raw.projectId : null;
  const asked = raw.asked.trim() && ctx.text.includes(raw.asked.trim()) ? raw.asked.trim() : ctx.text.trim();
  const { topic, projectId } = ctx.author ? aboutWhom(said, asked, named, ctx.author, ctx.projects) : { topic: said, projectId: named };
  const follows = followed(ctx.text, asked, topic, ctx.earlier ?? []);
  // Phase C, WY1: a subject outside the asker's lists is no subject, never a sign that it exists
  const subject = topic === "why" ? subjectById(raw.subjectId, ctx.projects) : null;
  const correction = topic === "correction" ? checkCorrection(raw.correction, ctx) : null;
  return { asked, topic, projectId, ...(follows.length ? { follows } : {}), ...(subject ? { subject } : {}), ...(correction ? { correction } : {}) };
}

/**
 * Phase H: who the words are about decides between the asker's work and someone else's, whatever Atlas
 * read. PP4: Kemar asking "What is Kemar working on?" asks about his own work, and Alicia asking it asks
 * about his, never hers. "What is Forager doing?" asks how that project stands, not about a person.
 */
function aboutWhom(
  said: QuestionTopic,
  asked: string,
  projectId: string | null,
  author: CheckContext["author"],
  projects: CheckContext["projects"],
): { topic: QuestionTopic; projectId: string | null } {
  if (said === "my_work" && aboutOther(asked, author, projects)) return { topic: "people", projectId };
  if (said !== "people") return { topic: said, projectId };
  if (aboutAsker(asked, author, projects)) return { topic: "my_work", projectId };
  const project = aboutProject(asked, author, projects);
  return project ? { topic: "project_status", projectId: projectId ?? project.id } : { topic: said, projectId };
}

/**
 * CV8: what a follow-up asks beyond following up and saying where, or null when the words are not a
 * follow-up. "and Jodian?" is "jodian" and "and the trend model?" is "the trend model"; "and on GQ?" is
 * "" (the question before it, on GQ). `places` are the names and aliases of the asker's projects.
 */
export function followUpRest(words: string, places: readonly string[]): string | null {
  const text = words.trim().toLowerCase().replace(/[‘’]/g, "'");
  const lead = FOLLOW_UP.exec(text);
  if (!lead) return null;
  let rest = text.slice(lead[0].length).replace(/[?.!]+$/, "");
  for (const place of places.map((p) => p.toLowerCase()).sort((a, b) => b.length - a.length)) {
    rest = rest.replace(new RegExp(`\\b(?:on|in|pon|for|at|with)\\s+${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "g"), " ");
  }
  return rest
    .replace(/\b(?:then|too|instead|now|there|only|just|please)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * CV8, CQ14: what a follow-up follows, for the answers that read the words as well as the topic ("and
 * on Store Insights?" after "When's the next milestone?" asks for milestones). A follow-up says so ("and
 * ...", "what about ...") or names no topic of its own, and has the topic of the question before it;
 * the run goes back while the questions keep that topic. Small talk and updates in between are skipped,
 * as the rule skips them.
 */
function followed(text: string, asked: string, topic: QuestionTopic, earlier: readonly EarlierTurn[]): string[] {
  if (topic === "other" || topic === "unclear" || topic === "undo" || topic === "standup" || topic === "draft" || topic === "correction" || (!FOLLOW_UP.test(text.trim()) && topicOf(asked) !== "other")) return [];
  const words: string[] = [];
  for (const turn of [...earlier].reverse()) {
    if (!turn.asked || turn.asked.topic === "small_talk") continue;
    if (turn.asked.topic !== topic) break;
    words.push(turn.text);
  }
  return words;
}

// Phase R: "wah bout GQ?" and "how bout Forager?" follow up too
const FOLLOW_UP = /^(and|what about|how about|wah bout|wha bout|wat bout|what bout|how bout)\b/i;
// Section 18: "Tell me about Forager" asks too, and phase Q's "Explain Store Insights". Phase R, JA5, JA6: so do the team's question words ("Weh
// mi fi do today?", "Wah due dis week?", "A who a hold up di feed?", "Anyting block?"), so "Mi done wid
// #208" and "Di access nuh come yet" stay updates.
const ASKING =
  /^(what|what's|whats|which|who|whom|whose|when|where|why|how|is|are|am|was|were|do|does|did|has|have|any|anything|should|shall|will|would|could|can|tell me|explain|wah|wha|a weh|weh mi fi|a wah|a wha|a who|a wen|anyting|tell mi)\b/i;
// Phase R: "wen", "weh", "wey", "anybody" and "unu" are not in the list. They start statements as often as
// questions ("Wen Kyle sen di access mi wi start #151", "Weh mi lef off yesterday, mi pick it back up today",
// "Anybody can take #152", "Unu fi check #151"), so they ask only with a "?" like any other message. A Patois
// yes or no question is shaped like a statement ("Unu have anyting fi mi"); without the "?" the model reads it.
// Phase R, CQ13: a greeting does not make what follows it a question, with or without a comma ("Wha gwaan
// everybody, mi done wid #208." and "Wha gwaan mi done wid #208" are updates). "Wha gwaan wid GQ" asks.
const GREETED = new RegExp(
  String.raw`${GREETING.source}(?:\s+(?:atlas|everybody|everyone|all|team|unu|people))?(?:\s*[,!.]\s*|\s+(?!\s|(?:wid|with|pon)\b))`,
  "i",
);
// QA4: "Can you mark #145 done?" asks for a change, so it is an update, not a question
// Phase C: a question that starts with why asks about a change ("Why did Alicia set Forager to Off track?"), never for one
const ASKS_FOR_A_CHANGE = /^(?!(?:why|how come|wha mek|wah mek|wa mek)\b).*\b(mark|set|move|change|update|add|log|close|resolve|approve|assign)\b.*\b(#\d+|done|blocked|to\b)/i;

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
  // Phase L: "Undo that" and a correction are whole-message commands; phase J: so is "Start my standup"
  if (undo.rule.test(text.toLowerCase())) return { asked: text, topic: "undo", projectId: null };
  if (standup.rule.test(text.toLowerCase())) return { asked: text, topic: "standup", projectId: null };
  // Phase G: and so is "Draft my standup", whose words say which draft and for which project
  const kind = draftKindOf(text);
  if (kind) return { asked: text, topic: "draft", projectId: namedProject(text, ctx.projects)?.id ?? null, draft: kind };
  const correction = ruleCorrection(ctx);
  if (correction) return { asked: text, topic: "correction", projectId: correction.projectId, correction };
  // CV8, CV9: "and on Store Insights?" takes its topic from the question before it in this conversation
  if (FOLLOW_UP.test(text) && !ASKS_FOR_A_CHANGE.test(text) && (text.endsWith("?") || text.split(/\s+/).length <= 6) && !/[.!]\s/.test(text)) {
    // Section 18: small talk is no question to follow, so "Thanks!" in between changes nothing
    const before = [...(ctx.earlier ?? [])].reverse().find((t) => t.asked && t.asked.topic !== "small_talk")?.asked;
    const named = namedProject(text, ctx.projects);
    if (!before) return { asked: text, topic: "unclear", projectId: null };
    const topic = (QUESTION_TOPICS as readonly string[]).includes(before.topic) ? (before.topic as QuestionTopic) : "other";
    return withSubject({ asked: text, topic, projectId: named?.id ?? null }, ctx.projects);
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  if (sentences.length !== 1) return null;
  if (!(text.endsWith("?") || ASKING.test(text.replace(GREETED, ""))) || ASKS_FOR_A_CHANGE.test(text)) return null;
  return withSubject({ asked: text, topic: topicOf(text), projectId: namedProject(text, ctx.projects)?.id ?? null }, ctx.projects);
}

/** Phase C: a why question by the rule takes its subject from the words ("#151", "the trend model", "Forager"). */
function withSubject(q: AskedQuestion, projects: CheckContext["projects"]): AskedQuestion {
  if (q.topic !== "why") return q;
  const subject = subjectIn(q.asked, projects, q.projectId);
  return subject ? { ...q, subject } : q;
}

/**
 * JA7: the project whose name or alias the words say in the shape of a reference ("Mi a teach a class at
 * di academy" is a word, not GQ & Academy). A question with no capitals at all has no shape to read, so
 * there a name counts in any case (QA8: "how is forager doing").
 */
function namedProject(text: string, projects: CheckContext["projects"]) {
  const shaped = text !== text.toLowerCase();
  return projects.find((p) => [p.name, ...p.aliases].some((n) => namesProject(text, shaped ? n : n.toLowerCase(), numbersOf(p))));
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
  /** Phase B: the record the line is about, so a reply can refer to it ("the second one"). */
  subject?: CommandSubject;
  /** Phase B: what the asker may do on it now, as its screen offers it, with the version they saw (AC3, AC5). */
  actions?: LineAction[];
  /** Phase B: an update waiting for review opens it, as the chat's Review button does. */
  review?: { captureId: string };
  /**
   * Phase E, CM12: the asker's own live promise, with its buttons (the model's OwnerSays): Done, New date, Drop;
   * or, while CM11's question waits, It still stands and Drop. Checked when pressed (rule 4).
   */
  promise?: { id: string; mode: "check" | "stands"; dropFirst: boolean; today: string };
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
