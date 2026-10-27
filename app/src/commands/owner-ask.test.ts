// M37 against PGlite (machines doc section 20, U5 and U7; research model ownerAsk.mjs): an update about
// someone else's record, or about work with no record, asks the person with the right. Saving writes
// nothing; their accept is checked again when it runs.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { getInbox } from "../queries/inbox";
import { getReview } from "../queries/review";
import { undoViewOf } from "../queries/undo";
import { at, seededDb } from "../test/seeded-db";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";
import { CommandRefused } from "./core";
import { acceptOwnerAsk, declineOwnerAsk, runOwnerAskTimers, withdrawOwnerAsk } from "./owner-ask";
import { undoSave } from "./undo";

let db: Db;
const DAY = 24 * 60;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const live = async (who: string) =>
  (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open").map((i) => i.causeKey).sort();
const notices = async (who: string) => (await db.select().from(t.notices).where(eq(t.notices.personId, who))).map((n) => n.text);
const ask = async (id: string) => (await db.select().from(t.ownerAsks).where(eq(t.ownerAsks.id, id)))[0];
const work = async (id: string) => (await db.select().from(t.workItems).where(eq(t.workItems.id, id)))[0];

const JODIAN_DONE: RawProposal = {
  kind: "update",
  projectId: "forager",
  routingReason: { basis: "target", evidence: "feature store backfill", label: "#160 is on Forager" },
  targetId: "wi-160",
  field: "state",
  newValue: "done",
  quote: "Jodian finished the feature store backfill",
  confidence: "high",
  rationale: "You say Jodian finished it.",
};

const NEW_WORK: RawProposal = {
  kind: "new_work",
  projectId: "forager",
  routingReason: { basis: "reference", evidence: "Forager", label: "You said Forager" },
  workTitle: "Harvest docs cleanup",
  newValue: "in_progress",
  quote: "Started on a harvest docs cleanup for Forager today",
  confidence: "high",
  rationale: "You started work that has no task.",
};

let n = 0;
/** Kemar says it, accepts every item and saves; returns the ask's id and the review card. */
async function kemarSays(proposal: RawProposal, minutes = 0) {
  const { captureId } = await createCapture(as("kemar", minutes), { channel: "atlas", messageId: `atl-a-${++n}`, kind: "text", text: `${proposal.quote}.`, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as("kemar", minutes), captureId, [proposal]);
  await openReview(as("kemar", minutes), captureId);
  const review = await getReview(db, "kemar", captureId);
  if (!review.found) throw new Error("no review");
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as("kemar", minutes), i.id, { type: "accept" });
  const saved = await saveCapture(as("kemar", minutes), captureId);
  if (saved.outcome !== "saved") throw new Error(`save: ${JSON.stringify(saved)}`);
  return { askId: `ask-${items[0].id}`, card: review.items[0] };
}

describe("an Ask to the owner (M37, section 20, U5)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("OA2: Kemar's save changes nothing and asks Jodian; her accept changes it, and Kemar is told", async () => {
    const { askId, card } = await kemarSays(JODIAN_DONE);
    expect([card.title, card.change, card.markLabel]).toEqual(["Issue #160 Feature store backfill", "Ask Jodian: In progress to Done", "Needs your OK"]);
    expect((await work("wi-160")).state).toBe("in_progress");
    expect(await ask(askId)).toMatchObject({ state: "asked", ownerId: "jodian", saw: "in_progress", value: "done" });
    expect(await live("jodian")).toContain(`owner_ask:${askId}`);
    const item = (await getInbox(db, "jodian", at(5))).items.find((i) => i.causeKey === `owner_ask:${askId}`)!;
    expect(item).toMatchObject({ title: "Kemar says: #160 Feature store backfill, In progress to Done", action: "Decide", subject: { type: "owner_ask", id: askId } });

    await acceptOwnerAsk(as("jodian", 10), askId);
    expect((await work("wi-160")).state).toBe("done");
    expect(await ask(askId)).toMatchObject({ state: "applied", decidedBy: "jodian", appliedValue: "done" });
    expect(await live("jodian")).not.toContain(`owner_ask:${askId}`);
    expect(await notices("kemar")).toContain("Jodian accepted your update.");
  });

  it("only the owner answers: not Kemar, and not the PM (S5, AppliedOnlyByTheAsked)", async () => {
    const { askId } = await kemarSays(JODIAN_DONE);
    await expect(acceptOwnerAsk(as("kemar", 10), askId)).rejects.toThrow(CommandRefused);
    await expect(acceptOwnerAsk(as("alicia", 10), askId)).rejects.toThrow(CommandRefused);
    expect((await work("wi-160")).state).toBe("in_progress");
  });

  it("an accept after the record changed writes nothing (NeverOverwriteUnseen)", async () => {
    const { askId } = await kemarSays(JODIAN_DONE);
    await db.update(t.workItems).set({ state: "blocked", blockedNote: "waiting on data" }).where(eq(t.workItems.id, "wi-160"));
    await expect(acceptOwnerAsk(as("jodian", 10), askId)).rejects.toThrow(/it is blocked now, not in_progress/);
    expect((await work("wi-160")).state).toBe("blocked");
    expect((await ask(askId)).state).toBe("asked");
  });

  it("declined with a reason, Kemar is told why (EndIsTold)", async () => {
    const { askId } = await kemarSays(JODIAN_DONE);
    await declineOwnerAsk(as("jodian", 10), askId, "Only the first half is done");
    expect(await ask(askId)).toMatchObject({ state: "declined", reason: "Only the first half is done" });
    expect(await notices("kemar")).toContain('Jodian declined your update: "Only the first half is done"');
    expect(await live("jodian")).not.toContain(`owner_ask:${askId}`);
  });

  it("moot when the record gets there another way; withdrawn when it is cancelled (OA9)", async () => {
    const first = await kemarSays(JODIAN_DONE);
    await db.update(t.workItems).set({ state: "done" }).where(eq(t.workItems.id, "wi-160"));
    expect(await runOwnerAskTimers({ db, now: at(10) })).toEqual([{ askId: first.askId, to: "moot" }]);

    await db.update(t.workItems).set({ state: "in_progress" }).where(eq(t.workItems.id, "wi-160"));
    const second = await kemarSays({ ...JODIAN_DONE, quote: "Jodian wrapped up the feature store backfill" }, 20);
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-160"));
    expect(await runOwnerAskTimers({ db, now: at(30) })).toEqual([{ askId: second.askId, to: "withdrawn" }]);
    expect((await ask(second.askId)).reason).toBe("the record was cancelled");
  });

  it("expires after 7 days unanswered, and Kemar is told (UD1, AskEnds)", async () => {
    const { askId } = await kemarSays(JODIAN_DONE);
    expect(await runOwnerAskTimers({ db, now: at(6 * DAY) })).toEqual([]);
    expect(await runOwnerAskTimers({ db, now: at(7 * DAY) })).toEqual([{ askId, to: "expired" }]);
    expect(await notices("kemar")).toContain("Nobody answered your update in 7 days, so it was not applied.");
    expect(await live("jodian")).not.toContain(`owner_ask:${askId}`);
  });

  it("Kemar may take it back before it is answered", async () => {
    const { askId } = await kemarSays(JODIAN_DONE);
    await withdrawOwnerAsk(as("kemar", 10), askId);
    expect((await ask(askId)).state).toBe("withdrawn");
  });

  it("W2-D1: undoing a save made only of Asks takes the waiting Ask back, and Jodian is no longer asked", async () => {
    const { askId } = await kemarSays(JODIAN_DONE);
    expect(await undoViewOf(db, "kemar", (await ask(askId)).captureId, at(5))).toMatchObject({ may: true });
    const undone = await undoSave(as("kemar", 5), { commandId: "undo-asks" });
    expect(undone).toMatchObject({ kind: "job", job: { state: "undone" } });
    expect((await ask(askId)).state).toBe("withdrawn");
    expect(await live("jodian")).not.toContain(`owner_ask:${askId}`);
    expect((await work("wi-160")).state).toBe("in_progress");
  });

  it("W2-D1: an Ask already answered stays as the owner decided; undo has nothing left to take back", async () => {
    const { askId } = await kemarSays(JODIAN_DONE);
    await acceptOwnerAsk(as("jodian", 2), askId);
    expect(await undoSave(as("kemar", 5), { commandId: "undo-answered" })).toEqual({ kind: "nothing" });
    expect(await ask(askId)).toMatchObject({ state: "applied" });
    expect((await work("wi-160")).state).toBe("done");
  });

  it("OA1: a forecast on Alicia's milestone asks Alicia, and her accept moves it", async () => {
    const { askId, card } = await kemarSays({
      ...JODIAN_DONE,
      routingReason: { basis: "target", evidence: "Release 1", label: "Release 1 is on Forager" },
      targetId: "ms-release-1",
      field: "forecast",
      newValue: "2026-11-03",
      quote: "Release 1 for the buyer pilot is going to slip to the 3rd",
    });
    expect(card.change).toBe("Ask Alicia: Forecast 30 Oct to 3 Nov");
    await acceptOwnerAsk(as("alicia", 10), askId);
    expect((await db.select().from(t.milestones).where(eq(t.milestones.id, "ms-release-1")))[0].forecastDate).toBe("2026-11-03");
  });
});

