// M35 against PGlite (conversational plan, phase P; research model coverRequest.mjs with its four fixes). The world is
// the 20 Oct snapshot at 9:10am: Kemar's leave Mon 26 to Fri 30 Oct is approved, and #152 Store feed connector is due
// Tue 27 Oct. He says the leave in the chat and saves; Atlas offers cover for what is due then; he asks a teammate,
// who answers. Until phase F the ask is an inbox item plus a notice in the teammate's DPM chat. Every move runs the
// machine as the person or the rule, checked when it runs.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { config } from "../domain/config";
import { getChatSummary, getThread } from "../queries/chat";
import { awayFor } from "../queries/cover";
import { getInbox } from "../queries/inbox";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { createCapture, decideExtraction, discardCapture, openReview, proposeItems, saveCapture } from "./capture";
import { CommandRefused } from "./core";
import { answerCover, askCover, coverOnLeave, dismissCover, runCoverTimers, type CoverAnswer } from "./cover";
import { approveLeave, declineLeave, withdrawLeave } from "./leave";
import { undoSave } from "./undo";

let db: Db;
const HOUR = 60;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const OCT = "lv-kemar-oct";
let n = 0;

const leaveSaid = (quote: string): RawProposal => ({
  kind: "update",
  projectId: null,
  routingReason: { basis: "personal", evidence: "I'm off", label: "Personal" },
  targetId: "leave-kemar",
  field: "dates",
  newValue: "",
  quote,
  confidence: "high",
  rationale: "Leave",
});

