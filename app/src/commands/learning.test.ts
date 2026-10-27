// Phase S against PGlite (conversational plan, section 21): feedback on answers, "Help improve Atlas",
// M36 eval candidates from the three places they come from, and the usage numbers (LF1 to LF8).
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Extractor } from "../atlas/extractor";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { DAY_MS } from "../domain/dates";
import type { RawQuestion } from "../domain/question";
import { getThread } from "../queries/chat";
import { evalCandidateList, topicsShown, usageNumbers, weekOf, type UsageView } from "../queries/usage";
import { at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { createCapture, openReview, proposeItems, routeExtraction } from "./capture";
import { CommandRefused } from "./core";
import { acceptCandidate, dismissCandidate, giveFeedback, runEvalCandidateTimers, setHelpImproveAtlas } from "./learning";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };
const as = (actorId: string, minutes = 30) => ({ db, now: at(minutes), actorId });
const dev = (minutes = 60) => ({ db, now: at(minutes), maintainer: "dev" });

/** Atlas that reads the message as this question and proposes nothing. */
const asks = (question: RawQuestion): Extractor => ({ name: "fake", extract: async () => ({ proposals: [], question, malformed: [], model: "fake", usage: null }) });

async function ask(who: string, text: string, topic = "other", minutes = 30, conversationId?: string): Promise<string> {
  const ctx = as(who, minutes);
  const { captureId } = await createCapture(ctx, { channel: "app", messageId: `s-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, conversationId });
  await readCapture(ctx, captureId, asks({ asked: text, topic, projectId: null }), noWait);
  return captureId;
}

const candidates = () => db.select().from(t.evalCandidates);
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(CommandRefused);
  return e as CommandRefused;
};

/**
 * Every place the person's words could be left, other than the capture, which keeps its own (M1): the
 * candidates, their audit trail, and the feedback on answers ("What was wrong?").
 */
async function wordsKept(words: string): Promise<number> {
  const rows = [
    ...(await candidates()),
    ...(await db.select().from(t.auditEntries).where(eq(t.auditEntries.machine, "eval_candidate"))),
    ...(await db.select().from(t.answerFeedback)),
  ];
  return rows.filter((r) => JSON.stringify(r).includes(words)).length;
}

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("feedback on an answer", () => {
  it("one per person per answer, changeable, with What was wrong? on a thumbs down only", async () => {
    await setHelpImproveAtlas(as("kemar", 0), true);
    const id = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), id, { rating: "up", wrong: "ignored" });
    await giveFeedback(as("kemar", 31), id, { rating: "down", wrong: "  #151 is done  " });
    const rows = await db.select().from(t.answerFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: "kemar", rating: "down", wrong: "#151 is done", topic: "due", version: 2 });
    const thread = await getThread(db, "kemar", (await db.select().from(t.captures).where(eq(t.captures.id, id)))[0].conversationId!, at(32));
    expect(thread.found && thread.turns.at(-1)!.feedback).toEqual({ rating: "down", wrong: "#151 is done" });
  });

  it("the feedback on every answer in a conversation is the viewer's own", async () => {
    const first = await ask("kemar", "What's due on Forager?", "due");
    const conversationId = (await db.select().from(t.captures).where(eq(t.captures.id, first)))[0].conversationId!;
    const second = await ask("kemar", "And on Store Insights?", "due", 31, conversationId);
    await giveFeedback(as("kemar", 32), second, { rating: "up" });
    const thread = await getThread(db, "kemar", conversationId, at(33));
    expect(thread.found && thread.turns.filter((c) => c.answer).map((c) => [c.id, c.feedback])).toEqual([
      [first, null],
      [second, { rating: "up", wrong: null }],
    ]);
  });

  it("P10: someone else's answer reads as one that does not exist", async () => {
    const id = await ask("kemar", "What's due on Forager?", "due");
    expect((await refusal(giveFeedback(as("alicia"), id, { rating: "down" }))).code).toBe("not_found");
    expect((await refusal(giveFeedback(as("kemar"), "cap-kemar-0858", { rating: "down" }))).code).toBe("not_found"); // an update, no answer
    expect(await db.select().from(t.answerFeedback)).toEqual([]);
  });

  it("What was wrong? is at most 500 characters", async () => {
    const id = await ask("kemar", "What's due on Forager?", "due");
    expect((await refusal(giveFeedback(as("kemar"), id, { rating: "down", wrong: "x".repeat(501) }))).reason).toBe("say what was wrong in at most 500 characters");
  });

  it("LF6: feedback on an answer from days ago is accepted and tied to that answer's as of", async () => {
    const id = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback({ db, now: new Date(at(30).getTime() + 9 * DAY_MS), actorId: "kemar" }, id, { rating: "up" });
    const [f] = await db.select().from(t.answerFeedback);
    expect(f.answerAsOf).toEqual(at(30));
    expect(weekOf(f.answerAsOf)).toBe("2026-10-19");
  });
});

describe("LF1: with Help improve Atlas off, only the counts are kept", () => {
  it("an answer DPM could not give, a thumbs down with what was wrong, and a move in review store no words", async () => {
    const id = await ask("kemar", "Can Atlas book my flight to Kingston?");
    expect(await giveFeedback(as("kemar"), id, { rating: "down", wrong: "it should know flights" })).toEqual({ rating: "down", wrong: null, logged: false });
    await openReview(as("kemar"), "cap-kemar-0858");
    await routeExtraction(as("kemar"), "cap-kemar-0858-8", { projectId: "gq" });
    expect(await candidates()).toEqual([]);
    expect(await wordsKept("book my flight")).toBe(0);
    expect(await wordsKept("should know flights")).toBe(0);
    // The counts are still there, in the records themselves
    expect(await db.select({ rating: t.answerFeedback.rating, wrong: t.answerFeedback.wrong }).from(t.answerFeedback)).toEqual([{ rating: "down", wrong: null }]);
  });
});

describe("with Help improve Atlas on", () => {
  beforeEach(async () => {
    await setHelpImproveAtlas(as("kemar", 0), true);
  });

  it("logs each cause once, with the words and what DPM did (rule 6)", async () => {
    const other = await ask("kemar", "Can Atlas book my flight to Kingston?");
    const unclear = await ask("kemar", "and on that one?", "unclear");
    const due = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), due, { rating: "down" });
    await giveFeedback(as("kemar", 31), due, { rating: "down" });
    await giveFeedback(as("kemar", 32), due, { rating: "down", wrong: "#151 is done" });
    await openReview(as("kemar"), "cap-kemar-0858");
    await routeExtraction(as("kemar"), "cap-kemar-0858-8", { projectId: "gq" });
    await routeExtraction(as("kemar"), "cap-kemar-0858-8", { projectId: "forager" });

    const rows = await candidates();
    expect(rows.map((r) => [r.cause, r.captureId, r.state]).sort()).toEqual(
      [
        ["moved", "cap-kemar-0858", "logged"],
        ["other", other, "logged"],
        ["thumbs_down", due, "logged"],
        ["unclear", unclear, "logged"],
      ].sort(),
    );
    expect(rows.find((r) => r.cause === "other")).toMatchObject({ text: "Can Atlas book my flight to Kingston?", detail: { topic: "other" }, personId: "kemar" });
    expect(rows.find((r) => r.cause === "moved")).toMatchObject({ extractionId: "cap-kemar-0858-8", detail: { kind: "braid_new", fromProject: "forager", toProject: "gq" } });
  });

  it("What was wrong?, given after the thumbs down, joins the waiting candidate with its version and an audit entry", async () => {
    const due = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), due, { rating: "down" });
    expect((await candidates())[0]).toMatchObject({ version: 1, detail: { wrong: null } });
    await giveFeedback(as("kemar", 31), due, { rating: "down", wrong: "#151 is done" });
    const [c] = await candidates();
    expect(c).toMatchObject({ version: 2, detail: { topic: "due", wrong: "#151 is done" } });
    const trail = await db.select().from(t.auditEntries).where(eq(t.auditEntries.subjectId, c.id));
    expect(trail.map((a) => [a.action, a.actorType, a.actorId, a.fromState, a.toState])).toEqual([
      ["LOGGED", "person", "kemar", "none", "logged"],
      ["WRONG_GIVEN", "person", "kemar", "logged", "logged"],
    ]);
    expect(await wordsKept("#151 is done")).toBe(2); // the candidate and the feedback, never the audit
  });

  it("an answer DPM could not give is logged by Atlas's job, with the asker's words", async () => {
    const other = await ask("kemar", "Can Atlas book my flight to Kingston?");
    const [c] = await candidates();
    expect(c).toMatchObject({ captureId: other, personId: "kemar" });
    const [entry] = await db.select().from(t.auditEntries).where(eq(t.auditEntries.subjectId, c.id));
    expect(entry).toMatchObject({ action: "LOGGED", actorType: "atlas", actorId: null });
  });

  it("an answer it could give, a thumbs up, picking a project and keeping it private are not candidates", async () => {
    const due = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), due, { rating: "up" });
    // Atlas asked which project: picking one is an answer, not a correction
    for (const [i, to] of [["1", { projectId: "insights" }], ["2", "keep_private"]] as const) {
      const { captureId } = await createCapture(as("kemar"), { channel: "app", messageId: `pick-${i}`, kind: "text", text: "The pipeline failed overnight.", messageAt: at(30), receivedAt: at(30) });
      await proposeItems(as("atlas"), captureId, [
        { kind: "braid_new", projectId: null, routingReason: { basis: "ambiguous", evidence: "pipeline", label: "Choose a project" }, options: ["forager", "insights"], braidKind: "issue", braidTitle: "Pipeline failed overnight", quote: "The pipeline failed overnight", confidence: "high", rationale: "" },
      ]);
      await openReview(as("kemar"), captureId);
      await routeExtraction(as("kemar"), `${captureId}-1`, to);
    }
    expect(await candidates()).toEqual([]);
  });

  it("LF4: a thumbs down changed to a thumbs up is taken back, with what was wrong; given again, it is logged anew", async () => {
    const due = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), due, { rating: "down", wrong: "#151 is done" });
    const [first] = await candidates();
    await giveFeedback(as("kemar", 31), due, { rating: "up" });
    expect((await candidates())[0]).toMatchObject({ id: first.id, state: "deleted", text: null, detail: null });
    expect((await evalCandidateList(db)).waiting).toEqual([]);
    expect(await wordsKept("#151 is done")).toBe(0);
    const [entry] = (await db.select().from(t.auditEntries).where(eq(t.auditEntries.subjectId, first.id))).filter((a) => a.action === "WITHDRAWN");
    expect(entry).toMatchObject({ actorType: "person", actorId: "kemar", fromState: "logged", toState: "deleted" });

    await giveFeedback(as("kemar", 32), due, { rating: "down" });
    expect((await candidates()).map((r) => [r.cause, r.state]).sort()).toEqual([
      ["thumbs_down", "deleted"],
      ["thumbs_down", "logged"],
    ]);
  });

  it("LF2: turning it off deletes their logged candidates and what they said was wrong; accepted cases and the thumbs stay", async () => {
    const kept = await ask("kemar", "Can Atlas book my flight to Kingston?");
    const gone = await ask("kemar", "Who is the Sprouts buyer for Kingston?");
    const due = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), due, { rating: "down", wrong: "#151 is done" });
    const [c1] = await db.select().from(t.evalCandidates).where(eq(t.evalCandidates.captureId, kept));
    await acceptCandidate(dev(), c1.id, { caseText: "Can Atlas book my flight to Montego Bay?", expected: "other" });

    expect(await setHelpImproveAtlas(as("kemar", 90), false)).toEqual({ on: false, deleted: 2, cleared: 1 });
    const rows = await candidates();
    expect(rows.find((r) => r.captureId === gone)).toMatchObject({ state: "deleted", text: null, detail: null });
    expect(rows.find((r) => r.captureId === kept)).toMatchObject({ state: "in_eval_set", text: null, caseText: "Can Atlas book my flight to Montego Bay?" });
    expect(await wordsKept("Sprouts buyer")).toBe(0);
    expect(await wordsKept("to Kingston")).toBe(0);
    expect(await wordsKept("#151 is done")).toBe(0);
    expect(await db.select({ rating: t.answerFeedback.rating, wrong: t.answerFeedback.wrong }).from(t.answerFeedback)).toEqual([{ rating: "down", wrong: null }]);
    // ...and nothing new is logged while it is off
    await ask("kemar", "Who is the Sprouts buyer for Kingston, again?", "other", 95);
    expect((await candidates()).filter((r) => r.state === "logged")).toEqual([]);
  });

  it("LF2: a thumbs down deleted when it was turned off is logged again once it is back on; one a maintainer decided is not", async () => {
    const due = await ask("kemar", "What's due on Forager?", "due");
    const other = await ask("kemar", "Can Atlas book my flight to Kingston?");
    await giveFeedback(as("kemar"), due, { rating: "down" });
    await giveFeedback(as("kemar"), other, { rating: "down" });
    const decided = (await candidates()).find((r) => r.cause === "thumbs_down" && r.captureId === other)!;
    await dismissCandidate(dev(), decided.id, "The answer was right");
    await setHelpImproveAtlas(as("kemar", 90), false);
    // "Help improve Atlas" in the reply: turned on, then the thumbs down given again
    await setHelpImproveAtlas(as("kemar", 91), true);
    expect((await giveFeedback(as("kemar", 91), due, { rating: "down" })).logged).toBe(true);
    expect((await giveFeedback(as("kemar", 91), other, { rating: "down" })).logged).toBe(false);
    const thumbs = (await candidates()).filter((r) => r.cause === "thumbs_down");
    expect(thumbs.map((r) => [r.captureId === due ? "due" : "other", r.state]).sort()).toEqual([
      ["due", "deleted"],
      ["due", "logged"],
      ["other", "dismissed"],
    ]);
  });

  it("LF2: a maintainer never sees the words of someone who no longer allows it, whatever the candidate's state says", async () => {
    await ask("kemar", "Can Atlas book my flight to Kingston?");
    // As if a candidate were logged in the instant the setting was turned off
    await db.update(t.people).set({ helpImproveAtlas: false }).where(eq(t.people.id, "kemar"));
    const list = await evalCandidateList(db);
    expect(list.waiting).toEqual([]);
    expect(list.counts).toEqual({ logged: { other: 1 } });
    const [c] = await candidates();
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: "Can Atlas book my flight?", expected: "other" }))).reason).toBe("the person no longer allows it");
  });

  it("LF2: Alicia turning hers off leaves Kemar's alone", async () => {
    await ask("kemar", "Can Atlas book my flight to Kingston?");
    await setHelpImproveAtlas(as("alicia", 90), false);
    expect((await candidates()).map((r) => r.state)).toEqual(["logged"]);
  });

  it("LF3: accepted only anonymised, with seed names, and what Atlas should do; a client's data can be dismissed outright", async () => {
    // A real deployment holds people and customers the seed does not
    await db.insert(t.people).values({ id: "shanice", name: "Shanice Reid", initials: "SR", orgRole: "employee" });
    await db.update(t.projects).set({ customer: "Juici Patties" }).where(eq(t.projects.id, "gq"));
    await ask("kemar", "Is Shanice Reid the buyer at Juici Patties?");
    const [c] = await candidates();
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: " ", expected: "other" }))).reason).toBe("give the words with seed names and ids");
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: "is shanice reid the buyer at juici patties", expected: "other" }))).reason).toBe(
      "these are the person's own words: give them with seed names and ids",
    );
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: "Is Kyle the buyer at Juici Patties?", expected: "other" }))).reason).toBe('"Juici Patties" is not in the seed: use a seed name instead');
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: "Is Reid the buyer at Sprouts?", expected: "other" }))).reason).toBe('"Reid" is not in the seed: use a seed name instead');
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: "Is Kyle the buyer at Sprouts?", expected: "" }))).reason).toBe("say what Atlas should have done");
    expect(await dismissCandidate(dev(), c.id, null)).toMatchObject({ state: "dismissed", note: null, text: null, decidedBy: "maintainer:dev" });
    // A decided candidate is never decided again (rule 6)
    await refusal(acceptCandidate(dev(), c.id, { caseText: "Is Kyle the buyer at Sprouts?", expected: "other" }));
  });

  it("LF3: with seed names it enters the eval set", async () => {
    await ask("kemar", "Who is the buyer at our client?");
    const [c] = await candidates();
    expect(await acceptCandidate(dev(), c.id, { caseText: "Is Kyle the buyer at Sprouts?", expected: "other" })).toMatchObject({ state: "in_eval_set", caseText: "Is Kyle the buyer at Sprouts?", text: null });
    expect((await evalCandidateList(db)).accepted).toEqual([{ id: c.id, cause: "other", caseText: "Is Kyle the buyer at Sprouts?", expected: "other" }]);
  });

  it("LF4: a thumbs down on a correct answer is logged, then dismissed with a note", async () => {
    const due = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), due, { rating: "down" });
    const [c] = await candidates();
    expect(await dismissCandidate(dev(), c.id, "The answer was right")).toMatchObject({ state: "dismissed", note: "The answer was right", text: null, detail: null });
    const [entry] = (await db.select().from(t.auditEntries).where(eq(t.auditEntries.subjectId, c.id))).filter((a) => a.action === "DISMISS");
    expect(entry).toMatchObject({ actorType: "system", actorId: "maintainer:dev", fromState: "logged", toState: "dismissed", detail: { cause: "thumbs_down" } });
  });

  it("LF5: the same words that cannot be answered are grouped, the count first", async () => {
    await ask("kemar", "Can you book my flight?");
    await ask("kemar", "can you book my flight", "other", 40);
    await ask("kemar", "What is Forager's budget?", "other", 50);
    const list = await evalCandidateList(db);
    expect(list.waiting.map((g) => [g.count, g.cause, g.text])).toEqual([
      [2, "other", "Can you book my flight?"],
      [1, "other", "What is Forager's budget?"],
    ]);
    expect(list.counts).toEqual({ logged: { other: 3 } });
  });

  it("rule 5: deleted after 30 days, with the words", async () => {
    await ask("kemar", "Can Atlas book my flight to Kingston?");
    expect(await runEvalCandidateTimers({ db, now: new Date(at(30).getTime() + 29 * DAY_MS) })).toEqual({ deleted: [] });
    const [c] = await candidates();
    expect(await runEvalCandidateTimers({ db, now: new Date(at(30).getTime() + 30 * DAY_MS) })).toEqual({ deleted: [c.id] });
    expect((await candidates())[0]).toMatchObject({ state: "deleted", text: null });
    expect(await wordsKept("book my flight")).toBe(0);
  });
});

describe("usage numbers (LF7, LF8)", () => {
  const intellibus = (weeks = 1, view: UsageView = "executive") => usageNumbers(db, { now: at(60), weeks, orgId: "intellibus", view });

  /** People on Forager's group, so they are Intellibus people (LF7). */
  async function addPeople(count: number) {
    for (let i = 1; i <= count; i++) {
      await db.insert(t.people).values({ id: `p${i}`, name: `Person ${i}`, initials: `P${i}`, orgRole: "employee" });
      await db.insert(t.groupMembers).values({ groupId: "g-forager", personId: `p${i}` });
    }
  }

  it("LF8: a week with fewer than 5 people asking shows no number at all", async () => {
    await addPeople(3);
    for (const who of ["kemar", "p1", "p2", "p3"]) await ask(who, "What's due?", "due");
    const [week] = await intellibus();
    expect(week).toEqual({ week: "2026-10-19", answers: { shown: false }, topics: expect.any(Array), rest: { shown: false }, updates: { shown: false } });
    expect(week.topics.every((t) => !t.numbers.shown)).toBe(true);
  });

  it("five people asking each of two topics: the rates, the thumbs and each topic", async () => {
    await addPeople(4);
    const people = ["kemar", "p1", "p2", "p3", "p4"];
    for (const who of people) await giveFeedback(as(who), await ask(who, "What's due?", "due"), { rating: who === "p1" ? "down" : "up" });
    for (const who of people) await ask(who, "Can you book my flight?", "other");
    const [week] = await intellibus();
    expect(week.answers).toEqual({ shown: true, people: 5, asked: 10, answerRate: 0.5, cantAnswerRate: 0.5, unclearRate: 0, thumbsUp: 4, thumbsDown: 1 });
    expect(week.topics.find((t) => t.topic === "due")!.numbers).toEqual({ shown: true, people: 5, asked: 5, thumbsUp: 4, thumbsDown: 1 });
    expect(week.topics.find((t) => t.topic === "other")!.numbers).toEqual({ shown: true, people: 5, asked: 5, thumbsUp: 0, thumbsDown: 0 });
    expect(week.rest).toEqual({ shown: false }); // nothing left out
  });

  it("W-D3: a maintainer sees every count, however few people are behind it", async () => {
    await addPeople(1);
    await giveFeedback(as("kemar"), await ask("kemar", "What's due?", "due"), { rating: "down" });
    await ask("p1", "Can you book my flight?", "other");
    const [executive] = await intellibus();
    expect(executive.answers).toEqual({ shown: false });
    const [week] = await intellibus(1, "maintainer");
    expect(week.answers).toEqual({ shown: true, people: 2, asked: 2, answerRate: 0.5, cantAnswerRate: 0.5, unclearRate: 0, thumbsUp: 0, thumbsDown: 1 });
    expect(week.topics.find((t) => t.topic === "due")!.numbers).toEqual({ shown: true, people: 1, asked: 1, thumbsUp: 0, thumbsDown: 1 });
    expect(week.rest).toEqual({ shown: false }); // every topic asked is shown on its own
  });

  it("LF8: one person's question cannot be worked out by subtraction from the numbers shown with it", async () => {
    await addPeople(4);
    for (const who of ["kemar", "p1", "p2", "p3", "p4"]) await giveFeedback(as(who), await ask(who, "What's due?", "due"), { rating: who === "p1" ? "down" : "up" });
    await ask("p2", "Can you book my flight?", "other");
    const [week] = await intellibus();
    // The week's total is shown, so "due" joins "other" rather than leave it as the total less "due"
    expect(week.answers).toEqual({ shown: true, people: 5, asked: 6, answerRate: null, cantAnswerRate: null, unclearRate: 0, thumbsUp: 4, thumbsDown: 1 });
    expect(week.topics.filter((t) => t.numbers.shown)).toEqual([]);
    expect(week.rest).toEqual({ shown: true, people: 5, asked: 6, thumbsUp: 4, thumbsDown: 1 });
  });

  it("LF8: the topics left out together come from at least 5 people, or from nobody", () => {
    const of = (...people: string[]) => new Set(people);
    const five = of("a", "b", "c", "d", "e");
    expect([...topicsShown(new Map([["due", five], ["mentions", of("f", "g", "h", "i", "j", "k")], ["other", of("a")]]))]).toEqual(["mentions"]);
    expect([...topicsShown(new Map([["due", five], ["other", of("f", "g")], ["unclear", of("h", "i", "j")]]))]).toEqual(["due"]);
    expect([...topicsShown(new Map([["due", five], ["updates", of()]]))]).toEqual(["due"]);
  });

  it("updates: moves in review count once Kemar is one of five who sent updates", async () => {
    await openReview(as("kemar"), "cap-kemar-0858");
    await routeExtraction(as("kemar"), "cap-kemar-0858-8", { projectId: "gq" });
    expect((await intellibus())[0].updates).toEqual({ shown: false }); // Kemar alone sent an update

    await addPeople(4);
    for (const who of ["p1", "p2", "p3", "p4"]) {
      await db.insert(t.projectMemberships).values({ projectId: "forager", personId: who, role: "member", state: "member" });
      const { captureId } = await createCapture(as(who), { channel: "app", messageId: `u-${who}`, kind: "text", text: "On Forager, the pipeline failed overnight.", messageAt: at(30), receivedAt: at(30) });
      await proposeItems(as("atlas"), captureId, [
        { kind: "braid_new", projectId: "forager", routingReason: { basis: "reference", evidence: "Forager", label: "On Forager" }, braidKind: "issue", braidTitle: "Pipeline failed overnight", quote: "the pipeline failed overnight", confidence: "high", rationale: "" },
      ]);
    }
    const [week] = await intellibus();
    expect(week.updates).toEqual({ shown: true, people: 5, updates: 5, items: 15, corrections: 0, moved: 1 });
  });

  it("LF7: an outside contact in one of the org's groups is not one of its people", async () => {
    await addPeople(3);
    // Kyle at Sprouts IT joins Forager's group (phase I); he has no role at Intellibus
    await db.insert(t.groupMembers).values({ groupId: "g-forager", personId: "kyle" });
    for (const who of ["kemar", "p1", "p2", "p3", "kyle"]) await ask(who, "What's due?", "due");
    expect((await intellibus())[0].answers).toEqual({ shown: false });

    await db.insert(t.people).values({ id: "p9", name: "Person 9", initials: "P9", orgRole: "employee" });
    await db.insert(t.groupMembers).values({ groupId: "g-gq", personId: "p9" });
    await ask("p9", "What's due?", "due");
    expect((await intellibus())[0].answers).toMatchObject({ shown: true, people: 5, asked: 5 });
  });

  it("weeks run Monday to Sunday in Jamaica, oldest first", async () => {
    const weeks = await intellibus(3);
    expect(weeks.map((w) => w.week)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(weekOf(new Date("2026-10-26T04:59:00Z"))).toBe("2026-10-19"); // Sunday 11:59pm in Kingston
    expect(weekOf(new Date("2026-10-26T05:00:00Z"))).toBe("2026-10-26");
  });
});
