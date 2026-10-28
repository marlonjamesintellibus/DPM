// Phase J against PGlite (conversational plan, section 12): Kemar's standup in his own chat (M28). "Start my
// standup" asks short questions from his open work, rebuilt at each step; taps and typed replies answer; the
// answers become one capture he reviews and saves as usual. Every edge case SU1 to SU10, the model check's
// fixes (the save asks the owner of a record that is no longer his), and rule 6 on the buttons.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Extractor } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import type { Db } from "../db/client";
import { loadItems } from "../db/records";
import * as t from "../db/schema";
import type { CheckContext, RawProposal } from "../domain/atlas-checks/types";
import { getThread } from "../queries/chat";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { createCapture, decideExtraction, openReview, saveCapture } from "./capture";
import { runStandupTimers, tapStandup, type StandupTap } from "./standup";

let db: Db;
let n = 0;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const standup = async (personId = "kemar") => (await db.select().from(t.standups).where(eq(t.standups.personId, personId)))[0];
const capture = async (id: string) => (await db.select().from(t.captures).where(eq(t.captures.id, id)))[0];
const items = async (captureId: string) => (await loadItems(db, captureId)).items;
const work = async (id: string) => (await db.select().from(t.workItems).where(eq(t.workItems.id, id)))[0];
const turn = async (who: string, conversationId: string, captureId: string, minutes = 0) => {
  const thread = await getThread(db, who, conversationId, at(minutes));
  if (!thread.found) throw new Error("no thread");
  return thread.turns.find((c) => c.id === captureId)!;
};

/** A message in the DPM chat (the Atlas app's direct chat with kind voice), read by Atlas: the recorded fixture by default. */
async function say(who: string, text: string, minutes = 0, conversationId: string | null = null, extractor: Extractor = createFixtureExtractor(), opts: { kind?: "text" | "voice"; atlasChatId?: string } = {}) {
  const ctx = as(who, minutes);
  const channel = opts.kind === "voice" || opts.atlasChatId ? "atlas" : "app";
  const created = await createCapture(ctx, { channel, messageId: `s-${++n}`, kind: opts.kind ?? "text", text, messageAt: at(minutes), receivedAt: at(minutes), conversationId, atlasChatId: opts.atlasChatId, transcriptConfidence: opts.kind === "voice" ? "high" : null });
  const read = await readCapture(ctx, created.captureId, extractor, { retryDelayMs: () => 0 });
  return { captureId: created.captureId, conversationId: created.conversationId!, read };
}

/** A button under the question waiting. When it composes the standup, the answers are read, as the action does after the reply. */
async function tap(who: string, what: StandupTap, minutes = 0, extractor: Extractor = noModel) {
  const row = await standup(who);
  const run = await tapStandup(as(who, minutes), row.id, row.current!.n, what);
  if (run.composed) await readCapture(as(who, minutes), run.composed, extractor, { retryDelayMs: () => 0 });
  return run;
}
const answer = (tapped: Extract<StandupTap, { act: "answer" }>["tap"]): StandupTap => ({ act: "answer", tap: tapped });

/** No model may be asked: every answer was a tap, or words DPM reads itself. */
const noModel: Extractor = {
  name: "none",
  extract: async () => {
    throw new Error("a standup of taps must not reach the model");
  },
};
/** Atlas that reads the typed answers as these proposals, and keeps what it was given. */
function reads(proposals: RawProposal[]) {
  const seen: CheckContext[] = [];
  const extractor: Extractor = {
    name: "fake",
    extract: async (ctx) => {
      seen.push(ctx);
      return { proposals, question: null, commands: [], malformed: [], model: "fake", usage: null };
    },
  };
  return { extractor, seen };
}