/** Someone says their leave in the DPM chat, accepts every item and saves. Returns the capture and its items. */
async function says(who: string, quote: string, opts: { minutes?: number; save?: boolean } = {}) {
  const minutes = opts.minutes ?? 0;
  const { captureId, conversationId } = await createCapture(as(who, minutes), { channel: "app", messageId: `cv-${++n}`, kind: "text", text: `${quote}.`, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as(who, minutes), captureId, [{ ...leaveSaid(quote), targetId: `leave-${who}` }]);
  if (opts.save !== false) {
    await openReview(as(who, minutes), captureId);
    for (const i of items) if (i.state === "needs_ok") await decideExtraction(as(who, minutes), i.id, { type: "accept" });
    expect((await saveCapture(as(who, minutes), captureId)).outcome).toBe("saved");
  }
  return { captureId, conversationId: conversationId!, items };
}

const requests = async (leaveId = OCT) => db.select().from(t.coverRequests).where(eq(t.coverRequests.leaveId, leaveId)).orderBy(t.coverRequests.id);
const notices = async (who: string) => (await db.select().from(t.notices).where(and(eq(t.notices.personId, who), eq(t.notices.subjectType, "cover_request")))).map((x) => x.text);
const inbox = async (who: string, minutes = 1) => (await getInbox(db, who, at(minutes))).items.filter((i) => i.cause === "cover_ask").map((i) => i.title);
const away = async (captureId: string, minutes = 1) => (await getChatSummary(db, "kemar", captureId, at(minutes))).latest!.away!;
const answer = (who: string, id: string, a: CoverAnswer, minutes = 2) => answerCover(as(who, minutes), id, a, `ans-${++n}`);
/** The Trend model forecast moved to Mon 26 Oct, so Kemar has two Forager things due while away (LV8). */
const trendOnMonday = () => db.update(t.milestones).set({ forecastDate: "2026-10-26" }).where(eq(t.milestones.id, "ms-trend"));

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("Atlas offers cover when a leave is saved (M35 OFFER)", () => {
  it('"I\'m off next week": the leave matches, and the chat lists what is due while away, with who could cover it (CD9)', async () => {
    await trendOnMonday();
    const { captureId } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    expect((await requests()).map((r) => r.state)).toEqual(["suggested"]);
    const view = await away(captureId);
    expect(view.line).toBe("While you're away (Mon 26 Oct to Fri 30 Oct): Trend model is forecast Mon 26 Oct and #152 Store feed connector is due Tue 27 Oct.");
    expect(view.things.map((x) => [x.label, x.status.kind, x.note])).toEqual([
      ["Trend model", "free", null],
      ["#152 Store feed connector", "free", null],
    ]);
    expect(view.open).toBe(true);
    // Facts only, as who_free gives them: open work and past due, never a pick (PP6)
    expect(view.teammates.forager.map((m) => `${m.name}: ${m.facts}`)).toEqual(["Alicia Campbell: 0 open work items, none past due", "Jodian Taylor: 1 open work item, none past due"]);
    // Nothing changed on a project, and nobody was asked (rule 1, rule 9)
    expect(await notices("jodian")).toEqual([]);
    expect(await db.select().from(t.handovers).where(eq(t.handovers.toPersonId, "jodian"))).toHaveLength(1);
  });

  it("a new leave before it is saved: the facts show to read, with nothing to press", async () => {
    await db.update(t.workItems).set({ dueDate: "2026-11-10" }).where(eq(t.workItems.id, "wi-152"));
    const { captureId } = await says("kemar", "I'm off Monday 9 Nov to Friday 13 Nov", { save: false });
    const view = await away(captureId);
    expect(view).toMatchObject({ leaveId: null, open: false, line: "While you're away (Mon 9 Nov to Fri 13 Nov): #152 Store feed connector is due Tue 10 Nov." });
    expect(await db.select().from(t.coverRequests)).toEqual([]);
  });

  it("leave already on record has nothing to save (D6), so cover is asked for it at once, the offer made on the ask", async () => {
    const { captureId } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct", { save: false });
    expect(await away(captureId)).toMatchObject({ leaveId: OCT, open: true });
    expect(await requests()).toEqual([]);
    const { record } = await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "at-once");
    expect(record.state).toBe("asked");
    // What he is told shows in that conversation, his newest
    await answer("jodian", record.id, { act: "accept" });
    const thread = await getThread(db, "kemar", (await db.select().from(t.captures).where(eq(t.captures.id, captureId)))[0].conversationId!, at(3));
    expect(thread.found && thread.notices.map((x) => x.text)).toContain("Jodian will cover #152 Store feed connector while you're away. A handover is proposed.");
    // A discarded update shows nothing to ask
    const other = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct", { save: false, minutes: 2 });
    await discardCapture(as("kemar", 2), other.captureId);
    expect((await getChatSummary(db, "kemar", other.captureId, at(3))).latest!.away).toBeNull();
  });

  it("LV1: nothing due while away offers nothing", async () => {
    const { captureId } = await says("kemar", "I'm off Monday 9 Nov to Friday 13 Nov");
    const [nov] = await db.select().from(t.leave).where(and(eq(t.leave.personId, "kemar"), eq(t.leave.startDate, "2026-11-09")));
    expect(await requests(nov.id)).toEqual([]);
    expect((await away(captureId)).line).toBe("Nothing of yours is due while you're away.");
  });

  it("LV7: work on a project they left is not shown, nor counted", async () => {
    await db.update(t.workItems).set({ dueDate: "2026-10-28" }).where(eq(t.workItems.id, "wi-208"));
    expect((await awayFor(db, "kemar", { start: "2026-10-26", end: "2026-10-30" }, at(0))).things.map((x) => x.label)).toEqual(["#152 Store feed connector", "#208 Weekly sales export"]);
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    expect((await awayFor(db, "kemar", { start: "2026-10-26", end: "2026-10-30" }, at(0))).things.map((x) => x.label)).toEqual(["#152 Store feed connector"]);
  });

  it("DISMISS: no cover needed ends the offer it was shown with, and nothing is asked", async () => {
    const { captureId } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const { offerId } = await away(captureId);
    expect(offerId).toBe("cv-lv-kemar-oct-1");
    await expect(dismissCover(as("alicia", 1), OCT, offerId, "d-0")).rejects.toBeInstanceOf(CommandRefused);
    await dismissCover(as("kemar", 1), OCT, offerId, "d-1");
    expect((await requests()).map((r) => [r.state, r.endedWhy])).toEqual([["withdrawn", "dismissed"]]);
    expect(await away(captureId)).toMatchObject({ dismissed: true, offerId: null });
    // A second tap finds nothing open and changes nothing
    await dismissCover(as("kemar", 2), OCT, offerId, "d-1");
    expect(await requests()).toHaveLength(1);
  });

  it("rule 6: a late \"No cover needed\" never ends the newer offer Atlas made after an ask", async () => {
    await trendOnMonday();
    const { captureId } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const shown = (await away(captureId)).offerId;
    // He asks Jodian for #152 from the first offer; the Trend model is still free, so Atlas offers again
    await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "pick-1");
    const newer = (await away(captureId, 2)).offerId;
    expect(newer).not.toBe(shown);
    // The tap made on the old offer arrives late: nothing changes
    expect((await dismissCover(as("kemar", 2), OCT, shown, "late")).message).toBe("No cover asked.");
    expect((await requests()).map((r) => r.state)).toEqual(["asked", "suggested"]);
    await dismissCover(as("kemar", 3), OCT, newer, "now");
    expect((await requests()).map((r) => [r.state, r.endedWhy])).toEqual([
      ["asked", null],
      ["withdrawn", "dismissed"],
    ]);
  });

  it("the offer lapses when the leave starts (suggestedWayOut); before that the timer leaves it", async () => {
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    await runCoverTimers({ db, now: at(2 * 24 * HOUR) });
    expect((await requests()).map((r) => r.state)).toEqual(["suggested"]);
    await runCoverTimers({ db, now: at(6 * 24 * HOUR) });
    expect((await requests()).map((r) => [r.state, r.endedWhy])).toEqual([["withdrawn", "leave_started"]]);
    await expect(askCover(as("kemar", 6 * 24 * HOUR), OCT, "jodian", ["work_item:wi-152"], "late")).rejects.toThrow("Your leave has started");
  });
});

