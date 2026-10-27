import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog, loadItems, persistBraidLog } from "../db/records";
import * as t from "../db/schema";
import { KEMAR_NOTE, KEMAR_NOTE_AT, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import type { RawProposal } from "../domain/atlas-checks/types";
import { applyToLog } from "../domain/machines/braid-entry";
import { loadCheckContext } from "../queries/check-context";
import { getReview } from "../queries/review";
import { AT_910, at, seededDb } from "../test/seeded-db";
import {
  createCapture,
  decideExtraction,
  discardCapture,
  elapsedSince,
  openReview,
  proposeItems,
  reviewCause,
  routeExtraction,
  runCaptureTimers,
  saveCapture,
} from "./capture";
import { CommandRefused } from "./core";

const CAP = "cap-kemar-0858";
const item = (n: number) => `${CAP}-${n}`;

let db: Db;
// Seeding a fresh PGlite is slow when every test file does it at once
beforeEach(async () => {
  db = await seededDb();
}, 30_000);

const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const kemar = (minutes = 0) => as("kemar", minutes);

/** Story step 4: Kemar opens the review, accepts #4, #8 and #9 and edits #6 to handed over. */
async function review() {
  await openReview(kemar(), CAP);
  for (const n of [4, 8, 9]) await decideExtraction(kemar(), item(n), { type: "accept" });
  await decideExtraction(kemar(), item(6), { type: "edit", value: "handed_over" });
}

async function workItem(id: string) {
  return (await db.select().from(t.workItems).where(eq(t.workItems.id, id)))[0];
}

async function captureState(id = CAP) {
  return (await db.select().from(t.captures).where(eq(t.captures.id, id)))[0].state;
}

async function itemStates(captureId = CAP) {
  return Object.fromEntries((await loadItems(db, captureId)).items.map((i) => [i.draft.ordinal, i.state]));
}

async function inbox(ownerId: string) {
  const rows = await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, ownerId));
  return Object.fromEntries(rows.map((r) => [r.causeKey, r.state]));
}

/** What a save would change in any project, to prove nothing was written. */
async function projectsSnapshot() {
  const [workItems, milestones, steps, handovers, entries, sources, leave] = await Promise.all([
    db.select().from(t.workItems),
    db.select().from(t.milestones),
    db.select().from(t.handoverSteps),
    db.select().from(t.handovers),
    db.select().from(t.braidEntries),
    db.select().from(t.braidSources),
    db.select().from(t.leave),
  ]);
  return { workItems, milestones, steps, handovers, entries, sources, leave };
}

/**
 * The database as a flaky network sees it: the first `fails` transactions throw before running
 * ("error"), or run and commit but lose their reply ("lost_reply").
 */
function flakyDb(fails: number, how: "error" | "lost_reply" = "error"): Db {
  let n = 0;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "transaction") return Reflect.get(target, prop, receiver);
      return async (fn: Parameters<Db["transaction"]>[0]) => {
        if (n++ >= fails) return target.transaction(fn);
        if (how === "error") throw new Error("connection reset");
        await target.transaction(fn);
        throw new Error("connection reset after commit");
      };
    },
  });
}

async function refusal(p: Promise<unknown>): Promise<CommandRefused> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandRefused);
  return error as CommandRefused;
}

