import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { KEMAR_NOTE } from "../domain/atlas-checks/kemar-note.fixture";
import { AT_910, at, seededDb } from "../test/seeded-db";
import { getProject, NOT_YOURS, type ProjectView } from "./project";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

const CAPTURE = "cap-kemar-0858";
const KEMAR_SAID = new Date("2026-10-20T13:58:00Z");

async function view(viewer: string, projectId: string, now = AT_910): Promise<ProjectView> {
  const r = await getProject(db, viewer, projectId, now);
  if (!r.found) throw new Error(`${viewer} should read ${projectId}`);
  return r;
}

const source = (id: string, entryId: string, ordinal: number, span: [number, number]) => ({
  id,
  entryId,
  originEntryId: entryId,
  personId: "kemar",
  captureId: CAPTURE,
  extractionId: `${CAPTURE}-${ordinal}`,
  spanStart: span[0],
  spanEnd: span[1],
  at: KEMAR_SAID,
});

// Kemar's capture as Save leaves it: items applied into Forager and Store Insights, with BRAID
// sources pointing into the note by span. Written directly, as the apply command would.
async function kemarSaved() {
  await db
    .update(t.extractions)
    .set({ state: "applied", appliedAt: AT_910 })
    .where(and(eq(t.extractions.captureId, CAPTURE), notInArray(t.extractions.ordinal, [1, 5])));
  await db.update(t.captures).set({ state: "saved" }).where(eq(t.captures.id, CAPTURE));
  await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
  await db.insert(t.braidEntries).values([
    { id: "br-trend-risk", projectId: "forager", kind: "risk", title: "Trend model may slip to 24 Oct", state: "proposed", reportedBy: "kemar", round: 1, proposedOn: "2026-10-20" },
    { id: "br-refresh", projectId: "insights", kind: "decision", title: "Move the daily refresh to 6am", state: "proposed", reportedBy: "kemar", round: 1, proposedOn: "2026-10-20" },
  ]);
  await db.insert(t.braidSources).values([
    source("src-feed-kemar", "br-feed-blocker", 7, [82, 122]),
    source("src-trend-kemar", "br-trend-risk", 8, [124, 156]),
    source("src-pipeline-kemar", "br-pipeline-risk", 9, [192, 222]),
    source("src-refresh-kemar", "br-refresh", 11, [281, 326]),
  ]);
}

