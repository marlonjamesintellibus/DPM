// Phase D against PGlite (conversational plan, section 6): Atlas asks when unsure (M21). A vague update, an
// item that could go to 2 or 3 projects, or a reply that could mean 2 or 3 lines of the open answer gets one
// question in the author's own chat, with the options as buttons; a typed answer is read against them only.
// Every edge case CL1 to CL8, the model check's three fixes, and phase B's AC6 and AC7 asked as a question.
// Wave 4 (CD50): a question whose words fit 2 or 3 projects (EX5) or people (PP2, WY8) is asked the same way.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Extractor } from "../atlas/extractor";
import { createFixtureExtractor, VAGUE_FEED } from "../atlas/fixture";
import type { Db } from "../db/client";
import { loadBraidLog, loadItems } from "../db/records";
import { seedE2e } from "../db/seed/e2e";
import * as t from "../db/schema";
import type { RawCommand } from "../domain/acting";
import type { RawProposal } from "../domain/atlas-checks/types";
import { optionGoneText } from "../domain/machines/clarification";
import { NOBODY } from "../queries/answers/people";
import { NOT_WHY } from "../queries/answers/why";
import { getThread } from "../queries/chat";
import { loadCheckContext } from "../queries/check-context";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { reportBraidEntry } from "./braid";
import { createCapture, decideExtraction, discardCapture, openReview, pickRecordExtraction, runCaptureTimers, saveCapture } from "./capture";
import { confirmCommand } from "./chat-command";
import { answerClarification, askIfUnsure, runClarificationTimers } from "./clarification";

let db: Db;
let n = 0;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const capture = async (id: string) => (await db.select().from(t.captures).where(eq(t.captures.id, id)))[0];
const question = async (captureId: string) => (await db.select().from(t.clarifications).where(eq(t.clarifications.captureId, captureId)))[0];
const items = async (captureId: string) => (await loadItems(db, captureId)).items;
const work = async (id: string) => (await db.select().from(t.workItems).where(eq(t.workItems.id, id)))[0];
const turn = async (who: string, conversationId: string, captureId: string, minutes = 0) => {
  const thread = await getThread(db, who, conversationId, at(minutes));
  if (!thread.found) throw new Error("no thread");
  return thread.turns.find((c) => c.id === captureId)!;
};

/** A message in the DPM chat (the Atlas app with kind voice), read by Atlas: the recorded fixture by default. */
async function say(who: string, text: string, minutes = 0, conversationId: string | null = null, extractor: Extractor = createFixtureExtractor(), kind: "text" | "voice" = "text") {
  const ctx = as(who, minutes);
  const channel = kind === "voice" ? "atlas" : "app";
  const created = await createCapture(ctx, { channel, messageId: `d-${++n}`, kind, text, messageAt: at(minutes), receivedAt: at(minutes), conversationId, transcriptConfidence: kind === "voice" ? "high" : null });
  const read = await readCapture(ctx, created.captureId, extractor, { retryDelayMs: () => 0 });
  return { captureId: created.captureId, conversationId: created.conversationId!, read };
}

/** Atlas that reads a message as these proposals and commands. */
const reads = (proposals: RawProposal[], commands: RawCommand[] = []): Extractor => ({
  name: "fake",
  extract: async () => ({ proposals, question: null, commands, malformed: [], model: "fake", usage: null }),
});
/** No model may be asked: a typed answer is DPM's to read (CL2). */
const noModel: Extractor = {
  name: "none",
  extract: async () => {
    throw new Error("a typed answer must not reach the model");
  },
};

/** "Waiting on the vendor's data, it may be late": a risk that fits more than one of Kemar's projects. */
const unsureRisk = (options: string[] = ["forager", "insights"], quote = "Waiting on the vendor's data, it may be late"): RawProposal => ({
  kind: "braid_new",
  projectId: null,
  routingReason: { basis: "ambiguous", evidence: "", label: "" },
  options,
  braidKind: "risk",
  braidTitle: "Vendor data may be late",
  quote,
  confidence: "medium",
  rationale: "You said the vendor may be late.",
});

