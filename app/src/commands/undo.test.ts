// Phase L, M30 Undo against PGlite (conversational plan, section 14; research model undoAndVocabulary.mjs,
// Undo "with the fixes"). Kemar saves the story's note at 9:12am, then says "Undo that" or presses Undo:
// UN1 to UN6, the recheck when the UNDO arrows run, and who is told (P10).
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog } from "../db/records";
import * as t from "../db/schema";
import { KEMAR_NOTE, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import { getChatSummary, getThread } from "../queries/chat";
import { getInbox } from "../queries/inbox";
import { readReceipt } from "../queries/undo";
import { at, seededDb } from "../test/seeded-db";
import { decideBraidEntry } from "./braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";
import { setStatus } from "./status";
import { undoSave } from "./undo";

let db: Db;
let saved: string;
const as = (actorId: string, minutes: number) => ({ db, now: at(minutes), actorId });

/** 9:12am: Kemar accepts what needs his OK, edits the runbook step, and saves (story steps 1 to 4). */
async function kemarSaves(): Promise<string> {
  const { captureId } = await createCapture(as("kemar", -12), { channel: "atlas", messageId: "atl-msg-0858", kind: "voice", text: KEMAR_NOTE, messageAt: at(-12), receivedAt: at(-12), durationSeconds: 31, transcriptConfidence: "high" });
  const { items } = await proposeItems(as("kemar", -11), captureId, KEMAR_PROPOSALS);
  await openReview(as("kemar", 0), captureId);
  for (const n of [4, 8, 9]) await decideExtraction(as("kemar", 1), items.find((i) => i.draft.ordinal === n)!.id, { type: "accept" });
  await decideExtraction(as("kemar", 1), items.find((i) => i.draft.ordinal === 6)!.id, { type: "edit", value: "handed_over" });
  const r = await saveCapture(as("kemar", 2), captureId);
  if (r.outcome !== "saved") throw new Error(`save: ${JSON.stringify(r)}`);
  return captureId;
}

/** "Undo that" in the chat, read without a model (QA8): the undo job runs as the message is read. */
async function says(who: string, minutes: number, text = "Undo that") {
  const { captureId } = await createCapture(as(who, minutes), { channel: "app", kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), messageId: `say-${who}-${minutes}-${text}` });
  const r = await proposeItems(as(who, minutes), captureId, [], { model: "fixture", question: { asked: text, topic: "undo", projectId: null } });
  return { captureId, answer: r.answer! };
}

