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
import { capturesToRead, readCapture } from "./atlas";
import { beginRead, createCapture, proposeItems, ReadSuperseded, runCaptureTimers } from "./capture";
import { CommandRefused } from "./core";
import { draftReason, draftReasonWithAtlas } from "./status";

let db: Db;
const kemar = () => ({ db, now: at(0), actorId: "kemar" });
const noWait = { retryDelayMs: () => 0 };

let messages = 0;
async function note(text = KEMAR_NOTE, kind: "voice" | "text" = "voice") {
  const { captureId } = await createCapture(kemar(), { channel: "atlas", messageId: `atl-${++messages}`, kind, text, messageAt: KEMAR_NOTE_AT, receivedAt: KEMAR_NOTE_AT, transcriptConfidence: kind === "voice" ? "high" : null });
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

describe("D1, D14, D19: voice notes, message ids and reads that never answer", () => {
  it("D1: a voice note with no transcript is tried 3 times, then Atlas asks for a new voice note", async () => {
    const id = await note("", "voice");
    const atlas = flaky([]);
    const r = await readCapture(kemar(), id, atlas, noWait);
    expect(r).toMatchObject({ outcome: "failed", tries: 3, failedStep: "transcribe" });
    expect(atlas.calls).toBe(0); // the model is never asked about a note nobody could hear
    expect(await moves(id)).toEqual(["RECEIVED", "START", "TRANSCRIBE_FAILED", "RETRY", "TRANSCRIBE_FAILED", "RETRY", "TRANSCRIBE_FAILED", "RETRY"]);
    expect((await getChatSummary(db, "kemar")).latest?.line).toBe("I couldn't hear that voice note. Can you send it again, or type it?");
  });

  it("D1: the new voice note is a new capture, read as normal", async () => {
    await readCapture(kemar(), await note("", "voice"), flaky([]), noWait);
    const later = new Date(KEMAR_NOTE_AT.getTime() + 60_000);
    const { captureId: again } = await createCapture(kemar(), { channel: "atlas", messageId: "atl-again", kind: "voice", text: KEMAR_NOTE, messageAt: later, receivedAt: later, transcriptConfidence: "high" });
    expect(await readCapture(kemar(), again, createFixtureExtractor(), noWait)).toMatchObject({ outcome: "proposed", state: "proposed" });
    expect((await getChatSummary(db, "kemar")).latest).toMatchObject({ id: again, line: "Got it. 9 updates for 2 projects; 4 need your OK." });
  });

  it("D14: a message from Atlas without its message id is refused", async () => {
    await expect(createCapture(kemar(), { channel: "atlas", kind: "text", text: "#145 done", messageAt: at(0), receivedAt: at(0) })).rejects.toThrow("needs its message id");
  });

  it("D14: the same words in Atlas and in the DPM app are two captures; a resend from Atlas is one", async () => {
    const input = { kind: "text" as const, text: "#145 done", messageAt: at(0), receivedAt: at(0) };
    const a = await createCapture(kemar(), { ...input, channel: "atlas", messageId: "atl-9" });
    const resend = await createCapture(kemar(), { ...input, channel: "atlas", messageId: "atl-9", receivedAt: at(1) });
    const app = await createCapture(kemar(), { ...input, channel: "app" });
    expect(resend).toEqual({ captureId: a.captureId, duplicate: true });
    expect(app.duplicate).toBe(false);
  });

  it("D19: a read with no answer for 5 minutes goes back to retry; the late answer is dropped", async () => {
    const id = await note("#145 is done.", "text");
    const started = await beginRead(kemar(), id); // the process stops here
    expect(await runCaptureTimers({ db, now: at(4) })).toMatchObject({ stale: [] });
    expect(await runCaptureTimers({ db, now: at(5) })).toMatchObject({ stale: [id] });
    expect(await capturesToRead(db)).toEqual([id]);
    // The first try answers after all: too late
    await expect(proposeItems({ ...kemar(), now: at(6) }, id, [KEMAR_PROPOSALS[1]], { model: "late", attempt: started.tries })).rejects.toBeInstanceOf(ReadSuperseded);
    const r = await readCapture({ ...kemar(), now: at(6) }, id, flaky([], [{ ...KEMAR_PROPOSALS[1], quote: "#145 is done" }]), noWait);
    expect(r).toMatchObject({ outcome: "proposed", state: "proposed" });
    expect(r.outcome === "proposed" && r.items).toHaveLength(1);
    expect(await capturesToRead(db)).toEqual([]);
  });

  it("D19: a transcription with no answer is caught the same way (found by the model check)", async () => {
    const id = await note();
    await beginRead(kemar(), id);
    expect(await runCaptureTimers({ db, now: at(5) })).toMatchObject({ stale: [id] });
    const [row] = await db.select().from(t.captures).where(eq(t.captures.id, id));
    expect(row.state).toBe("transcribe_wait");
  });

  it("a run whose capture moved on stops quietly", async () => {
    const id = await note("#145 is done.", "text");
    const late: Extractor = {
      name: "slow",
      async extract() {
        // The timer fires while the model is still thinking, and another worker starts the next try
        await runCaptureTimers({ db, now: at(10) });
        await beginRead({ ...kemar(), now: at(10) }, id);
        return { proposals: [KEMAR_PROPOSALS[1]], malformed: [], model: "slow", usage: null };
      },
    };
    expect(await readCapture(kemar(), id, late, noWait)).toEqual({ outcome: "superseded", failures: [] });
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