/** "Worked on the store feed today": an update Atlas could only guess is #151, when it may be #152. */
const vagueFeed: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "store feed", label: "#151" }, targetId: "wi-151", targetOptions: ["wi-151", "wi-152"], field: "state", newValue: "in_progress", quote: "Worked on the store feed today", confidence: "medium", rationale: "" };
/** A sure update to one record's state. */
const sure = (targetId: string, newValue: string, quote: string, replacesItemId: string | null = null): RawProposal => ({ kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: quote, label: quote }, targetId, field: "state", newValue, quote, confidence: "high", rationale: "", replacesItemId });

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("CHECKS_DONE: asked in the author's own chat", () => {
  it("a vague update whose words fit #151 and #152 asks which, with both as buttons; the item waits in review for his OK", async () => {
    const { captureId, conversationId } = await say("kemar", VAGUE_FEED);
    expect((await capture(captureId)).state).toBe("proposed");
    expect(await question(captureId)).toMatchObject({ about: "record", state: "asked", extractionId: `${captureId}-1`, options: [{ id: "wi-151" }, { id: "wi-152" }] });
    const [item] = await items(captureId);
    expect(item).toMatchObject({ state: "needs_ok", draft: { target: { id: "wi-151" }, closeMatches: { ids: ["wi-151", "wi-152"], chosen: null } } });
    const shown = await turn("kemar", conversationId, captureId);
    expect(shown.clarification).toEqual({
      id: `clr-${captureId}`,
      about: "record",
      state: "asked",
      question: 'For "Worked on the store feed today", do you mean #151 Store sales feed access or #152 Store feed connector?',
      options: [
        { id: "wi-151", label: "#151 Store sales feed access" },
        { id: "wi-152", label: "#152 Store feed connector" },
      ],
      outcome: null,
    });
  });

  it("choose_project with 2 or 3 candidates asks which project; with 4, only the review card asks (ProjectCap)", async () => {
    const two = await say("kemar", "Waiting on the vendor's data, it may be late.", 0, null, reads([unsureRisk()]));
    expect(await question(two.captureId)).toMatchObject({ about: "project", options: [{ id: "forager", label: "Forager 2.0" }, { id: "insights", label: "Store Insights" }] });
    expect((await turn("kemar", two.conversationId, two.captureId)).clarification?.question).toBe('Which project is "Waiting on the vendor\'s data, it may be late" for: Forager 2.0 or Store Insights?');

    // A fourth project of Kemar's: an item that could be any of them stays with the review card
    const [g] = await db.select().from(t.groups).where(eq(t.groups.id, "g-gq"));
    await db.insert(t.groups).values({ ...g, id: "g-retail", name: "Retail pilot" });
    await db.insert(t.groupMembers).values({ groupId: "g-retail", personId: "kemar" });
    await db.insert(t.projects).values({ id: "retail", groupId: "g-retail", name: "Retail pilot", aliases: [], customer: null, ownerId: "kemar", contractType: "internal" });
    await db.insert(t.projectMemberships).values({ projectId: "retail", personId: "kemar", role: "pm", state: "member" });
    const four = await say("kemar", "Waiting on the vendor's data, it may be late again.", 1, null, reads([unsureRisk([], "Waiting on the vendor's data, it may be late again")]));
    expect((await items(four.captureId))[0].draft).toMatchObject({ routing: "choose_project", options: ["forager", "insights", "gq", "retail"] });
    expect(await question(four.captureId)).toBeUndefined();
  });

  it("CD23: one question per capture, about the first unsure item in the message", async () => {
    const text = "Waiting on the vendor's data, it may be late. Worked on the store feed today.";
    // Atlas lists the feed first; the message says the risk first
    const { captureId } = await say("kemar", text, 0, null, reads([vagueFeed, unsureRisk()]));
    expect(await db.select().from(t.clarifications)).toHaveLength(1);
    expect(await question(captureId)).toMatchObject({ about: "project", extractionId: `${captureId}-2` });
  });

  it("rule 6: a read delivered twice asks once", async () => {
    const { captureId } = await say("kemar", VAGUE_FEED);
    const row = await capture(captureId);
    const ctx = await loadCheckContext(db, { authorId: "kemar", text: row.text, messageAt: row.messageAt, transcriptConfidence: null, captureId });
    const kept = await items(captureId);
    const twice = await db.transaction((tx) => askIfUnsure(tx, at(1), row, kept, null, ctx));
    expect(twice).toBeNull();
    expect(await db.select().from(t.clarifications)).toHaveLength(1);
  });

  it("never an option the checks would refuse: an update to #151 needing a project can only be Forager's, so nothing is asked", async () => {
    const { captureId } = await say("kemar", "Waiting on the vendor's data, it may be late.", 0, null, reads([unsureRisk()]));
    const row = await capture(captureId);
    const ctx = await loadCheckContext(db, { authorId: "kemar", text: row.text, messageAt: row.messageAt, transcriptConfidence: null, captureId });
    const [risk] = await items(captureId);
    const update = { ...risk, id: "other", draft: { ...risk.draft, kind: "update" as const, braid: undefined, target: { type: "work_item" as const, id: "wi-151", field: "state", oldValue: "in_progress", newValue: "done" }, options: ["forager", "insights", "gq"] } };
    const asked = await db.transaction((tx) => askIfUnsure(tx, at(1), { ...row, id: "cap-other" }, [update], null, ctx));
    expect(asked).toBeNull();
  });

  it("section 6: never a record another item of the message already changes: beside '#152 is done' only #151 is left, so nothing is asked and the update saves", async () => {
    const text = "Worked on the store feed today. #152 is done.";
    const { captureId } = await say("kemar", text, 0, null, reads([vagueFeed, sure("wi-152", "done", "#152 is done")]));
    expect(await question(captureId)).toBeUndefined();
    const [feed, done] = await items(captureId);
    // #151 is in progress already, so with no other record to mean the first item changes nothing
    expect([feed.draft.target?.id, feed.draft.closeMatches, feed.state, done.draft.target?.id]).toEqual(["wi-151", undefined, "no_change", "wi-152"]);
    await openReview(as("kemar", 1), captureId);
    await decideExtraction(as("kemar", 2), done.id, { type: "accept" });
    expect((await saveCapture(as("kemar", 3), captureId)).outcome).toBe("saved");
    expect((await work("wi-152")).state).toBe("done");
  });

  it("rules 3 and 8: a message from any Atlas chat but the direct one (a project group, phase I) is never asked about", async () => {
    const ctx = as("kemar");
    const inGroup = await createCapture(ctx, { channel: "atlas", messageId: "grp-1", kind: "text", text: VAGUE_FEED, messageAt: at(0), receivedAt: at(0), atlasChatId: "grp-forager" });
    await readCapture(ctx, inGroup.captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
    // The review card still asks, as it does with four options
    expect((await items(inGroup.captureId))[0]).toMatchObject({ state: "needs_ok", draft: { closeMatches: { ids: ["wi-151", "wi-152"], chosen: null } } });
    expect(await question(inGroup.captureId)).toBeUndefined();
    // The same words in his direct chat with Atlas are asked about there
    const direct = await createCapture(ctx, { channel: "atlas", messageId: "dm-1", kind: "text", text: VAGUE_FEED, messageAt: at(1), receivedAt: at(1) });
    await readCapture(ctx, direct.captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
    expect(await question(direct.captureId)).toMatchObject({ state: "asked" });
  });

  it("CL7: a voice note is asked about in text, after its transcript", async () => {
    const { captureId, conversationId } = await say("kemar", VAGUE_FEED, 0, null, createFixtureExtractor(), "voice");
    expect((await turn("kemar", conversationId, captureId)).clarification?.question).toContain("do you mean #151 Store sales feed access or #152 Store feed connector?");
  });

  it("CL8: with no model connected nothing is proposed, so nothing is asked", async () => {
    const { captureId, read } = await say("kemar", "Worked on the store feed again.");
    expect(read.outcome).toBe("failed");
    expect(await question(captureId)).toBeUndefined();
  });
});

describe("ANSWER by a button", () => {
  it("#152: the item is read again for #152 and still waits for his OK; the review shows it chosen; saving changes #152, never #151", async () => {
    const { captureId, conversationId } = await say("kemar", VAGUE_FEED);
    const r = await answerClarification(as("kemar", 2), `clr-${captureId}`, "wi-152");
    expect(r.message).toBe("Got it: #152 Store feed connector. It's in your review, waiting for your OK.");
    const [item] = await items(captureId);
    expect(item).toMatchObject({ state: "needs_ok", saw: "to_do", value: "in_progress", draft: { target: { id: "wi-152", oldValue: "to_do", newValue: "in_progress" }, routingReason: "#152", closeMatches: { chosen: "chat" } } });
    // Rule 1: answering changed no record, and the capture is still waiting for review
    expect((await work("wi-152")).state).toBe("to_do");
    expect((await capture(captureId)).state).toBe("proposed");
    expect((await turn("kemar", conversationId, captureId, 2)).clarification).toMatchObject({ state: "resolved", outcome: "Got it: #152 Store feed connector. It's in your review, waiting for your OK." });
    // Rule 6: a second tap changes nothing and says how it ended
    expect((await answerClarification(as("kemar", 3), `clr-${captureId}`, "wi-151")).message).toBe(r.message);
    expect((await items(captureId))[0].draft.target?.id).toBe("wi-152");

    await openReview(as("kemar", 4), captureId);
    const review = await getReview(db, "kemar", captureId);
    expect(review.found && review.items[0]).toMatchObject({ title: "Issue #152 Store feed connector", closeMatches: { chosen: "chat" } });
    await decideExtraction(as("kemar", 5), item.id, { type: "accept" });
    await saveCapture(as("kemar", 6), captureId);
    expect([(await work("wi-151")).state, (await work("wi-152")).state]).toEqual(["in_progress", "in_progress"]);
  });

  it("a project: the item is routed there through M14, and the review says he chose it in the chat", async () => {
    const { captureId } = await say("kemar", "Waiting on the vendor's data, it may be late.", 0, null, reads([unsureRisk()]));
    expect((await answerClarification(as("kemar", 1), `clr-${captureId}`, "insights")).message).toBe("Got it: Store Insights. It's in your review, waiting for your OK.");
    expect((await items(captureId))[0].draft).toMatchObject({ routing: "routed", projectId: "insights", routingReason: "You chose it in the chat" });
    const audit = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.captureId, captureId), eq(t.auditEntries.machine, "routing")));
    expect(audit.map((a) => [a.action, a.actorId])).toEqual([["PICK", "kemar"]]);
  });

  it("CL5: an option cancelled since is refused when tapped, and the other still works", async () => {
    const { captureId } = await say("kemar", VAGUE_FEED);
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-152"));
    await expect(answerClarification(as("kemar", 1), `clr-${captureId}`, "wi-152")).rejects.toMatchObject({ reason: optionGoneText("record") });
    expect(await question(captureId)).toMatchObject({ state: "asked", chosen: null });
    expect((await items(captureId))[0].draft.target?.id).toBe("wi-151");
    expect((await answerClarification(as("kemar", 2), `clr-${captureId}`, "wi-151")).message).toContain("#151 Store sales feed access");
  });

  it("CL5, P10: after he leaves a project, its option is refused and no longer shown; the rest still work", async () => {
    const { captureId, conversationId } = await say("kemar", "Waiting on the vendor's data, it may be late.", 0, null, reads([unsureRisk()]));
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const shown = (await turn("kemar", conversationId, captureId, 1)).clarification!;
    expect(shown.options).toEqual([{ id: "forager", label: "Forager 2.0" }]);
    expect(shown.question).not.toContain("Store Insights");
    await expect(answerClarification(as("kemar", 1), `clr-${captureId}`, "insights")).rejects.toMatchObject({ reason: optionGoneText("project") });
    await answerClarification(as("kemar", 2), `clr-${captureId}`, "forager");
    expect((await items(captureId))[0].draft.projectId).toBe("forager");
  });

  it("section 6: a record another item of the update has taken since is refused, and the review no longer offers it", async () => {
    const text = "Worked on the store feed today. Trend connector work too.";
    const trend: RawProposal = { ...vagueFeed, routingReason: { basis: "target", evidence: "trend connector", label: "#145" }, targetId: "wi-145", targetOptions: ["wi-145", "wi-152"], quote: "Trend connector work too" };
    const { captureId } = await say("kemar", text, 0, null, reads([vagueFeed, trend]));
    expect(await question(captureId)).toMatchObject({ extractionId: `${captureId}-1`, options: [{ id: "wi-151" }, { id: "wi-152" }] });
    await answerClarification(as("kemar", 1), `clr-${captureId}`, "wi-152");
    await openReview(as("kemar", 2), captureId);
    const review = await getReview(db, "kemar", captureId);
    expect(review.found && review.items.find((i) => i.id === `${captureId}-2`)?.closeMatches).toEqual({ others: [], chosen: null });
    // Two items on #152's state could never both save
    await expect(pickRecordExtraction(as("kemar", 3), `${captureId}-2`, "wi-152")).rejects.toMatchObject({ reason: "another part of this update already changes that one" });
    expect((await items(captureId)).map((i) => i.draft.target?.id)).toEqual(["wi-152", "wi-145"]);
  });

  it("rule 10: only the author answers; anyone else's tap reads as not found, and an option it never offered is refused", async () => {
    const { captureId } = await say("kemar", VAGUE_FEED);
    await expect(answerClarification(as("alicia", 1), `clr-${captureId}`, "wi-152")).rejects.toMatchObject({ code: "not_found" });
    await expect(answerClarification(as("kemar", 1), `clr-${captureId}`, "wi-145")).rejects.toMatchObject({ reason: "that is not one of the options" });
    expect((await question(captureId)).state).toBe("asked");
  });
});