describe("the story's save (step 4 and 5)", () => {
  it("applies 9 changes across Forager and Store Insights, and the rules and inbox follow", async () => {
    await review();
    const r = await saveCapture(kemar(), CAP);
    if (r.outcome !== "saved") throw new Error("expected a save");
    expect(r.applied.map((id) => Number(id.split("-").at(-1))).sort((a, b) => a - b)).toEqual([2, 3, 4, 6, 7, 8, 9, 10, 11]);
    expect(r.projects).toEqual(["forager", "insights"]);
    expect(await captureState()).toBe("saved");
    expect(await itemStates()).toMatchObject({ 1: "no_change", 5: "no_change", 2: "applied", 11: "applied" });

    // Records, each moved by its own machine
    expect(await workItem("wi-151")).toMatchObject({ state: "blocked", blockedNote: "waiting on Kyle (Sprouts IT)" });
    expect((await workItem("wi-145")).state).toBe("done");
    expect((await workItem("wi-208")).state).toBe("done");
    const [trend] = await db.select().from(t.milestones).where(eq(t.milestones.id, "ms-trend"));
    expect(trend.forecastDate).toBe("2026-10-24");
    const steps = await db.select().from(t.handoverSteps).where(eq(t.handoverSteps.handoverId, "ho-kemar-jodian"));
    expect(steps.find((s) => s.id === "ho-runbook")!.state).toBe("handed_over");
    expect(`${steps.filter((s) => s.state === "handed_over").length} of ${steps.length}`).toBe("3 of 4");
    const [handover] = await db.select().from(t.handovers).where(eq(t.handovers.id, "ho-kemar-jodian"));
    expect(handover.state).toBe("in_progress");

    // BRAID logs
    const forager = (await loadBraidLog(db, "forager")).log;
    expect(forager["br-feed-blocker"].sources.map((s) => s.personId)).toEqual(["alicia", "kemar"]);
    expect(forager["br-feed-blocker"].state).toBe("reported");
    expect(forager[`br-${item(8)}`]).toMatchObject({ kind: "risk", title: "Trend model may slip to 24 Oct", state: "proposed", reportedBy: "kemar" });
    expect(forager["br-pipeline-risk"].sources.map((s) => s.id)).toEqual(["src-pipeline-alicia", `src-${item(9)}`]);
    expect(forager["br-pipeline-risk"].state).toBe("mitigating");
    const insights = (await loadBraidLog(db, "insights")).log;
    expect(insights[`br-${item(11)}`]).toMatchObject({ kind: "decision", title: "Move the daily refresh to 6am", state: "proposed" });
    // The source quote is Kemar's words from his note, at the time he spoke
    const [source] = await db.select().from(t.braidSources).where(eq(t.braidSources.id, `src-${item(11)}`));
    expect(KEMAR_NOTE.slice(source.spanStart!, source.spanEnd!)).toBe("Andre and I agreed to move the refresh to 6am");
    expect(source).toMatchObject({ captureId: CAP, extractionId: item(11), at: KEMAR_NOTE_AT });

    // Leave matched approved leave and changed nothing
    expect(await db.select().from(t.leave)).toEqual([expect.objectContaining({ id: "lv-kemar-oct", state: "approved" })]);

    // Rules: Forager is At risk; Alicia's Off track stands and her reason item stays open
    expect(r.evaluations.get("forager")!.calculated).toBe("at_risk");
    expect(await inbox("alicia")).toEqual({ "status_set_with_no_reason:forager": "open", [`approve:br-${item(8)}`]: "open" });
    expect(await inbox("andre")).toEqual({ [`approve:br-${item(11)}`]: "open" });
  });

  it("A11: every applied change has an audit entry naming the capture and the extraction", async () => {
    await review();
    await saveCapture(kemar(), CAP);
    const entries = await db.select().from(t.auditEntries).where(eq(t.auditEntries.captureId, CAP));
    const recordMachines = ["work_item", "milestone", "handover_step", "handover", "braid_entry", "leave"];
    for (const n of [2, 3, 4, 6, 7, 8, 9, 10, 11]) {
      const mine = entries.filter((e) => e.extractionId === item(n));
      expect(mine.some((e) => e.action === "APPLIED" && e.machine === "extracted_item"), `item ${n} settled`).toBe(true);
      const changes = mine.filter((e) => recordMachines.includes(e.machine ?? ""));
      expect(changes.length, `item ${n} changed a record`).toBeGreaterThan(0);
      for (const e of changes) expect(e).toMatchObject({ actorType: "person", actorId: "kemar", captureId: CAP });
    }
    expect(entries.filter((e) => e.extractionId === item(6)).map((e) => [e.machine, e.action])).toEqual(
      expect.arrayContaining([
        ["handover_step", "STEP_CHANGED"],
        ["handover", "STEPS_DONE"],
      ]),
    );
    expect(entries.filter((e) => e.machine === "capture").map((e) => e.action)).toEqual(["RECEIVED", "PROPOSALS_READY", "OPEN_REVIEW", "SAVE", "SAVE_DONE"]);
  });
});

