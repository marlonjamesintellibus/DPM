import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { evaluateProject } from "../commands/evaluate";
import { AT_910, at, seededDb } from "../test/seeded-db";
import { getInbox } from "./inbox";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

const KEMAR_SAID = new Date("2026-10-20T13:58:00Z");

// What Kemar's save at 9:10 leaves behind for the inbox: the new forecast, a proposed risk on
// Forager and a proposed decision on Store Insights. Rows are written directly; evaluate makes the items.
async function kemarSaved() {
  await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
  await db.insert(t.braidEntries).values([
    { id: "br-trend-risk", projectId: "forager", kind: "risk", title: "Trend model may slip to 24 Oct", state: "proposed", reportedBy: "kemar", round: 1, proposedOn: "2026-10-20" },
    { id: "br-refresh", projectId: "insights", kind: "decision", title: "Move the daily refresh to 6am", state: "proposed", reportedBy: "kemar", round: 1, proposedOn: "2026-10-20" },
  ]);
  await db.insert(t.braidSources).values([
    { id: "src-trend-kemar", entryId: "br-trend-risk", originEntryId: "br-trend-risk", personId: "kemar", captureId: "cap-kemar-0858", extractionId: "cap-kemar-0858-8", spanStart: 124, spanEnd: 156, at: KEMAR_SAID },
    { id: "src-refresh-kemar", entryId: "br-refresh", originEntryId: "br-refresh", personId: "kemar", captureId: "cap-kemar-0858", extractionId: "cap-kemar-0858-11", spanStart: 281, spanEnd: 326, at: KEMAR_SAID },
  ]);
  await db.transaction(async (tx) => {
    await evaluateProject(tx, "forager", AT_910, { actorId: "kemar" });
    await evaluateProject(tx, "insights", AT_910, { actorId: "kemar" });
  });
}

describe("getInbox at 9:10am, before Kemar saves", () => {
  it("Alicia sees exactly her reason item, in the L6 wording", async () => {
    const inbox = await getInbox(db, "alicia", AT_910);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      causeKey: "status_set_with_no_reason:forager",
      title: "Forager 2.0 is set Off track, but the plan says On track",
      why: "a status and the data disagree, and no reason is given",
      source: "Delivery check",
      age: "8m",
      sourceLine: "Delivery check · 8m",
      action: "Add reason",
      group: "do_now",
      groupLabel: "Do now",
      subject: { type: "project", id: "forager" },
      project: { id: "forager", name: "Forager 2.0" },
    });
    expect(inbox.groups.map((g) => [g.label, g.items.length])).toEqual([["Do now", 1]]);
  });

  it("Andre's inbox is empty before Kemar saves, and Kemar's is empty", async () => {
    expect((await getInbox(db, "andre", AT_910)).items).toEqual([]);
    expect((await getInbox(db, "kemar", AT_910)).items).toEqual([]);
    expect((await getInbox(db, "nobody", AT_910)).items).toEqual([]);
  });

  it("M10: the title follows the data, while the inbox row stays as it was", async () => {
    const [before] = await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, "alicia"));
    await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
    const inbox = await getInbox(db, "alicia", at(2));
    expect(inbox.items[0].title).toBe("Forager 2.0 is set Off track, but the plan says At risk");
    expect(inbox.items[0].sourceLine).toBe("Delivery check · 10m");
    const [after] = await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, "alicia"));
    expect(after).toEqual(before);
  });
});

describe("getInbox after Kemar saves (story steps 6 and 7)", () => {
  it("Alicia: her reason item first, then Kemar's risk to approve", async () => {
    await kemarSaved();
    const inbox = await getInbox(db, "alicia", at(2));
    expect(inbox.items.map((i) => i.title)).toEqual([
      "Forager 2.0 is set Off track, but the plan says At risk",
      "Kemar raised a risk: Trend model may slip to 24 Oct",
    ]);
    expect(inbox.items[1]).toMatchObject({
      why: "risks go on the log only when a PM or Lead approves",
      sourceLine: "Kemar's update · 9:10am",
      action: "Review",
      group: "today",
      subject: { type: "braid_entry", id: "br-trend-risk", projectId: "forager" },
    });
    expect(inbox.groups.map((g) => g.label)).toEqual(["Do now", "Today"]);
  });

  it("Andre: Kemar's decision, pending until he approves; nothing about Forager", async () => {
    await kemarSaved();
    const inbox = await getInbox(db, "andre", at(2));
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      title: "Kemar proposed a decision: move the daily refresh to 6am",
      why: "decisions stay pending until a PM or Lead approves",
      sourceLine: "Kemar's update · 9:10am",
      action: "Review",
      project: { id: "insights", name: "Store Insights" },
    });
    expect((await getInbox(db, "kemar", at(2))).items).toEqual([]);
  });
});