describe("Kemar asks a teammate (PICK)", () => {
  it("asks Jodian for both Forager things in one request (LV8): her inbox and chat, his chat says who is asked", async () => {
    await trendOnMonday();
    const { captureId } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const { message, record } = await askCover(as("kemar", 1), OCT, "jodian", ["milestone:ms-trend", "work_item:wi-152"], "pick-1");
    expect(message).toBe("Asked Jodian to cover Trend model and #152 Store feed connector. I'll tell you when they answer.");
    expect(record).toMatchObject({ state: "asked", toId: "jodian", projectId: "forager" });
    expect(await inbox("jodian")).toEqual(["Kemar asks you to cover Trend model and #152 Store feed connector while they're away Mon 26 Oct to Fri 30 Oct"]);
    expect(await notices("jodian")).toEqual(["Kemar asks if you can cover Trend model and #152 Store feed connector on Forager 2.0 while they're away Mon 26 Oct to Fri 30 Oct. Accept, or say you can't."]);
    // Her chat carries the buttons on that notice
    const hers = (await getChatSummary(db, "jodian", undefined, at(2))).notices.find((x) => x.cover);
    expect(hers?.cover?.items.map((i) => i.label)).toEqual(["Trend model", "#152 Store feed connector"]);
    expect((await away(captureId, 2)).things.map((x) => x.status)).toEqual([
      { kind: "asked", who: "Jodian" },
      { kind: "asked", who: "Jodian" },
    ]);
    // Rule 6: the same tap again asks once
    expect((await askCover(as("kemar", 2), OCT, "jodian", ["milestone:ms-trend", "work_item:wi-152"], "pick-1")).record.id).toBe(record.id);
    expect(await notices("jodian")).toHaveLength(1);
    // Nothing left free, so Atlas offers nothing more
    expect((await requests()).map((r) => r.state)).toEqual(["asked"]);
  });

  it("refuses an item already asked of someone (oneCoverPerItem), another project's items together, and work that is not his", async () => {
    await trendOnMonday();
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "pick-1");
    // Atlas offered again for the Trend model, still free
    expect((await requests()).map((r) => r.state)).toEqual(["asked", "suggested"]);
    await expect(askCover(as("kemar", 2), OCT, "alicia", ["work_item:wi-152"], "pick-2")).rejects.toThrow("Someone is already asked about that, or covers it.");
    await expect(askCover(as("kemar", 2), OCT, "jodian", ["work_item:wi-160"], "pick-3")).rejects.toThrow("That is not yours, or not due while you're away.");
    await expect(askCover(as("alicia", 2), OCT, "jodian", ["milestone:ms-trend"], "pick-4")).rejects.toThrow("Not found");
  });

  it("P10: someone not on the project is refused in the words for a name nobody has", async () => {
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    await expect(askCover(as("kemar", 1), OCT, "andre", ["work_item:wi-152"], "pick-1")).rejects.toThrow("I can't ask them about that.");
    await expect(askCover(as("kemar", 1), OCT, "kemar", ["work_item:wi-152"], "pick-2")).rejects.toThrow("You can't cover your own work.");
    expect(await notices("andre")).toEqual([]);
  });

  it("LV2: a teammate the project shows away then is refused before asking; leave the asker is not shown is not used", async () => {
    await db.insert(t.leave).values({ id: "lv-jodian", personId: "jodian", startDate: "2026-10-29", endDate: "2026-10-30", state: "approved" });
    // Alicia, a PM, sees Jodian's leave (D6, CD43): her own leave asks someone else
    await db.update(t.milestones).set({ forecastDate: "2026-10-28" }).where(eq(t.milestones.id, "ms-release-1"));
    await says("alicia", "I'm off Monday 26 Oct to Friday 30 Oct");
    const [mine] = await db.select().from(t.leave).where(eq(t.leave.personId, "alicia"));
    const { captureId } = (await db.select({ captureId: t.coverRequests.captureId }).from(t.coverRequests).where(eq(t.coverRequests.leaveId, mine.id)))[0] as { captureId: string };
    const view = (await getChatSummary(db, "alicia", captureId, at(1))).latest!.away!;
    expect(view.teammates.forager.find((m) => m.id === "jodian")?.away).toBe("away Thu 29 Oct to Fri 30 Oct");
    await expect(askCover(as("alicia", 1), mine.id, "jodian", ["milestone:ms-release-1"], "a-1")).rejects.toThrow("Jodian is away then, so I won't ask them.");
    // Kemar, a member, is not shown her leave, so nothing about it shows or refuses (P10)
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    expect((await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "k-1")).record.state).toBe("asked");
  });
});

