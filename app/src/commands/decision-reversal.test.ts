// Section 20, U4 against PGlite: "we're going back to 5am" is a new decision that names the one it
// reverses. Saving it only links them; approving it supersedes the old one (E87); declining it leaves the
// old one standing (research model braidEntry.mjs, SupersededHasApprovedSuccessor).
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { loadBraidLog } from "../db/records";
import type { RawProposal } from "../domain/atlas-checks/types";
import { getReview } from "../queries/review";
import { at, seededDb } from "../test/seeded-db";
import { decideBraidEntry } from "./braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "./capture";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const log = async () => (await loadBraidLog(db, "insights")).log;

const decision = (title: string, quote: string, supersedes: string | null = null): RawProposal => ({
  kind: "braid_new",
  projectId: "insights",
  routingReason: { basis: "reference", evidence: "Store Insights", label: '"On Store Insights"' },
  braidKind: "decision",
  braidTitle: title,
  supersedes,
  quote,
  confidence: "high",
  rationale: "You and Andre agreed it.",
});

let n = 0;
/** Kemar says it, accepts it and saves; returns the new entry's id and the review card's match line. */
async function kemarSays(proposal: RawProposal, minutes = 0) {
  const { captureId } = await createCapture(as("kemar", minutes), { channel: "atlas", messageId: `atl-d-${++n}`, kind: "text", text: `On Store Insights, ${proposal.quote}.`, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as("kemar", minutes), captureId, [proposal]);
  await openReview(as("kemar", minutes), captureId);
  const review = await getReview(db, "kemar", captureId);
  if (!review.found) throw new Error("no review");
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as("kemar", minutes), i.id, { type: "accept" });
  const saved = await saveCapture(as("kemar", minutes), captureId);
  if (saved.outcome !== "saved") throw new Error(`save: ${JSON.stringify(saved)}`);
  return { id: `br-${items[0].id}`, matchLine: review.items[0].match?.label };
}

describe("a reversed decision supersedes the old one (section 20, U4)", () => {
  let six: string;
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
    six = (await kemarSays(decision("Move the daily refresh to 6am", "Andre and I agreed to move the refresh to 6am"))).id;
  }, 30_000);

  it("saving only links them; Andre's approval supersedes the 6am decision", async () => {
    await decideBraidEntry(as("andre", 5), six, { type: "approve" });
    const { id: five, matchLine } = await kemarSays(decision("Go back to the 5am refresh", "Andre and I agreed to go back to the 5am refresh", six), 60);
    expect(matchLine).toBe("Replaces: Move the daily refresh to 6am");

    let l = await log();
    expect(l[six].state).toBe("approved"); // a reported reversal replaces nothing (SupersededHasApprovedSuccessor)
    expect(l[five]).toMatchObject({ state: "proposed", links: [{ relation: "conflicts_with", entryId: six }] });

    await decideBraidEntry(as("andre", 70), five, { type: "approve" });
    l = await log();
    expect(l[six].state).toBe("superseded");
    expect(l[five].state).toBe("approved");
    expect(l[five].links).toContainEqual({ relation: "supersedes", entryId: six });
  });

  it("SD3: a declined reversal leaves the 6am decision standing", async () => {
    await decideBraidEntry(as("andre", 5), six, { type: "approve" });
    const { id: five } = await kemarSays(decision("Go back to the 5am refresh", "Andre and I agreed to go back to the 5am refresh", six), 60);
    await decideBraidEntry(as("andre", 70), five, { type: "decline", reason: "6am stays" });
    const l = await log();
    expect([l[six].state, l[five].state]).toEqual(["approved", "declined"]);
  });

  it("SD1 (E88): reversing one still waiting links them, and approving the new one leaves the old for Andre", async () => {
    const { id: five } = await kemarSays(decision("Go back to the 5am refresh", "Andre and I agreed to go back to the 5am refresh", six), 60);
    await decideBraidEntry(as("andre", 70), five, { type: "approve" });
    const l = await log();
    expect([l[six].state, l[five].state]).toEqual(["proposed", "approved"]);
    expect(l[six].links).toContainEqual({ relation: "conflicts_with", entryId: five });
  });
});
