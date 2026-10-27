// readCapture against PGlite with fake extractors: the read, its retries and its failure (M2, E4,
// E18, E19), and the Atlas-worded reason with its fallback (M11).
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { AtlasReadFailed, type Drafter, type Extractor, type ReadFailure } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { KEMAR_NOTE, KEMAR_NOTE_AT, KEMAR_PROPOSALS } from "../domain/atlas-checks/kemar-note.fixture";
import type { RawProposal } from "../domain/atlas-checks/types";
import { getChatSummary } from "../queries/chat";
import { AT_910, at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { beginRead, createCapture } from "./capture";
import { CommandRefused } from "./core";
import { draftReason, draftReasonWithAtlas } from "./status";

let db: Db;
const kemar = () => ({ db, now: at(0), actorId: "kemar" });
const noWait = { retryDelayMs: () => 0 };

async function note(text = KEMAR_NOTE) {
  const { captureId } = await createCapture(kemar(), { channel: "whatsapp", kind: "voice", text, messageAt: KEMAR_NOTE_AT, receivedAt: KEMAR_NOTE_AT, transcriptConfidence: "high" });
  return captureId;
}

/** Fails with each reason in turn, then answers with `then`. */
function flaky(failures: ReadFailure[], then: readonly RawProposal[] = KEMAR_PROPOSALS): Extractor & { calls: number } {
  const ex = {
    name: "flaky",
    calls: 0,
    async extract() {
      const why = failures[ex.calls++];
      if (why) throw new AtlasReadFailed(why, `try ${ex.calls}: ${why}`);
      return { proposals: [...then], malformed: [], model: "fake-model", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } };
    },
  };
  return ex;
}

const moves = async (captureId: string) =>
  (await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, captureId), eq(t.auditEntries.machine, "capture")))).map((a) => a.action);

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("readCapture", () => {
  it("reads Kemar's note with the recorded Atlas: 11 items for review, and the model is in the audit", async () => {
    const id = await note();
    const r = await readCapture(kemar(), id, createFixtureExtractor(), noWait);
    expect(r).toMatchObject({ outcome: "proposed", state: "proposed", model: "fixture" });
    expect(r.outcome === "proposed" && r.items).toHaveLength(11);
    expect(await moves(id)).toEqual(["RECEIVED", "START", "TRANSCRIBED", "PROPOSALS_READY"]);
    const [ready] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.subjectId, id), eq(t.auditEntries.action, "PROPOSALS_READY")));
    expect(ready.detail).toMatchObject({ items: 11, model: "fixture" });
    expect((await getChatSummary(db, "kemar")).latest?.line).toBe("Got it. 9 updates for 2 projects; 4 need your OK.");
  });

  it("E19: a timeout and a broken answer are retried, and the third try is read", async () => {
    const id = await note();
    const atlas = flaky(["timeout", "bad_output"]);
    const slept: number[] = [];
    const r = await readCapture(kemar(), id, atlas, { sleep: async (ms) => void slept.push(ms) });
    expect(r.outcome).toBe("proposed");
    expect(atlas.calls).toBe(3);
    expect(slept).toEqual([2000, 4000]);
    expect(await moves(id)).toEqual(["RECEIVED", "START", "TRANSCRIBED", "READ_FAILED", "RETRY", "READ_FAILED", "RETRY", "PROPOSALS_READY"]);
    const [capture] = await db.select().from(t.captures).where(eq(t.captures.id, id));
    expect(capture.tries).toBe(3);
  });

  it("E18: after 3 failed tries the capture fails, keeps the text, and the author is told to try again or type it", async () => {
    const id = await note();
    const atlas = flaky(["model_error", "timeout", "model_error", "model_error"]);
    const r = await readCapture(kemar(), id, atlas, noWait);
    expect(r).toMatchObject({ outcome: "failed", tries: 3 });
    expect(r.outcome === "failed" && r.failures.map((f) => f.why)).toEqual(["model_error", "timeout", "model_error"]);
    expect(atlas.calls).toBe(3);
    const [capture] = await db.select().from(t.captures).where(eq(t.captures.id, id));
    expect(capture).toMatchObject({ state: "failed", text: KEMAR_NOTE });
    expect(await db.select().from(t.extractions).where(eq(t.extractions.captureId, id))).toEqual([]);
    expect((await getChatSummary(db, "kemar")).latest?.line).toBe("Atlas could not read this. Try again or type the update.");
  });

  it("E4: nothing to propose ends the read with nothing to review", async () => {
    const id = await note("Quiet day, nothing new.");
    const r = await readCapture(kemar(), id, flaky([], []), noWait);
    expect(r).toMatchObject({ outcome: "proposed", state: "nothing_to_update", items: [] });
    expect((await getChatSummary(db, "kemar")).latest?.line).toBe("Got it. Nothing in this one changes a project.");
  });

  it("the server checks still run on every proposal: an invented project or record never reaches review", async () => {
    const id = await note();
    const invented: RawProposal[] = [
      { ...KEMAR_PROPOSALS[0], projectId: "payroll", routingReason: { basis: "reference", evidence: "Finished", label: "Payroll" } },
      { ...KEMAR_PROPOSALS[1], targetId: "wi-999" },
      KEMAR_PROPOSALS[2],
    ];
    const r = await readCapture(kemar(), id, flaky([], invented), noWait);
    expect(r.outcome === "proposed" && r.items.map((i) => i.draft.target?.id)).toEqual(["wi-151"]);
    expect(r.outcome === "proposed" && r.dropped).toHaveLength(2);
  });

  it("a second reader cannot start while the first is reading", async () => {
    const id = await note();
    await beginRead(kemar(), id);
    await expect(beginRead(kemar(), id)).rejects.toBeInstanceOf(CommandRefused);
  });

  it("a database refusal is not mistaken for a model failure", async () => {
    await expect(readCapture(kemar(), "cap-missing", createFixtureExtractor(), noWait)).rejects.toBeInstanceOf(CommandRefused);
  });
});