describe("the teammate answers", () => {
  async function asked(items = ["milestone:ms-trend", "work_item:wi-152"]) {
    await trendOnMonday();
    const said = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const { record } = await askCover(as("kemar", 1), OCT, "jodian", items, `pick-${++n}`);
    return { ...said, id: record.id };
  }

  it("ACCEPT: the leave is approved, so a handover is proposed through M7; Kemar and Alicia, the PM, are told (CD19)", async () => {
    const { id, captureId, conversationId } = await asked();
    await expect(answer("alicia", id, { act: "accept" })).rejects.toThrow("Not found");
    const { message } = await answer("jodian", id, { act: "accept" });
    expect(message).toBe("You'll cover Trend model and #152 Store feed connector. A handover is proposed.");
    const [r] = await requests();
    expect(r).toMatchObject({ state: "accepted", handover: "proposed", handoverId: `ho-${id}` });
    const [ho] = await db.select().from(t.handovers).where(eq(t.handovers.id, `ho-${id}`));
    expect(ho).toMatchObject({ projectId: "forager", fromPersonId: "kemar", toPersonId: "jodian", state: "not_started", title: "Kemar to Jodian: cover for 26 to 30 Oct" });
    expect((await db.select().from(t.handoverSteps).where(eq(t.handoverSteps.handoverId, ho.id)).orderBy(t.handoverSteps.position)).map((s) => [s.title, s.state])).toEqual([
      ["Trend model", "not_done"],
      ["#152 Store feed connector", "not_done"],
    ]);
    expect(await notices("kemar")).toEqual(["Jodian will cover Trend model and #152 Store feed connector while you're away. A handover is proposed."]);
    expect(await notices("alicia")).toEqual(["Jodian will cover Trend model and #152 Store feed connector for Kemar while they're away Mon 26 Oct to Fri 30 Oct. A handover is proposed. No OK is needed from you."]);
    expect(await notices("andre")).toEqual([]);
    // Who owns the work does not change: cover is the handover (A10.2)
    expect((await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-152")))[0].ownerId).toBe("kemar");
    expect(await inbox("jodian", 3)).toEqual([]);
    expect((await away(captureId, 3)).things.map((x) => x.status)).toEqual([
      { kind: "covered", who: "Jodian", waiting: false },
      { kind: "covered", who: "Jodian", waiting: false },
    ]);
    // Kemar's notice shows in the conversation where he said the leave (CV14)
    const thread = await getThread(db, "kemar", conversationId, at(4));
    expect(thread.found && thread.notices.map((x) => x.text)).toContain("Jodian will cover Trend model and #152 Store feed connector while you're away. A handover is proposed.");
  });

  it("rule 6: the same answer again changes nothing; another answer after it is refused", async () => {
    const { id } = await asked();
    await answerCover(as("jodian", 2), id, { act: "accept" }, "same");
    expect((await answerCover(as("jodian", 3), id, { act: "accept" }, "same")).message).toMatch(/^You'll cover/);
    await expect(answer("jodian", id, { act: "decline" }, 3)).rejects.toThrow("You already answered: accepted.");
    expect(await db.select().from(t.handovers).where(eq(t.handovers.id, `ho-${id}`))).toHaveLength(1);
    expect(await notices("alicia")).toHaveLength(1);
  });

  it("DECLINE: Kemar is told, the things are free again with why, and Atlas offers again", async () => {
    const { id, captureId } = await asked();
    expect((await answer("jodian", id, { act: "decline" })).message).toBe("Declined. Kemar is told.");
    expect(await notices("kemar")).toEqual(["Jodian can't cover Trend model and #152 Store feed connector. You can ask someone else."]);
    expect((await requests()).map((r) => r.state)).toEqual(["declined", "suggested"]);
    expect((await away(captureId, 3)).things.map((x) => [x.status.kind, x.note])).toEqual([
      ["free", "Jodian can't"],
      ["free", "Jodian can't"],
    ]);
    expect((await askCover(as("kemar", 4), OCT, "alicia", ["work_item:wi-152"], "again")).record.state).toBe("asked");
  });

  it("LV8: one item declined, the rest accepted together", async () => {
    const { id } = await asked();
    await expect(answer("jodian", id, { act: "decline_item", key: "work_item:wi-999" })).rejects.toThrow("that is not in this request");
    expect((await answer("jodian", id, { act: "decline_item", key: "work_item:wi-152" })).message).toBe("You said you can't cover #152 Store feed connector. Kemar is told.");
    expect(await notices("kemar")).toEqual(["Jodian can't cover #152 Store feed connector; the rest still waits on them. You can ask someone else for it."]);
    // #152 is free again, so Atlas offers it; the last item is declined with the request
    await expect(answer("jodian", id, { act: "decline_item", key: "milestone:ms-trend" })).rejects.toThrow("It's the only thing asked: decline the request instead.");
    await answer("jodian", id, { act: "accept" });
    const [r, offer] = await requests();
    expect([r.state, r.items.map((i) => i.id), r.declined.map((i) => i.id), offer.state]).toEqual(["accepted", ["ms-trend"], ["wi-152"], "suggested"]);
    expect((await db.select().from(t.handoverSteps).where(eq(t.handoverSteps.handoverId, `ho-${id}`))).map((s) => s.title)).toEqual(["Trend model"]);
  });

  it(`no answer in ${config.coverAskHours} hours: unanswered, and Kemar is told (AskEnds)`, async () => {
    const { id } = await asked();
    await runCoverTimers({ db, now: at(23 * HOUR) });
    expect((await requests())[0].state).toBe("asked");
    await runCoverTimers({ db, now: at(24 * HOUR + 1) });
    expect((await requests()).map((r) => r.state)).toEqual(["unanswered", "suggested"]);
    expect(await notices("kemar")).toEqual([`Jodian didn't answer about covering Trend model and #152 Store feed connector within ${config.coverAskHours} hours. You can ask someone else.`]);
    expect(await inbox("jodian", 24 * HOUR + 2)).toEqual([]);
    // A late tap is refused and covers nothing (the model's lateAccept)
    await expect(answer("jodian", id, { act: "accept" }, 24 * HOUR + 2)).rejects.toThrow("You already answered: unanswered.");
  });

  it("leaveProjectWithdraws: the teammate leaves the project, the ask is withdrawn and nobody is told", async () => {
    const { id } = await asked();
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "jodian")));
    // Checked when it runs, before the timer gets there (rule 4)
    await expect(answer("jodian", id, { act: "accept" })).rejects.toThrow("That is no longer on a project you share, so it can't be accepted.");
    await runCoverTimers({ db, now: at(5) });
    expect((await requests())[0]).toMatchObject({ state: "withdrawn", endedWhy: "left_project" });
    expect(await notices("kemar")).toEqual([]);
    expect(await notices("jodian")).toHaveLength(1);
    expect(await inbox("jodian", 6)).toEqual([]);
  });

  it("LV3: work Done before the leave leaves the ask; when nothing asked is due, the ask is withdrawn", async () => {
    await asked();
    await db.update(t.workItems).set({ state: "done" }).where(eq(t.workItems.id, "wi-152"));
    await runCoverTimers({ db, now: at(5) });
    const [r] = await requests();
    expect([r.state, r.items.map((i) => i.id)]).toEqual(["asked", ["ms-trend"]]);
    await db.update(t.milestones).set({ forecastDate: "2026-11-04" }).where(eq(t.milestones.id, "ms-trend"));
    await runCoverTimers({ db, now: at(6) });
    expect((await requests())[0]).toMatchObject({ state: "withdrawn", endedWhy: "not_due" });
  });
});

