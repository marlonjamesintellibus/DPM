// D6 against PGlite: leave said in an update matches live leave, changes it, or becomes a request;
// each project lead sees what it touches in their project only; an admin decides.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { getInbox } from "../queries/inbox";
import { getLeaveImpact } from "../queries/leave";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { createCapture, openReview, proposeItems, saveCapture, decideExtraction } from "./capture";
import { CommandRefused } from "./core";
import { approveLeave, declineLeave, leaveImpactCause, withdrawLeave } from "./leave";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

let n = 0;
/** Kemar says it in Atlas; Atlas reads the leave; he accepts it and saves. Returns the item's review card. */
async function kemarSays(text: string, quote: string, opts: { save?: boolean } = {}) {
  const { captureId } = await createCapture(as("kemar"), { channel: "atlas", messageId: `atl-leave-${++n}`, kind: "text", text, messageAt: at(0), receivedAt: at(0) });
  const p: RawProposal = {
    kind: "update",
    projectId: null,
    routingReason: { basis: "personal", evidence: "I'm out", label: "Personal" },
    targetId: "leave-kemar",
    field: "dates",
    newValue: "",
    quote,
    confidence: "high",
    rationale: "Leave",
  };
  const { items } = await proposeItems(as("kemar"), captureId, [p]);
  await openReview(as("kemar"), captureId);
  const review = await getReview(db, "kemar", captureId);
  if (!review.found) throw new Error("no review");
  const card = review.groups.flatMap((g) => g.items)[0];
  if (opts.save !== false) {
    if (items[0].state === "needs_ok") await decideExtraction(as("kemar"), items[0].id, { type: "accept" });
    expect((await saveCapture(as("kemar"), captureId)).outcome).toBe("saved");
  }
  return card;
}

const leaves = async () => db.select().from(t.leave).where(eq(t.leave.personId, "kemar")).orderBy(t.leave.startDate);
const titles = async (who: string) => (await getInbox(db, who, at(1))).items.map((i) => i.title);