const Q145 = "#145 Google Trends connector is In progress. Done, still going, or stuck?";
const Q151 = "#151 Store sales feed access is In progress. Done, still going, or stuck?";
const Q147 = "#147 Trend scoring model is In progress. Done, still going, or stuck?";

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("START: \"Start my standup\" in his own chat", () => {
  it("asks about his work In progress, soonest due first, with the taps as buttons; no model is asked", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    expect(start.read).toMatchObject({ outcome: "proposed", state: "answered" });
    const row = await standup();
    expect(row).toMatchObject({ day: "2026-10-20", state: "asking", conversationId: start.conversationId, startedBy: start.captureId, shownIn: start.captureId, steps: [] });
    expect(row.current).toEqual({ n: 1, kind: "in_progress", subject: { type: "work_item", id: "wi-145", projectId: "forager", label: "#145 Google Trends connector", number: "#145" }, text: Q145, askedIn: start.captureId });
    const shown = await turn("kemar", start.conversationId, start.captureId);
    expect(shown.answer?.text).toBe("Let's do your standup. Tap an answer or type your own. Skip moves on, and That's all ends it.");
    expect(shown.standup).toEqual({
      id: row.id,
      state: "asking",
      steps: [],
      current: { n: 1, text: Q145, taps: [{ answer: "done", label: "Done" }, { answer: "still_going", label: "Still going" }, { answer: "stuck", label: "Stuck" }] },
      ended: null,
    });
  });

  it("rules 3 and 8: a group chat in the Atlas app never runs a standup", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor(), { atlasChatId: "g-forager" });
    expect(await standup()).toBeUndefined();
    expect((await turn("kemar", start.conversationId, start.captureId)).answer?.text).toBe("I run your standup only in your own chat with me.");
  });

  it("SU10: one per person per day: a second while it asks, or after it ended, starts nothing", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    // Said again in the same conversation, it is read as itself, never as the answer to the question waiting
    const again = await say("kemar", "Start my standup", 1, start.conversationId, createFixtureExtractor());
    expect((await turn("kemar", start.conversationId, again.captureId, 1)).answer?.text).toBe('Your standup is already going. Answer its question, or say "That\'s all" to end it.');
    expect((await standup()).current?.n).toBe(1);
    await tap("kemar", { act: "stop" }, 2);
    const third = await say("kemar", "Let's do my standup", 3, null, createFixtureExtractor());
    expect((await turn("kemar", third.conversationId, third.captureId, 3)).answer?.text).toBe("You've done your standup today. You can still send me an update any time.");
    expect(await db.select().from(t.standups)).toHaveLength(1);
    // The next day is a new standup
    await say("kemar", "Start my standup", 24 * 60, null, createFixtureExtractor());
    expect(await db.select().from(t.standups)).toHaveLength(2);
  });
});