describe("the leave moves (LV3, LV4, LV9, declineCancels)", () => {
  /** Kemar asks for new leave 9 to 13 Nov with #152 due Tue 10 Nov, and asks Jodian; the request waits on an admin. */
  async function requested() {
    await db.update(t.workItems).set({ dueDate: "2026-11-10" }).where(eq(t.workItems.id, "wi-152"));
    const said = await says("kemar", "I'm off Monday 9 Nov to Friday 13 Nov");
    const [nov] = await db.select().from(t.leave).where(and(eq(t.leave.personId, "kemar"), eq(t.leave.startDate, "2026-11-09")));
    expect(nov.state).toBe("requested");
    const { record } = await askCover(as("kemar", 1), nov.id, "jodian", ["work_item:wi-152"], `pick-${++n}`);
    return { ...said, leaveId: nov.id, id: record.id };
  }

  it("LV9: accepted before the approval, the handover waits; approving starts it through M7", async () => {
    const { leaveId, id } = await requested();
    expect((await answer("jodian", id, { act: "accept" })).message).toBe("You'll cover #152 Store feed connector. The handover starts when the leave is approved.");
    expect((await requests(leaveId))[0]).toMatchObject({ state: "accepted", handover: "waiting", handoverId: null });
    expect(await notices("alicia")).toEqual(["Jodian will cover #152 Store feed connector for Kemar while they're away Mon 9 Nov to Fri 13 Nov. The handover starts when the leave is approved. No OK is needed from you."]);
    await approveLeave(as("alicia", 3), leaveId);
    expect((await requests(leaveId))[0]).toMatchObject({ handover: "proposed", handoverId: `ho-${id}` });
    expect((await db.select().from(t.handovers).where(eq(t.handovers.id, `ho-${id}`)))[0].state).toBe("not_started");
    expect(await notices("jodian")).toContain("Kemar's leave is approved, so the handover for #152 Store feed connector starts.");
  });

  it("declineCancels: a declined leave withdraws the open asks and cancels the handover that waited", async () => {
    const { leaveId, id } = await requested();
    await answer("jodian", id, { act: "accept" });
    await db.update(t.milestones).set({ forecastDate: "2026-11-11" }).where(eq(t.milestones.id, "ms-trend"));
    await askCover(as("kemar", 3), leaveId, "alicia", ["milestone:ms-trend"], "second");
    await declineLeave(as("alicia", 4), leaveId);
    expect((await requests(leaveId)).map((r) => [r.state, r.handover, r.endedWhy])).toEqual([
      ["accepted", "cancelled", null],
      ["withdrawn", "none", "leave_off"],
    ]);
    expect(await notices("jodian")).toContain("Kemar no longer needs cover for #152 Store feed connector, so the handover is cancelled.");
    expect(await inbox("alicia", 5)).toEqual([]);
  });

  it("LV4: the person withdraws the leave, or undoes the save that asked for it: everything for it ends", async () => {
    const { leaveId } = await requested();
    await withdrawLeave(as("kemar", 2), leaveId);
    expect((await requests(leaveId)).map((r) => [r.state, r.endedWhy])).toEqual([["withdrawn", "leave_off"]]);

    const again = await says("kemar", "I'm off Monday 16 Nov to Friday 20 Nov", { minutes: 3 });
    const [later] = await db.select().from(t.leave).where(and(eq(t.leave.personId, "kemar"), eq(t.leave.startDate, "2026-11-16")));
    await db.update(t.workItems).set({ dueDate: "2026-11-17" }).where(eq(t.workItems.id, "wi-152"));
    await askCover(as("kemar", 4), later.id, "jodian", ["work_item:wi-152"], "undo-pick");
    expect(await undoSave(as("kemar", 5), { commandId: "undo-1", captureId: again.captureId })).toMatchObject({ kind: "job" });
    expect((await requests(later.id)).map((r) => [r.state, r.endedWhy])).toEqual([["withdrawn", "leave_off"]]);
  });

  it("LV4 with a handover under way: a leave that goes off cancels it through M7's CANCEL", async () => {
    const { id } = await (async () => {
      await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
      return (await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "p")).record;
    })();
    await answer("jodian", id, { act: "accept" });
    // M8 has no arrow that cancels approved leave yet; the rule runs on the state as it is written
    await db.update(t.leave).set({ state: "withdrawn" }).where(eq(t.leave.id, OCT));
    await db.transaction((tx) => coverOnLeave(tx, at(3), OCT));
    expect((await requests())[0]).toMatchObject({ state: "accepted", handover: "cancelled" });
    expect((await db.select().from(t.handovers).where(eq(t.handovers.id, `ho-${id}`)))[0].state).toBe("cancelled");
  });

  it("LV3: new dates on a request leave what is no longer due; an empty ask is withdrawn", async () => {
    const { leaveId } = await requested();
    await says("kemar", "I'm off Wednesday 11 Nov to Wednesday 18 Nov", { minutes: 3 });
    expect((await db.select().from(t.leave).where(eq(t.leave.id, leaveId)))[0]).toMatchObject({ startDate: "2026-11-11", endDate: "2026-11-18" });
    expect((await requests(leaveId))[0]).toMatchObject({ state: "withdrawn", endedWhy: "not_due" });
  });
});

