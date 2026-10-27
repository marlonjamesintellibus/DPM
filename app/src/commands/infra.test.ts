import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog, loadProject, persistBraidLog, persistSetStatus, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { runChecks } from "../domain/atlas-checks/checks";
import { KEMAR_CONTEXT, KEMAR_NOTE, KEMAR_NOTE_AT, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import { applyToLog, draftEntry, type BraidLog } from "../domain/machines/braid-entry";
import { mergeEntries, unmergeEntry } from "../domain/machines/match";
import { loadCheckContext } from "../queries/check-context";
import { AT_910, at, seededDb } from "../test/seeded-db";
import { StaleVersion } from "./core";
import { evaluateProject } from "./evaluate";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

describe("loadCheckContext", () => {
  it("gives the server checks exactly what the fixture gives them: the same 11 items", async () => {
    const ctx = await loadCheckContext(db, { authorId: "kemar", text: KEMAR_NOTE, messageAt: KEMAR_NOTE_AT, transcriptConfidence: "high" });
    expect(ctx.projects.map((p) => p.id).sort()).toEqual(["forager", "gq", "insights"]);
    expect(runChecks(KEMAR_PROPOSALS, ctx)).toEqual(runChecks(KEMAR_PROPOSALS, KEMAR_CONTEXT));
  });

  it("loads nothing about projects the author cannot file into (check 9)", async () => {
    const ctx = await loadCheckContext(db, { authorId: "andre", text: "hi", messageAt: KEMAR_NOTE_AT, transcriptConfidence: null });
    expect(ctx.projects.map((p) => p.id)).toEqual(["insights"]);
  });
});

describe("evaluateProject", () => {
  const blockerFixture = async () => (await loadBraidLog(db, "forager")).log;

  it("on the seed: Forager is On track and the inbox is already in step", async () => {
    const r = await db.transaction((tx) => evaluateProject(tx, "forager", AT_910));
    expect(r.calculated).toBe("on_track");
    expect(r.setStatus.override).toBe("reason_required");
    expect(r.opened).toEqual([]);
    expect(r.closed).toEqual([]);
  });

  it("E40: the plan moves to At risk; Alicia's Off track stays and her item stays open", async () => {
    await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
    const r = await db.transaction((tx) => evaluateProject(tx, "forager", at(5)));
    expect(r.calculated).toBe("at_risk");
    expect(r.setStatus).toMatchObject({ override: "reason_required", setStatus: "off_track" });
    expect(r.closed).toEqual([]);
  });

  it("E42: a reason given at At risk goes stale when the plan moves back, and Alicia is asked to keep it", async () => {
    await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
    await db.transaction(async (tx) => {
      const p = (await loadProject(tx, "forager"))!;
      await persistSetStatus(tx, "forager", p.version, { override: "explained", setStatus: "off_track", reasonGivenAt: "at_risk" }, at(5));
      await evaluateProject(tx, "forager", at(5), { actorId: "alicia" }); // her reason closes the reason item
    });
    await db.update(t.milestones).set({ forecastDate: "2026-10-23" }).where(eq(t.milestones.id, "ms-trend"));
    const r = await db.transaction((tx) => evaluateProject(tx, "forager", at(60)));
    expect(r.setStatus.override).toBe("reason_stale");
    expect(r.opened).toEqual([{ ownerId: "alicia", causeKey: "keep_set_status:forager" }]);
    const items = await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, "alicia"));
    expect(items.map((i) => [i.causeKey, i.state])).toEqual([
      ["status_set_with_no_reason:forager", "acted"],
      ["keep_set_status:forager", "open"],
    ]);
  });

  it("a proposed risk asks the PM; when the PM loses the role, the project owner is told nobody can decide (E91, rule 7)", async () => {
    const before = await blockerFixture();
    const draft = draftEntry({ id: "br-new-risk", projectId: "forager", kind: "risk", title: "Trend model may slip" });
    const reported = applyToLog({ ...before, [draft.id]: draft }, draft.id, { type: "REPORT", source: { id: "s1", personId: "kemar", captureId: null, span: null, at: at(0).toISOString() } }, {
      actor: { id: "kemar", role: "member" },
      today: "2026-10-20",
    });
    expect(reported.outcome.ok).toBe(true);
    await db.transaction((tx) => persistBraidLog(tx, before, reported.log, new Map(), at(0)));
    let r = await db.transaction((tx) => evaluateProject(tx, "forager", at(1)));
    expect(r.opened).toEqual([{ ownerId: "alicia", causeKey: "approve:br-new-risk" }]);

    await db.update(t.projectMemberships).set({ role: "member" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    r = await db.transaction((tx) => evaluateProject(tx, "forager", at(2)));
    expect(r.closed).toEqual([{ ownerId: "alicia", causeKey: "approve:br-new-risk", to: "auto_closed" }]);
    expect(r.opened).toEqual([{ ownerId: "alicia", causeKey: "no_decider:br-new-risk" }]);
  });
});

describe("records", () => {
  it("a stale version is refused, never overwritten", async () => {
    const p = (await loadProject(db, "forager"))!;
    await db.transaction((tx) => persistSetStatus(tx, "forager", p.version, setStatusRecordOf(p), at(1)));
    await expect(db.transaction((tx) => persistSetStatus(tx, "forager", p.version, setStatusRecordOf(p), at(2)))).rejects.toBeInstanceOf(StaleVersion);
  });

  it("a BRAID log survives merge and unmerge through the database, sources moved and given back", async () => {
    const { log: start, versions } = await loadBraidLog(db, "forager");
    const dup = draftEntry({ id: "br-dup", projectId: "forager", kind: "blocker", title: "Store feed blocked" });
    const withDup = applyToLog({ ...start, [dup.id]: dup }, dup.id, { type: "REPORT", source: { id: "s-dup", personId: "jodian", captureId: null, span: null, at: at(0).toISOString() } }, {
      actor: { id: "jodian", role: "member" },
      today: "2026-10-20",
    }).log;
    await db.transaction((tx) => persistBraidLog(tx, start, withDup, versions, at(0)));

    const pm = { actor: { id: "alicia", role: "pm" as const }, today: "2026-10-20" };
    let loaded = await loadBraidLog(db, "forager");
    const merged = mergeEntries(loaded.log, "br-dup", "br-feed-blocker", pm);
    expect(merged.outcome.ok).toBe(true);
    await db.transaction((tx) => persistBraidLog(tx, loaded.log, merged.log, loaded.versions, at(1)));
    loaded = await loadBraidLog(db, "forager");
    expect(asDomain(loaded.log)).toEqual(asDomain(merged.log));
    expect(loaded.log["br-feed-blocker"].sources.map((s) => s.id).sort()).toEqual(["s-dup", "src-feed-alicia"]);

    const unmerged = unmergeEntry(loaded.log, "br-dup", pm);
    expect(unmerged.outcome.ok).toBe(true);
    await db.transaction((tx) => persistBraidLog(tx, loaded.log, unmerged.log, loaded.versions, at(2)));
    const back = await loadBraidLog(db, "forager");
    expect(asDomain(back.log)).toEqual(asDomain(unmerged.log));
    expect(back.log["br-dup"].sources.map((s) => s.id)).toEqual(["s-dup"]);
  });
});

// Compare records as plain data, the way the domain sees them
function asDomain(log: BraidLog) {
  return JSON.parse(JSON.stringify(log)) as BraidLog;
}

