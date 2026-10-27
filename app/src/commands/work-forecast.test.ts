// Section 20, U6 against PGlite: a work item's forecast, from its owner's words (research model
// workForecast.mjs; WF1 to WF7). The due date is the plan and never moves from a message.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { calculatePlan, workItemStatus } from "../domain/status/rules";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";
import { loadPlanRows } from "../db/records";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const work = async (id: string) => (await db.select().from(t.workItems).where(eq(t.workItems.id, id)))[0];

const forecast = (targetId: string, quote: string, newValue = "2026-10-26"): RawProposal => ({
  kind: "update",
  projectId: "forager",
  routingReason: { basis: "target", evidence: "trend scoring model", label: "Kemar owns it" },
  targetId,
  field: "forecast",
  newValue,
  quote,
  confidence: "high",
  rationale: "You expect it done then.",
});

let n = 0;
/** Kemar says it; returns what Atlas's checks made of it, and saves when there is something to save. */
async function kemarSays(proposal: RawProposal) {
  const { captureId } = await createCapture(as("kemar"), { channel: "atlas", messageId: `atl-f-${++n}`, kind: "text", text: `${proposal.quote}.`, messageAt: at(0), receivedAt: at(0) });
  const { items, dropped } = await proposeItems(as("kemar"), captureId, [proposal]);
  if (!items.length) return { items, dropped, card: null };
  await openReview(as("kemar"), captureId);
  const review = await getReview(db, "kemar", captureId);
  if (!review.found) throw new Error("no review");
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as("kemar"), i.id, { type: "accept" });
  const saved = await saveCapture(as("kemar"), captureId);
  if (saved.outcome !== "saved") throw new Error(`save: ${JSON.stringify(saved)}`);
  return { items, dropped, card: review.items[0] };
}

describe("a work item's forecast (section 20, U6)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("Kemar's own: saved as its forecast, the due date unchanged, and the item At risk (WF4: on his leave)", async () => {
    const { card } = await kemarSays(forecast("wi-147", "The trend scoring model will take until Monday"));
    expect(card?.change).toBe("Forecast 23 Oct to 26 Oct (due 23 Oct), when you're on leave");
    expect(await work("wi-147")).toMatchObject({ forecastDate: "2026-10-26", dueDate: "2026-10-23", state: "in_progress" });
    // Three days after due is within the tolerance: At risk, not Off track
    const rows = await loadPlanRows(db, "forager");
    const w147 = rows.workItems.find((w) => w.threadId === "th-trend" && w.forecastDate === "2026-10-26")!;
    expect(workItemStatus(w147, "2026-10-21")).toBe("at_risk");
    expect(calculatePlan(rows, "2026-10-21").threads["th-trend"]).toBe("at_risk");
  });

  it("WF1: on or before the due date it is on time, and the status is unchanged", async () => {
    const { card } = await kemarSays(forecast("wi-152", "The store feed connector will be done Monday"));
    expect(card?.change).toBe("Forecast 27 Oct to 26 Oct, on time, when you're on leave");
    expect(workItemStatus({ state: "to_do", dueDate: "2026-10-27", forecastDate: "2026-10-26" }, "2026-10-21")).toBe("not_started");
  });

  it("WF5: Jodian's work is hers to forecast, so it asks her", async () => {
    const { card } = await kemarSays(forecast("wi-160", "The feature store backfill will take until Monday"));
    expect(card?.change).toBe("Ask Jodian: Forecast 28 Oct to 26 Oct, on time");
    expect((await work("wi-160")).forecastDate).toBeNull();
  });

  it("WF2: a day already past is refused", async () => {
    const { items, dropped } = await kemarSays(forecast("wi-147", "The trend scoring model was done yesterday", "2026-10-19"));
    expect(items).toEqual([]);
    expect(dropped[0].reason).toBe("a forecast for #147 Trend scoring model is a day still to come");
  });

  it("WF3: finished work has nothing to forecast", async () => {
    const { card } = await kemarSays(forecast("wi-142", "The TikTok ingest will be done Monday"));
    expect(card?.markLabel).toBe("No change");
    expect((await work("wi-142")).forecastDate).toBeNull();
  });

  it("WF7: a due date never moves from a message", async () => {
    const { items, dropped } = await kemarSays({ ...forecast("wi-147", "Push the due date for #147 to the 30th", "2026-10-30"), field: "due" });
    expect(items).toEqual([]);
    expect(dropped[0].reason).toBe("#147 Trend scoring model's due date is the plan; ask Alicia Campbell to move it, or say when you now expect it done");
    expect((await work("wi-147")).dueDate).toBe("2026-10-23");
  });
});