describe("LV10: a promise due while away", () => {
  it("is proposed to move to the first working day back, with his OK in the same review", async () => {
    await db.insert(t.commitments).values({ id: "cm-wed", ownerId: "kemar", what: "Send Andre the export notes", dueOn: "2026-10-28", state: "open", savedOn: "2026-10-20" });
    const { captureId, items } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct", { save: false });
    expect(items.map((i) => [i.draft.kind, i.state])).toEqual([
      ["update", "no_change"],
      ["commitment", "needs_ok"],
    ]);
    await openReview(as("kemar"), captureId);
    const review = await getReview(db, "kemar", captureId);
    if (!review.found) throw new Error("no review");
    expect(review.items.find((i) => i.kindLabel === "Promise")).toMatchObject({ title: "Send Andre the export notes", change: "Moves your promise from Wed 28 Oct to Mon 2 Nov, your first working day back", markLabel: "Needs your OK" });
    await decideExtraction(as("kemar"), items[1].id, { type: "accept" });
    expect((await saveCapture(as("kemar"), captureId)).outcome).toBe("saved");
    expect((await db.select().from(t.commitments).where(eq(t.commitments.id, "cm-wed")))[0]).toMatchObject({ dueOn: "2026-11-02", moves: 1, state: "open" });
  });

  it("rejected, it stays due while away; the chat says nobody can cover a promise", async () => {
    await db.insert(t.commitments).values({ id: "cm-wed", ownerId: "kemar", what: "Send Andre the export notes", dueOn: "2026-10-28", state: "open", savedOn: "2026-10-20" });
    const { captureId, items } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct", { save: false });
    await openReview(as("kemar"), captureId);
    await decideExtraction(as("kemar"), items[1].id, { type: "reject" });
    await saveCapture(as("kemar"), captureId);
    expect((await db.select().from(t.commitments).where(eq(t.commitments.id, "cm-wed")))[0].dueOn).toBe("2026-10-28");
    const view = await away(captureId);
    expect(view.line).toBe('While you\'re away (Mon 26 Oct to Fri 30 Oct): #152 Store feed connector is due Tue 27 Oct and your promise "Send Andre the export notes" is due Wed 28 Oct.');
    expect(view.promises.map((p) => p.id)).toEqual(["cm-wed"]);
  });
});

