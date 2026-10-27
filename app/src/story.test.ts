// Use case 1, end to end against the database (build plan phase 3): every step of the story runs
// through the real commands, and every check reads through the per-viewer queries the screens will use.
// Starts from the world only: Kemar's note and Alicia's 9:02 Off track happen here, not in the seed.
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./commands/capture";
import type { CommandCtx } from "./commands/core";
import { decideBraidEntry } from "./commands/braid";
import { draftReason, keepSetStatus, linkChange, saveReason, setStatus } from "./commands/status";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import type { RawProposal } from "./domain/atlas-checks/types";
import { KEMAR_NOTE, KEMAR_PROPOSALS } from "./domain/atlas-checks/kemar-note.fixture";
import type { ExtractedItem } from "./domain/machines/extracted-item";
import { getAuditTrail } from "./queries/audit";
import { getChatSummary } from "./queries/chat";
import { getInbox } from "./queries/inbox";
import { getProject } from "./queries/project";
import { getReview } from "./queries/review";
import { seededDb } from "./test/seeded-db";

// Jamaica is UTC-5 all year
const jamaica = (hhmm: string, day = "2026-10-20") => new Date(`${day}T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, "0")}:${hhmm.slice(3)}:00Z`);
const THURSDAY = "2026-10-22";
const as = (actorId: string, hhmm: string, day?: string): CommandCtx => ({ db, now: jamaica(hhmm, day), actorId });

let db: Db;
let captureId: string;
let items: ExtractedItem[];
const byOrdinal = (n: number) => items.find((i) => i.draft.ordinal === n)!;

async function project(viewer: string, id: string, hhmm: string, day?: string) {
  const view = await getProject(db, viewer, id, jamaica(hhmm, day));
  if (!view.found) throw new Error(`${viewer} cannot read ${id}`);
  return view;
}
const titles = async (viewer: string, hhmm: string, day?: string) => (await getInbox(db, viewer, jamaica(hhmm, day))).items.map((i) => i.title);

beforeAll(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
});