describe("ANSWER in words, read against the options only", () => {
  it("CL2: 'the connector one' answers it without asking the model; the reply says what came of it", async () => {
    const first = await say("kemar", VAGUE_FEED);
    const reply = await say("kemar", "the connector one", 1, first.conversationId, noModel);
    expect(reply.read).toMatchObject({ outcome: "proposed", state: "answered" });
    expect(await question(first.captureId)).toMatchObject({ state: "resolved", chosen: "wi-152", answeredBy: reply.captureId });
    expect((await items(first.captureId))[0].draft.target?.id).toBe("wi-152");
    expect((await turn("kemar", first.conversationId, reply.captureId, 1)).answered).toBe("Got it: #152 Store feed connector. It's in your review, waiting for your OK.");
  });

  it("CL2: words that fit no option, or both, are a new message; the question stays", async () => {
    const first = await say("kemar", VAGUE_FEED);
    const seen: string[] = [];
    const reading: Extractor = { name: "fake", extract: async (ctx) => (seen.push(ctx.text), { proposals: [], question: null, commands: [], malformed: [], model: "fake", usage: null }) };
    await say("kemar", "the monitoring one", 1, first.conversationId, reading);
    await say("kemar", "the store feed", 2, first.conversationId, reading);
    expect(seen).toEqual(["the monitoring one", "the store feed"]);
    expect((await question(first.captureId)).state).toBe("asked");
  });

  it("CL1: a new update instead of an answer is read as a new capture; the question stays open until its timer", async () => {
    const first = await say("kemar", VAGUE_FEED);
    const done: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#145", label: "#145" }, targetId: "wi-145", field: "state", newValue: "done", quote: "Finished #145", confidence: "high", rationale: "" };
    const next = await say("kemar", "Finished #145 and the connector tests.", 1, first.conversationId, reads([done]));
    expect((await capture(next.captureId)).state).toBe("proposed");
    expect((await question(first.captureId)).state).toBe("asked");
    // A long message that names an option is still not an answer
    expect((await items(next.captureId)).map((i) => i.draft.target?.id)).toEqual(["wi-145"]);
  });

  it("CL4: two questions open in a conversation: a typed answer goes to the newest; the older one's buttons still work", async () => {
    const older = await say("kemar", VAGUE_FEED);
    const newer = await say("kemar", "Waiting on the vendor's data, it may be late.", 1, older.conversationId, reads([unsureRisk()]));
    await say("kemar", "Store Insights", 2, older.conversationId, noModel);
    expect((await question(newer.captureId)).state).toBe("resolved");
    expect((await question(older.captureId)).state).toBe("asked");
    await answerClarification(as("kemar", 3), `clr-${older.captureId}`, "wi-152");
    expect((await question(older.captureId)).chosen).toBe("wi-152");
  });

  it("CL5, P10: 'the second one' counts over the options he can still see", async () => {
    const first = await say("kemar", "Waiting on the vendor's data, it may be late.", 0, null, reads([unsureRisk(["forager", "insights", "gq"])]));
    expect((await question(first.captureId)).options.map((o) => o.id)).toEqual(["forager", "insights", "gq"]);
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    // The chat shows Forager 2.0 and GQ & Academy: the second of those is GQ
    await say("kemar", "the second one", 1, first.conversationId, noModel);
    expect(await question(first.captureId)).toMatchObject({ state: "resolved", chosen: "gq" });
    expect((await items(first.captureId))[0].draft.projectId).toBe("gq");
  });

  it("a question in another conversation is never answered by words here", async () => {
    const first = await say("kemar", VAGUE_FEED);
    const other = await say("kemar", "#152", 1, null, reads([]));
    expect(other.conversationId).not.toBe(first.conversationId);
    expect((await question(first.captureId)).state).toBe("asked");
  });

  it("CL5: words naming an option that can no longer be chosen say so; the question stays", async () => {
    const first = await say("kemar", VAGUE_FEED);
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-152"));
    const reply = await say("kemar", "#152", 1, first.conversationId, noModel);
    expect(await capture(reply.captureId)).toMatchObject({ state: "answered", commandNote: optionGoneText("record") });
    expect((await question(first.captureId)).state).toBe("asked");
  });
});