describe("capture and proposals (5.1)", () => {
  it("E1 the same note arriving twice is dropped and changes nothing", async () => {
    const again = await createCapture(kemar(), { channel: "atlas", messageId: "atl-msg-0858", kind: "voice", text: KEMAR_NOTE, messageAt: KEMAR_NOTE_AT, receivedAt: at(1), transcriptConfidence: "high" });
    expect(again).toEqual({ captureId: CAP, duplicate: true, conversationId: "conv-atlas-kemar" });
    const first = await createCapture(kemar(), { channel: "atlas", kind: "text", text: "hello", messageAt: at(2), receivedAt: at(2), messageId: "atl-7" });
    const retry = await createCapture(kemar(), { channel: "atlas", kind: "text", text: "hello", messageAt: at(2), receivedAt: at(3), messageId: "atl-7" });
    expect(first.duplicate).toBe(false);
    expect(retry).toEqual({ captureId: first.captureId, duplicate: true, conversationId: first.conversationId });
    expect(await db.select().from(t.captures)).toHaveLength(2);
  });

  it("E4 a chatty message gives no proposals: nothing to update, no items", async () => {
    const { captureId } = await createCapture(kemar(), { channel: "app", kind: "text", text: "morning!", messageAt: at(0), receivedAt: at(0) });
    const r = await proposeItems(as("atlas"), captureId, []);
    expect(r).toMatchObject({ state: "nothing_to_update", items: [] });
    expect(await captureState(captureId)).toBe("nothing_to_update");
    expect(await db.select().from(t.extractions).where(eq(t.extractions.captureId, captureId))).toEqual([]);
  });

  it("proposes Kemar's note as the seed has it: 11 items, 4 need his OK, dropped proposals audited", async () => {
    // Typed again in the app: a message id keeps it apart from the Atlas copy (E2, not E1)
    const { captureId } = await createCapture(kemar(), { channel: "app", kind: "text", text: KEMAR_NOTE, messageAt: KEMAR_NOTE_AT, receivedAt: at(0), messageId: "app-1" });
    const bad: RawProposal = { ...KEMAR_PROPOSALS[1], targetId: "wi-999" }; // E10: an invented target
    const r = await proposeItems(as("atlas"), captureId, [...KEMAR_PROPOSALS, bad]);
    expect(r.state).toBe("proposed");
    const seeded = (await loadItems(db, CAP)).items;
    expect(r.items.map((i) => [i.state, i.confidence])).toEqual(seeded.map((i) => [i.state, i.confidence]));
    expect(r.items.filter((i) => i.state === "needs_ok")).toHaveLength(4);
    const [ready] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, captureId), eq(t.auditEntries.action, "PROPOSALS_READY")));
    expect(ready.actorType).toBe("atlas");
    expect(ready.detail).toMatchObject({ items: 11, dropped: [{ check: 1 }] });
  });

  it("E5 a poor voice transcript lowers every item to at most Medium: nothing starts ready", async () => {
    const { captureId } = await createCapture(kemar(), {
      channel: "atlas",
      kind: "voice",
      text: KEMAR_NOTE,
      messageAt: KEMAR_NOTE_AT,
      receivedAt: at(0),
      messageId: "atl-patois",
      transcriptConfidence: "low",
    });
    const r = await proposeItems(as("atlas"), captureId, KEMAR_PROPOSALS);
    expect(r.items).toHaveLength(11);
    expect(r.items.every((i) => i.confidence !== "high")).toBe(true);
    expect(r.items.some((i) => i.state === "pre_accepted")).toBe(false);
    const moves = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, captureId), eq(t.auditEntries.machine, "capture")));
    expect(moves.map((m) => m.action)).toEqual(["RECEIVED", "START", "TRANSCRIBED", "PROPOSALS_READY"]);
  });

  it("E7 past 20 proposals the rest wait: Atlas says it found more", async () => {
    const text = Array.from({ length: 25 }, (_, i) => `On Forager, problem ${i + 1} is open.`).join(" ");
    const { captureId } = await createCapture(kemar(), { channel: "app", kind: "text", text, messageAt: at(0), receivedAt: at(0) });
    const proposals: RawProposal[] = Array.from({ length: 25 }, (_, i) => ({
      kind: "braid_new",
      projectId: "forager",
      routingReason: { basis: "reference", evidence: "Forager", label: "On Forager" },
      braidKind: "issue",
      braidTitle: `Problem ${i + 1}`,
      quote: `problem ${i + 1} is open`,
      confidence: "high",
      rationale: "",
    }));
    const r = await proposeItems(as("atlas"), captureId, proposals);
    expect(r.items).toHaveLength(20);
    expect(r.moreFound).toBe(true);
    expect(r.dropped.filter((d) => d.check === "cap")).toHaveLength(5);
  });

  it("only the author opens and decides; a decision needs the review open", async () => {
    await refusal(decideExtraction(kemar(), item(4), { type: "accept" }));
    expect((await refusal(openReview(as("alicia"), CAP))).code).toBe("not_allowed");
    await openReview(kemar(), CAP);
    expect((await refusal(decideExtraction(as("alicia"), item(4), { type: "accept" }))).code).toBe("not_allowed");
  });
});