describe("D6: leave in an update", () => {
  it("out 11 to 13 Nov with a request for 11 to 13 Nov matches it: no second request", async () => {
    await db.insert(t.leave).values({ id: "lv-nov", personId: "kemar", startDate: "2026-11-11", endDate: "2026-11-13", state: "requested" });
    const card = await kemarSays("I'm out Wednesday 11 Nov to Friday 13 Nov.", "I'm out Wednesday 11 Nov to Friday 13 Nov", { save: false });
    expect(card).toMatchObject({ state: "no_change", markLabel: "Matches your leave request", change: "11 to 13 Nov" });
    expect((await leaves()).map((l) => l.id)).toEqual(["lv-kemar-oct", "lv-nov"]);
  });

  it("with no leave that fits, saving makes a request, and each lead sees their own project's part", async () => {
    const card = await kemarSays("I'm out Wednesday 11 Nov to Friday 13 Nov.", "I'm out Wednesday 11 Nov to Friday 13 Nov");
    expect(card).toMatchObject({ state: "needs_ok", change: "11 to 13 Nov" });
    const [, nov] = await leaves();
    expect(nov).toMatchObject({ state: "requested", startDate: "2026-11-11", endDate: "2026-11-13" });

    expect(await titles("alicia")).toEqual([expect.stringMatching(/^Kemar asked for leave 11 to 13 Nov: \d+ things to cover in Forager 2.0$/)]);
    expect(await titles("andre")).toEqual([expect.stringMatching(/^Kemar asked for leave 11 to 13 Nov: \d+ things? to cover in Store Insights$/)]);
    expect(await titles("jodian")).toEqual([]); // a member, not a lead
    expect(await titles("kemar")).toEqual([]);

    const forager = await getLeaveImpact(db, "alicia", nov.id, "forager");
    if (!forager.found) throw new Error("Alicia should see Forager's part");
    expect(forager.workItems.map((w) => w.number)).toEqual(expect.arrayContaining(["#145", "#151", "#152"]));
    expect(forager.workItems.map((w) => w.number)).not.toContain("#160"); // Jodian's
    expect(forager.braid.map((e) => e.title)).toEqual(["Only Kemar can run the pipeline"]);
    expect(forager.handoverSteps.length).toBeGreaterThan(0);
    expect(forager.mayDecide).toBe(true);
    // Andre sees Store Insights only
    expect((await getLeaveImpact(db, "andre", nov.id, "forager")).found).toBe(false);
    const insights = await getLeaveImpact(db, "andre", nov.id, "insights");
    expect(insights.found && insights.workItems.map((w) => w.number)).toEqual(["#208"]);
  });

  it("a leave reason never reaches what leads see (A5.2, E17)", async () => {
    await kemarSays("I'm out sick Wednesday 11 Nov to Friday 13 Nov.", "Wednesday 11 Nov to Friday 13 Nov");
    const [, nov] = await leaves();
    const impact = await getLeaveImpact(db, "alicia", nov.id, "forager");
    expect(JSON.stringify(impact)).not.toMatch(/sick/i);
    expect(JSON.stringify(await getInbox(db, "alicia", at(1)))).not.toMatch(/sick/i);
  });

  it("an admin approves; the impact items close; only an admin of one of Kemar's projects may", async () => {
    await kemarSays("I'm out Wednesday 11 Nov to Friday 13 Nov.", "I'm out Wednesday 11 Nov to Friday 13 Nov");
    const [, nov] = await leaves();
    await expect(approveLeave(as("kemar"), nov.id)).rejects.toBeInstanceOf(CommandRefused);
    await expect(approveLeave(as("jodian"), nov.id)).rejects.toThrow("only an admin of one of their projects decides leave");
    await approveLeave(as("andre", 1), nov.id);
    expect((await leaves())[1]).toMatchObject({ state: "approved", decidedBy: "andre" });
    expect(await titles("alicia")).toEqual([]);
    expect(await titles("andre")).toEqual([]);
    const closed = await db.select().from(t.inboxItems).where(eq(t.inboxItems.causeKey, leaveImpactCause(nov.id, "forager")));
    expect(closed.map((i) => i.state)).toEqual(["auto_closed"]);
  });

  it("a change to approved leave keeps the approved dates until an admin decides", async () => {
    const card = await kemarSays("I'm out Monday 26 Oct to Monday 2 Nov.", "I'm out Monday 26 Oct to Monday 2 Nov");
    expect(card).toMatchObject({ state: "needs_ok", change: "Change 26 to 30 Oct to 26 Oct to 2 Nov" });
    const [oct] = await leaves();
    expect(oct).toMatchObject({ id: "lv-kemar-oct", state: "approved", startDate: "2026-10-26", endDate: "2026-10-30", changeEnd: "2026-11-02" });
    expect(await titles("alicia")).toEqual([expect.stringMatching(/^Kemar asked to change leave to 26 Oct to 2 Nov: /)]);

    await declineLeave(as("alicia", 1), oct.id);
    expect((await leaves())[0]).toMatchObject({ state: "approved", endDate: "2026-10-30", changeEnd: null });
    expect(await titles("alicia")).toEqual([]);
  });

  it("Kemar may withdraw his request", async () => {
    await kemarSays("I'm out Wednesday 11 Nov to Friday 13 Nov.", "I'm out Wednesday 11 Nov to Friday 13 Nov");
    const [, nov] = await leaves();
    await expect(withdrawLeave(as("alicia"), nov.id)).rejects.toBeInstanceOf(CommandRefused);
    await withdrawLeave(as("kemar", 1), nov.id);
    expect((await leaves())[1].state).toBe("withdrawn");
    expect(await titles("alicia")).toEqual([]);
    // Withdrawn leave no longer counts: saying the dates again asks again
    const again = await kemarSays("I'm out Wednesday 11 Nov to Friday 13 Nov.", "I'm out Wednesday 11 Nov to Friday 13 Nov", { save: false });
    expect(again.state).toBe("needs_ok");
  });
});
