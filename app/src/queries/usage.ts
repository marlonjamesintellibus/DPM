// Phase S numbers for the team building DPM (conversational plan, section 21): per week and per topic,
// how often Atlas answered, could not answer, got a thumbs up or down, and how often an update was
// corrected or moved in review. Counts come from the answers, feedback and reviews themselves, so they
// hold for everyone, "Help improve Atlas" or not, and carry no one's words (LF1). A number from fewer
// than config.metricMinimumCount people is not shown at all (LF8, CD28). DPM maintainers read these
// and the candidate list; an org's executives would read their own org's counts only (LF7, CD21). There
// is no maintainer role or screen yet: `pnpm atlas:usage` prints them.
import { and, eq, gte, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { addDays, dateInZone, DAY_MS, weekday, WEEKDAYS, type IsoDate } from "../domain/dates";
import type { EvalCandidateDetail, EvalCause } from "../domain/machines/eval-candidate";
import { QUESTION_TOPICS } from "../domain/topics";

/** The Monday of the week an instant falls in, in the org time zone. */
export function weekOf(at: Date): IsoDate {
  const day = dateInZone(at, config.timeZone);
  return addDays(day, -((WEEKDAYS.indexOf(weekday(day)) + 6) % 7));
}

/** LF8: a number with the count of people behind it, or nothing when they are too few to hide among. */
export type Shown<T> = ({ shown: true; people: number } & T) | { shown: false };

function shown<T extends object>(people: ReadonlySet<string>, numbers: T): Shown<T> {
  return people.size >= config.metricMinimumCount ? { shown: true, people: people.size, ...numbers } : { shown: false };
}

const rate = (n: number, of: number) => (of ? n / of : 0);

export type AnswerNumbers = {
  asked: number;
  /** Answered from DPM's facts: neither "I can't answer that yet" nor "I'm not sure what you mean". */
  answerRate: number;
  /** "I can't answer that yet" (topic other). */
  cantAnswerRate: number;
  /** "I'm not sure what you mean" (topic unclear). */
  unclearRate: number;
  thumbsUp: number;
  thumbsDown: number;
};
export type TopicNumbers = { asked: number; thumbsUp: number; thumbsDown: number };
export type UpdateNumbers = {
  /** Messages that gave at least one item. */
  updates: number;
  items: number;
  /** Section 16: "Actually it was #146, not #145". */
  corrections: number;
  /** Items the author moved to another project in review. */
  moved: number;
};

export type UsageWeek = {
  /** The Monday it starts. */
  week: IsoDate;
  answers: Shown<AnswerNumbers>;
  topics: { topic: string; numbers: Shown<TopicNumbers> }[];
  updates: Shown<UpdateNumbers>;
};

/** LF7: an org's people are the members of its groups; outside contacts are in none of them. */
async function orgPeople(conn: Conn, orgId: string): Promise<Set<string>> {
  const rows = await conn
    .select({ personId: t.groupMembers.personId })
    .from(t.groupMembers)
    .innerJoin(t.groups, eq(t.groups.id, t.groupMembers.groupId))
    .where(eq(t.groups.orgId, orgId));
  return new Set(rows.map((r) => r.personId));
}

/**
 * The last `weeks` weeks, oldest first, the current one last. Feedback counts in the week of the answer
 * it is about, however late it was given (LF6); a move counts in the week of the update it moved.
 */
export async function usageNumbers(conn: Conn, { now, weeks = 4, orgId }: { now: Date; weeks?: number; orgId?: string }): Promise<UsageWeek[]> {
  const first = addDays(weekOf(now), -7 * (weeks - 1));
  const since = new Date(now.getTime() - (weeks + 1) * 7 * DAY_MS);
  const within = orgId ? await orgPeople(conn, orgId) : null;
  const counted = (personId: string) => !within || within.has(personId);

  const captures = (
    await conn
      .select({ id: t.captures.id, authorId: t.captures.authorId, receivedAt: t.captures.receivedAt, question: t.captures.question, answer: t.captures.answer })
      .from(t.captures)
      .where(gte(t.captures.receivedAt, since))
  ).filter((c) => counted(c.authorId));
  const ids = captures.map((c) => c.id);
  const feedback = ids.length ? await conn.select().from(t.answerFeedback).where(inArray(t.answerFeedback.captureId, ids)) : [];
  const items = ids.length ? await conn.select({ id: t.extractions.id, captureId: t.extractions.captureId, draft: t.extractions.draft }).from(t.extractions).where(inArray(t.extractions.captureId, ids)) : [];
  const moves = items.length
    ? await conn
        .select({ extractionId: t.auditEntries.extractionId })
        .from(t.auditEntries)
        .where(and(eq(t.auditEntries.machine, "routing"), eq(t.auditEntries.action, "MOVE"), inArray(t.auditEntries.extractionId, items.map((i) => i.id))))
    : [];
  const movedIds = new Set(moves.map((m) => m.extractionId));

  const out: UsageWeek[] = [];
  for (let w = 0; w < weeks; w++) {
    const week = addDays(first, 7 * w);
    // LF6: an answer belongs to the week of its "as of"; an update to the week it came in
    const asked = captures.filter((c) => c.question && weekOf(c.answer ? new Date(c.answer.asOf) : c.receivedAt) === week);
    const thumbs = (of: typeof asked, rating: "up" | "down") => feedback.filter((f) => f.rating === rating && of.some((c) => c.id === f.captureId && c.authorId === f.personId)).length;
    const askers = (of: typeof asked) => new Set(of.map((c) => c.authorId));
    const topicOf = (c: (typeof asked)[number]) => c.question!.topic;
    const n = asked.length;
    const answers = shown(askers(asked), {
      asked: n,
      answerRate: rate(asked.filter((c) => topicOf(c) !== "other" && topicOf(c) !== "unclear").length, n),
      cantAnswerRate: rate(asked.filter((c) => topicOf(c) === "other").length, n),
      unclearRate: rate(asked.filter((c) => topicOf(c) === "unclear").length, n),
      thumbsUp: thumbs(asked, "up"),
      thumbsDown: thumbs(asked, "down"),
    });
    const topics = QUESTION_TOPICS.map((topic) => {
      const of = asked.filter((c) => topicOf(c) === topic);
      return { topic, numbers: shown(askers(of), { asked: of.length, thumbsUp: thumbs(of, "up"), thumbsDown: thumbs(of, "down") }) };
    });
    const sent = captures.filter((c) => weekOf(c.receivedAt) === week);
    const their = items.filter((i) => sent.some((c) => c.id === i.captureId));
    const updated = sent.filter((c) => their.some((i) => i.captureId === c.id));
    const updates = shown(new Set(updated.map((c) => c.authorId)), {
      updates: updated.length,
      items: their.length,
      corrections: their.filter((i) => !!i.draft.replaces).length,
      moved: their.filter((i) => movedIds.has(i.id)).length,
    });
    out.push({ week, answers, topics, updates });
  }
  return out;
}

// ---- The candidate list (M36), for DPM maintainers only ----

export type CandidateLine = { id: string; loggedAt: Date; detail: EvalCandidateDetail | null };
/** LF5: the same words for the same cause, grouped; the count is the signal for what to build. */
export type CandidateGroup = { cause: EvalCause; text: string; count: number; lines: CandidateLine[] };
export type AcceptedCase = { id: string; cause: EvalCause; caseText: string; expected: string };
export type CandidateList = {
  waiting: CandidateGroup[];
  accepted: AcceptedCase[];
  /** Every candidate by state and cause; no words, so no minimum (they are only ever the maintainers'). */
  counts: Record<string, Partial<Record<EvalCause, number>>>;
};

const sameWords = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");

/** Who said it is left out: a maintainer judges the words, not the person (M1). */
export async function evalCandidateList(conn: Conn): Promise<CandidateList> {
  const rows = await conn.select().from(t.evalCandidates).orderBy(t.evalCandidates.loggedAt);
  const groups = new Map<string, CandidateGroup>();
  for (const r of rows.filter((r) => r.state === "logged" && r.text)) {
    const key = `${r.cause}|${sameWords(r.text!)}`;
    const g = groups.get(key) ?? { cause: r.cause, text: r.text!, count: 0, lines: [] };
    g.count++;
    g.lines.push({ id: r.id, loggedAt: r.loggedAt!, detail: r.detail });
    groups.set(key, g);
  }
  const counts: CandidateList["counts"] = {};
  for (const r of rows) (counts[r.state] ??= {})[r.cause] = (counts[r.state]?.[r.cause] ?? 0) + 1;
  return {
    waiting: [...groups.values()].sort((a, b) => b.count - a.count || b.lines.at(-1)!.loggedAt.getTime() - a.lines.at(-1)!.loggedAt.getTime()),
    accepted: rows.filter((r) => r.state === "in_eval_set").map((r) => ({ id: r.id, cause: r.cause, caseText: r.caseText ?? "", expected: r.expected ?? "" })),
    counts,
  };
}