describe("review and save (5.2)", () => {
  it("E20 Save is refused while 4 need an OK", async () => {
    await openReview(kemar(), CAP);
    const before = await projectsSnapshot();
    expect((await refusal(saveCapture(kemar(), CAP))).reason).toBe("4 need your OK before this is saved");
    expect(await captureState()).toBe("reviewing");
    expect(await projectsSnapshot()).toEqual(before);
  });

  it("E22 an invalid edit is refused with the reason; the card stays Needs your OK", async () => {
    await openReview(kemar(), CAP);
    const early = await refusal(decideExtraction(kemar(), item(4), { type: "edit", value: "2026-10-01" }));
    expect(early.reason).toBe("2026-10-01 is before Forager 2.0 starts (2026-10-12)");
    await refusal(decideExtraction(kemar(), item(4), { type: "edit", value: "soon" }));
    await refusal(decideExtraction(kemar(), item(6), { type: "edit", value: "finished" }));
    expect((await itemStates())[4]).toBe("needs_ok");
    const edited = await decideExtraction(kemar(), item(4), { type: "edit", value: "2026-10-26" });
    expect(edited).toMatchObject({ state: "edited", value: "2026-10-26" });
  });

  it("E23 an accepted item can be undone until save", async () => {
    await openReview(kemar(), CAP);
    await decideExtraction(kemar(), item(4), { type: "accept" });
    expect(await decideExtraction(kemar(), item(4), { type: "undo" })).toMatchObject({ state: "needs_ok" });
  });

  it("E3 a second Save of a saved capture is refused; nothing is applied twice", async () => {
    await review();
    await saveCapture(kemar(), CAP);
    const after = await projectsSnapshot();
    expect((await refusal(saveCapture(kemar(), CAP))).reason).toMatch(/^already saved at 9:10 AM/);
    expect(await projectsSnapshot()).toEqual(after);
    const finished = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, "wi-145"), eq(t.auditEntries.action, "FINISH")));
    expect(finished).toHaveLength(1);
  });

  it("E24 GitHub changes #145 between proposal and save: conflict, nothing applied anywhere; accepting again saves", async () => {
    await review();
    await db.update(t.workItems).set({ state: "blocked", blockedNote: "waiting on review (GitHub)" }).where(eq(t.workItems.id, "wi-145"));
    const before = await projectsSnapshot();
    const r = await saveCapture(kemar(), CAP);
    expect(r).toMatchObject({ outcome: "conflict", conflicts: [{ itemId: item(2), saw: "in_progress", current: "blocked" }] });
    expect(await projectsSnapshot()).toEqual(before);
    expect(await captureState()).toBe("reviewing");
    const conflicted = (await loadItems(db, CAP)).items.find((i) => i.id === item(2))!;
    expect(conflicted).toMatchObject({ state: "conflict", conflict: { current: "blocked", reason: 'Atlas read "in_progress" but it is now "blocked"' } });
    expect(await inbox("andre")).toEqual({});

    await decideExtraction(kemar(), item(2), { type: "accept" });
    const saved = await saveCapture(kemar(), CAP);
    expect(saved.outcome).toBe("saved");
    expect(await workItem("wi-145")).toMatchObject({ state: "done", blockedNote: null });
    expect((await workItem("wi-151")).state).toBe("blocked");
  });

  it("E25 a target that already has the new value is no change, and the rest saves", async () => {
    await review();
    await db.update(t.workItems).set({ state: "done" }).where(eq(t.workItems.id, "wi-145"));
    const r = await saveCapture(kemar(), CAP);
    if (r.outcome !== "saved") throw new Error("expected a save");
    expect(r.noChange).toEqual([item(2)]);
    expect((await itemStates())[2]).toBe("no_change");
    expect((await workItem("wi-151")).state).toBe("blocked");
  });

  it("E27, D12 a record machine refuses (the milestone changed owner): the card says why, nothing is written, and it is audited", async () => {
    await review();
    await db.update(t.milestones).set({ ownerId: "alicia" }).where(eq(t.milestones.id, "ms-trend"));
    const before = await projectsSnapshot();
    const r = await saveCapture(kemar(), CAP);
    expect(r).toMatchObject({ outcome: "conflict", refused: [{ itemId: item(4), reason: expect.stringMatching(/^only the milestone owner changes its forecast.*Edit it or reject it$/) }] });
    expect(await projectsSnapshot()).toEqual(before);
    expect(await captureState()).toBe("reviewing");
    const card = (await getReview(db, "kemar", CAP)) as Extract<Awaited<ReturnType<typeof getReview>>, { found: true }>;
    const four = card.groups.flatMap((g) => g.items).find((i) => i.ordinal === 4)!;
    expect(four).toMatchObject({ state: "conflict", markLabel: "Can't apply", conflict: { refused: true } });
    const [logged] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.extractionId, item(4)), eq(t.auditEntries.action, "SAVE_REFUSED")));
    expect(logged.actorId).toBe("kemar");

    // Rejecting the refused card lets the rest save
    await decideExtraction(kemar(), item(4), { type: "reject" });
    expect((await saveCapture(kemar(), CAP)).outcome).toBe("saved");
    expect((await workItem("wi-145")).state).toBe("done");
  });

  it("D3 a database error is retried with the same items, after 1s, and the save goes through", async () => {
    await review();
    const slept: number[] = [];
    const r = await saveCapture({ ...kemar(), db: flakyDb(1) }, CAP, { sleep: async (ms) => void slept.push(ms) });
    expect(r.outcome).toBe("saved");
    expect(slept).toEqual([1000]);
    expect((await workItem("wi-145")).state).toBe("done");
  });

  it("D3 a save whose reply was lost is not run again: the retry finds it saved", async () => {
    await review();
    const r = await saveCapture({ ...kemar(), db: flakyDb(1, "lost_reply") }, CAP, { sleep: async () => {} });
    expect(r).toMatchObject({ outcome: "saved", retried: true });
    expect(r.outcome === "saved" && r.applied).toHaveLength(9);
    expect((await workItem("wi-145")).version).toBe(2); // moved once, not twice
    const applied = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.captureId, CAP), eq(t.auditEntries.action, "APPLIED")));
    expect(applied).toHaveLength(9);
  });

  it("D3 after 3 failed tries the author is told nothing changed, and Save can be pressed again", async () => {
    await review();
    const before = await projectsSnapshot();
    const slept: number[] = [];
    const r = await saveCapture({ ...kemar(), db: flakyDb(3) }, CAP, { sleep: async (ms) => void slept.push(ms) });
    expect(r).toEqual({ outcome: "failed", message: "This didn't save, and nothing was changed. Try Save again.", tries: 3 });
    expect(slept).toEqual([1000, 2000]);
    expect(await projectsSnapshot()).toEqual(before);
    expect(await captureState()).toBe("reviewing");
    const [logged] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, CAP), eq(t.auditEntries.action, "SAVE_ERROR")));
    expect(logged.detail).toMatchObject({ message: "connection reset", tries: 3 });
    expect((await saveCapture(kemar(), CAP)).outcome).toBe("saved");
  });

  it("D12 a refused save is written to the audit after it rolls back (rule 2)", async () => {
    await openReview(kemar(), CAP);
    await refusal(saveCapture(kemar(), CAP));
    const [logged] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, CAP), eq(t.auditEntries.action, "SAVE_REFUSED")));
    expect(logged).toMatchObject({ actorId: "kemar", detail: { reason: "4 need your OK before this is saved", attempt: 1 } });
  });

  it("E77 Kemar leaves Store Insights before saving: items 10 and 11 are withdrawn, the rest saves", async () => {
    await review();
    await db
      .update(t.projectMemberships)
      .set({ state: "left" })
      .where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const r = await saveCapture(kemar(), CAP);
    if (r.outcome !== "saved") throw new Error("expected a save");
    expect(r.withdrawn).toEqual([item(10), item(11)]);
    expect(r.projects).toEqual(["forager"]);
    expect(await itemStates()).toMatchObject({ 10: "withdrawn", 11: "withdrawn", 2: "applied", 3: "applied" });
    expect((await workItem("wi-208")).state).toBe("in_progress");
    expect((await loadBraidLog(db, "insights")).log).toEqual({});
    expect((await workItem("wi-145")).state).toBe("done");
  });

  it("E83 Alicia resolves the blocker before Kemar saves: conflict; reporting it again reopens it", async () => {
    await review();
    const { log, versions } = await loadBraidLog(db, "forager");
    const resolved = applyToLog(log, "br-feed-blocker", { type: "RESOLVE" }, { actor: { id: "alicia", role: "pm" }, today: "2026-10-20" });
    expect(resolved.outcome.ok).toBe(true);
    await db.transaction((tx) => persistBraidLog(tx, log, resolved.log, versions, at(-5)));
    const before = await projectsSnapshot();

    const r = await saveCapture(kemar(), CAP);
    expect(r).toMatchObject({ outcome: "conflict", conflicts: [{ itemId: item(7), saw: "reported", current: "resolved" }] });
    expect(await projectsSnapshot()).toEqual(before);

    await decideExtraction(kemar(), item(7), { type: "accept" });
    expect((await saveCapture(kemar(), CAP)).outcome).toBe("saved");
    const blocker = (await loadBraidLog(db, "forager")).log["br-feed-blocker"];
    expect(blocker.state).toBe("reported"); // S14: the same entry reopens
    expect(blocker.sources.map((s) => s.personId)).toEqual(["alicia", "kemar"]);
  });

  it("E26, D2 a target cancelled before save withdraws its item, never a conflict; the rest saves", async () => {
    await review();
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-145"));
    const r = await saveCapture(kemar(), CAP);
    if (r.outcome !== "saved") throw new Error("expected a save");
    expect(r.withdrawn).toEqual([item(2)]);
    expect((await workItem("wi-145")).state).toBe("cancelled");
    const card = (await getReview(db, "kemar", CAP)) as Extract<Awaited<ReturnType<typeof getReview>>, { found: true }>;
    expect(card.groups.flatMap((g) => g.items).find((i) => i.ordinal === 2)).toMatchObject({ state: "withdrawn", withdrawnNote: "This issue was cancelled" });
  });

  it("D2 cancelled work is never offered to Atlas", async () => {
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-160"));
    const ctx = await loadCheckContext(db, { authorId: "kemar", text: "", messageAt: at(0), transcriptConfidence: null });
    const ids = ctx.projects.flatMap((p) => p.records.map((r) => r.id));
    expect(ids).toContain("wi-145");
    expect(ids).not.toContain("wi-160");
  });

  it("D13 only new BRAID entries and items with no target offer Move; a report on an entry stays with its log", async () => {
    const r = (await getReview(db, "kemar", CAP)) as Extract<Awaited<ReturnType<typeof getReview>>, { found: true }>;
    const canMove = Object.fromEntries(r.groups.flatMap((g) => g.items).map((i) => [i.ordinal, i.canMove]));
    expect(canMove).toEqual({ 1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false, 8: true, 9: false, 10: false, 11: true });
  });

  it("Discard withdraws every open item and changes no project", async () => {
    const before = await projectsSnapshot();
    expect((await refusal(discardCapture(as("andre"), CAP))).code).toBe("not_allowed");
    const r = await discardCapture(kemar(), CAP);
    expect(r.withdrawn).toHaveLength(9); // #1 and the leave match were already settled
    expect(await captureState()).toBe("rejected");
    expect(await projectsSnapshot()).toEqual(before);
    await refusal(saveCapture(kemar(), CAP));
  });
});

