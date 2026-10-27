// Section 20, U3 against PGlite: a message says a risk, assumption or dependency ended. A member's words
// propose it to the PM and Leads (D7 stands); a PM's own words end it (research model braidOutcome.mjs).
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog } from "../db/records";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { getInbox } from "../queries/inbox";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { keepOpen, resolveBraidEntry } from "./braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const live = async (who: string) =>
  (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open").map((i) => i.causeKey).sort();
const entry = async (id: string) => (await loadBraidLog(db, "forager")).log[id];
const notices = async (who: string) => (await db.select().from(t.notices).where(eq(t.notices.personId, who))).map((n) => n.text);

const ended = (matchEntryId: string, outcome: string, quote: string): RawProposal => ({
  kind: "braid_resolve",
  projectId: "forager",
  routingReason: { basis: "target", evidence: quote, label: "The entry it names" },
  matchEntryId,
  outcome,
  quote,
  confidence: "high",
  rationale: "You say it ended.",
});

let n = 0;
/** Someone says it, accepts the item and saves; returns the review card's change line. */
async function says(who: string, proposal: RawProposal, minutes = 0): Promise<string> {
  const { captureId } = await createCapture(as(who, minutes), { channel: "atlas", messageId: `atl-o-${++n}`, kind: "text", text: `${proposal.quote}.`, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as(who, minutes), captureId, [proposal]);
  await openReview(as(who, minutes), captureId);
  const review = await getReview(db, who, captureId);
  if (!review.found) throw new Error("no review");
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as(who, minutes), i.id, { type: "accept" });
  const saved = await saveCapture(as(who, minutes), captureId);
  if (saved.outcome !== "saved") throw new Error(`save: ${JSON.stringify(saved)}`);
  return review.items[0].change;
}

describe("a message says how a risk, assumption or dependency ended (section 20, U3)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("OC2: Kemar says the pipeline risk is gone; it stays, and Alicia decides", async () => {
    const change = await says("kemar", ended("br-pipeline-risk", "closed", "The pipeline risk is gone, Jodian can run it on her own"));
    expect(change).toBe("Propose to Alicia, the PM: it's gone");
    expect(await entry("br-pipeline-risk")).toMatchObject({ state: "mitigating", outcomesProposed: [{ by: "kemar", outcome: "closed" }] });
    expect(await live("alicia")).toContain("confirm_outcome:br-pipeline-risk");
    const item = (await getInbox(db, "alicia", at(5))).items.find((i) => i.causeKey === "confirm_outcome:br-pipeline-risk")!;
    expect(item).toMatchObject({ title: "Kemar says it's gone: Only Kemar can run the pipeline", action: "Decide", why: "only a PM or Lead ends a risk; decide how it ended, or keep it open" });

    await resolveBraidEntry(as("alicia", 10), "br-pipeline-risk", "closed");
    expect(await entry("br-pipeline-risk")).toMatchObject({ state: "closed", outcomesProposed: [] });
    expect(await live("alicia")).not.toContain("confirm_outcome:br-pipeline-risk");
  });

  it("OC2: kept open, whoever said it is told", async () => {
    await says("kemar", ended("br-pipeline-risk", "closed", "The pipeline risk is gone"));
    await keepOpen(as("alicia", 10), "br-pipeline-risk");
    expect(await entry("br-pipeline-risk")).toMatchObject({ state: "mitigating", outcomesProposed: [] });
    expect(await live("alicia")).not.toContain("confirm_outcome:br-pipeline-risk");
    expect(await notices("kemar")).toContain('Alicia kept "Only Kemar can run the pipeline" open.');
  });

  it("OC3: two people saying different things are both put to Alicia", async () => {
    await says("kemar", ended("br-pipeline-risk", "closed", "The pipeline risk is gone"));
    await says("jodian", ended("br-pipeline-risk", "realised", "The pipeline risk happened, I could not run it alone"), 5);
    const item = (await getInbox(db, "alicia", at(10))).items.find((i) => i.causeKey === "confirm_outcome:br-pipeline-risk")!;
    expect(item.title).toBe("Kemar says it's gone; Jodian says it happened: Only Kemar can run the pipeline");
  });

  it("OC1, OC6: Alicia's own words end it; a realised risk drafts its issue for her to confirm (D10)", async () => {
    const change = await says("alicia", ended("br-pipeline-risk", "realised", "The pipeline risk happened yesterday"));
    expect(change).toBe("Mark it realised");
    expect((await entry("br-pipeline-risk")).state).toBe("realised");
    expect(await entry("br-pipeline-risk-raised")).toMatchObject({ kind: "issue", state: "none" });
    expect(await live("alicia")).toContain("follow_up:br-pipeline-risk-raised");
    expect(await live("alicia")).not.toContain("confirm_outcome:br-pipeline-risk");
  });

  it("an assumption breaks, and a dependency is met, the same way", async () => {
    await says("kemar", ended("br-buyers-assumption", "broken", "The buyers are not available the week of the 26th after all"));
    expect(await entry("br-buyers-assumption")).toMatchObject({ state: "holding", outcomesProposed: [{ by: "kemar", outcome: "broken" }] });
    await resolveBraidEntry(as("alicia", 10), "br-buyers-assumption", "broken");
    expect((await entry("br-buyers-assumption")).state).toBe("broken");

    await says("kemar", ended("br-feed-dependency", "met", "Kyle finally gave us the store feed access"), 20);
    expect(await live("alicia")).toContain("confirm_outcome:br-feed-dependency");
  });
});