const work = async (id: string) => (await db.select().from(t.workItems).where(eq(t.workItems.id, id)))[0];
const live = async (who: string) => (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open").map((i) => i.causeKey).sort();
const noticesTo = async (who: string) => (await db.select().from(t.notices).where(eq(t.notices.personId, who))).map((n) => n.text);
const RISK = (captureId: string) => `br-${captureId}-8`;
const DECISION = (captureId: string) => `br-${captureId}-11`;

describe("Undo (M30)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
    // 9:02am: Alicia sets At risk with no reason; Kemar's save moves the plan to At risk, so the rule clears it
    await setStatus(as("alicia", -8), "forager", "at_risk");
    saved = await kemarSaves();
  }, 30_000);

  it("the save keeps a receipt: each record as it was, the version it left, and who it told", async () => {
    const receipt = (await readReceipt(db, saved))!;
    expect(receipt).toMatchObject({ authorId: "kemar", savedAt: at(2) });
    expect(receipt.records.map((r) => `${r.type}:${r.id}`).sort()).toEqual(
      [
        "work_item:wi-145",
        "work_item:wi-151",
        "work_item:wi-208",
        "milestone:ms-trend",
        "handover_step:ho-runbook",
        "handover:ho-kemar-jodian",
        "braid_entry:br-feed-blocker",
        "braid_entry:br-pipeline-risk",
        `braid_entry:${RISK(saved)}`,
        `braid_entry:${DECISION(saved)}`,
        "set_status:forager",
      ].sort(),
    );
    expect(receipt.records.find((r) => r.id === "wi-151")).toMatchObject({ before: { state: "in_progress", blockedNote: null } });
    expect(receipt.records.find((r) => r.id === RISK(saved))).toMatchObject({ before: null });
    expect(receipt.told.map((x) => `${x.personId}:${x.subjectId}`).sort()).toEqual([`alicia:${RISK(saved)}`, `andre:${DECISION(saved)}`]);
  });

  it('"Undo that" within undoMinutes takes every record back through its own UNDO arrow, all at once', async () => {
    expect(await live("alicia")).toContain(`approve:${RISK(saved)}`);
    const { answer } = await says("kemar", 6);
    expect(answer.text).toBe("Done. I undid your 9:12am update: 9 changes are back as they were. Anyone it told has been told it's undone.");
    expect(answer.wording).toBe("rules");

    expect(await work("wi-151")).toMatchObject({ state: "in_progress", blockedNote: null, blockedLinks: [] });
    expect((await work("wi-145")).state).toBe("in_progress");
    expect((await work("wi-142")).state).toBe("done"); // already Done before: it was no change
    expect((await db.select().from(t.milestones).where(eq(t.milestones.id, "ms-trend")))[0].forecastDate).toBe("2026-10-23");
    expect((await db.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, "ho-runbook")))[0].state).toBe("not_done");
    expect((await db.select().from(t.handovers))[0].state).toBe("in_progress");

    const { log } = await loadBraidLog(db, "forager");
    // UN6: only Kemar's report leaves the shared blocker; Alicia's stays
    expect(log["br-feed-blocker"]).toMatchObject({ state: "reported", reportedBy: "alicia" });
    expect(log["br-feed-blocker"].sources.map((s) => s.personId)).toEqual(["alicia"]);
    expect(log["br-pipeline-risk"].sources.map((s) => s.personId)).toEqual(["alicia"]);
    // UN3: the risk the save proposed goes back to none, off the log; Alicia's item closes as cause gone
    expect(log[RISK(saved)]).toMatchObject({ state: "none", sources: [] });
    expect(await live("alicia")).not.toContain(`approve:${RISK(saved)}`);
    expect(await live("andre")).toEqual([]);
    expect((await loadBraidLog(db, "insights")).log[DECISION(saved)].state).toBe("none");
    // The rule had cleared Alicia's At risk because the plan agreed; it is back, waiting for a reason
    expect((await db.select().from(t.projects).where(eq(t.projects.id, "forager")))[0]).toMatchObject({ setOverride: "reason_required", setStatus: "at_risk", setBy: "alicia" });
    expect(await live("alicia")).toContain("status_set_with_no_reason:forager");
    // The "Done with no linked change" checks the save raised for Kemar close too
    expect(await live("kemar")).toEqual([]);

    // "Kemar undid this." to each person the save told
    expect(await noticesTo("alicia")).toEqual(["Kemar undid this: Trend model may slip to 24 Oct."]);
    expect(await noticesTo("andre")).toEqual(["Kemar undid this: Move the daily refresh to 6am."]);
    const undos = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.action, "UNDO"), eq(t.auditEntries.captureId, saved)));
    expect(undos).toHaveLength(11);
    expect(await db.select().from(t.undos)).toMatchObject([{ captureId: saved, ownerId: "kemar", state: "undone" }]);
  });

  it("the chat shows Undo on the saved message while it may work, then when it was undone", async () => {
    const before = (await getChatSummary(db, "kemar", saved, at(5))).latest!;
    expect(before.undo).toEqual({ may: true, state: null, at: null, jobId: null });
    expect((await getChatSummary(db, "kemar", saved, at(18))).latest!.undo).toMatchObject({ may: false });
    await undoSave(as("kemar", 6), { commandId: "btn-1", captureId: saved });
    expect((await getChatSummary(db, "kemar", saved, at(7))).latest!.undo).toMatchObject({ may: false, state: "undone", jobId: "btn-1" });
  });

  it("UN1: after the window it is refused, with links to change it from the project; nothing changes", async () => {
    const { answer } = await says("kemar", 18);
    expect(answer.text).toBe("It's been more than 15 minutes since you saved that 9:12am update, so I can't undo it. You can change these from the project now.");
    expect(answer.cards.map((c) => c.title)).toEqual(["Forager 2.0", "Store Insights"]);
    // The saved message says why too, after the reply has scrolled away
    expect((await getChatSummary(db, "kemar", saved, at(19))).latest!.undo).toMatchObject({ state: "refused", note: answer.text });
    expect((await work("wi-151")).state).toBe("blocked");
    expect(await db.select().from(t.undos)).toMatchObject([{ state: "refused", refusal: { why: "too_late" } }]);
  });

  it("UN2: someone changed one of the records since: refused, naming it and who; nothing is undone", async () => {
    await decideBraidEntry(as("alicia", 4), RISK(saved), { type: "approve" });
    const { answer } = await says("kemar", 6);
    expect(answer.text).toBe("Someone changed this since you saved it, so nothing was undone.");
    expect(answer.cards).toMatchObject([{ title: "Trend model may slip to 24 Oct", detail: "Alicia changed it at 9:14am" }]);
    expect((await work("wi-151")).state).toBe("blocked");
    expect((await loadBraidLog(db, "forager")).log[RISK(saved)].state).toBe("open");
    expect(await noticesTo("alicia")).not.toContain("Kemar undid this: Trend model may slip to 24 Oct.");
  });

  it("P10: a record that moved on a project the asker has left is never named", async () => {
    await decideBraidEntry(as("andre", 3), DECISION(saved), { type: "approve" });
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const { answer } = await says("kemar", 6);
    expect(answer.text).toBe("Something in it has changed since you saved it, so nothing was undone.");
    expect(answer.cards).toEqual([]);
    expect(JSON.stringify(answer)).not.toContain("refresh");
  });

  it("rule 4: the right is held now; someone who left a project the save touched cannot undo it", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const { answer } = await says("kemar", 6);
    expect(answer.text).toBe("You're no longer in a project that update changed, so nothing was undone.");
    expect((await work("wi-208")).state).toBe("done");
  });

  it("the model's fix: an arrow refused while the arrows run ends the job refused, all or nothing (undoing --> refused)", async () => {
    // The milestone's owner changes without its version moving, so the guard passes and its UNDO arrow refuses
    await db.update(t.milestones).set({ ownerId: "alicia" }).where(eq(t.milestones.id, "ms-trend"));
    const r = await undoSave(as("kemar", 6), { commandId: "btn-1", captureId: saved });
    expect(r).toMatchObject({ kind: "job", job: { state: "refused", refusal: { why: "failed" } } });
    // Nothing was undone: the savepoint rolled every arrow back
    expect((await work("wi-151")).state).toBe("blocked");
    expect((await loadBraidLog(db, "forager")).log[RISK(saved)].state).toBe("proposed");
    const moves = (await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.machine, "undo"), eq(t.auditEntries.subjectId, "btn-1")))).map((a) => `${a.fromState}>${a.toState}`);
    expect(moves).toEqual(["null>requested", "requested>undoing", "undoing>refused"]);
  });

  it("UN4: with no recent save of theirs, there's nothing to undo; someone else's save is nothing to them", async () => {
    expect((await says("andre", 6)).answer.text).toBe("There's nothing of yours to undo.");
    expect(await undoSave(as("andre", 6), { commandId: "btn-andre", captureId: saved })).toEqual({ kind: "nothing" });
    expect((await work("wi-151")).state).toBe("blocked");
  });

  it("UN5: twice is once: the same button again, or Undo that after it", async () => {
    const first = await undoSave(as("kemar", 6), { commandId: "btn-1", captureId: saved });
    const again = await undoSave(as("kemar", 6), { commandId: "btn-1", captureId: saved });
    expect(again).toEqual(first);
    const { answer } = await says("kemar", 8);
    expect(answer.text).toBe("You already undid your 9:12am update at 9:16am.");
    expect(await db.select().from(t.undos)).toHaveLength(1);
    expect(await noticesTo("alicia")).toEqual(["Kemar undid this: Trend model may slip to 24 Oct."]);
  });

  it('"Kemar undid this." goes only to people who can still open the record', async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "andre")));
    await undoSave(as("kemar", 6), { commandId: "btn-1", captureId: saved });
    expect(await noticesTo("andre")).toEqual([]);
    expect(await noticesTo("alicia")).toEqual(["Kemar undid this: Trend model may slip to 24 Oct."]);
  });

  it("the thread shows the reply in DPM's words, and the inbox no longer offers the risk", async () => {
    const { captureId } = await says("kemar", 6);
    const [c] = await db.select({ conversationId: t.captures.conversationId }).from(t.captures).where(eq(t.captures.id, captureId));
    const thread = await getThread(db, "kemar", c.conversationId!, at(6));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns.at(-1)).toMatchObject({ state: "answered", answer: { topic: "undo" } });
    expect((await getInbox(db, "alicia", at(6))).items.map((i) => i.title)).toEqual(["Forager 2.0 is set At risk, but the plan says On track"]);
  });
});