describe("routing (M14)", () => {
  async function ambiguous() {
    const text = "The pipeline failed overnight.";
    const { captureId } = await createCapture(kemar(), { channel: "app", kind: "text", text, messageAt: at(0), receivedAt: at(0) });
    await proposeItems(as("atlas"), captureId, [
      {
        kind: "braid_new",
        projectId: null,
        routingReason: { basis: "ambiguous", evidence: "pipeline", label: "Choose a project" },
        options: ["forager", "insights"],
        braidKind: "issue",
        braidTitle: "Pipeline failed overnight",
        quote: "The pipeline failed overnight",
        confidence: "high",
        rationale: "",
      },
    ]);
    await openReview(kemar(), captureId);
    return { captureId, itemId: `${captureId}-1` };
  }

  it("E71 an item that fits two projects blocks Save until Kemar picks one", async () => {
    const { captureId, itemId } = await ambiguous();
    expect((await loadItems(db, captureId)).items[0].draft).toMatchObject({ routing: "choose_project", options: ["forager", "insights"] });
    expect((await refusal(saveCapture(kemar(), captureId))).reason).toBe("1 needs a project before this is saved");
    await refusal(routeExtraction(kemar(), itemId, { projectId: "nope" }));

    const picked = await routeExtraction(kemar(), itemId, { projectId: "insights" });
    expect(picked.draft).toMatchObject({ routing: "routed", projectId: "insights", routingReason: "You picked this project" });
    expect(picked.draft.options).toBeUndefined();
    const [row] = await db.select().from(t.extractions).where(eq(t.extractions.id, itemId));
    expect(row).toMatchObject({ routing: "routed", projectId: "insights" });

    expect((await saveCapture(kemar(), captureId)).outcome).toBe("saved");
    const log = (await loadBraidLog(db, "insights")).log;
    expect(log[`br-${itemId}`]).toMatchObject({ kind: "issue", state: "reported", title: "Pipeline failed overnight" });
  });

  it("S16 an item kept private is saved with the capture and reaches no project", async () => {
    const { captureId, itemId } = await ambiguous();
    const kept = await routeExtraction(kemar(), itemId, "keep_private");
    expect(kept.draft).toMatchObject({ routing: "not_filed", projectId: null });
    const r = await saveCapture(kemar(), captureId);
    expect(r).toMatchObject({ outcome: "saved", keptPrivate: [itemId], projects: [] });
    expect(Object.keys((await loadBraidLog(db, "insights")).log)).toEqual([]);
  });

  it("E74 moving a record update where its target does not exist is refused; a new BRAID item moves", async () => {
    await openReview(kemar(), CAP);
    const moved = await refusal(routeExtraction(kemar(), item(2), { projectId: "insights" }));
    expect(moved.reason).toBe("#145 is in Forager 2.0. To log this somewhere else, add it as a BRAID item in that project");
    await refusal(routeExtraction(kemar(), item(7), { projectId: "insights" }));
    await refusal(routeExtraction(kemar(), item(5), { projectId: "forager" })); // personal items stay with him
    expect((await loadItems(db, CAP)).items.find((i) => i.id === item(2))!.draft.projectId).toBe("forager");

    const risk = await routeExtraction(kemar(), item(8), { projectId: "gq" });
    expect(risk.draft).toMatchObject({ projectId: "gq", routing: "routed", routingReason: "You moved it here" });
    const [entry] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.extractionId, item(8)), eq(t.auditEntries.machine, "routing")));
    expect(entry).toMatchObject({ action: "MOVE", actorId: "kemar", detail: { fromProject: "forager", toProject: "gq" } });
  });
});