describe("a standup, end to end", () => {
  it("taps and a typed answer become one capture: Done on #145 and Stuck on #151 with what it waits on, quoted; Atlas reads only the typed answer, after its question", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await tap("kemar", answer("done"), 1);
    expect((await standup()).current).toMatchObject({ n: 2, kind: "in_progress", text: Q151 });
    await tap("kemar", answer("stuck"), 2);
    // asking(k) --ANSWER Stuck--> asking(k, "What's it waiting on?")
    expect((await standup()).current).toMatchObject({ n: 3, kind: "wait", subject: { id: "wi-151" }, text: "What's it waiting on?", askedIn: start.captureId });
    const reply = await say("kemar", "Kyle hasn't sent the access yet", 3, start.conversationId, noModel);
    expect(reply.read).toMatchObject({ state: "answered", model: "standup" });
    // The next question shows under his reply; the follow-up did not use up one of the four
    expect((await standup()).current).toMatchObject({ n: 4, kind: "in_progress", text: Q147, askedIn: reply.captureId });
    await tap("kemar", answer("still_going"), 4);
    expect((await standup()).current).toMatchObject({ n: 5, kind: "new", text: "Anything new blocking you?" });

    const blocker: RawProposal = { kind: "braid_new", projectId: "forager", routingReason: { basis: "same_quote", evidence: "Kyle", label: "Same words as #151" }, braidKind: "blocker", braidTitle: "Store sales feed access from Kyle", quote: "Kyle hasn't sent the access yet", confidence: "high", rationale: "" };
    const atlas = reads([blocker]);
    const done = await tap("kemar", answer("nothing"), 5, atlas.extractor);
    const row = await standup();
    expect(row).toMatchObject({ state: "composed", endedBy: "answers", captureId: done.composed, current: null });
    const composed = await capture(done.composed!);
    expect(composed).toMatchObject({ authorId: "kemar", conversationId: start.conversationId, channel: "app", state: "proposed" });
    expect(composed.text).toBe(
      [`Atlas: ${Q145}`, "Kemar: Done", `Atlas: ${Q151}`, "Kemar: Stuck", "Atlas: What's it waiting on?", "Kemar: Kyle hasn't sent the access yet", `Atlas: ${Q147}`, "Kemar: Still going", "Atlas: Anything new blocking you?", "Kemar: No"].join("\n"),
    );
    // Each read with its question as context: Atlas got the stuck question and what it waits on, nothing else
    expect(atlas.seen).toHaveLength(1);
    expect(atlas.seen[0].text).toBe(`Atlas: ${Q151}\nKemar: Stuck\nAtlas: What's it waiting on?\nKemar: Kyle hasn't sent the access yet`);
    expect(atlas.seen[0].standup).toBeDefined();
    expect(atlas.seen[0].earlier).toBeUndefined();

    const proposed = await items(done.composed!);
    const quote = (i: (typeof proposed)[number]) => i.draft.spans.map((sp) => composed.text.slice(sp.start, sp.end)).join(" … ");
    expect(proposed.map((i) => [i.draft.kind, i.draft.target?.id ?? i.draft.braid?.kind, i.value, i.state, quote(i)])).toEqual([
      ["update", "wi-145", "done", "pre_accepted", Q145],
      ["update", "wi-151", "blocked", "pre_accepted", "Kyle hasn't sent the access yet"],
      ["braid_new", "blocker", "Store sales feed access from Kyle", "pre_accepted", "Kyle hasn't sent the access yet"],
    ]);
    expect(proposed[1].draft.target?.note).toBe("Kyle hasn't sent the access yet");

    // The chat: the questions under the message they were asked after, how it ended, and the update as Atlas's
    const startTurn = await turn("kemar", start.conversationId, start.captureId, 6);
    expect(startTurn.standup?.steps).toEqual([
      { n: 1, text: Q145, answer: "Done" },
      { n: 2, text: Q151, answer: "Stuck" },
      { n: 3, text: "What's it waiting on?", answer: null },
    ]);
    const replyTurn = await turn("kemar", start.conversationId, reply.captureId, 6);
    expect(replyTurn.standup).toMatchObject({ steps: [{ n: 4, answer: "Still going" }, { n: 5, answer: "No" }], current: null, ended: "That's your standup. I put your answers together below for you to review." });
    const update = await turn("kemar", start.conversationId, done.composed!, 6);
    expect(update).toMatchObject({ fromStandup: true, line: "Got it. 3 updates for 1 project." });

    // He saves it as any update: the review is the same, and the blocker is linked to #151 (M5)
    await openReview(as("kemar", 7), done.composed!);
    expect((await saveCapture(as("kemar", 7), done.composed!)).outcome).toBe("saved");
    expect(await work("wi-145")).toMatchObject({ state: "done" });
    expect(await work("wi-151")).toMatchObject({ state: "blocked", blockedNote: "Kyle hasn't sent the access yet", blockedLinks: [`br-${proposed[2].id}`] });
  });

  it("No, it moves asks when he now expects it, and his words are the forecast, read by the checks, not a model", async () => {
    // Thursday 22 Oct, with his work In progress finished: the Trend model is due tomorrow
    await db.update(t.workItems).set({ state: "done" }).where(and(eq(t.workItems.ownerId, "kemar"), eq(t.workItems.state, "in_progress")));
    const thursday = 2 * 24 * 60;
    const start = await say("kemar", "Start my standup", thursday, null, createFixtureExtractor());
    expect((await standup()).current).toMatchObject({ kind: "due", subject: { id: "ms-trend" }, text: "Is Trend model still on for Fri 23 Oct?" });
    await tap("kemar", answer("moves"), thursday + 1);
    expect((await standup()).current).toMatchObject({ kind: "when", text: "When do you now expect it?" });
    await say("kemar", "Monday", thursday + 2, start.conversationId, noModel);
    const done = await tap("kemar", answer("nothing"), thursday + 3);
    const [forecast] = await items(done.composed!);
    // A relative date is Medium (E13), so it waits for his OK
    expect(forecast).toMatchObject({ value: "2026-10-26", state: "needs_ok", draft: { target: { type: "milestone", id: "ms-trend", field: "forecast" } } });
  });
});

