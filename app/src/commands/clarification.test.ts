// Phase D against PGlite (conversational plan, section 6): Atlas asks when unsure (M21). A vague update, an
// item that could go to 2 or 3 projects, or a reply that could mean 2 or 3 lines of the open answer gets one
// question in the author's own chat, with the options as buttons; a typed answer is read against them only.
// Every edge case CL1 to CL8, the model check's three fixes, and phase B's AC6 and AC7 asked as a question.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Extractor } from "../atlas/extractor";
import { createFixtureExtractor, VAGUE_FEED } from "../atlas/fixture";
import type { Db } from "../db/client";
import { loadBraidLog, loadItems } from "../db/records";
import * as t from "../db/schema";
import type { RawCommand } from "../domain/acting";
import type { RawProposal } from "../domain/atlas-checks/types";
import { OPTION_GONE_TEXT } from "../domain/machines/clarification";
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
    const feed: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "store feed", label: "#151" }, targetId: "wi-151", targetOptions: ["wi-151", "wi-152"], field: "state", newValue: "in_progress", quote: "Worked on the store feed today", confidence: "medium", rationale: "" };
    // Atlas lists the feed first; the message says the risk first
    const { captureId } = await say("kemar", text, 0, null, reads([feed, unsureRisk()]));
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
    await expect(answerClarification(as("kemar", 1), `clr-${captureId}`, "wi-152")).rejects.toMatchObject({ reason: OPTION_GONE_TEXT });
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
    await expect(answerClarification(as("kemar", 1), `clr-${captureId}`, "insights")).rejects.toMatchObject({ reason: OPTION_GONE_TEXT });
    await answerClarification(as("kemar", 2), `clr-${captureId}`, "forager");
    expect((await items(captureId))[0].draft.projectId).toBe("forager");
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
    expect(await capture(reply.captureId)).toMatchObject({ state: "answered", commandNote: OPTION_GONE_TEXT });
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
    await expect(answerClarification(as("alicia", 3), q.id, onGq)).rejects.toMatchObject({ reason: OPTION_GONE_TEXT });
    const other = q.options.find((o) => o.id !== onGq)!;
    await answerClarification(as("alicia", 4), q.id, other.id);
    expect(await db.select().from(t.chatCommands).where(eq(t.chatCommands.captureId, reply.captureId))).toHaveLength(1);
  });
});
