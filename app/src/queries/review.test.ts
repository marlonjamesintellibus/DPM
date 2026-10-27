import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { seededDb } from "../test/seeded-db";
import { NOT_YOURS } from "./project";
import { getReview, type Review } from "./review";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

const CAPTURE = "cap-kemar-0858";

async function kemarsReview(): Promise<Review> {
  const r = await getReview(db, "kemar", CAPTURE);
  if (!r.found) throw new Error("Kemar should see his own review");
  return r;
}

describe("getReview: Kemar's note at 9:10am (L16b)", () => {
  it("11 items, 9 changes for 2 projects, items 4, 6, 8 and 9 need his OK", async () => {
    const r = await kemarsReview();
    expect(r.items).toHaveLength(11);
    expect(r.counts).toEqual({ changes: 9, projects: 2, needsOk: 4, needsProject: 0, needsOkOrdinals: [4, 6, 8, 9] });
    expect(r.footer).toBe("9 updates for 2 projects. 4 need your OK.");
    expect(r.chatLine).toBe("Got it. 9 updates for 2 projects; 4 need your OK.");
    expect(r.canSave).toBe(false);
    expect(r.capture.text.startsWith("Finished the TikTok ingest")).toBe(true);
    expect(r.author).toEqual({ id: "kemar", name: "Kemar Brown" });
  });

  it("groups by project with its PM, then You; nothing is Not filed", async () => {
    const r = await kemarsReview();
    expect(r.groups.map((g) => [g.label, g.type === "project" ? g.pm?.name : null, g.items.map((i) => i.ordinal)])).toEqual([
      ["Forager 2.0", "Alicia Campbell", [1, 2, 3, 4, 6, 7, 8, 9]],
      ["Store Insights", "Andre Mitchell", [10, 11]],
      ["You", null, [5]],
    ]);
  });

  it("each card: kind label, title, change line, confidence, mark and why this project", async () => {
    const r = await kemarsReview();
    const rows = r.items.map((i) => [i.ordinal, i.kindLabel, i.title, i.change, i.confidence, i.markLabel, i.routing.reason]);
    expect(rows).toEqual([
      [1, "Update", "Issue #142 TikTok trend ingest", "Already Done", "high", "No change", "#142"],
      [2, "Update", "Issue #145 Google Trends connector", "In progress to Done", "high", "Ready", "#145"],
      [3, "Update", "Issue #151 Store sales feed access", "In progress to Blocked: waiting on Kyle (Sprouts IT)", "high", "Ready", "Kyle is the contact on #151"],
      [4, "Update", "Milestone Trend model", "Forecast 23 Oct to 24 Oct", "medium", "Needs your OK", "Kemar owns it"],
      [5, "Update", "Leave Kemar Brown", "26 to 30 Oct", "high", "Matches approved leave", "Personal"],
      [6, "Update", "Handover Runbook", "Not done to Handed to Jodian", "low", "Needs your OK", "His handover"],
      [7, "BRAID · Blocker", "Store sales feed access", "Add Kemar as a source (2 reports)", "high", "Ready", "Same subject as #151"],
      [8, "BRAID · Risk", "Trend model may slip to 24 Oct", "Propose to the PM", "medium", "Needs your OK", "Same quote as #4"],
      [9, "BRAID · Risk", "Only Kemar can run the pipeline", "Add as evidence (2 sources)", "medium", "Needs your OK", "Same subject as #5 and #6"],
      [10, "Update", "Issue #208 Weekly sales export", "In progress to Done", "high", "Ready", "\"On Store Insights\""],
      [11, "BRAID · Decision", "Move the daily refresh to 6am", "Propose to the decider", "high", "Ready", "\"On Store Insights\""],
    ]);
    expect(r.items.map((i) => i.match?.label ?? null)).toEqual([
      null, null, null, null, null, null,
      "Same as: Store sales feed access", "New", "Same as: Only Kemar can run the pipeline", null, "New",
    ]);
    expect(r.items[2].quotes).toEqual(["Still waiting on Kyle for the store feed"]);
    expect(r.items.every((i) => i.routing.options.length === 0)).toBe(true);
  });

  it("highlights tie each quote to every card it feeds (one quote, several items)", async () => {
    const r = await kemarsReview();
    expect(r.highlights.find((h) => h.text === "Still waiting on Kyle for the store feed")!.ordinals).toEqual([3, 7]);
    expect(r.highlights.find((h) => h.text === "so I think the model slips a day")!.ordinals).toEqual([4, 8]);
  });

  it("counts follow Kemar's decisions: accept 4, 8, 9 and edit 6, and Save is allowed", async () => {
    await db.update(t.extractions).set({ state: "accepted", touched: true }).where(and(eq(t.extractions.captureId, CAPTURE), inArray(t.extractions.ordinal, [4, 8, 9])));
    await db.update(t.extractions).set({ state: "edited", touched: true, value: "handed_over" }).where(eq(t.extractions.id, `${CAPTURE}-6`));
    await db.update(t.captures).set({ state: "reviewing" }).where(eq(t.captures.id, CAPTURE));
    const r = await kemarsReview();
    expect(r.counts).toMatchObject({ changes: 9, projects: 2, needsOk: 0, needsOkOrdinals: [] });
    expect(r.footer).toBe("9 updates for 2 projects.");
    expect(r.items[5].markLabel).toBe("Edited by you");
    expect(r.canSave).toBe(true);
  });

  it("an item that fits two projects offers both; one that fits none is Not filed", async () => {
    const [row7, row10] = await db.select().from(t.extractions).where(inArray(t.extractions.id, [`${CAPTURE}-7`, `${CAPTURE}-10`])).orderBy(t.extractions.ordinal);
    await db
      .update(t.extractions)
      .set({ routing: "choose_project", projectId: null, draft: { ...row7.draft, routing: "choose_project", projectId: null, options: ["forager", "insights"] } })
      .where(eq(t.extractions.id, row7.id));
    await db
      .update(t.extractions)
      .set({ routing: "not_filed", projectId: null, draft: { ...row10.draft, routing: "not_filed", projectId: null, routingReason: "None of your projects fits; only you can see this" } })
      .where(eq(t.extractions.id, row10.id));
    const r = await kemarsReview();
    expect(r.groups.map((g) => g.label)).toEqual(["Forager 2.0", "Store Insights", "Choose a project", "You", "Not filed"]);
    expect(r.groups[2].items[0].routing.options).toEqual([
      { id: "forager", name: "Forager 2.0" },
      { id: "insights", name: "Store Insights" },
    ]);
    expect(r.counts).toMatchObject({ changes: 9, projects: 2, needsOk: 4, needsProject: 1 });
    expect(r.chatLine).toBe("Got it. 9 updates for 2 projects; 4 need your OK; 1 needs a project.");
  });
});

describe("getReview privacy (M1)", () => {
  it("only the author reads the capture; anyone else gets the same answer as for no capture", async () => {
    expect(await getReview(db, "alicia", CAPTURE)).toEqual(NOT_YOURS);
    expect(await getReview(db, "andre", CAPTURE)).toEqual(NOT_YOURS);
    expect(await getReview(db, "kemar", "cap-nope")).toEqual(NOT_YOURS);
    expect(JSON.stringify(await getReview(db, "alicia", CAPTURE))).not.toContain("TikTok");
  });
});