describe("draftReasonWithAtlas (M11)", () => {
  const drafter = (text: string): Drafter & { asked: string[] } => {
    const d = {
      name: "fake",
      asked: [] as string[],
      async draft(_: string, user: string) {
        d.asked.push(user);
        return { text, model: "fake", usage: null };
      },
    };
    return d;
  };

  beforeEach(async () => {
    db = await seededDb(); // Alicia has set Forager 2.0 Off track
  }, 30_000);

  it("rewords the rules draft and sees only its facts", async () => {
    const rules = await draftReason(db, "forager", AT_910);
    const d = drafter("Forager 2.0 is Off track because the store sales feed is still blocked.");
    const out = await draftReasonWithAtlas(db, "forager", AT_910, d);
    expect(out).toMatchObject({ by: "atlas", text: "Forager 2.0 is Off track because the store sales feed is still blocked.", entryIds: rules.entryIds });
    expect(d.asked[0]).toBe(`Project: Forager 2.0\nStatus set by the owner: Off track\nFacts:\n${rules.text}`);
  });

  it("keeps the rules draft when Atlas adds a fact", async () => {
    const rules = await draftReason(db, "forager", AT_910);
    const out = await draftReasonWithAtlas(db, "forager", AT_910, drafter("Blocked for 40 days."));
    expect(out).toEqual({ ...rules, fallback: "adds the number 40" });
  });

  it("without Atlas, or with nothing to draft from (E47), it is the rules draft and Atlas is not asked", async () => {
    expect(await draftReasonWithAtlas(db, "forager", AT_910, null)).toEqual(await draftReason(db, "forager", AT_910));
    const d = drafter("anything");
    expect(await draftReasonWithAtlas(db, "insights", AT_910, d)).toEqual({ text: "", entryIds: [], by: "rules" });
    expect(d.asked).toEqual([]);
  });
});