describe("getInbox: every cause, worst first", () => {
  it("words each cause from the data, and sorts Do now, Today, This week, then oldest first", async () => {
    await db.update(t.projects).set({ setOverride: "reason_stale", reasonGivenAt: "at_risk" }).where(eq(t.projects.id, "forager"));
    await db.update(t.braidEntries).set({ newAlert: true, resolveProposedBy: "jodian" }).where(eq(t.braidEntries.id, "br-feed-blocker"));
    await db.insert(t.braidEntries).values([
      { id: "br-gq-risk", projectId: "gq", kind: "risk", title: "Academy cohort may start late", state: "proposed", reportedBy: "kemar", round: 1, proposedOn: "2026-10-19" },
      { id: "br-forager-ask", projectId: "forager", kind: "assumption", title: "Kyle sends the feed this week", state: "more_info", reportedBy: "kemar", round: 1 },
    ]);
    await db.insert(t.braidAnswers).values({ entryId: "br-forager-ask", by: "alicia", act: "request_info", note: "Which week?", round: 1, on: "2026-10-20" });
    const item = (owner: string, causeKey: string, createdAt: Date) => ({ id: `${owner}-${causeKey}`, ownerId: owner, causeKey, episode: 1, state: "open" as const, createdAt });
    await db.delete(t.inboxItems);
    await db.insert(t.inboxItems).values([
      item("alicia", "keep_set_status:forager", at(-60)),
      item("alicia", "no_decider:br-gq-risk", at(-30)),
      item("alicia", "clear:br-feed-blocker", at(-20)),
      item("alicia", "blocker_new:br-feed-blocker", at(-10)),
      item("kemar", "more_info:br-forager-ask", at(-5)),
    ]);

    const alicia = await getInbox(db, "alicia", AT_910);
    expect(alicia.items.map((i) => [i.groupLabel, i.title, i.action])).toEqual([
      ["Do now", "New blocker on Forager 2.0: Store sales feed access", "Acknowledge"],
      ["Today", "No one can approve this on GQ & Academy", "Assign"],
      ["Today", "Jodian says this blocker is cleared: Store sales feed access", "Confirm"],
      ["This week", "Forager 2.0: plan now says On track. Keep Off track?", "Keep"],
    ]);
    expect(alicia.items.find((i) => i.cause === "keep_set_status")!.why).toBe("your reason was given when the plan said At risk");
    expect(alicia.items.find((i) => i.cause === "keep_set_status")!.sourceLine).toBe("Delivery check · 1h");

    const kemar = await getInbox(db, "kemar", AT_910);
    expect(kemar.items.map((i) => [i.title, i.sourceLine, i.action])).toEqual([["Alicia asked for more on your assumption", "Alicia's question · 9:05am", "Reply"]]);
  });

  it("an item older than today says so", async () => {
    const inbox = await getInbox(db, "alicia", new Date("2026-10-21T14:10:00Z"));
    expect(inbox.items[0].sourceLine).toBe("Delivery check · yesterday");
  });
});

describe("getInbox privacy and liveness", () => {
  it("never shows an item about a project the owner may not read, nor closed or still snoozed items", async () => {
    await db.insert(t.braidEntries).values({ id: "br-refresh", projectId: "insights", kind: "decision", title: "Move the daily refresh to 6am", state: "proposed", reportedBy: "kemar", round: 1 });
    await db.insert(t.inboxItems).values([
      // A stray row for a project Alicia is not in: the query must not trust the row alone
      { id: "stray", ownerId: "alicia", causeKey: "approve:br-refresh", episode: 1, state: "open", createdAt: at(0) },
      { id: "closed", ownerId: "andre", causeKey: "approve:br-refresh", episode: 1, state: "acted", createdAt: at(0), closedAt: at(1) },
      { id: "snoozed", ownerId: "andre", causeKey: "approve:br-refresh", episode: 2, state: "snoozed", snoozedUntil: at(60), createdAt: at(0) },
    ]);
    const alicia = await getInbox(db, "alicia", at(2));
    expect(alicia.items.map((i) => i.id)).toEqual(["inbox-alicia-status_set_with_no_reason:forager-1"]);
    expect(JSON.stringify(alicia)).not.toContain("6am");

    expect((await getInbox(db, "andre", at(2))).items).toEqual([]);
    expect((await getInbox(db, "andre", at(61))).items.map((i) => i.id)).toEqual(["snoozed"]);
  });
});

describe("the review reminder (M2, E28)", () => {
  it("Kemar's unsaved update shows in his inbox once the reminder fires, and only in his", async () => {
    const { runCaptureTimers } = await import("../commands/capture");
    const fourWorkingHoursLater = new Date("2026-10-20T18:00:00Z");
    await runCaptureTimers({ db, now: fourWorkingHoursLater });
    const inbox = await getInbox(db, "kemar", fourWorkingHoursLater);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      cause: "review_waiting",
      title: "4 updates waiting for your OK",
      action: "Review",
      group: "today",
      subject: { type: "capture", id: "cap-kemar-0858" },
      project: null,
    });
    expect((await getInbox(db, "alicia", fourWorkingHoursLater)).items.map((i) => i.cause)).not.toContain("review_waiting");
  });
});