describe("handed to the review, or closed", () => {
  it("CL3: opening the review hands the choice to it; the chat says so and a later tap changes nothing; on the review, choosing is confirming", async () => {
    const { captureId, conversationId } = await say("kemar", VAGUE_FEED);
    await openReview(as("kemar", 1), captureId);
    expect(await question(captureId)).toMatchObject({ state: "handed_to_review", endedBy: "review" });
    expect((await turn("kemar", conversationId, captureId, 1)).clarification?.outcome).toBe("Chosen in review.");
    expect((await answerClarification(as("kemar", 2), `clr-${captureId}`, "wi-152")).message).toBe("Chosen in review.");
    expect((await items(captureId))[0].draft.target?.id).toBe("wi-151");

    const review = await getReview(db, "kemar", captureId);
    expect(review.found && review.items[0].closeMatches).toEqual({ others: [{ id: "wi-152", label: "#152 Store feed connector" }], chosen: null });
    const picked = await pickRecordExtraction(as("kemar", 3), `${captureId}-1`, "wi-152");
    expect(picked).toMatchObject({ state: "accepted", draft: { target: { id: "wi-152" }, closeMatches: { chosen: "review" } } });
    await saveCapture(as("kemar", 4), captureId);
    expect((await work("wi-152")).state).toBe("in_progress");
  });

  it("timer clarify_expiry: after 2 hours an item's question goes to its review (CD2)", async () => {
    const { captureId, conversationId } = await say("kemar", VAGUE_FEED);
    expect((await runClarificationTimers({ db, now: at(119) })).expired).toEqual([]);
    expect((await runClarificationTimers({ db, now: at(120) })).expired).toEqual([`clr-${captureId}`]);
    expect((await turn("kemar", conversationId, captureId, 120)).clarification).toMatchObject({ state: "handed_to_review", outcome: "I left this for your review: choose it there." });
    // The review still holds the choice: the item waits for his OK, so nothing saves on its own
    expect((await items(captureId))[0].state).toBe("needs_ok");
  });

  it("a tap after 2 hours expires it there and then, as the timer would", async () => {
    const { captureId } = await say("kemar", VAGUE_FEED);
    expect((await answerClarification(as("kemar", 121), `clr-${captureId}`, "wi-152")).message).toBe("I left this for your review: choose it there.");
    expect((await items(captureId))[0].draft.target?.id).toBe("wi-151");
  });

  it("CL6: discarding the update closes its question; so does the update expiring", async () => {
    const a = await say("kemar", VAGUE_FEED);
    await discardCapture(as("kemar", 1), a.captureId);
    expect(await question(a.captureId)).toMatchObject({ state: "closed", endedBy: "capture" });
    expect((await turn("kemar", a.conversationId, a.captureId, 1)).clarification?.outcome).toBe("Closed with the update.");

    const b = await say("kemar", "Waiting on the vendor's data, it may be late.", 2, null, reads([unsureRisk()]));
    // The review timers remind, then expire it after 7 days; the question's own timer has not run
    await runCaptureTimers({ db, now: at(60 * 24 * 3) });
    await runCaptureTimers({ db, now: at(60 * 24 * 8) });
    expect((await capture(b.captureId)).state).toBe("expired");
    expect(await question(b.captureId)).toMatchObject({ state: "closed", endedBy: "capture" });
  });

  it("CV10, rule 5: a correction that withdraws the item closes its question, whose buttons could never work again", async () => {
    const first = await say("kemar", VAGUE_FEED);
    const fix = sure("wi-152", "in_progress", "That was #152, not #151", `${first.captureId}-1`);
    await say("kemar", "That was #152, not #151. It is in progress now.", 1, first.conversationId, reads([fix]));
    expect((await items(first.captureId))[0].state).toBe("withdrawn");
    expect(await question(first.captureId)).toMatchObject({ state: "closed", endedBy: "corrected" });
    expect((await turn("kemar", first.conversationId, first.captureId, 1)).clarification).toMatchObject({ state: "closed", outcome: "You corrected this in a later message." });
    // Its timer has nothing left to hand to the review
    expect((await runClarificationTimers({ db, now: at(130) })).expired).toEqual([]);
  });
});

