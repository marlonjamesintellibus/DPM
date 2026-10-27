// Phase S numbers for the team building DPM (conversational plan, section 21): per week and per topic,
// how often Atlas answered, could not answer, got a thumbs up or down, and how often an update was
// corrected or moved in review. Counts come from the answers, feedback and reviews themselves, so they
// hold for everyone, "Help improve Atlas" or not, and carry no one's words (LF1). Numbers are always one
// org's, of its own people (LF7): there is no total across orgs to subtract an org's numbers from. DPM
// maintainers read every count, since they decide what to build (W-D3); an org's executives read their own
// org's counts only (CD21), where a number from fewer than config.metricMinimumCount people is not shown
// at all, and neither is one that the numbers shown beside it would give by subtraction (LF8, CD28). There
// is no maintainer role or screen yet: `pnpm atlas:usage` prints them.
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { addDays, dateInZone, DAY_MS, weekday, WEEKDAYS, type IsoDate } from "../domain/dates";
import { sameWords, type EvalCandidateDetail, type EvalCause } from "../domain/machines/eval-candidate";
import { QUESTION_TOPICS } from "../domain/topics";

/** The Monday of the week an instant falls in, in the org time zone. */
export function weekOf(at: Date): IsoDate {
  const day = dateInZone(at, config.timeZone);
  return addDays(day, -((WEEKDAYS.indexOf(weekday(day)) + 6) % 7));
}

/** LF8: a number with the count of people behind it, or nothing when they are too few to hide among. */
export type Shown<T> = ({ shown: true; people: number } & T) | { shown: false };

/** W-D3: who reads the numbers. A maintainer sees every count; an executive only counts from enough people (LF8). */
export type UsageView = "maintainer" | "executive";

/** The fewest people a number is shown for: any for a maintainer, config.metricMinimumCount for an executive. */
const minimumFor = (view: UsageView) => (view === "maintainer" ? 1 : config.metricMinimumCount);

function shown<T extends object>(people: ReadonlySet<string>, numbers: T, min: number): Shown<T> {
  return people.size >= min ? { shown: true, people: people.size, ...numbers } : { shown: false };
}

const rate = (n: number, of: number) => (of ? n / of : 0);

export type AnswerNumbers = {
  asked: number;
  /** Answered from DPM's facts: neither "I can't answer that yet" nor "I'm not sure what you mean". Null when either of those is not shown (LF8). */
  answerRate: number | null;
  /** "I can't answer that yet" (topic other); null when that topic is not shown on its own (LF8). */
  cantAnswerRate: number | null;
  /** "I'm not sure what you mean" (topic unclear); null when that topic is not shown on its own (LF8). */
  unclearRate: number | null;
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
  /** LF8: the topics not shown on their own, together; the week's total is the topics shown and this. */
  rest: Shown<TopicNumbers>;
  updates: Shown<UpdateNumbers>;
};

/** The orgs there are numbers for, one set each (LF7). */
export async function usageOrgs(conn: Conn): Promise<{ id: string; name: string }[]> {
  return conn.select({ id: t.orgs.id, name: t.orgs.name }).from(t.orgs).orderBy(t.orgs.name);
}

/**
 * LF7: an org's people are the members of its groups who hold a role in it. An outside contact has none
 * (Kyle at Sprouts IT), so they are not counted even once they are in one of its project groups (phase I).
 */
async function orgPeople(conn: Conn, orgId: string): Promise<Set<string>> {
  const rows = await conn
    .select({ personId: t.groupMembers.personId })
    .from(t.groupMembers)
    .innerJoin(t.groups, eq(t.groups.id, t.groupMembers.groupId))
    .innerJoin(t.people, eq(t.people.id, t.groupMembers.personId))
    .where(and(eq(t.groups.orgId, orgId), isNotNull(t.people.orgRole)));
  return new Set(rows.map((r) => r.personId));
}

/**
 * LF8: the topics shown on their own. A topic asked by fewer than the minimum is not; while the topics left
 * out come from fewer people together too, the smallest one shown joins them, so the week's total less the
 * topics shown never gives a number from fewer people. Topics nobody asked about are left out of both.
 */
export function topicsShown(askersOf: ReadonlyMap<string, ReadonlySet<string>>, min: number = config.metricMinimumCount): Set<string> {
  const asked = [...askersOf].filter(([, people]) => people.size > 0);
  const alone = new Set(asked.filter(([, people]) => people.size >= min).map(([topic]) => topic));
  const restPeople = () => new Set(asked.filter(([topic]) => !alone.has(topic)).flatMap(([, people]) => [...people])).size;
  while (alone.size && restPeople() > 0 && restPeople() < min) {
    alone.delete([...alone].sort((a, b) => askersOf.get(a)!.size - askersOf.get(b)!.size)[0]);
  }
  return alone;
}

/**
 * One org's last `weeks` weeks, oldest first, the current one last. Feedback counts in the week of the
 * answer it is about, however late it was given (LF6); a move counts in the week of the update it moved.
 */