describe("use case 1: a daily update reaches the right projects", () => {
  it("8:58am. Kemar's voice note arrives and Atlas proposes 11 items for 2 projects", async () => {
    const created = await createCapture(as("kemar", "08:58"), {
      channel: "atlas",
      messageId: "atl-msg-0858",
      kind: "voice",
      text: KEMAR_NOTE,
      messageAt: jamaica("08:58"),
      receivedAt: jamaica("08:58"),
      durationSeconds: 31,
      transcriptConfidence: "high",
    });
    captureId = created.captureId;
    const proposed = await proposeItems({ db, now: jamaica("08:59"), actorId: "kemar" }, captureId, KEMAR_PROPOSALS);
    items = proposed.items;
    expect(proposed.state).toBe("proposed");
    expect(items).toHaveLength(11);
    expect((await getChatSummary(db, "kemar")).latest?.line).toBe("Got it. 9 updates for 2 projects; 4 need your OK.");
  });

  it("9:02am. Alicia sets Forager 2.0 Off track with no reason", async () => {
    await setStatus(as("alicia", "09:02"), "forager", "off_track");
    expect(await titles("alicia", "09:10")).toEqual(["Forager 2.0 is set Off track, but the plan says On track"]);
    expect(await titles("andre", "09:10")).toEqual([]);
  });

  it("9:10am. Kemar reviews: grouped by project, 4 need his OK, Save waits for them", async () => {
    await openReview(as("kemar", "09:10"), captureId);
    const review = await getReview(db, "kemar", captureId);
    if (!review.found) throw new Error("Kemar cannot read his own review");
    expect(review.groups.map((g) => g.type === "project" ? g.name : g.type)).toEqual(["Forager 2.0", "Store Insights", "you"]);
    expect(review.counts).toMatchObject({ changes: 9, projects: 2, needsOk: 4, needsOkOrdinals: [4, 6, 8, 9] });
    expect(review.canSave).toBe(false);
    expect((await getReview(db, "alicia", captureId)).found).toBe(false); // the whole note is Kemar's
  });

  it("Kemar accepts 4, 8 and 9, edits 6, and saves: every project changes at once", async () => {
    for (const n of [4, 8, 9]) await decideExtraction(as("kemar", "09:11"), byOrdinal(n).id, { type: "accept" });
    await decideExtraction(as("kemar", "09:11"), byOrdinal(6).id, { type: "edit", value: "handed_over" });
    const saved = await saveCapture(as("kemar", "09:12"), captureId);
    expect(saved.outcome).toBe("saved");

    const forager = await project("alicia", "forager", "09:12");
    expect(forager.calculated.status).toBe("at_risk");
    expect(forager.displayed).toMatchObject({ status: "at_risk", from: "calculated" }); // no reason yet (NoSilentDisagreement)
    expect(forager.setStatus).toMatchObject({ status: "off_track", waitingForReason: true });
    const work = forager.threads.flatMap((th) => th.workItems);
    expect(work.find((w) => w.number === "#151")).toMatchObject({ state: "blocked", blockedNote: "waiting on Kyle (Sprouts IT)" });
    expect(work.find((w) => w.number === "#145")?.state).toBe("done");
    const blocker = forager.braid.entries.find((e) => e.title === "Store sales feed access" && e.kind === "blocker")!;
    expect(blocker.reportCount).toBe(2);
    expect(forager.braid.entries.find((e) => e.title === "Trend model may slip to 24 Oct")).toMatchObject({ kind: "risk", waitingForApproval: true });
    const insights = await project("andre", "insights", "09:12");
    expect(insights.braid.entries.find((e) => e.kind === "decision")).toMatchObject({ title: "Move the daily refresh to 6am", waitingForApproval: true });
    const [runbook] = await db.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, "ho-runbook"));
    expect(runbook.state).toBe("handed_over");
  });

  it("each person sees only their part: inboxes, and the quotes behind the BRAID entries (rule 9, E79)", async () => {
    expect(await titles("alicia", "09:12")).toEqual([
      "Forager 2.0 is set Off track, but the plan says At risk",
      "Kemar raised a risk: Trend model may slip to 24 Oct",
    ]);
    expect(await titles("andre", "09:12")).toEqual(["Kemar proposed a decision: move the daily refresh to 6am"]);
    // M5, A10.1: work Done by voice with no PR linked is expected to ask its owner for the link (D18)
    expect(await titles("kemar", "09:12")).toEqual(["#145 is Done with no linked change", "#208 is Done with no linked change"]);
    await linkChange(as("kemar", "09:13"), "wi-145", "https://github.com/intellibus/forager/pull/145");
    expect(await titles("kemar", "09:13")).toEqual(["#208 is Done with no linked change"]);

    const foragerQuotes = (await project("alicia", "forager", "09:12")).braid.entries.flatMap((e) => e.sources.map((s) => s.quote)).filter(Boolean);
    expect(foragerQuotes).toContain("Still waiting on Kyle for the store feed");
    expect(foragerQuotes.join(" ")).not.toContain("Store Insights");
    const insightsQuotes = (await project("andre", "insights", "09:12")).braid.entries.flatMap((e) => e.sources.map((s) => s.quote)).filter(Boolean);
    expect(insightsQuotes).toEqual(["Andre and I agreed to move the refresh to 6am"]);
    expect((await getProject(db, "andre", "forager", jamaica("09:12"))).found).toBe(false);
    expect((await getProject(db, "alicia", "insights", jamaica("09:12"))).found).toBe(false);
  });

  it("Alicia approves the risk, then saves the reason Atlas drafted; Forager shows Off track", async () => {
    const risk = (await project("alicia", "forager", "09:20")).braid.entries.find((e) => e.title === "Trend model may slip to 24 Oct")!;
    await decideBraidEntry(as("alicia", "09:20"), risk.id, { type: "approve" });
    const draft = await draftReason(db, "forager", jamaica("09:21"));
    const blocker = (await project("alicia", "forager", "09:21")).braid.entries.find((e) => e.kind === "blocker" && e.title === "Store sales feed access")!;
    await saveReason(as("alicia", "09:22"), "forager", { text: draft.text, entryIds: [blocker.id, risk.id], draftedByAtlas: true, edited: false });

    const forager = await project("alicia", "forager", "09:22");
    expect(forager.displayed).toMatchObject({ status: "off_track", from: "set" });
    expect(forager.reason).toMatchObject({ stale: false });
    expect(await titles("alicia", "09:22")).toEqual([]);
    const closed = await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, "alicia"));
    expect(closed.map((i) => i.state).sort()).toEqual(["acted", "acted"]); // both closed by her own actions (M10)
  });

  it("Andre approves the decision; \"we agreed\" never approved it on its own (E96)", async () => {
    const decision = (await project("andre", "insights", "09:30")).braid.entries.find((e) => e.kind === "decision")!;
    expect(decision.waitingForApproval).toBe(true);
    await decideBraidEntry(as("andre", "09:30"), decision.id, { type: "approve" });
    expect((await project("andre", "insights", "09:30")).braid.entries.find((e) => e.id === decision.id)).toMatchObject({ state: "approved", decidedBy: { id: "andre" } });
    expect(await titles("andre", "09:30")).toEqual([]);
  });

  it("Thursday. The feed opens and the model is back on plan: the blocker resolves, Alicia's reason goes stale, and she keeps Off track", async () => {
    const update = "Kyle sent the store feed, so #151 is moving again, and the trend model is back on plan for the 23rd.";
    const later: RawProposal[] = [
      // D7, E93: Kemar owns the blocked work, so saying the feed came resolves the blocker once he confirms it
      { kind: "braid_resolve", projectId: "forager", routingReason: { basis: "target", evidence: "store feed", label: "The feed blocker" }, matchEntryId: "br-feed-blocker", quote: "Kyle sent the store feed", confidence: "high", rationale: "The store feed came" },
      { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#151", label: "#151" }, targetId: "wi-151", field: "state", newValue: "in_progress", quote: "#151 is moving again", confidence: "high", rationale: "The store feed is unblocked" },
      { kind: "update", projectId: "forager", routingReason: { basis: "owned_record", evidence: "Trend model", label: "Kemar owns it" }, targetId: "ms-trend", field: "forecast", newValue: "2026-10-23", quote: "the trend model is back on plan for the 23rd", confidence: "high", rationale: "Back on the target date" },
    ];
    const thursday = as("kemar", "09:00", THURSDAY);
    const { captureId: next } = await createCapture(thursday, { channel: "app", kind: "text", text: update, messageAt: thursday.now, receivedAt: thursday.now });
    const proposed = await proposeItems(thursday, next, later);
    expect(proposed.items.map((i) => i.state)).toEqual(["needs_ok", "pre_accepted", "pre_accepted"]);
    await openReview(thursday, next);
    await decideExtraction(thursday, proposed.items[0].id, { type: "accept" });
    await saveCapture(as("kemar", "09:05", THURSDAY), next);
    const blocker = (await project("alicia", "forager", "09:05", THURSDAY)).braid.entries.find((e) => e.title === "Store sales feed access" && e.kind === "blocker");
    expect(blocker).toMatchObject({ state: "resolved" });
    // D15: Alicia reported it, so Atlas tells her; nothing lands in her inbox for it
    expect((await getChatSummary(db, "alicia")).notices.map((n) => n.text)).toContain("Kemar resolved the blocker you reported: Store sales feed access.");

    const forager = await project("alicia", "forager", "09:05", THURSDAY);
    expect(forager.calculated.status).toBe("on_track");
    expect(forager.reason).toMatchObject({ stale: true, staleNote: "given when the plan said At risk" });
    expect(await titles("alicia", "09:05", THURSDAY)).toEqual(["Forager 2.0: plan now says On track. Keep Off track?"]);

    await keepSetStatus(as("alicia", "09:10", THURSDAY), "forager");
    expect((await project("alicia", "forager", "09:10", THURSDAY)).reason).toMatchObject({ stale: false });
    expect(await titles("alicia", "09:10", THURSDAY)).toEqual([]);
  });

  it("every step left an audit trail, visible to the right people (A11)", async () => {
    const trail = await getAuditTrail(db, "alicia", { type: "project", id: "forager" });
    if (!trail.found) throw new Error("Alicia cannot read Forager's trail");
    const actions = trail.entries.map((e) => e.action);
    for (const a of ["OWNER_SETS", "GIVE_REASON", "APPROVE", "CALCULATED_CHANGED", "KEEP"]) expect(actions).toContain(a);
    const kemars = await getAuditTrail(db, "kemar", { type: "capture", id: captureId });
    expect(kemars.found && kemars.entries.some((e) => e.extractionId && e.actor.id === "kemar")).toBe(true);
    expect((await getAuditTrail(db, "andre", { type: "capture", id: captureId })).found).toBe(false);
  });
});
