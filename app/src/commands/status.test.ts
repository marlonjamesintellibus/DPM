import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog, loadProject, persistBraidLog, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { applyToLog, draftEntry, type BraidActor } from "../domain/machines/braid-entry";
import { displayedStatus } from "../domain/machines/set-status";
import type { BraidKind } from "../domain/rights";
import { AT_910, at, seededDb } from "../test/seeded-db";
import { decideBraidEntry, resolveBraidEntry } from "./braid";
import { CommandRefused } from "./core";
import { evaluateProject } from "./evaluate";
import { draftReason, keepSetStatus, saveReason, setStatus, useCalculated } from "./status";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });

async function inbox(ownerId: string) {
  const rows = await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, ownerId)).orderBy(t.inboxItems.createdAt, t.inboxItems.episode);
  return rows.map((i) => [i.causeKey, i.state]);
}

async function forager() {
  const p = (await loadProject(db, "forager"))!;
  return { row: p, record: setStatusRecordOf(p) };
}

// Kemar's 9:10 save as far as the plan is concerned: the trend model slips a day (At risk)
const slipTrendModel = (to = "2026-10-24") => db.update(t.milestones).set({ forecastDate: to }).where(eq(t.milestones.id, "ms-trend"));

/** Reports an entry the way the Apply job does, then runs the rules. */
async function report(id: string, kind: BraidKind, title: string, actor: BraidActor, projectId = "forager") {
  const { log, versions } = await loadBraidLog(db, projectId);
  const draft = draftEntry({ id, projectId, kind, title });
  const r = applyToLog({ ...log, [id]: draft }, id, { type: "REPORT", source: { id: `src-${id}`, personId: actor.id, captureId: null, span: null, at: AT_910.toISOString() } }, { actor, today: "2026-10-20" });
  expect(r.outcome.ok).toBe(true);
  await db.transaction(async (tx) => {
    await persistBraidLog(tx, log, r.log, versions, AT_910);
    await evaluateProject(tx, projectId, AT_910, { actorId: actor.id });
  });
}