describe("edge cases SU1 to SU10", () => {
  it("SU1: no open work asks only \"Anything blocking you?\"; That's all with nothing answered is abandoned, never an empty capture", async () => {
    const start = await say("andre", "Start my standup", 0, null, createFixtureExtractor());
    expect((await standup("andre")).current).toMatchObject({ n: 1, kind: "new", text: "Anything blocking you?" });
    const stop = await say("andre", "That's all", 1, start.conversationId, noModel);
    expect(await standup("andre")).toMatchObject({ state: "abandoned", endedBy: "stop", captureId: null });
    expect((await turn("andre", start.conversationId, stop.captureId, 1)).standup?.ended).toBe("Nothing was answered, so there's nothing to review.");
    expect(await db.select().from(t.captures).where(eq(t.captures.authorId, "andre"))).toHaveLength(2);
  });

  it("SU2: work an update of his today already speaks to is not asked; the standup only fills the gaps", async () => {
    await say("kemar", "Finished #145.", 0, null, reads([{ kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#145", label: "#145" }, targetId: "wi-145", field: "state", newValue: "done", quote: "Finished #145", confidence: "high", rationale: "" }]).extractor);
    await say("kemar", "Start my standup", 1, null, createFixtureExtractor());
    expect((await standup()).current).toMatchObject({ subject: { id: "wi-151" } });
  });

  it("SU3: someone else changed #145 while he answered: the save compares versions and the card shows the conflict", async () => {
    await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await tap("kemar", answer("done"), 1);
    const done = await tap("kemar", { act: "stop" }, 2);
    await db.update(t.workItems).set({ state: "blocked", blockedNote: "waiting on QA" }).where(eq(t.workItems.id, "wi-145"));
    await openReview(as("kemar", 3), done.composed!);
    expect(await saveCapture(as("kemar", 3), done.composed!)).toMatchObject({ outcome: "conflict", conflicts: [{ saw: "in_progress", current: "blocked" }] });
    expect((await work("wi-145")).state).toBe("blocked");
  });

  it("SU4: an answer about another item is his own words, read by Atlas with the question; a quote from DPM's question is dropped", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await say("kemar", "Not that, but #208 is done", 1, start.conversationId, noModel);
    const said = (quote: string, targetId: string, projectId: string): RawProposal => ({ kind: "update", projectId, routingReason: { basis: "target", evidence: quote, label: quote }, targetId, field: "state", newValue: "done", quote, confidence: "high", rationale: "" });
    const atlas = reads([said("#208 is done", "wi-208", "insights"), said("#145 Google Trends connector", "wi-145", "forager")]);
    const done = await tap("kemar", { act: "stop" }, 2, atlas.extractor);
    expect(atlas.seen[0].text).toBe(`Atlas: ${Q145}\nKemar: Not that, but #208 is done`);
    const proposed = await items(done.composed!);
    expect(proposed.map((i) => [i.draft.target?.id, i.draft.projectId])).toEqual([["wi-208", "insights"]]);
  });

  it("U1: words he typed that fed nothing are set aside as not used; DPM's questions and his taps never are", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await say("kemar", "Spent the morning pairing with Jodian on the backfill", 1, start.conversationId, noModel);
    const done = await tap("kemar", { act: "stop" }, 2, reads([]).extractor);
    expect((await turn("kemar", start.conversationId, done.composed!, 2)).line).toBe("Got it. Nothing in this one changes a project.");
    const review = (await getReview(db, "kemar", done.composed!)) as Extract<Awaited<ReturnType<typeof getReview>>, { found: true }>;
    expect(review.setAside.unused.map((u) => u.text)).toEqual(["Spent the morning pairing with Jodian on the backfill"]);
  });

  it("SU5: a voice note in the Atlas chat answers like typed words, once transcribed", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor(), { atlasChatId: "dm" });
    await say("kemar", "Done", 1, start.conversationId, noModel, { kind: "voice" });
    expect((await standup()).steps).toEqual([expect.objectContaining({ n: 1, answer: { tap: "done", words: null, by: expect.any(String) } })]);
  });

  it("SU6: he stops half-way: what was answered is composed; the rest is not asked again today", async () => {
    await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await tap("kemar", answer("done"), 1);
    const done = await tap("kemar", { act: "stop" }, 2);
    expect(await standup()).toMatchObject({ state: "composed", endedBy: "stop", steps: [{ n: 1 }], current: null });
    expect((await items(done.composed!)).map((i) => i.draft.target?.id)).toEqual(["wi-145"]);
    await expect(tapStandup(as("kemar", 3), (await standup()).id, 2, answer("done"))).rejects.toThrow("your standup is done; its answers are below");
  });

  it("SU7: he stops answering: the idle timer composes what was answered, or abandons with nothing", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await tap("kemar", answer("done"), 1);
    expect(await runStandupTimers({ db, now: at(60) })).toEqual({ composed: [], ended: [] });
    const r = await runStandupTimers({ db, now: at(61) });
    expect(r.composed).toHaveLength(1);
    expect(await standup()).toMatchObject({ state: "composed", endedBy: "idle", captureId: r.composed[0] });
    expect((await turn("kemar", start.conversationId, start.captureId, 61)).standup?.ended).toBe("You stopped answering, so I put together what you had answered. It's below for you to review.");

    await say("andre", "Start my standup", 0, null, createFixtureExtractor());
    expect(await runStandupTimers({ db, now: at(60) })).toMatchObject({ composed: [] });
    expect(await standup("andre")).toMatchObject({ state: "abandoned", endedBy: "idle" });
  });

  it("SU7: a reply after the idle time ends the standup first and is read as a new message", async () => {
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await tap("kemar", answer("done"), 1);
    const late = await say("kemar", "What am I working on?", 90, start.conversationId);
    expect(late.read).toMatchObject({ state: "answered" });
    expect((await capture(late.captureId)).question).toMatchObject({ topic: "my_work" });
    const row = await standup();
    expect(row).toMatchObject({ state: "composed", endedBy: "idle", steps: [{ n: 1 }] });
    expect((await capture(row.captureId!)).state).toBe("proposed");
  });

  it("SU8: work he lost or left before its question is not asked; the list is rebuilt at each step", async () => {
    await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await db.update(t.workItems).set({ ownerId: "alicia" }).where(eq(t.workItems.id, "wi-151"));
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    await tap("kemar", answer("done"), 1);
    expect((await standup()).current).toMatchObject({ subject: { id: "wi-147" } });
    await tap("kemar", answer("done"), 2);
    // #208 on Store Insights, which he left, is never named: Trend model is due Friday, not today or tomorrow
    expect((await standup()).current).toMatchObject({ kind: "new" });
  });

  it("SU8, P10: a question waiting about a project he has since left is not named in the chat", async () => {
    await db.update(t.workItems).set({ state: "done" }).where(eq(t.workItems.projectId, "forager"));
    const start = await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    expect((await standup()).current).toMatchObject({ subject: { id: "wi-208" } });
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    expect((await turn("kemar", start.conversationId, start.captureId)).standup?.current).toEqual({ n: 1, text: null, taps: [] });
  });

  it("SU9: on leave, a standup is never scheduled (phase F), but one he asks for still runs", async () => {
    // Nothing sends SCHEDULE yet; asking for one on leave is his own choice
    await db.update(t.leave).set({ startDate: "2026-10-19" }).where(eq(t.leave.personId, "kemar"));
    await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    expect((await standup()).state).toBe("asking");
  });
});