describe("a reply that could mean 2 or 3 lines of the open answer (phase B, AC6 and AC7)", () => {
  async function twoRisks() {
    const a = (await reportBraidEntry(as("kemar", -5), "forager", { kind: "risk", title: "Trend model may slip to 24 Oct" })).entry.id;
    const b = (await reportBraidEntry(as("kemar", -5), "forager", { kind: "risk", title: "Trend model may need more data" })).entry.id;
    const asked = await say("alicia", "What needs me today?");
    const cards = (await capture(asked.captureId)).answer!.cards;
    return { a, b, conversationId: asked.conversationId, lineOf: (id: string) => cards.findIndex((c) => c.subject?.id === id) + 1 };
  }

  it("AC7: words that fit two lines ask which; the answer makes the M20 card for that line, which she confirms", async () => {
    const { a, b, conversationId, lineOf } = await twoRisks();
    // The fixture is DPM with no model connected: its own rule read the reply (CL8 asks about no item then,
    // but a reply that decides lines is asked about as with a model; see askIfUnsure)
    const reply = await say("alicia", "Approve the trend model risk", 2, conversationId);
    expect(await capture(reply.captureId)).toMatchObject({ state: "answered", commandNote: null });
    const q = await question(reply.captureId);
    expect(q).toMatchObject({ about: "line", act: "approve", state: "asked" });
    expect(q.options.map((o) => o.id).sort()).toEqual([String(lineOf(a)), String(lineOf(b))].sort());
    expect((await turn("alicia", conversationId, reply.captureId, 2)).clarification?.question).toMatch(/^Did you mean "Kemar raised a risk: Trend model may (slip to 24 Oct|need more data)" or "Kemar raised a risk: Trend model may (slip to 24 Oct|need more data)"\?$/);

    const r = await answerClarification(as("alicia", 3), q.id, String(lineOf(b)));
    expect(r.message).toBe('Got it: "Kemar raised a risk: Trend model may need more data".');
    const [card] = await db.select().from(t.chatCommands).where(eq(t.chatCommands.captureId, reply.captureId));
    expect(card).toMatchObject({ state: "proposed", act: "approve", subjectId: b, via: "words" });
    // Rule 1: the answer only made the card; she confirms it
    expect((await loadBraidLog(db, "forager")).log[b].state).toBe("proposed");
    await confirmCommand(as("alicia", 4), card.id);
    expect([(await loadBraidLog(db, "forager")).log[a].state, (await loadBraidLog(db, "forager")).log[b].state]).toEqual(["proposed", "open"]);
  });

  it("section 6: words that fit two lines, neither offering the act, ask nothing; the chat says neither can take it", async () => {
    const { conversationId } = await twoRisks();
    // Both risks offer Approve and Decline; neither offers Resolve, so every option would be refused
    const reply = await say("alicia", "Resolve the trend model risk", 2, conversationId);
    expect(await question(reply.captureId)).toBeUndefined();
    expect((await capture(reply.captureId)).commandNote).toMatch(/^You can't resolve "Kemar raised a risk: Trend model may [^"]+" or "Kemar raised a risk: Trend model may [^"]+" here\.$/);
  });

  it("the model check's item 1: a reply that also holds an update is still asked which line; the review does not take that question", async () => {
    const { a, b, conversationId, lineOf } = await twoRisks();
    const approve: RawCommand = { act: "approve", lines: [lineOf(a), lineOf(b)], reason: null, by: "author" };
    const reply = await say("alicia", "Approve the trend model risk, and #145 is done.", 2, conversationId, reads([sure("wi-145", "done", "#145 is done")], [approve]));
    expect(await capture(reply.captureId)).toMatchObject({ state: "proposed", commandNote: null });
    expect(await question(reply.captureId)).toMatchObject({ about: "line", state: "asked" });
    await openReview(as("alicia", 3), reply.captureId);
    expect((await question(reply.captureId)).state).toBe("asked");
    await answerClarification(as("alicia", 4), `clr-${reply.captureId}`, String(lineOf(b)));
    expect(await db.select().from(t.chatCommands).where(eq(t.chatCommands.captureId, reply.captureId))).toMatchObject([{ act: "approve", subjectId: b }]);
  });

  it("CL1: passed over, a line's question is answered by a later reply that makes the card for one of its lines; it never says nothing was done", async () => {
    const { a, conversationId, lineOf } = await twoRisks();
    const reply = await say("alicia", "Approve the trend model risk", 2, conversationId);
    const clearer = await say("alicia", "Approve the slip risk", 3, conversationId);
    const cards = await db.select().from(t.chatCommands).where(eq(t.chatCommands.captureId, clearer.captureId));
    expect(cards).toMatchObject([{ act: "approve", subjectId: a, state: "proposed" }]);
    expect(await question(reply.captureId)).toMatchObject({ state: "resolved", chosen: String(lineOf(a)), answeredBy: clearer.captureId });
    // No second card from the question, and its timer has nothing to close
    expect(await db.select().from(t.chatCommands).where(eq(t.chatCommands.captureId, reply.captureId))).toEqual([]);
    expect((await runClarificationTimers({ db, now: at(122) })).expired).toEqual([]);
    expect((await turn("alicia", conversationId, reply.captureId, 122)).clarification?.outcome).toBe('Got it: "Kemar raised a risk: Trend model may slip to 24 Oct".');
    // The clearer reply shows its own card, not a second "Got it"
    const shown = await turn("alicia", conversationId, clearer.captureId, 3);
    expect([shown.commands.length, shown.answered]).toEqual([1, null]);
  });

  it("AC6: words that fit no line ask over the lines that offer the act", async () => {
    const { conversationId } = await twoRisks();
    const reply = await say("alicia", "Approve that risk please", 2, conversationId, reads([], [{ act: "approve", lines: [], reason: null, by: "author" }]));
    expect(await question(reply.captureId)).toMatchObject({ about: "line", state: "asked" });
    expect((await question(reply.captureId)).options).toHaveLength(2);
  });

  it("the model check's fix: a line's question has no review card, so its timer closes it and nothing was done", async () => {
    const { a, b, conversationId } = await twoRisks();
    const reply = await say("alicia", "Approve the trend model risk", 2, conversationId);
    await runClarificationTimers({ db, now: at(122) });
    expect((await turn("alicia", conversationId, reply.captureId, 122)).clarification).toMatchObject({ state: "closed", outcome: "Nothing was done; ask again." });
    expect(await db.select().from(t.chatCommands).where(eq(t.chatCommands.captureId, reply.captureId))).toEqual([]);
    const log = (await loadBraidLog(db, "forager")).log;
    expect([log[a].state, log[b].state]).toEqual(["proposed", "proposed"]);
  });

  it("a line on a project she has left since is refused when chosen (CL5) and no longer shown; the other still makes its card", async () => {
    // One risk on Forager, one on GQ & Academy; Alicia is PM of both
    await reportBraidEntry(as("kemar", -5), "forager", { kind: "risk", title: "Trend model may slip to 24 Oct" });
    const b = (await reportBraidEntry(as("kemar", -5), "gq", { kind: "risk", title: "Trend model course may need more data" })).entry.id;
    const asked = await say("alicia", "What needs me today?");
    const cards = (await capture(asked.captureId)).answer!.cards;
    const onGq = String(cards.findIndex((c) => c.subject?.id === b) + 1);
    const reply = await say("alicia", "Approve the trend model risk", 2, asked.conversationId);
    const q = await question(reply.captureId);
    expect(q.options.map((o) => o.id)).toContain(onGq);
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "gq"), eq(t.projectMemberships.personId, "alicia")));
    expect((await turn("alicia", asked.conversationId, reply.captureId, 3)).clarification?.options.map((o) => o.label)).toEqual(["Kemar raised a risk: Trend model may slip to 24 Oct"]);
    await expect(answerClarification(as("alicia", 3), q.id, onGq)).rejects.toMatchObject({ reason: optionGoneText("line") });
    const other = q.options.find((o) => o.id !== onGq)!;
    await answerClarification(as("alicia", 4), q.id, other.id);
    expect(await db.select().from(t.chatCommands).where(eq(t.chatCommands.captureId, reply.captureId))).toHaveLength(1);
  });
});