describe("someone leaves the project (leaveProjectWithdraws, rule 4, P10)", () => {
  const leaves = (who: string, projectId = "forager") =>
    db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, projectId), eq(t.projectMemberships.personId, who)));

  /** Kemar asks for new leave 9 to 13 Nov with #152 due Tue 10 Nov; Jodian accepts, so the handover waits on the approval. */
  async function waitingCover() {
    await db.update(t.workItems).set({ dueDate: "2026-11-10" }).where(eq(t.workItems.id, "wi-152"));
    await says("kemar", "I'm off Monday 9 Nov to Friday 13 Nov");
    const [nov] = await db.select().from(t.leave).where(and(eq(t.leave.personId, "kemar"), eq(t.leave.startDate, "2026-11-09")));
    const { record } = await askCover(as("kemar", 1), nov.id, "jodian", ["work_item:wi-152"], `pick-${++n}`);
    await answer("jodian", record.id, { act: "accept" });
    return { leaveId: nov.id, id: record.id };
  }

  it("LV9: the teammate left before the approval, so approving starts no handover for her and tells her nothing", async () => {
    const { leaveId, id } = await waitingCover();
    const before = await notices("jodian");
    await leaves("jodian");
    await approveLeave(as("alicia", 3), leaveId);
    const [r, offer] = await requests(leaveId);
    expect(r).toMatchObject({ state: "accepted", handover: "cancelled", handoverId: null });
    expect(await db.select().from(t.handovers).where(eq(t.handovers.id, `ho-${id}`))).toEqual([]);
    expect(await notices("jodian")).toEqual(before);
    // Kemar, still on Forager, hears the cover ended; #152 is free again, so Atlas offers again
    expect(await notices("kemar")).toContain("Jodian no longer covers #152 Store feed connector, so the handover is cancelled. You can ask someone else.");
    expect(offer.state).toBe("suggested");
  });

  it("the teammate left with the leave still waiting: the minute timer cancels the cover's handover before anything else names it", async () => {
    const { leaveId } = await waitingCover();
    await leaves("jodian");
    await runCoverTimers({ db, now: at(5) });
    expect((await requests(leaveId))[0]).toMatchObject({ state: "accepted", handover: "cancelled" });
    // A leave declined later tells her nothing either
    const before = await notices("jodian");
    await declineLeave(as("alicia", 6), leaveId);
    expect(await notices("jodian")).toEqual(before);
  });

  it("the person going on leave left: an ask is withdrawn by the timer, telling nobody; a proposed handover is cancelled through M7", async () => {
    await trendOnMonday();
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const asked = (await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "p-1")).record;
    const covered = (await askCover(as("kemar", 1), OCT, "alicia", ["milestone:ms-trend"], "p-2")).record;
    await answer("alicia", covered.id, { act: "accept" });
    const [kemarBefore, jodianBefore] = [await notices("kemar"), await notices("jodian")];
    await leaves("kemar");
    await runCoverTimers({ db, now: at(5) });
    const rows = await requests();
    expect(rows.find((r) => r.id === asked.id)).toMatchObject({ state: "withdrawn", endedWhy: "left_project" });
    expect(rows.find((r) => r.id === covered.id)).toMatchObject({ state: "accepted", handover: "cancelled" });
    expect((await db.select().from(t.handovers).where(eq(t.handovers.id, `ho-${covered.id}`)))[0].state).toBe("cancelled");
    // Nobody is told of the ask; Alicia, still on Forager, hears the cover ended; nothing goes to Kemar
    expect(await notices("kemar")).toEqual(kemarBefore);
    expect(await notices("jodian")).toEqual(jodianBefore);
    expect(await notices("alicia")).toContain("Kemar no longer needs cover for Trend model, so the handover is cancelled.");
    expect(await inbox("jodian", 6)).toEqual([]);
    // He reads no Forager work now, so nothing is offered again
    expect(rows.filter((r) => r.state === "suggested")).toEqual([]);
  });

  it("the person left and then withdrew the leave: the leave's own move settles it the same way (coverOnLeave)", async () => {
    await db.update(t.workItems).set({ dueDate: "2026-11-10" }).where(eq(t.workItems.id, "wi-152"));
    await says("kemar", "I'm off Monday 9 Nov to Friday 13 Nov");
    const [nov] = await db.select().from(t.leave).where(and(eq(t.leave.personId, "kemar"), eq(t.leave.startDate, "2026-11-09")));
    await askCover(as("kemar", 1), nov.id, "jodian", ["work_item:wi-152"], "p-1");
    await leaves("kemar");
    await withdrawLeave(as("kemar", 2), nov.id);
    expect((await requests(nov.id)).map((r) => [r.state, r.endedWhy])).toEqual([["withdrawn", "left_project"]]);
    expect(await notices("kemar")).toEqual([]);
  });

  it('P10: the person left, so the teammate\'s "I can\'t" is refused before it names the item to him; the timer then withdraws it', async () => {
    await trendOnMonday();
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const { record } = await askCover(as("kemar", 1), OCT, "jodian", ["milestone:ms-trend", "work_item:wi-152"], "p-1");
    await leaves("kemar");
    for (const a of [{ act: "decline" }, { act: "decline_item", key: "work_item:wi-152" }] as CoverAnswer[]) {
      await expect(answer("jodian", record.id, a)).rejects.toThrow("That is no longer on a project you share, so there is nothing to answer.");
    }
    expect(await notices("kemar")).toEqual([]);
    await runCoverTimers({ db, now: at(5) });
    expect((await requests())[0]).toMatchObject({ state: "withdrawn", endedWhy: "left_project" });
    expect(await notices("kemar")).toEqual([]);
  });
});