describe("new work proposed to the PM (M37, section 20, U7)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("NW1: Alicia adds it to the plan as Kemar's; nothing exists until she does", async () => {
    const { askId, card } = await kemarSays(NEW_WORK);
    expect([card.kindLabel, card.title, card.change]).toEqual(["New work", "New work: Harvest docs cleanup", "Propose to Alicia, the PM: In progress"]);
    expect(await work(`wi-${askId}`)).toBeUndefined();
    expect(await live("alicia")).toContain(`owner_ask:${askId}`);
    const item = (await getInbox(db, "alicia", at(5))).items.find((i) => i.causeKey === `owner_ask:${askId}`)!;
    expect(item.title).toBe("Kemar proposes new work: Harvest docs cleanup");

    await acceptOwnerAsk(as("alicia", 10), askId);
    expect(await work(`wi-${askId}`)).toMatchObject({ title: "Harvest docs cleanup", ownerId: "kemar", state: "in_progress", projectId: "forager" });
    expect(await notices("kemar")).toContain('Alicia added "Harvest docs cleanup" to the plan.');
  });

  it("NW5: declined, nothing is created and Kemar is told why; a member cannot add it", async () => {
    const { askId } = await kemarSays(NEW_WORK);
    await expect(acceptOwnerAsk(as("jodian", 10), askId)).rejects.toThrow(/a PM or Lead answers new work/);
    await declineOwnerAsk(as("alicia", 10), askId, "That is part of #147");
    expect(await work(`wi-${askId}`)).toBeUndefined();
    expect(await notices("kemar")).toContain('Alicia declined your update: "That is part of #147"');
  });
});