describe("getProject: Forager 2.0 at 9:10am, before Kemar saves", () => {
  it("calculated On track, displayed On track, set Off track waiting for a reason", async () => {
    const p = await view("alicia", "forager");
    expect(p.project).toMatchObject({ id: "forager", name: "Forager 2.0", owner: { id: "alicia", name: "Alicia Campbell" } });
    expect(p.viewerRole).toBe("pm");
    expect(p.calculated).toEqual({ status: "on_track", label: "On track" });
    expect(p.displayed).toEqual({ status: "on_track", label: "On track", from: "calculated" });
    expect(p.setStatus).toMatchObject({
      status: "off_track",
      label: "Off track",
      override: "reason_required",
      setBy: { id: "alicia", name: "Alicia Campbell" },
      setAt: new Date("2026-10-20T14:02:00Z"),
      waitingForReason: true,
      differsFromPlan: true,
    });
    expect(p.reason).toBeNull();
  });

  it("threads, milestones and work items each carry their own status", async () => {
    const p = await view("alicia", "forager");
    expect(p.threads.map((th) => [th.name, th.statusLabel])).toEqual([
      ["Trend to buyer email", "On track"],
      ["Store sales signal", "On track"],
      ["Production ready", "On track"],
    ]);
    const trend = p.threads[0];
    expect(trend.milestones.map((m) => [m.name, m.stateLabel, m.statusLabel, m.forecastDate])).toEqual([
      ["Data sources", "Done", "Done", "2026-10-16"],
      ["Trend model", "In progress", "On track", "2026-10-23"],
      ["Buyer pilot · Release 1", "Planned", "On track", "2026-10-30"],
    ]);
    expect(p.threads[1].workItems.map((w) => [w.number, w.stateLabel, w.statusLabel])).toEqual([
      ["#151", "In progress", "On track"],
      ["#152", "To do", "Not started"],
    ]);
    expect(p.unthreaded).toEqual({ milestones: [], workItems: [] });
  });

  it("the BRAID log as seeded: kinds neutral, lifecycle states not statuses, Store sales feed access at 1 report", async () => {
    const p = await view("alicia", "forager");
    expect(p.braid.entries.map((e) => [e.kindLabel, e.title, e.stateLabel, e.reportCount])).toEqual([
      ["Blocker", "Store sales feed access", "Reported", 1],
      ["Risk", "Only Kemar can run the pipeline", "Mitigating", 1],
      ["Assumption", "Buyers available for the pilot week of 26 Oct", "Holding", 1],
      ["Issue", "Google Trends rate limit", "Resolved", 3],
      ["Dependency", "Store sales feed access from Sprouts IT", "Open", 1],
    ]);
    expect(p.braid.counts).toEqual({ blocker: 1, risk: 1, assumption: 1, issue: 1, dependency: 1, decision: 0 });
    expect(p.braid.waitingForApproval).toBe(0);
    const blocker = p.braid.entries[0];
    expect(blocker).toMatchObject({ onLog: true, owner: { id: "kemar", name: "Kemar Brown" }, reportedBy: { id: "alicia", name: "Alicia Campbell" } });
    expect(blocker.sources).toEqual([
      { id: "src-feed-alicia", person: { id: "alicia", name: "Alicia Campbell" }, at: new Date("2026-10-14T15:00:00Z"), ago: "6 days ago", fromCapture: false, quote: null },
    ]);
    expect(blocker.links).toEqual([{ relation: "related", entryId: "br-feed-dependency", title: "Store sales feed access from Sprouts IT", kind: "dependency", stateLabel: "Open" }]);
    expect(p.braid.entries[3]).toMatchObject({ onLog: false, resolvedBy: { id: "kemar", name: "Kemar Brown" }, resolvedOn: "2026-10-17" });
  });
});

describe("getProject: who may read a project", () => {
  it("only members of the project; anyone else gets the same answer as for no project", async () => {
    expect(await getProject(db, "andre", "forager", AT_910)).toEqual(NOT_YOURS);
    expect(await getProject(db, "kyle", "forager", AT_910)).toEqual(NOT_YOURS); // a contact on #151, not a member
    expect(await getProject(db, "alicia", "insights", AT_910)).toEqual(NOT_YOURS);
    expect(await getProject(db, "alicia", "no-such-project", AT_910)).toEqual(NOT_YOURS);
    expect((await view("jodian", "forager")).viewerRole).toBe("member");
    expect((await view("andre", "insights")).viewerRole).toBe("pm");
  });

  it("a member who left, or a group disconnected from DPM, reads nothing (M13)", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "jodian")));
    expect(await getProject(db, "jodian", "forager", AT_910)).toEqual(NOT_YOURS);
    await db.update(t.groups).set({ connectedToDpm: false }).where(eq(t.groups.id, "g-forager"));
    expect(await getProject(db, "alicia", "forager", AT_910)).toEqual(NOT_YOURS);
  });
});