describe("the leave goes off with an offer still open (suggestedWayOut, LV4, declineCancels)", () => {
  /** New leave 9 to 13 Nov: #152 due Tue 10 Nov is asked of Jodian, the Trend model forecast Wed 11 Nov is left free. */
  async function askedAndOffered() {
    await db.update(t.workItems).set({ dueDate: "2026-11-10" }).where(eq(t.workItems.id, "wi-152"));
    await db.update(t.milestones).set({ forecastDate: "2026-11-11" }).where(eq(t.milestones.id, "ms-trend"));
    const said = await says("kemar", "I'm off Monday 9 Nov to Friday 13 Nov");
    const [nov] = await db.select().from(t.leave).where(and(eq(t.leave.personId, "kemar"), eq(t.leave.startDate, "2026-11-09")));
    await askCover(as("kemar", 1), nov.id, "jodian", ["work_item:wi-152"], `pick-${++n}`);
    expect((await requests(nov.id)).map((r) => r.state)).toEqual(["asked", "suggested"]);
    return { ...said, leaveId: nov.id };
  }
  const ended = async (leaveId: string) => (await requests(leaveId)).map((r) => [r.state, r.endedWhy]);
  const BOTH_OFF = [
    ["withdrawn", "leave_off"],
    ["withdrawn", "leave_off"],
  ];

  it("withdrawn by the person", async () => {
    const { leaveId } = await askedAndOffered();
    await withdrawLeave(as("kemar", 2), leaveId);
    expect(await ended(leaveId)).toEqual(BOTH_OFF);
  });

  it("declined by the admin", async () => {
    const { leaveId } = await askedAndOffered();
    await declineLeave(as("alicia", 2), leaveId);
    expect(await ended(leaveId)).toEqual(BOTH_OFF);
    expect(await inbox("jodian", 3)).toEqual([]);
  });

  it("undone with the save that asked for it", async () => {
    const { leaveId, captureId } = await askedAndOffered();
    expect(await undoSave(as("kemar", 2), { commandId: "undo-off", captureId })).toMatchObject({ kind: "job" });
    expect(await ended(leaveId)).toEqual(BOTH_OFF);
  });
});

describe("LV3: a change waiting on the admin moves nothing (D6)", () => {
  it("#152 due Tue 27 Oct stays asked, and the offer lapses on the approved start", async () => {
    await trendOnMonday();
    const { captureId } = await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const { record } = await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "p-1");
    await says("kemar", "I'm off Wednesday 28 Oct to Friday 6 Nov", { minutes: 2 });
    expect((await db.select().from(t.leave).where(eq(t.leave.id, OCT)))[0]).toMatchObject({ startDate: "2026-10-26", endDate: "2026-10-30", changeStart: "2026-10-28", changeEnd: "2026-11-06" });
    await runCoverTimers({ db, now: at(5) });
    expect((await requests()).find((r) => r.id === record.id)).toMatchObject({ state: "asked" });
    expect((await away(captureId, 6)).line).toBe("While you're away (Mon 26 Oct to Fri 30 Oct): Trend model is forecast Mon 26 Oct and #152 Store feed connector is due Tue 27 Oct.");
    // Mon 26 Oct 10:10: the approved leave has started, whatever the change asks
    const monday = 6 * 24 * HOUR + 60;
    await runCoverTimers({ db, now: at(monday) });
    expect((await requests()).filter((r) => r.state === "suggested")).toEqual([]);
    await expect(askCover(as("kemar", monday), OCT, "alicia", ["milestone:ms-trend"], "late")).rejects.toThrow("Your leave has started");
  });
});

describe("the timer and a leave that is over", () => {
  it("settles a cover only while its leave lasts; a leave that ended is not off, so its handover stays", async () => {
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const { record } = await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152"], "p-1");
    await answer("jodian", record.id, { act: "accept" });
    expect((await runCoverTimers({ db, now: at(8 * 24 * HOUR) })).settled).toEqual([record.id]);
    // Sat 31 Oct: the leave is over, and the cover is left as it stands
    expect((await runCoverTimers({ db, now: at(11 * 24 * HOUR) })).settled).toEqual([]);
    await db.update(t.leave).set({ state: "ended" }).where(eq(t.leave.id, OCT));
    await db.transaction((tx) => coverOnLeave(tx, at(11 * 24 * HOUR), OCT));
    expect((await requests())[0]).toMatchObject({ state: "accepted", handover: "proposed" });
    expect((await db.select().from(t.handovers).where(eq(t.handovers.id, `ho-${record.id}`)))[0].state).toBe("not_started");
  });
});

describe("rule 6: a thing named twice is asked once", () => {
  it("the same key twice from the form is one item, one line in each notice and one handover step", async () => {
    await says("kemar", "I'm off Monday 26 Oct to Friday 30 Oct");
    const { record, message } = await askCover(as("kemar", 1), OCT, "jodian", ["work_item:wi-152", "work_item:wi-152"], "twice");
    expect(message).toBe("Asked Jodian to cover #152 Store feed connector. I'll tell you when they answer.");
    expect(record.items.map((i) => i.id)).toEqual(["wi-152"]);
    expect(await notices("jodian")).toEqual(["Kemar asks if you can cover #152 Store feed connector on Forager 2.0 while they're away Mon 26 Oct to Fri 30 Oct. Accept, or say you can't."]);
    await answer("jodian", record.id, { act: "accept" });
    expect(await db.select().from(t.handoverSteps).where(eq(t.handoverSteps.handoverId, `ho-${record.id}`))).toHaveLength(1);
  });
});
