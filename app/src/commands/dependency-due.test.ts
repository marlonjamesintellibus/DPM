// Section 20, U2 against PGlite: someone else's promise becomes a dependency with an expected date, and
// its PM is asked once the date has passed (research model dependencyDue.mjs; DP1 to DP8).
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog } from "../db/records";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { getInbox } from "../queries/inbox";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { decideBraidEntry, resolveBraidEntry, runDependencyDue, setExpectedDate } from "./braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";
import { CommandRefused } from "./core";

let db: Db;
const DAY = 24 * 60;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const live = async (who: string) =>
  (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open").map((i) => i.causeKey).sort();

const TEXT = "I've spoken with Kyle to update the harvest docs, he'll do it tomorrow";
const PROMISE: RawProposal = {
  kind: "braid_new",
  projectId: "forager",
  routingReason: { basis: "tied_person", evidence: "Kyle", label: "Kyle is the contact on #151" },
  braidKind: "dependency",
  braidTitle: "Kyle to update the harvest docs by 21 Oct",
  quote: TEXT,
  confidence: "high",
  rationale: "Kyle agreed to update the harvest docs tomorrow.",
};

/** Kemar says it on Tuesday 20 Oct, accepts it and saves; returns the new entry's id. */
async function kemarSavesThePromise(proposal = PROMISE): Promise<string> {
  const { captureId } = await createCapture(as("kemar"), { channel: "app", kind: "text", text: TEXT, messageAt: at(0), receivedAt: at(0), messageId: `dep-${proposal.braidTitle}` });
  const { items } = await proposeItems(as("kemar"), captureId, [proposal]);
  await openReview(as("kemar"), captureId);
  const review = await getReview(db, "kemar", captureId);
  if (!review.found) throw new Error("no review");
  expect(review.items[0].change).toBe(proposal === PROMISE ? "Propose to Alicia, the PM, expected Wed 21 Oct" : "Propose to Alicia, the PM");
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as("kemar"), i.id, { type: "accept" });
  const saved = await saveCapture(as("kemar"), captureId);
  if (saved.outcome !== "saved") throw new Error(`save: ${JSON.stringify(saved)}`);
  return `br-${items[0].id}`;
}

const entry = async (id: string) => (await loadBraidLog(db, "forager")).log[id];

describe("someone else's promise as a dependency (section 20, U2)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("is proposed to Alicia with the promised date; once approved and the date passes, she is asked", async () => {
    const id = await kemarSavesThePromise();
    expect(await entry(id)).toMatchObject({ kind: "dependency", state: "proposed", expectedOn: "2026-10-21", title: "Kyle to update the harvest docs by 21 Oct" });
    expect(await live("alicia")).toContain(`approve:${id}`);

    await decideBraidEntry(as("alicia", 10), id, { type: "approve" });
    // Wednesday 21 Oct is the day itself: nothing yet
    expect(await runDependencyDue({ db, now: at(DAY) })).toEqual([]);
    expect(await live("alicia")).not.toContain(`dependency_due:${id}`);

    // Thursday 22 Oct: the PM and Leads are asked; the entry itself does not change (NeverEndsByItself)
    expect(await runDependencyDue({ db, now: at(2 * DAY) })).toEqual(["forager"]);
    expect(await live("alicia")).toContain(`dependency_due:${id}`);
    expect((await entry(id)).state).toBe("open");
    // Run again: the item is already open, so nothing is evaluated
    expect(await runDependencyDue({ db, now: at(2 * DAY + 1) })).toEqual([]);

    const inbox = await getInbox(db, "alicia", at(2 * DAY));
    const due = inbox.items.find((i) => i.causeKey === `dependency_due:${id}`)!;
    expect(due).toMatchObject({ title: "Was this delivered? Kyle to update the harvest docs by 21 Oct", why: "it was expected 21 Oct; mark it met or late, or give a new date", action: "Update" });
  });

  it("a new date closes the item until that date passes; Met ends it for good", async () => {
    const id = await kemarSavesThePromise();
    await decideBraidEntry(as("alicia", 10), id, { type: "approve" });
    await runDependencyDue({ db, now: at(2 * DAY) });

    await setExpectedDate(as("alicia", 2 * DAY), id, "2026-10-26");
    expect((await entry(id)).expectedOn).toBe("2026-10-26");
    expect(await live("alicia")).not.toContain(`dependency_due:${id}`);
    expect(await runDependencyDue({ db, now: at(6 * DAY) })).toEqual([]); // Monday 26 Oct itself
    expect(await runDependencyDue({ db, now: at(7 * DAY) })).toEqual(["forager"]); // Tuesday 27 Oct

    await resolveBraidEntry(as("alicia", 7 * DAY), id, "met");
    expect((await entry(id)).state).toBe("met");
    expect(await live("alicia")).not.toContain(`dependency_due:${id}`);
    expect(await runDependencyDue({ db, now: at(30 * DAY) })).toEqual([]);
  });

  it("only a PM or Lead gives a new date (DependencyDue, DateMovesOnlyByLead)", async () => {
    const id = await kemarSavesThePromise();
    await decideBraidEntry(as("alicia", 10), id, { type: "approve" });
    await expect(setExpectedDate(as("kemar", 10), id, "2026-10-28")).rejects.toThrow(CommandRefused);
    expect((await entry(id)).expectedOn).toBe("2026-10-21");
  });

  it("DP8: while it waits for approval the date may pass, and only the approval reminders run", async () => {
    const id = await kemarSavesThePromise();
    expect(await runDependencyDue({ db, now: at(5 * DAY) })).toEqual([]);
    expect(await live("alicia")).toEqual([`approve:${id}`]);
  });

  it("DP7: a declined dependency is never asked about", async () => {
    const id = await kemarSavesThePromise();
    await decideBraidEntry(as("alicia", 10), id, { type: "decline", reason: "Kyle is not on this" });
    expect(await runDependencyDue({ db, now: at(5 * DAY) })).toEqual([]);
    expect((await live("alicia")).filter((k) => k.endsWith(id))).toEqual([]);
  });

  it("DP1: a promise with no date is a dependency with none, and never due", async () => {
    const id = await kemarSavesThePromise({ ...PROMISE, braidTitle: "Kyle to update the harvest docs", quote: "I've spoken with Kyle to update the harvest docs" });
    await decideBraidEntry(as("alicia", 10), id, { type: "approve" });
    expect((await entry(id)).expectedOn).toBeNull();
    expect(await runDependencyDue({ db, now: at(30 * DAY) })).toEqual([]);
  });
});