describe("getProject after Kemar saves: quotes by project (rule 9, E79)", () => {
  it("Alicia sees the Forager quotes from Kemar's note, never the Store Insights sentence or the note", async () => {
    await kemarSaved();
    const p = await view("alicia", "forager", at(2));
    expect(p.calculated.label).toBe("At risk");
    const entry = (title: string) => p.braid.entries.find((e) => e.title === title)!;
    expect(entry("Store sales feed access").reportCount).toBe(2);
    expect(entry("Store sales feed access").sources.map((s) => [s.person.name, s.ago, s.quote])).toEqual([
      ["Alicia Campbell", "6 days ago", null],
      ["Kemar Brown", "today", "Still waiting on Kyle for the store feed"],
    ]);
    expect(entry("Trend model may slip to 24 Oct")).toMatchObject({ stateLabel: "Waiting for approval", waitingForApproval: true, onLog: false, reportCount: 1 });
    expect(entry("Trend model may slip to 24 Oct").sources[0].quote).toBe("so I think the model slips a day");
    expect(entry("Only Kemar can run the pipeline").sources[1].quote).toBe("Jodian has the runbook already");
    expect(p.braid.waitingForApproval).toBe(1);

    const json = JSON.stringify(p);
    expect(json).not.toContain("6am");
    expect(json).not.toContain("weekly sales export");
    expect(json).not.toContain(KEMAR_NOTE);
  });

  it("Andre sees only the Store Insights sentence", async () => {
    await kemarSaved();
    const p = await view("andre", "insights", at(2));
    expect(p.braid.entries.map((e) => [e.kindLabel, e.title, e.stateLabel])).toEqual([["Decision", "Move the daily refresh to 6am", "Waiting for approval"]]);
    expect(p.braid.entries[0].sources.map((s) => s.quote)).toEqual(["Andre and I agreed to move the refresh to 6am"]);
    expect(p.braid.counts.decision).toBe(1);
    const json = JSON.stringify(p);
    for (const words of ["Kyle", "runbook", "TikTok", "slips a day", "I'm out"]) expect(json).not.toContain(words);
  });

  it("a source pointing at words routed to another project shows no quote, even to someone in both", async () => {
    await kemarSaved();
    await db.insert(t.braidSources).values([
      // An item filed into Store Insights cannot lend its words to a Forager entry
      source("src-forged-other-item", "br-feed-blocker", 10, [224, 275]),
      // A Forager item with a span that was never routed to Forager
      source("src-forged-span", "br-feed-blocker", 7, [281, 326]),
    ]);
    for (const viewer of ["alicia", "kemar"]) {
      const p = await view(viewer, "forager", at(2));
      const sources = p.braid.entries.find((e) => e.title === "Store sales feed access")!.sources;
      expect(sources.find((s) => s.id === "src-forged-other-item")!.quote, viewer).toBeNull();
      expect(sources.find((s) => s.id === "src-forged-span")!.quote, viewer).toBeNull();
      expect(JSON.stringify(p), viewer).not.toContain("6am");
    }
  });

  it("a quote stays private until Save files its item", async () => {
    await kemarSaved();
    await db.update(t.extractions).set({ state: "accepted" }).where(inArray(t.extractions.id, [`${CAPTURE}-8`]));
    const p = await view("alicia", "forager", at(2));
    expect(p.braid.entries.find((e) => e.title === "Trend model may slip to 24 Oct")!.sources[0].quote).toBeNull();
  });
});

describe("getProject: set status and reason (M9, A4.3)", () => {
  it("a stale reason still wins for display and says when it was given", async () => {
    await db.update(t.projects).set({ setOverride: "reason_stale", reasonGivenAt: "at_risk" }).where(eq(t.projects.id, "forager"));
    await db.insert(t.statusReasons).values({ id: "reason-1", projectId: "forager", text: "Store feed still blocked by Sprouts IT", draftedByAtlas: true, savedBy: "alicia", savedAt: at(5), staleSince: at(60) });
    await db.insert(t.statusReasonLinks).values({ reasonId: "reason-1", braidEntryId: "br-feed-blocker" });
    const p = await view("alicia", "forager", at(61));
    expect(p.calculated.label).toBe("On track");
    expect(p.displayed).toEqual({ status: "off_track", label: "Off track", from: "set" });
    expect(p.setStatus).toMatchObject({ override: "reason_stale", waitingForReason: false });
    expect(p.reason).toMatchObject({
      text: "Store feed still blocked by Sprouts IT",
      draftedByAtlas: true,
      savedBy: { id: "alicia", name: "Alicia Campbell" },
      stale: true,
      staleNote: "given when the plan said At risk",
      links: [{ entryId: "br-feed-blocker", title: "Store sales feed access", kind: "blocker", stateLabel: "Reported", onLog: true }],
    });
  });
});