export async function usageNumbers(
  conn: Conn,
  { now, weeks = 4, orgId, view }: { now: Date; weeks?: number; orgId: string; view: UsageView },
): Promise<UsageWeek[]> {
  const min = minimumFor(view);
  const first = addDays(weekOf(now), -7 * (weeks - 1));
  const since = new Date(now.getTime() - (weeks + 1) * 7 * DAY_MS);
  const within = await orgPeople(conn, orgId);

  const captures = (
    await conn
      .select({ id: t.captures.id, authorId: t.captures.authorId, receivedAt: t.captures.receivedAt, question: t.captures.question, answer: t.captures.answer })
      .from(t.captures)
      .where(gte(t.captures.receivedAt, since))
  ).filter((c) => within.has(c.authorId));
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
    type Asked = typeof asked;
    const thumbs = (of: Asked, rating: "up" | "down") => feedback.filter((f) => f.rating === rating && of.some((c) => c.id === f.captureId && c.authorId === f.personId)).length;
    const askers = (of: Asked) => new Set(of.map((c) => c.authorId));
    const numbersOf = (of: Asked): TopicNumbers => ({ asked: of.length, thumbsUp: thumbs(of, "up"), thumbsDown: thumbs(of, "down") });
    const on = (topic: string) => asked.filter((c) => c.question!.topic === topic);
    const askersOf = new Map<string, Set<string>>(QUESTION_TOPICS.map((topic) => [topic, askers(on(topic))]));
    const alone = topicsShown(askersOf, min);
    // LF8: a rate gives its topic's count, so it is shown only with that topic (or when nobody asked it)
    const known = (topic: string) => alone.has(topic) || askersOf.get(topic)!.size === 0;
    const n = asked.length;
    const cant = on("other").length;
    const unclear = on("unclear").length;
    const answers = shown(askers(asked), {
      asked: n,
      answerRate: known("other") && known("unclear") ? rate(n - cant - unclear, n) : null,
      cantAnswerRate: known("other") ? rate(cant, n) : null,
      unclearRate: known("unclear") ? rate(unclear, n) : null,
      thumbsUp: thumbs(asked, "up"),
      thumbsDown: thumbs(asked, "down"),
    }, min);
    const topics = QUESTION_TOPICS.map((topic) => ({ topic, numbers: alone.has(topic) ? shown(askersOf.get(topic)!, numbersOf(on(topic)), min) : ({ shown: false } as const) }));
    const restOf = asked.filter((c) => !alone.has(c.question!.topic));
    const rest = shown(askers(restOf), numbersOf(restOf), min);
    const sent = captures.filter((c) => weekOf(c.receivedAt) === week);
    const their = items.filter((i) => sent.some((c) => c.id === i.captureId));
    const updated = sent.filter((c) => their.some((i) => i.captureId === c.id));
    const updates = shown(new Set(updated.map((c) => c.authorId)), {
      updates: updated.length,
      items: their.length,
      corrections: their.filter((i) => !!i.draft.replaces).length,
      moved: their.filter((i) => movedIds.has(i.id)).length,
    }, min);
    out.push({ week, answers, topics, rest, updates });
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

/**
 * Who said it is left out: a maintainer judges the words, not the person (M1). Words are shown only while
 * the person still allows it, read now (rule 4, LF2), whatever a candidate's state says.
 */
export async function evalCandidateList(conn: Conn): Promise<CandidateList> {
  const rows = await conn
    .select({ candidate: t.evalCandidates, allows: t.people.helpImproveAtlas })
    .from(t.evalCandidates)
    .innerJoin(t.people, eq(t.people.id, t.evalCandidates.personId))
    .orderBy(t.evalCandidates.loggedAt);
  const groups = new Map<string, CandidateGroup>();
  for (const { candidate: r } of rows.filter((r) => r.allows && r.candidate.state === "logged" && r.candidate.text)) {
    const key = `${r.cause}|${sameWords(r.text!)}`;
    const g = groups.get(key) ?? { cause: r.cause, text: r.text!, count: 0, lines: [] };
    g.count++;
    g.lines.push({ id: r.id, loggedAt: r.loggedAt!, detail: r.detail });
    groups.set(key, g);
  }
  const counts: CandidateList["counts"] = {};
  for (const { candidate: r } of rows) (counts[r.state] ??= {})[r.cause] = (counts[r.state]?.[r.cause] ?? 0) + 1;
  return {
    waiting: [...groups.values()].sort((a, b) => b.count - a.count || b.lines.at(-1)!.loggedAt.getTime() - a.lines.at(-1)!.loggedAt.getTime()),
    accepted: rows.filter((r) => r.candidate.state === "in_eval_set").map(({ candidate: r }) => ({ id: r.id, cause: r.cause, caseText: r.caseText ?? "", expected: r.expected ?? "" })),
    counts,
  };
}