describe("setStatus (M9 guard)", () => {
  it("only the owner, or a PM or Lead of the project, sets its status", async () => {
    await expect(setStatus(as("kemar"), "forager", "at_risk")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(setStatus(as("andre"), "forager", "at_risk")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(setStatus(as("alicia"), "nowhere", "at_risk")).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a status that cannot be set by hand, or that matches the plan", async () => {
    await expect(setStatus(as("alicia"), "forager", "done")).rejects.toThrow("cannot be set by hand");
    await expect(useCalculated(as("alicia"), "gq")).rejects.toBeInstanceOf(CommandRefused);
  });

  it("E40: Alicia sets Off track while the plan is On track; Kemar's save makes it At risk and her status stays", async () => {
    await useCalculated(as("alicia"), "forager"); // start from no set status
    const r = await setStatus(as("alicia", 1), "forager", "off_track");
    expect(r.outcome).toMatchObject({ from: "calculated_only", to: "reason_required" });
    expect(await inbox("alicia")).toEqual([
      ["status_set_with_no_reason:forager", "acted"],
      ["status_set_with_no_reason:forager", "open"],
    ]);

    await slipTrendModel();
    const e = await db.transaction((tx) => evaluateProject(tx, "forager", at(2)));
    expect(e.calculated).toBe("at_risk");
    expect(e.setStatus).toMatchObject({ override: "reason_required", setStatus: "off_track" });
    expect((await inbox("alicia")).at(-1)).toEqual(["status_set_with_no_reason:forager", "open"]);
    const [audited] = await db.select().from(t.auditEntries).where(eq(t.auditEntries.action, "OWNER_SETS")).orderBy(t.auditEntries.id).offset(2);
    expect(audited).toMatchObject({ actorId: "alicia", subjectId: "forager", fromState: "calculated_only", toState: "reason_required" });
  });

  it("E41: the plan comes to agree with the set status; it clears and the item closes on its own", async () => {
    await setStatus(as("alicia"), "forager", "at_risk");
    expect((await forager()).record).toMatchObject({ override: "reason_required", setStatus: "at_risk" });
    await slipTrendModel();
    const e = await db.transaction((tx) => evaluateProject(tx, "forager", at(5)));
    expect(e.setStatus.override).toBe("calculated_only");
    expect(await inbox("alicia")).toEqual([["status_set_with_no_reason:forager", "auto_closed"]]);
    expect((await forager()).row.setBy).toBeNull();
  });

  it("E42: a reason goes stale when the plan moves; Keep Off track closes the light item as acted", async () => {
    await slipTrendModel();
    await saveReason(as("alicia", 1), "forager", { text: "Store feed blocked", entryIds: ["br-feed-blocker"], draftedByAtlas: false, edited: false });
    expect((await forager()).record).toEqual({ override: "explained", setStatus: "off_track", reasonGivenAt: "at_risk" });

    await slipTrendModel("2026-10-23");
    const e = await db.transaction((tx) => evaluateProject(tx, "forager", at(30)));
    expect(e.setStatus.override).toBe("reason_stale");
    expect(displayedStatus(e.setStatus, e.calculated)).toBe("off_track");

    const kept = await keepSetStatus(as("alicia", 31), "forager");
    expect(kept.outcome).toMatchObject({ from: "reason_stale", to: "explained" });
    expect(kept.record.reasonGivenAt).toBe("on_track");
    expect(await inbox("alicia")).toEqual([
      ["status_set_with_no_reason:forager", "acted"],
      ["keep_set_status:forager", "acted"],
    ]);
  });

  it('E42: "Use On track instead" from a stale reason clears the set status', async () => {
    await slipTrendModel();
    await saveReason(as("alicia", 1), "forager", { text: "Store feed blocked", entryIds: ["br-feed-blocker"], draftedByAtlas: false, edited: false });
    await slipTrendModel("2026-10-23");
    await db.transaction((tx) => evaluateProject(tx, "forager", at(30)));
    const r = await useCalculated(as("alicia", 31), "forager");
    expect(r.outcome).toMatchObject({ from: "reason_stale", to: "calculated_only" });
    expect((await inbox("alicia")).at(-1)).toEqual(["keep_set_status:forager", "acted"]);
    await expect(keepSetStatus(as("alicia", 32), "forager")).rejects.toBeInstanceOf(CommandRefused);
  });

  it("E43: setting a status when everything is Done is refused (DoneWins)", async () => {
    await db.update(t.milestones).set({ state: "done" }).where(eq(t.milestones.projectId, "forager"));
    await db.update(t.workItems).set({ state: "done" }).where(eq(t.workItems.projectId, "forager"));
    await expect(setStatus(as("alicia"), "forager", "at_risk")).rejects.toThrow("DoneWins");
  });

  it("E44: setting Off track twice is refused and changes nothing", async () => {
    const before = await forager();
    const audits = (await db.select().from(t.auditEntries)).length;
    await expect(setStatus(as("alicia"), "forager", "off_track")).rejects.toThrow("already set");
    expect((await forager()).row.version).toBe(before.row.version);
    expect((await db.select().from(t.auditEntries)).length).toBe(audits);
    expect(await inbox("alicia")).toEqual([["status_set_with_no_reason:forager", "open"]]);
  });
});

describe("saveReason (M9)", () => {
  const reason = (entryIds: string[]) => ({ text: "Store feed blocked", entryIds, draftedByAtlas: false, edited: false });

  it("stores the reason with its links; the item closes as acted and the set status wins for display", async () => {
    await slipTrendModel();
    const r = await saveReason(as("alicia"), "forager", { ...reason(["br-feed-blocker", "br-pipeline-risk"]), draftedByAtlas: true, edited: true });
    expect(r.outcome).toMatchObject({ from: "reason_required", to: "explained" });
    expect(displayedStatus(r.record, r.evaluation.calculated)).toBe("off_track");
    const [saved] = await db.select().from(t.statusReasons);
    expect(saved).toMatchObject({ id: r.reasonId, projectId: "forager", savedBy: "alicia", draftedByAtlas: true, edited: true });
    const links = await db.select().from(t.statusReasonLinks);
    expect(links.map((l) => l.braidEntryId).sort()).toEqual(["br-feed-blocker", "br-pipeline-risk"]);
    expect(await inbox("alicia")).toEqual([["status_set_with_no_reason:forager", "acted"]]);
  });

  it("E45: a reason with no entry is refused; a proposed entry cannot be linked until it is approved inline", async () => {
    await report("br-slip", "risk", "Trend model may slip to 24 Oct", { id: "kemar", role: "member" });
    await expect(saveReason(as("alicia"), "forager", reason([]))).rejects.toThrow("link at least one");
    await expect(saveReason(as("alicia"), "forager", reason(["br-slip"]))).rejects.toThrow("not on the log");
    expect(await db.select().from(t.statusReasons)).toEqual([]);

    await decideBraidEntry(as("alicia", 1), "br-slip", { type: "approve" });
    const r = await saveReason(as("alicia", 2), "forager", reason(["br-slip"]));
    expect(r.outcome.to).toBe("explained");
  });

  it("refuses entries from another project, resolved or withdrawn ones, an empty text, and a member", async () => {
    await report("br-ins-dec", "decision", "Move the refresh to 6am", { id: "kemar", role: "member" }, "insights");
    await expect(saveReason(as("alicia"), "forager", reason(["br-ins-dec"]))).rejects.toThrow("not on this project's BRAID log");
    await expect(saveReason(as("alicia"), "forager", reason(["br-rate-limit"]))).rejects.toThrow("resolved, not on the log");
    await expect(saveReason(as("alicia"), "forager", { ...reason(["br-feed-blocker"]), text: "  " })).rejects.toThrow("write the reason");
    await expect(saveReason(as("kemar"), "forager", reason(["br-feed-blocker"]))).rejects.toMatchObject({ code: "not_allowed" });
  });

  it("E46: the linked risk is resolved later; the reason keeps its link and stays explained while the plan holds", async () => {
    await saveReason(as("alicia"), "forager", reason(["br-pipeline-risk"]));
    await resolveBraidEntry(as("alicia", 5), "br-pipeline-risk", "closed");
    const { record } = await forager();
    expect(record.override).toBe("explained");
    expect((await db.select().from(t.statusReasonLinks)).map((l) => l.braidEntryId)).toEqual(["br-pipeline-risk"]);
    expect((await loadBraidLog(db, "forager")).log["br-pipeline-risk"].state).toBe("closed");
  });

  it("a second save of the same reason (two tabs) is refused, never stored twice", async () => {
    const results = await Promise.allSettled([saveReason(as("alicia"), "forager", reason(["br-feed-blocker"])), saveReason(as("alicia"), "forager", reason(["br-feed-blocker"]))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(t.statusReasons)).toHaveLength(1);
  });
});

describe("draftReason (M11)", () => {
  it("drafts from the log and the worst items, in plain words, and links only entries on the log", async () => {
    await slipTrendModel();
    await db.update(t.workItems).set({ state: "blocked", blockedNote: "waiting on Kyle (Sprouts IT)", blockedLinks: ["br-feed-blocker"] }).where(eq(t.workItems.id, "wi-151"));
    await report("br-slip", "risk", "Trend model may slip to 24 Oct", { id: "kemar", role: "member" });

    const draft = await draftReason(db, "forager", AT_910);
    expect(draft.by).toBe("rules");
    expect(draft.text).toMatch(/^Store sales feed access has been blocked for 6 days \(#151\)\. Trend model is forecast for 24 Oct, 1 day after its target\./);
    expect(draft.text).toContain("Risk: Only Kemar can run the pipeline.");
    expect(draft.entryIds).toEqual(["br-feed-blocker", "br-pipeline-risk"]);
    expect(draft.text).not.toContain("may slip"); // still proposed
    expect(draft.text).not.toMatch(/leave|26 Oct|30 Oct/);

    // The draft is good enough to save as is
    const r = await saveReason(as("alicia"), "forager", { text: draft.text, entryIds: draft.entryIds, draftedByAtlas: false, edited: false });
    expect(r.outcome.to).toBe("explained");
  });

  it("E47: nothing to draft from gives an empty draft, so the owner writes it", async () => {
    expect(await draftReason(db, "insights", AT_910)).toEqual({ text: "", entryIds: [], by: "rules" });
  });
});
