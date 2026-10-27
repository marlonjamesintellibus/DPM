// D7 to D11, D15, D16 against PGlite (machines doc, section 11; research model braidFollowUps.mjs).
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog, loadItems } from "../db/records";
import * as t from "../db/schema";
import { KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import type { RawProposal } from "../domain/atlas-checks/types";
import { getChatSummary } from "../queries/chat";
import { getInbox } from "../queries/inbox";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import {
  confirmFollowUp,
  decideBraidEntry,
  dropFollowUp,
  mergeBraidEntries,
  reportBraidEntry,
  resolveBraidEntry,
  setDecisionApprovers,
  withdrawEntry,
} from "./braid";
import { createCapture, decideExtraction, openReview, proposeItems, rematchExtraction, saveCapture } from "./capture";
import { CommandRefused } from "./core";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const entry = async (id: string, projectId = "forager") => (await loadBraidLog(db, projectId)).log[id];
const live = async (who: string) =>
  (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open").map((i) => i.causeKey).sort();

let n = 0;
/** Someone says something in Atlas; Atlas proposes these; they accept every item and save. */
async function says(who: string, text: string, proposals: RawProposal[], minutes = 0, opts: { save?: boolean } = {}) {
  const { captureId } = await createCapture(as(who, minutes), { channel: "atlas", messageId: `atl-f-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as(who, minutes), captureId, proposals);
  await openReview(as(who, minutes), captureId);
  const review = await getReview(db, who, captureId);
  if (!review.found) throw new Error("no review");
  if (opts.save !== false) {
    for (const i of items) if (i.state === "needs_ok") await decideExtraction(as(who, minutes), i.id, { type: "accept" });
    const r = await saveCapture(as(who, minutes), captureId);
    if (r.outcome !== "saved") throw new Error(`save: ${JSON.stringify(r)}`);
  }
  return { captureId, items, cards: review.groups.flatMap((g) => g.items) };
}

const resolve = (quote: string, entryId = "br-feed-blocker"): RawProposal => ({
  kind: "braid_resolve",
  projectId: "forager",
  routingReason: { basis: "target", evidence: "Store sales feed access", label: "The feed blocker" },
  matchEntryId: entryId,
  quote,
  confidence: "high",
  rationale: "The store feed is cleared",
});

const sameAs = (entryId: string, kind: RawProposal["braidKind"], quote: string): RawProposal => ({
  kind: "braid_same",
  projectId: "forager",
  routingReason: { basis: "target", evidence: quote, label: "Same subject" },
  braidKind: kind,
  matchEntryId: entryId,
  quote,
  confidence: "high",
  rationale: "Reported again",
});

describe("D7: a blocker resolved from a message (E93)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("Kemar owns the blocked work: \"Kyle sent the feed\" resolves it on save, and Alicia, who reported it, is told", async () => {
    const { cards } = await says("kemar", "Kyle sent the feed this morning.", [resolve("Kyle sent the feed")], 0, { save: false });
    expect(cards[0]).toMatchObject({ kind: "braid_resolve", state: "needs_ok", change: "Resolve it", match: { label: "Resolves: Store sales feed access" } });
    await says("kemar", "Kyle sent the feed today.", [resolve("Kyle sent the feed")], 1);
    expect(await entry("br-feed-blocker")).toMatchObject({ state: "resolved", resolvedBy: "kemar" });
    expect((await getChatSummary(db, "alicia")).notices.map((x) => x.text)).toEqual(["Kemar resolved the blocker you reported: Store sales feed access."]);
  });

  it("Jodian says it: it becomes \"it's cleared\" for Kemar and the PM to confirm, never a resolution", async () => {
    const { cards } = await says("jodian", "Kyle sent the feed.", [resolve("Kyle sent the feed")], 0, { save: false });
    expect(cards[0].change).toBe("Tell the owner and the PM it is cleared");
    await says("jodian", "Kyle sent the feed today.", [resolve("Kyle sent the feed")], 1);
    expect(await entry("br-feed-blocker")).toMatchObject({ state: "reported", resolveProposedBy: "jodian" });
    expect(await live("kemar")).toContain("clear:br-feed-blocker");
    expect(await live("alicia")).toContain("clear:br-feed-blocker");
  });

  it("a resolve item on a blocker already resolved is no change", async () => {
    await resolveBraidEntry(as("alicia"), "br-feed-blocker");
    const { items } = await says("kemar", "Kyle sent the feed.", [resolve("Kyle sent the feed")], 1, { save: false });
    expect(items[0].state).toBe("no_change");
  });

  it("only blockers and issues are resolved from a message (check 12)", async () => {
    const { captureId } = await createCapture(as("kemar"), { channel: "atlas", messageId: "atl-risk", kind: "text", text: "The pipeline risk is gone.", messageAt: at(0), receivedAt: at(0) });
    const r = await proposeItems(as("kemar"), captureId, [{ ...resolve("The pipeline risk is gone", "br-pipeline-risk") }]);
    expect(r.items).toEqual([]);
    expect(r.dropped[0].reason).toMatch(/not resolved from a message/);
  });
});

describe("E93: when the work a blocker held moves on, its owner is asked", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("blocking #151 and reporting the blocker in the same words links them; unblocking asks Kemar to confirm", async () => {
    const quote = "Still waiting on Kyle for the store feed";
    await says("kemar", `${quote}.`, [KEMAR_PROPOSALS[2], { ...KEMAR_PROPOSALS[6], quote }]);
    const [wi] = await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-151"));
    expect(wi).toMatchObject({ state: "blocked", blockedLinks: ["br-feed-blocker"] });
    expect(await live("kemar")).not.toContain("confirm_clear:br-feed-blocker");

    const moving: RawProposal = { ...KEMAR_PROPOSALS[2], newValue: "in_progress", note: null, quote: "#151 is moving again" };
    await says("kemar", "#151 is moving again.", [moving], 60);
    expect(await live("kemar")).toContain("confirm_clear:br-feed-blocker");
    expect((await getInbox(db, "kemar", at(61))).items.map((i) => i.title)).toContain("Your work is moving again. Is this blocker resolved? Store sales feed access");
    expect((await entry("br-feed-blocker")).state).toBe("reported"); // the rule never resolves it

    await resolveBraidEntry(as("kemar", 62), "br-feed-blocker");
    expect(await live("kemar")).not.toContain("confirm_clear:br-feed-blocker");
  });
});

describe("D8, D10: reports on finished entries, and what follows them", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("D8 a closed risk reported again is a new risk for the leads, linked to the closed one; the closed one stays closed", async () => {
    await resolveBraidEntry(as("alicia"), "br-pipeline-risk", "closed");
    const quote = "Only I can run the pipeline again";
    const { items } = await says("kemar", `${quote}.`, [sameAs("br-pipeline-risk", "risk", quote)], 1);
    expect((await entry("br-pipeline-risk")).state).toBe("closed");
    const fresh = await entry(`br-${items[0].id}`);
    expect(fresh).toMatchObject({ kind: "risk", state: "proposed", title: "Only Kemar can run the pipeline", links: [{ relation: "raised_from", entryId: "br-pipeline-risk" }] });
    expect(await live("alicia")).toContain(`approve:${fresh.id}`);
  });

  it("D10 a realised risk drafts an issue for the PM to confirm in one step; reports on the risk then go to the issue (D8)", async () => {
    await resolveBraidEntry(as("alicia"), "br-pipeline-risk", "realised");
    const draft = await entry("br-pipeline-risk-raised");
    expect(draft).toMatchObject({ kind: "issue", state: "none", links: [{ relation: "raised_from", entryId: "br-pipeline-risk" }] });
    expect(await live("alicia")).toContain("follow_up:br-pipeline-risk-raised");
    expect((await getInbox(db, "alicia", at(1))).items.find((i) => i.cause === "follow_up")?.title).toBe("Atlas drafted an issue: Only Kemar can run the pipeline");

    await expect(confirmFollowUp(as("kemar", 1), "br-pipeline-risk-raised")).rejects.toBeInstanceOf(CommandRefused);
    await confirmFollowUp(as("alicia", 1), "br-pipeline-risk-raised", "Pipeline runs depend on Kemar alone");
    expect(await entry("br-pipeline-risk-raised")).toMatchObject({ state: "reported", title: "Pipeline runs depend on Kemar alone" });
    expect(await live("alicia")).not.toContain("follow_up:br-pipeline-risk-raised");

    const quote = "nobody else can run the pipeline";
    await says("kemar", `${quote}.`, [sameAs("br-pipeline-risk", "risk", quote)], 2);
    expect((await entry("br-pipeline-risk")).sources.map((s) => s.personId)).toEqual(["alicia"]);
    expect((await entry("br-pipeline-risk-raised")).sources.map((s) => s.personId)).toEqual(["alicia", "kemar"]);
  });

  it("D10 the PM can drop the draft; the risk stays realised", async () => {
    await resolveBraidEntry(as("alicia"), "br-pipeline-risk", "realised");
    await dropFollowUp(as("alicia", 1), "br-pipeline-risk-raised");
    expect((await entry("br-pipeline-risk-raised")).state).toBe("withdrawn");
    expect((await entry("br-pipeline-risk")).state).toBe("realised");
    expect(await live("alicia")).not.toContain("follow_up:br-pipeline-risk-raised");
  });
});

describe("D9, D11: merging and withdrawing", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  async function duplicateBlocker() {
    const report: RawProposal = {
      kind: "braid_new",
      projectId: "forager",
      routingReason: { basis: "tied_person", evidence: "Kyle", label: "Kyle is the contact on #151" },
      braidKind: "blocker",
      braidTitle: "Feed access from Kyle",
      quote: "Blocked on Kyle for the feed",
      confidence: "high",
      rationale: "A blocker",
    };
    const { items } = await says("jodian", "Blocked on Kyle for the feed.", [report]);
    return `br-${items[0].id}`;
  }

  it("D9 merging an open duplicate into a resolved blocker asks the PM: reopen it, or keep it resolved", async () => {
    const dup = await duplicateBlocker();
    await resolveBraidEntry(as("alicia", 1), "br-feed-blocker");
    await expect(mergeBraidEntries(as("alicia", 2), dup, "br-feed-blocker")).rejects.toThrow("reopen it, or keep it resolved");
    await mergeBraidEntries(as("alicia", 2), dup, "br-feed-blocker", "keep_resolved");
    expect(await entry("br-feed-blocker")).toMatchObject({ state: "resolved", keptOnMerge: true });
    expect((await entry("br-feed-blocker")).sources.map((s) => s.personId)).toEqual(["alicia", "jodian"]);
  });

  it("D9 choosing reopen puts the blocker back on the log", async () => {
    const dup = await duplicateBlocker();
    await resolveBraidEntry(as("alicia", 1), "br-feed-blocker");
    await mergeBraidEntries(as("alicia", 2), dup, "br-feed-blocker", "reopen");
    expect(await entry("br-feed-blocker")).toMatchObject({ state: "reported", keptOnMerge: false });
  });

  it("D11 Kemar takes back his report of a blocker Alicia also reported: hers stays, the entry stays", async () => {
    const quote = "Still waiting on Kyle for the store feed";
    const { items } = await says("kemar", `${quote}.`, [{ ...KEMAR_PROPOSALS[6], quote }]);
    expect((await entry("br-feed-blocker")).sources.map((s) => s.personId)).toEqual(["alicia", "kemar"]);
    await withdrawEntry(as("kemar", 1), "br-feed-blocker");
    const after = await entry("br-feed-blocker");
    expect(after).toMatchObject({ state: "reported", reportedBy: "alicia" });
    expect(after.sources.map((s) => s.personId)).toEqual(["alicia"]);
    // Kept for the history, never shown on the entry
    const [row] = await db.select().from(t.braidSources).where(eq(t.braidSources.id, `src-${items[0].id}`));
    expect(row.withdrawnAt).not.toBeNull();
  });
});

describe("D15, D16: reporters hear back; approvers per project", () => {
  beforeEach(async () => {
    db = await seededDb();
  }, 30_000);

  async function kemarSaves() {
    const ids = (await loadItems(db, "cap-kemar-0858")).items;
    await openReview(as("kemar"), "cap-kemar-0858");
    for (const i of ids) if (i.state === "needs_ok") await decideExtraction(as("kemar"), i.id, { type: "accept" });
    expect((await saveCapture(as("kemar", 1), "cap-kemar-0858")).outcome).toBe("saved");
  }

  it("D15 Kemar is told in his chat when Alicia approves his risk, and when Andre declines his decision", async () => {
    await kemarSaves();
    const risk = Object.values((await loadBraidLog(db, "forager")).log).find((e) => e.title === "Trend model may slip to 24 Oct")!;
    await decideBraidEntry(as("alicia", 2), risk.id, { type: "approve" });
    const decision = Object.values((await loadBraidLog(db, "insights")).log).find((e) => e.kind === "decision")!;
    await decideBraidEntry(as("andre", 3), decision.id, { type: "decline", reason: "The 6am window clashes with the store backups" });
    expect((await getChatSummary(db, "kemar")).notices.map((x) => x.text)).toEqual([
      "Andre declined your decision: Move the daily refresh to 6am. Reason: The 6am window clashes with the store backups",
      "Alicia approved your risk: Trend model may slip to 24 Oct.",
    ]);
    expect((await getChatSummary(db, "alicia")).notices).toEqual([]);
  });

  it("D16 the PM sets 2 approvers: one approval decides nothing yet, and no notice goes out", async () => {
    await expect(setDecisionApprovers(as("kemar"), "insights", 2)).rejects.toThrow("only the project's PM");
    await setDecisionApprovers(as("andre"), "insights", 2);
    await db.update(t.projectMemberships).set({ role: "lead" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    await kemarSaves();
    const decision = Object.values((await loadBraidLog(db, "insights")).log).find((e) => e.kind === "decision")!;
    const first = await decideBraidEntry(as("andre", 2), decision.id, { type: "approve" });
    expect(first.entry.state).toBe("proposed");
    expect((await getChatSummary(db, "kemar")).notices).toEqual([]);
    // A lead who proposed it may approve it too (S12), and the second approval decides it
    const second = await decideBraidEntry(as("kemar", 3), decision.id, { type: "approve" });
    expect(second.entry.state).toBe("approved");
  });
});

describe("D17, D18: adding to the log while writing a reason; correcting a match on review", () => {
  beforeEach(async () => {
    db = await seededDb();
  }, 30_000);

  it("D17 Alicia adds an entry while writing her reason: as PM it lands on the log at once, and can be linked", async () => {
    const r = await reportBraidEntry(as("alicia", 1), "forager", { kind: "issue", title: "Feed access needs a new Sprouts IT contact" });
    expect(r.entry).toMatchObject({ kind: "issue", state: "reported", reportedBy: "alicia" });
    const saved = await giveReasonFor(r.entry.id);
    expect(saved.reasonId).toBeTruthy();
  });

  it("D17 a member's entry lands as a proposal, per the rights table", async () => {
    const r = await reportBraidEntry(as("kemar", 1), "forager", { kind: "risk", title: "Feed may need a VPN" });
    expect(r.entry.state).toBe("proposed");
    await expect(reportBraidEntry(as("kemar", 1), "forager", { kind: "risk", title: "  " })).rejects.toThrow("give the entry a title");
  });

  it("D18 \"Not the same\" makes Kemar's same-as report a new entry; \"Pick an entry\" points it at another", async () => {
    await openReview(as("kemar"), "cap-kemar-0858");
    const nine = "cap-kemar-0858-9"; // Same as: Only Kemar can run the pipeline
    const different = await rematchExtraction(as("kemar"), nine, { type: "different" });
    expect(different).toMatchObject({ state: "accepted", draft: { kind: "braid_new", braid: { match: "new", matchEntryId: null } } });
    const picked = await rematchExtraction(as("kemar"), nine, { type: "pick", entryId: "br-pipeline-risk" });
    expect(picked.draft).toMatchObject({ kind: "braid_same", braid: { match: "same_as", matchEntryId: "br-pipeline-risk" } });
    await expect(rematchExtraction(as("kemar"), nine, { type: "pick", entryId: "br-feed-blocker" })).rejects.toThrow("kinds never merge");
  });
});

async function giveReasonFor(entryId: string) {
  const { saveReason } = await import("./status");
  return saveReason(as("alicia", 2), "forager", { text: "The feed contact changed.", entryIds: [entryId], draftedByAtlas: false, edited: false });
}