describe("a question whose words fit 2 or 3 of the asker's projects or people (CD50)", () => {
  /** Someone joins a project as a member, for the cases the seed does not have (a second Kemar). */
  async function addPerson(id: string, name: string, projectId: string) {
    await db.insert(t.people).values({ id, name, initials: name.slice(0, 2).toUpperCase(), title: null, orgRole: "employee" });
    await db.insert(t.projectMemberships).values({ projectId, personId: id, state: "member", role: "member" });
  }
  /** Alicia shares Forager with Kemar Brown and, from here, with Kemar Smith too. */
  async function twoKemars() {
    await addPerson("kemar-s", "Kemar Smith", "forager");
    return say("alicia", "What is Kemar working on?");
  }
  /** "Insights" is also a name for Forager, so "Explain Insights" fits Forager 2.0 and Store Insights for Kemar. */
  const insightsTwice = () => db.update(t.projects).set({ aliases: ["Forager", "Forager Insights"] }).where(eq(t.projects.id, "forager"));

  it("PP2: 'What is Kemar working on?' asks who, a button each, before any answer; a tap answers it as if it had named him", async () => {
    const { captureId, conversationId } = await twoKemars();
    expect(await capture(captureId)).toMatchObject({ state: "answered", answer: null });
    expect(await question(captureId)).toMatchObject({ about: "question", state: "asked", extractionId: null, question: { fits: "person", asked: { topic: "people" } } });
    expect((await turn("alicia", conversationId, captureId)).clarification).toEqual({
      id: `clr-${captureId}`,
      about: "question",
      state: "asked",
      question: "Who do you mean: Kemar Brown or Kemar Smith?",
      options: [
        { id: "kemar", label: "Kemar Brown" },
        { id: "kemar-s", label: "Kemar Smith" },
      ],
      outcome: null,
    });

    const r = await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar");
    expect(r).toMatchObject({ message: "Got it: Kemar Brown.", answeredIn: captureId });
    const answered = await capture(captureId);
    expect(answered.question).toMatchObject({ topic: "people", chosen: { fits: "person", id: "kemar" } });
    expect(answered.answer).toMatchObject({ topic: "people", wording: "rules" });
    expect(answered.answer!.text).toMatch(/^Kemar Brown has \d+ open work items?\b.* on projects you share; /);
    const shown = await turn("alicia", conversationId, captureId, 1);
    expect([shown.clarification?.outcome, shown.answer?.text]).toEqual(["Got it: Kemar Brown.", answered.answer!.text]);
    // Rule 6: a second tap changes nothing and says how it ended
    expect((await answerClarification(as("alicia", 2), `clr-${captureId}`, "kemar-s")).message).toBe("Got it: Kemar Brown.");
    expect((await capture(captureId)).answer!.text).toBe(answered.answer!.text);
  });

  it("the browser story's own data (db/seed/e2e.ts): Kemar Lee on GQ & Academy makes Alicia's question ask who", async () => {
    await seedE2e(db);
    const { captureId, conversationId } = await say("alicia", "What is Kemar working on?");
    expect((await turn("alicia", conversationId, captureId)).clarification?.question).toBe("Who do you mean: Kemar Brown or Kemar Lee?");
    // Andre shares no project with Kemar Lee: his question is answered at once
    expect((await say("andre", "What is Kemar working on?", 1)).read).toMatchObject({ answer: { text: expect.stringMatching(/^Kemar Brown has /) } });
    // The other story steps that list GQ's people: Phase N's "Who hasn't updated today?" names him on GQ only;
    // its Forager sentence, which the story checks, is as before
    const leads = (await say("alicia", "Who hasn't updated today?", 2)).read;
    expect(leads).toMatchObject({ answer: { text: expect.stringContaining("no update saved today on Forager 2.0: Jodian Taylor and Kemar Brown.") } });
    expect(leads).toMatchObject({ answer: { text: expect.stringContaining("no update saved today on GQ & Academy: Kemar Brown and Kemar Lee.") } });
  });

  it("PP2: two with the same full name are told apart by the projects she shares with each, and only those", async () => {
    await addPerson("kemar-b2", "Kemar Brown", "gq");
    const { captureId, conversationId } = await say("alicia", "What is Kemar Brown working on?");
    // Kept by name only; the projects are said when shown (P10)
    expect((await question(captureId)).options.map((o) => o.label)).toEqual(["Kemar Brown", "Kemar Brown"]);
    expect((await turn("alicia", conversationId, captureId)).clarification).toMatchObject({
      question: "Who do you mean: Kemar Brown (Forager 2.0 and GQ & Academy) or Kemar Brown (GQ & Academy)?",
      options: [
        { id: "kemar", label: "Kemar Brown (Forager 2.0 and GQ & Academy)" },
        { id: "kemar-b2", label: "Kemar Brown (GQ & Academy)" },
      ],
    });
    // Typed, the project tells them apart too
    await say("alicia", "the Forager one", 1, conversationId, noModel);
    expect(await question(captureId)).toMatchObject({ state: "resolved", chosen: "kemar" });
  });

  it("P10: a project she has left since she was asked is never named, in the question, the tap or a follow-up", async () => {
    await addPerson("kemar-b2", "Kemar Brown", "gq");
    const { captureId, conversationId } = await say("alicia", "What is Kemar Brown working on?");
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "gq"), eq(t.projectMemberships.personId, "alicia")));
    const shown = (await turn("alicia", conversationId, captureId, 1)).clarification!;
    expect([shown.question, shown.options]).toEqual(["Who do you mean: Kemar Brown?", [{ id: "kemar", label: "Kemar Brown" }]]);
    expect((await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar")).message).toBe("Got it: Kemar Brown.");
    expect((await turn("alicia", conversationId, captureId, 1)).clarification?.outcome).toBe("Got it: Kemar Brown.");
    const next = await say("alicia", "and on Forager?", 2, conversationId);
    expect((await capture(next.captureId)).answer!.text).toMatch(/^Kemar Brown has /);
    for (const c of [captureId, next.captureId]) expect(JSON.stringify(await capture(c))).not.toContain("GQ");
  });

  it("CV8: a follow-up after the tap keeps the one chosen ('and on GQ?' is about Kemar Brown)", async () => {
    const { captureId, conversationId } = await twoKemars();
    await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar");
    const next = await say("alicia", "and on GQ?", 2, conversationId);
    expect((await capture(next.captureId)).answer!.text).toMatch(/^Kemar Brown has nothing open on GQ & Academy\./);
    expect(await question(next.captureId)).toBeUndefined();
  });

  it("CV8, CL2: a follow-up after a typed answer that does not say the name keeps the one chosen ('the second one')", async () => {
    const first = await twoKemars();
    await say("alicia", "the second one", 1, first.conversationId, noModel);
    expect(await question(first.captureId)).toMatchObject({ state: "resolved", chosen: "kemar-s" });
    const next = await say("alicia", "and on GQ?", 2, first.conversationId);
    expect((await capture(next.captureId)).answer!.text).toBe("Kemar Smith is not on GQ & Academy.");
    // Newer words that name someone still decide: "and Kemar Brown?" is about him
    const other = await say("alicia", "and Kemar Brown?", 3, first.conversationId);
    expect((await capture(other.captureId)).answer!.text).toMatch(/^Kemar Brown has /);
  });

  it("CV8, PP2: a follow-up after choosing one of two with the same full name is about that one, never asked again", async () => {
    await addPerson("kemar-b2", "Kemar Brown", "gq");
    const { captureId, conversationId } = await say("alicia", "What is Kemar Brown working on?");
    await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar-b2");
    const next = await say("alicia", "and on GQ?", 2, conversationId);
    expect(await question(next.captureId)).toBeUndefined();
    expect((await capture(next.captureId)).answer!.text).toBe("Kemar Brown has nothing open on GQ & Academy.");
    // Kemar Brown on Forager has work there; the one chosen has none
    const forager = await say("alicia", "and on Forager?", 3, conversationId);
    expect((await capture(forager.captureId)).answer!.text).toBe("Kemar Brown is not on Forager 2.0.");
  });

  it("CV8, P10: a follow-up about someone chosen whom she no longer shares a project with gets the words for nobody", async () => {
    const { captureId, conversationId } = await twoKemars();
    await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar-s");
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "kemar-s")));
    const next = await say("alicia", "and on GQ?", 2, conversationId);
    expect((await capture(next.captureId)).answer!.text).toBe(NOBODY);
    expect(await question(next.captureId)).toBeUndefined();
  });

  it("EX5, CV8: a follow-up after choosing a project is about that project", async () => {
    await insightsTwice();
    const { captureId, conversationId } = await say("kemar", "Explain Insights");
    await say("kemar", "Sprouts", 1, conversationId, noModel);
    expect(await question(captureId)).toMatchObject({ state: "resolved", chosen: "insights" });
    const next = await say("kemar", "and where do I start?", 2, conversationId);
    expect(await question(next.captureId)).toBeUndefined();
    expect((await capture(next.captureId)).answer!.text).toMatch(/^Store Insights is for Sprouts/);
  });

  it("EX5: 'Explain Insights' with two of his projects fitting asks which project; choosing Store Insights explains it", async () => {
    await insightsTwice();
    const { captureId, conversationId } = await say("kemar", "Explain Insights");
    expect((await turn("kemar", conversationId, captureId)).clarification?.question).toBe("Which project do you mean: Forager 2.0 or Store Insights?");
    expect((await answerClarification(as("kemar", 1), `clr-${captureId}`, "insights")).message).toBe("Got it: Store Insights.");
    expect((await capture(captureId)).answer!.text).toMatch(/^Store Insights is for Sprouts, from Mon 5 Oct to Fri 18 Dec, and Andre Mitchell owns it\./);
  });

  it("EX5, EX4: an outside contact is asked which of his client views, and nothing else is offered", async () => {
    await insightsTwice();
    await db.insert(t.projectContacts).values({ projectId: "insights", personId: "kyle", tie: "contact", clientView: true });
    const { captureId } = await say("kyle", "Explain Insights");
    expect((await question(captureId)).options).toEqual([
      { id: "forager", label: "Forager 2.0", projectId: null },
      { id: "insights", label: "Store Insights", projectId: null },
    ]);
    await answerClarification(as("kyle", 1), `clr-${captureId}`, "insights");
    const answer = (await capture(captureId)).answer!;
    expect(answer.text).toMatch(/^Store Insights is for Sprouts, from Mon 5 Oct to Fri 18 Dec\. /);
    // The client view only: no owner, status or people
    for (const word of ["Andre", "track", "thread"]) expect(answer.text).not.toContain(word);
  });

  it("CL2: a typed answer is read against the options; the reply carries the answer and says no 'Got it' of its own", async () => {
    const first = await twoKemars();
    const reply = await say("alicia", "Kemar Smith", 1, first.conversationId, noModel);
    expect(reply.read).toMatchObject({ outcome: "proposed", state: "answered" });
    expect(await question(first.captureId)).toMatchObject({ state: "resolved", chosen: "kemar-s", answeredBy: reply.captureId });
    expect(await capture(reply.captureId)).toMatchObject({ question: { topic: "people", chosen: { id: "kemar-s" } }, answer: { text: "Kemar Smith has nothing open on Forager 2.0." } });
    // The question's own message still has no answer; the chat shows it under the reply
    expect((await capture(first.captureId)).answer).toBeNull();
    const shown = await turn("alicia", first.conversationId, reply.captureId, 1);
    expect([shown.answered, shown.answer?.text]).toEqual([null, "Kemar Smith has nothing open on Forager 2.0."]);
    expect((await turn("alicia", first.conversationId, first.captureId, 1)).clarification?.outcome).toBe("Got it: Kemar Smith.");
  });

  it("CD61: asked again in her own words, naming one of them, the open question closes quietly and the new message is answered", async () => {
    const first = await twoKemars();
    // Another topic, or the same topic about someone else, leaves it asking
    await say("alicia", "What is Forager?", 1, first.conversationId);
    await say("alicia", "What is Andre working on?", 2, first.conversationId);
    expect((await question(first.captureId)).state).toBe("asked");
    const again = await say("alicia", "What is Kemar Smith working on?", 3, first.conversationId);
    expect(await question(first.captureId)).toMatchObject({ state: "closed", endedBy: "asked_again", chosen: null });
    expect((await capture(again.captureId)).answer!.text).toBe("Kemar Smith has nothing open on Forager 2.0.");
    expect((await turn("alicia", first.conversationId, first.captureId, 4)).clarification?.outcome).toBe("You asked again.");
    // Its timer has nothing left to close
    expect((await runClarificationTimers({ db, now: at(3 * 60) })).expired).not.toContain(`clr-${first.captureId}`);
  });

  it("CL2: 'the second one' counts over the options shown; a first name both have is a new message, and the question stays", async () => {
    const first = await twoKemars();
    await say("alicia", "Kemar", 1, first.conversationId, reads([]));
    expect((await question(first.captureId)).state).toBe("asked");
    await say("alicia", "the second one", 2, first.conversationId, noModel);
    expect(await question(first.captureId)).toMatchObject({ state: "resolved", chosen: "kemar-s" });
  });

  it("CL5, P10: someone she no longer shares a project with is refused with the gone words, never named, and the other still answers", async () => {
    const { captureId, conversationId } = await twoKemars();
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "kemar-s")));
    const shown = (await turn("alicia", conversationId, captureId, 1)).clarification!;
    expect(shown.options).toEqual([{ id: "kemar", label: "Kemar Brown" }]);
    expect(shown.question).not.toContain("Smith");
    await expect(answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar-s")).rejects.toMatchObject({ reason: optionGoneText("question") });
    expect(await question(captureId)).toMatchObject({ state: "asked", chosen: null });
    expect((await capture(captureId)).answer).toBeNull();
    // Typed, a name she can no longer ask about is no answer at all: it is read as a new message
    const typed = await say("alicia", "Kemar Smith", 2, conversationId, reads([]));
    expect((await capture(typed.captureId)).commandNote).toBeNull();
    expect((await question(captureId)).state).toBe("asked");
    await answerClarification(as("alicia", 3), `clr-${captureId}`, "kemar");
    expect((await capture(captureId)).answer!.text).toMatch(/^Kemar Brown has /);
  });

  it("CL5, P10: a project he has left since is refused, and the project still his still explains", async () => {
    await insightsTwice();
    const { captureId } = await say("kemar", "Explain Insights");
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    await expect(answerClarification(as("kemar", 1), `clr-${captureId}`, "insights")).rejects.toMatchObject({ reason: optionGoneText("question") });
    await answerClarification(as("kemar", 2), `clr-${captureId}`, "forager");
    expect((await capture(captureId)).answer!.text).toMatch(/^Forager 2\.0 is for Sprouts/);
  });

  it("CL5, P10: a second tap after she stops sharing a project with the one chosen says how it ended without naming him, as the chat does", async () => {
    const { captureId, conversationId } = await twoKemars();
    expect((await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar-s")).message).toBe("Got it: Kemar Smith.");
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "kemar-s")));
    expect((await answerClarification(as("alicia", 2), `clr-${captureId}`, "kemar-s")).message).toBe("Got it.");
    expect((await turn("alicia", conversationId, captureId, 2)).clarification?.outcome).toBe("Got it.");
  });

  it("EX5: a typed answer by another name of the project ('Sprouts', Store Insights' alias) chooses it", async () => {
    await insightsTwice();
    const first = await say("kemar", "Explain Insights");
    const reply = await say("kemar", "Sprouts", 1, first.conversationId, noModel);
    expect(await question(first.captureId)).toMatchObject({ state: "resolved", chosen: "insights", answeredBy: reply.captureId });
    expect((await capture(reply.captureId)).answer!.text).toMatch(/^Store Insights is for Sprouts/);
  });

  it("ProjectCap: words that fit 4 or more people are not asked through M21; the answer's own words ask for the name", async () => {
    for (const [id, name] of [["kemar-s", "Kemar Smith"], ["kemar-l", "Kemar Lee"], ["kemar-w", "Kemar White"]]) await addPerson(id, name, "forager");
    const { captureId, conversationId } = await say("alicia", "What is Kemar working on?");
    expect(await question(captureId)).toBeUndefined();
    expect((await capture(captureId)).answer!.text).toBe('Did you mean Kemar Brown, Kemar Lee, Kemar Smith or Kemar White? Ask again with their full name, for example "and Kemar White?"');
    expect((await turn("alicia", conversationId, captureId)).clarification).toBeNull();
  });

  it("CL6: a message with an update and a question that asks which closes its question when the update is discarded, or expires", async () => {
    await insightsTwice();
    const both = (quote: string): Extractor => ({
      name: "fake",
      extract: async () => ({ proposals: [sure("wi-152", "done", quote)], question: { asked: "Explain Insights", topic: "explain_project", projectId: null }, commands: [], malformed: [], model: "fake", usage: null }),
    });
    const a = await say("kemar", "#152 is done. Explain Insights", 0, null, both("#152 is done"));
    expect(await capture(a.captureId)).toMatchObject({ state: "proposed", answer: null });
    expect(await question(a.captureId)).toMatchObject({ about: "question", state: "asked" });
    await discardCapture(as("kemar", 1), a.captureId);
    expect(await question(a.captureId)).toMatchObject({ state: "closed", endedBy: "capture" });
    await expect(answerClarification(as("kemar", 2), `clr-${a.captureId}`, "insights")).resolves.toMatchObject({ answeredIn: null });
    expect((await capture(a.captureId)).answer).toBeNull();

    const b = await say("kemar", "#152 is done now. Explain Insights", 2, null, both("#152 is done now"));
    expect(await question(b.captureId)).toMatchObject({ about: "question", state: "asked" });
    // The review timers remind, then expire it after 7 days; the question's own timer has not run
    await runCaptureTimers({ db, now: at(60 * 24 * 3) });
    await runCaptureTimers({ db, now: at(60 * 24 * 8) });
    expect((await capture(b.captureId)).state).toBe("expired");
    expect(await question(b.captureId)).toMatchObject({ state: "closed", endedBy: "capture" });
  });

  it("CL7: a voice question that fits two people is asked about in text, after its transcript", async () => {
    await addPerson("kemar-s", "Kemar Smith", "forager");
    const { captureId, conversationId } = await say("alicia", "What is Kemar working on?", 0, null, createFixtureExtractor(), "voice");
    expect((await turn("alicia", conversationId, captureId)).clarification).toMatchObject({ about: "question", question: "Who do you mean: Kemar Brown or Kemar Smith?" });
    await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar");
    expect((await capture(captureId)).answer!.text).toMatch(/^Kemar Brown has /);
  });

  it("CD23: one question per message: an unsure item in the same message is asked about, and the question's answer says the names", async () => {
    await addPerson("kemar-s", "Kemar Smith", "forager");
    const text = "Waiting on the vendor's data, it may be late. What is Kemar working on?";
    const asking: Extractor = {
      name: "fake",
      extract: async () => ({ proposals: [unsureRisk(["forager", "gq"])], question: { asked: "What is Kemar working on?", topic: "people", projectId: null }, commands: [], malformed: [], model: "fake", usage: null }),
    };
    const { captureId } = await say("alicia", text, 0, null, asking);
    expect(await db.select().from(t.clarifications)).toHaveLength(1);
    expect(await question(captureId)).toMatchObject({ about: "project" });
    expect((await capture(captureId)).answer!.text).toBe('Did you mean Kemar Brown or Kemar Smith? Ask again with their full name, for example "and Kemar Smith?"');
  });

  it("CL4: two questions open in a conversation: a typed answer goes to the newest, and the older one's buttons still work", async () => {
    const older = await twoKemars();
    // A different question (WY8), so asking it does not close the older one (CD61)
    const newer = await say("alicia", "Why is Kemar behind?", 1, older.conversationId);
    expect((await question(newer.captureId)).state).toBe("asked");
    await say("alicia", "Smith", 2, older.conversationId, noModel);
    expect((await question(newer.captureId)).state).toBe("resolved");
    expect((await question(older.captureId)).state).toBe("asked");
    await answerClarification(as("alicia", 3), `clr-${older.captureId}`, "kemar");
    expect((await question(older.captureId)).chosen).toBe("kemar");
  });

  it("rules 3 and 8: asked in no other chat; there the answer says the names, as before", async () => {
    await addPerson("kemar-s", "Kemar Smith", "forager");
    const ctx = as("alicia");
    const inGroup = await createCapture(ctx, { channel: "atlas", messageId: "grp-q", kind: "text", text: "What is Kemar working on?", messageAt: at(0), receivedAt: at(0), atlasChatId: "grp-forager" });
    await readCapture(ctx, inGroup.captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
    expect(await question(inGroup.captureId)).toBeUndefined();
    expect((await capture(inGroup.captureId)).answer!.text).toMatch(/^Did you mean Kemar Brown or Kemar Smith\?/);
  });

  it("timer clarify_expiry: after 2 hours a question closes quietly with nothing answered; a tap then says so", async () => {
    const { captureId, conversationId } = await twoKemars();
    expect((await runClarificationTimers({ db, now: at(120) })).expired).toEqual([`clr-${captureId}`]);
    expect(await question(captureId)).toMatchObject({ state: "closed", endedBy: "timer" });
    expect((await turn("alicia", conversationId, captureId, 120)).clarification).toMatchObject({ state: "closed", outcome: "Nothing was chosen; ask me again." });
    expect((await capture(captureId)).answer).toBeNull();
    expect(await answerClarification(as("alicia", 121), `clr-${captureId}`, "kemar")).toMatchObject({ message: "Nothing was chosen; ask me again.", answeredIn: null });
    // Quietly: nobody is told anything
    expect(await db.select().from(t.notices).where(eq(t.notices.personId, "alicia"))).toEqual([]);
  });

  it("WY8: a why about a person two share a name with asks who, and the answer still gives no reason", async () => {
    await addPerson("kemar-s", "Kemar Smith", "forager");
    const { captureId } = await say("alicia", "Why is Kemar behind?");
    expect(await question(captureId)).toMatchObject({ about: "question", question: { asked: { topic: "why" }, fits: "person" } });
    await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar-s");
    expect((await capture(captureId)).answer!.text).toBe(`${NOT_WHY}Kemar Smith has nothing open on Forager 2.0.`);
  });

  it("section 17: with Atlas connected, the chosen answer waits to be worded, as a read's does", async () => {
    const { captureId } = await twoKemars();
    await answerClarification(as("alicia", 1), `clr-${captureId}`, "kemar-s", { wordWithAtlas: true });
    expect((await capture(captureId)).answer).toMatchObject({ wording: "pending", text: "Kemar Smith has nothing open on Forager 2.0.", rulesText: "Kemar Smith has nothing open on Forager 2.0." });
  });
});