describe("E28 timers (S4)", () => {
  it("reminds after 4 working hours, once, then expires after 7 days with nothing applied", async () => {
    const before = await projectsSnapshot();
    expect(await runCaptureTimers({ db, now: at(60) })).toEqual({ reminded: [], expired: [], stale: [] });
    expect(await runCaptureTimers({ db, now: at(240) })).toEqual({ reminded: [CAP], expired: [], stale: [] });
    expect(await inbox("kemar")).toEqual({ [reviewCause(CAP)]: "open" });
    expect(await runCaptureTimers({ db, now: at(300) })).toEqual({ reminded: [], expired: [], stale: [] });
    expect(await runCaptureTimers({ db, now: at(6 * 24 * 60) })).toEqual({ reminded: [], expired: [], stale: [] });

    expect(await runCaptureTimers({ db, now: at(7 * 24 * 60) })).toEqual({ reminded: [], expired: [CAP], stale: [] });
    expect(await captureState()).toBe("expired");
    expect(await itemStates()).toMatchObject({ 1: "no_change", 2: "withdrawn", 4: "withdrawn", 5: "no_change", 11: "withdrawn" });
    expect(await inbox("kemar")).toEqual({ [reviewCause(CAP)]: "auto_closed" });
    expect(await projectsSnapshot()).toEqual(before);
    await refusal(openReview(kemar(), CAP));
  });

  it("saving closes the reminder as acted", async () => {
    await runCaptureTimers({ db, now: at(240) });
    await review();
    await saveCapture(kemar(), CAP);
    // M5 (D18): #145 and #208 went Done by voice with nothing linked, so Kemar is asked to link them
    expect(await inbox("kemar")).toEqual({ [reviewCause(CAP)]: "acted", "done_no_change:wi-145": "open", "done_no_change:wi-208": "open" });
  });

  it("counts only hours on working days", () => {
    const friday5pm = new Date("2026-10-23T22:00:00Z");
    expect(elapsedSince(friday5pm, new Date("2026-10-26T14:00:00Z"))).toEqual({ workingHours: 7 + 9, days: 3 });
    expect(elapsedSince(AT_910, at(239))).toEqual({ workingHours: 3, days: 0 });
  });
});