describe("rule 6 and P10 on the buttons", () => {
  it("a tap on an earlier question, or sent twice, changes nothing; a tap a question does not offer is refused", async () => {
    await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    const id = (await standup()).id;
    await tapStandup(as("kemar", 1), id, 1, answer("done"));
    await expect(tapStandup(as("kemar", 1), id, 1, answer("done"))).rejects.toThrow("that question was already answered");
    await expect(tapStandup(as("kemar", 1), id, 2, answer("moves"))).rejects.toThrow("that question does not take that answer");
    expect((await standup()).steps).toHaveLength(1);
  });

  it("someone else's standup reads as not found", async () => {
    await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await expect(tapStandup(as("alicia", 1), (await standup()).id, 1, answer("done"))).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the model check's fix: at save, an answer about a record that is not his is asked of its owner (rule 10)", () => {
  it("#145 moved to Jodian after he answered Done: the save stops, the card asks Jodian, and accepted again it asks her and changes nothing", async () => {
    await say("kemar", "Start my standup", 0, null, createFixtureExtractor());
    await tap("kemar", answer("done"), 1);
    const done = await tap("kemar", { act: "stop" }, 2);
    await db.update(t.workItems).set({ ownerId: "jodian" }).where(eq(t.workItems.id, "wi-145"));
    await openReview(as("kemar", 3), done.composed!);
    expect(await saveCapture(as("kemar", 3), done.composed!)).toMatchObject({ outcome: "conflict", refused: [] });
    const review = (await getReview(db, "kemar", done.composed!)) as Extract<Awaited<ReturnType<typeof getReview>>, { found: true }>;
    expect(review.groups[0].items[0].conflict?.reason).toBe("#145 is Jodian's now, so saving asks Jodian instead of changing it. Accept it to ask, or reject it");
    const [item] = await items(done.composed!);
    await decideExtraction(as("kemar", 4), item.id, { type: "accept" });
    expect((await saveCapture(as("kemar", 4), done.composed!)).outcome).toBe("saved");
    expect((await work("wi-145")).state).toBe("in_progress");
    expect(await db.select().from(t.ownerAsks)).toEqual([expect.objectContaining({ ownerId: "jodian", authorId: "kemar", value: "done", state: "asked" })]);
  });

  it("the other way: an Ask to Jodian about #160, which is his since, is written by him once he accepts it again", async () => {
    const said: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#160", label: "#160" }, targetId: "wi-160", field: "state", newValue: "done", quote: "Jodian finished #160", confidence: "high", rationale: "" };
    const { captureId } = await say("kemar", "Jodian finished #160.", 0, null, reads([said]).extractor);
    const [asked] = await items(captureId);
    expect(asked.draft.ask).toEqual({ ownerId: "jodian" });
    await openReview(as("kemar", 1), captureId);
    await decideExtraction(as("kemar", 1), asked.id, { type: "accept" });
    await db.update(t.workItems).set({ ownerId: "kemar" }).where(eq(t.workItems.id, "wi-160"));
    expect(await saveCapture(as("kemar", 2), captureId)).toMatchObject({ outcome: "conflict" });
    const [now] = await items(captureId);
    expect(now.draft.ask).toBeUndefined();
    expect(now.conflict?.reason).toBe("You can change #160 yourself now, so saving changes it instead of asking Jodian. Accept it to change it, or reject it");
    await decideExtraction(as("kemar", 3), asked.id, { type: "accept" });
    expect((await saveCapture(as("kemar", 3), captureId)).outcome).toBe("saved");
    expect((await work("wi-160")).state).toBe("done");
    expect(await db.select().from(t.ownerAsks)).toEqual([]);
  });
});
