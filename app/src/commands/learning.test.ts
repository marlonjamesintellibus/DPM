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
import { evalCandidateList, usageNumbers, weekOf } from "../queries/usage";
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

async function ask(who: string, text: string, topic = "other", minutes = 30): Promise<string> {
  const ctx = as(who, minutes);
  const { captureId } = await createCapture(ctx, { channel: "app", messageId: `s-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now });
  await readCapture(ctx, captureId, asks({ asked: text, topic, projectId: null }), noWait);
  return captureId;
}

const candidates = () => db.select().from(t.evalCandidates);
const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(CommandRefused);
  return e as CommandRefused;
};

/** Every place a candidate could leave the person's words: its row and its audit trail. (The capture keeps its own, M1.) */
async function wordsKept(words: string): Promise<number> {
  const rows = [...(await candidates()), ...(await db.select().from(t.auditEntries).where(eq(t.auditEntries.machine, "eval_candidate")))];
  return rows.filter((r) => JSON.stringify(r).includes(words)).length;
}

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("feedback on an answer", () => {
  it("one per person per answer, changeable, with What was wrong? on a thumbs down only", async () => {
    const id = await ask("kemar", "What's due on Forager?", "due");
    await giveFeedback(as("kemar"), id, { rating: "up", wrong: "ignored" });
    await giveFeedback(as("kemar", 31), id, { rating: "down", wrong: "  #151 is done  " });
    const rows = await db.select().from(t.answerFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: "kemar", rating: "down", wrong: "#151 is done", topic: "due", version: 2 });
    const thread = await getThread(db, "kemar", (await db.select().from(t.captures).where(eq(t.captures.id, id)))[0].conversationId!, at(32));
    expect(thread.found && thread.turns.at(-1)!.feedback).toEqual({ rating: "down", wrong: "#151 is done" });
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
  it("an answer DPM could not give, a thumbs down and a move in review store no words", async () => {
    const id = await ask("kemar", "Can Atlas book my flight to Kingston?");
    await giveFeedback(as("kemar"), id, { rating: "down", wrong: "it should know flights" });
    await openReview(as("kemar"), "cap-kemar-0858");
    await routeExtraction(as("kemar"), "cap-kemar-0858-8", { projectId: "gq" });
    expect(await candidates()).toEqual([]);
    expect(await wordsKept("book my flight")).toBe(0);
    // The counts are still there, in the records themselves
    expect(await db.select({ rating: t.answerFeedback.rating }).from(t.answerFeedback)).toEqual([{ rating: "down" }]);
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
    await giveFeedback(as("kemar", 31), due, { rating: "up" });
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
    // What was wrong?, given after the thumbs down, joins the candidate while it waits
    expect(rows.find((r) => r.cause === "thumbs_down")!.detail).toMatchObject({ topic: "due", wrong: "#151 is done" });
    expect(rows.find((r) => r.cause === "moved")).toMatchObject({ extractionId: "cap-kemar-0858-8", detail: { kind: "braid_new", fromProject: "forager", toProject: "gq" } });
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

  it("LF2: turning it off deletes their logged candidates; accepted cases stay; no words are left", async () => {
    const kept = await ask("kemar", "Can Atlas book my flight to Kingston?");
    const gone = await ask("kemar", "Who is the Sprouts buyer for Kingston?");
    const [c1] = await db.select().from(t.evalCandidates).where(eq(t.evalCandidates.captureId, kept));
    await acceptCandidate(dev(), c1.id, { caseText: "Can Atlas book my flight to Montego Bay?", expected: "other" });

    expect(await setHelpImproveAtlas(as("kemar", 90), false)).toEqual({ on: false, deleted: 1 });
    const rows = await candidates();
    expect(rows.find((r) => r.captureId === gone)).toMatchObject({ state: "deleted", text: null, detail: null });
    expect(rows.find((r) => r.captureId === kept)).toMatchObject({ state: "in_eval_set", text: null, caseText: "Can Atlas book my flight to Montego Bay?" });
    expect(await wordsKept("Sprouts buyer")).toBe(0);
    expect(await wordsKept("to Kingston")).toBe(0);
    // ...and nothing new is logged while it is off
    await ask("kemar", "Who is the Sprouts buyer for Kingston, again?", "other", 95);
    expect((await candidates()).filter((r) => r.state === "logged")).toEqual([]);
  });

  it("LF2: Alicia turning hers off leaves Kemar's alone", async () => {
    await ask("kemar", "Can Atlas book my flight to Kingston?");
    await setHelpImproveAtlas(as("alicia", 90), false);
    expect((await candidates()).map((r) => r.state)).toEqual(["logged"]);
  });

  it("LF3: accepted only with seed words and what Atlas should do; a client's data can be dismissed outright", async () => {
    await ask("kemar", "Who is the Sprouts buyer for Kingston?");
    const [c] = await candidates();
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: " ", expected: "other" }))).reason).toBe("give the words with seed names and ids");
    expect((await refusal(acceptCandidate(dev(), c.id, { caseText: "Who is the buyer?", expected: "" }))).reason).toBe("say what Atlas should have done");
    expect(await dismissCandidate(dev(), c.id, null)).toMatchObject({ state: "dismissed", note: null, text: null, decidedBy: "maintainer:dev" });
    // A decided candidate is never decided again (rule 6)
    await refusal(acceptCandidate(dev(), c.id, { caseText: "Who is the buyer?", expected: "other" }));
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
    const [week] = await usageNumbers(db, { now: at(60), weeks: 1 });
    expect(week).toEqual({ week: "2026-10-19", answers: { shown: false }, topics: expect.any(Array), updates: { shown: false } });
    expect(week.topics.every((t) => !t.numbers.shown)).toBe(true);
  });

  it("five people asking: the rates, the thumbs and each topic asked by five", async () => {
    await addPeople(4);
    const people = ["kemar", "p1", "p2", "p3", "p4"];
    for (const who of people) await giveFeedback(as(who), await ask(who, "What's due?", "due"), { rating: who === "p1" ? "down" : "up" });
    await ask("p2", "Can you book my flight?", "other");
    const [week] = await usageNumbers(db, { now: at(60), weeks: 1 });
    expect(week.answers).toEqual({ shown: true, people: 5, asked: 6, answerRate: 5 / 6, cantAnswerRate: 1 / 6, unclearRate: 0, thumbsUp: 4, thumbsDown: 1 });
    expect(week.topics.find((t) => t.topic === "due")!.numbers).toEqual({ shown: true, people: 5, asked: 5, thumbsUp: 4, thumbsDown: 1 });
    // One person couldn't be answered: that topic is not shown on its own
    expect(week.topics.find((t) => t.topic === "other")!.numbers).toEqual({ shown: false });
  });

  it("updates: moves in review count once Kemar is one of five who sent updates", async () => {
    await openReview(as("kemar"), "cap-kemar-0858");
    await routeExtraction(as("kemar"), "cap-kemar-0858-8", { projectId: "gq" });
    expect((await usageNumbers(db, { now: at(60), weeks: 1 }))[0].updates).toEqual({ shown: false }); // Kemar alone sent an update

    await addPeople(4);
    for (const who of ["p1", "p2", "p3", "p4"]) {
      await db.insert(t.projectMemberships).values({ projectId: "forager", personId: who, role: "member", state: "member" });
      const { captureId } = await createCapture(as(who), { channel: "app", messageId: `u-${who}`, kind: "text", text: "On Forager, the pipeline failed overnight.", messageAt: at(30), receivedAt: at(30) });
      await proposeItems(as("atlas"), captureId, [
        { kind: "braid_new", projectId: "forager", routingReason: { basis: "reference", evidence: "Forager", label: "On Forager" }, braidKind: "issue", braidTitle: "Pipeline failed overnight", quote: "the pipeline failed overnight", confidence: "high", rationale: "" },
      ]);
    }
    const [week] = await usageNumbers(db, { now: at(60), weeks: 1 });
    expect(week.updates).toEqual({ shown: true, people: 5, updates: 5, items: 15, corrections: 0, moved: 1 });
  });

  it("LF7: an org's numbers count only its own people", async () => {
    await addPeople(4);
    for (const who of ["kemar", "p1", "p2", "p3", "p4"]) await ask(who, "What's due?", "due");
    const [ours] = await usageNumbers(db, { now: at(60), weeks: 1, orgId: "intellibus" });
    expect(ours.answers).toMatchObject({ shown: true, people: 5 });
    const [theirs] = await usageNumbers(db, { now: at(60), weeks: 1, orgId: "sprouts" });
    expect(theirs.answers).toEqual({ shown: false });
  });

  it("weeks run Monday to Sunday in Jamaica, oldest first", async () => {
    const weeks = await usageNumbers(db, { now: at(60), weeks: 3 });
    expect(weeks.map((w) => w.week)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(weekOf(new Date("2026-10-26T04:59:00Z"))).toBe("2026-10-19"); // Sunday 11:59pm in Kingston
    expect(weekOf(new Date("2026-10-26T05:00:00Z"))).toBe("2026-10-26");
  });
});
