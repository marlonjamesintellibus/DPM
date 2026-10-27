import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyHandover, applyStep, HANDOVER_STATES, STEP_STATES, type HandoverEvent, type HandoverRecord, type HandoverState } from "./handover";

describe("a handover step (phase L, rule 2)", () => {
  it("moves only forward on a save, and each move has its UNDO back (undoArrows.mjs, HandoverStep)", () => {
    for (const from of STEP_STATES) {
      for (const to of STEP_STATES) {
        const forward = STEP_STATES.indexOf(to) > STEP_STATES.indexOf(from);
        expect(applyStep(from, { type: "MOVE", to }).ok, `${from} to ${to}`).toBe(forward);
        expect(applyStep(to, { type: "UNDO", to: from }).ok, `back from ${to} to ${from}`).toBe(forward);
      }
    }
    expect(applyStep("not_done", { type: "MOVE", to: "finished" as never })).toMatchObject({ ok: false, reason: '"finished" is not a handover step state (not_done, in_progress, handed_over)' });
  });
});

// Kemar's runbook handover to Jodian before his leave
const runbook = (state: HandoverState = "in_progress", stepsDone = 2): HandoverRecord => ({
  id: "runbook",
  projectId: "forager",
  fromPersonId: "kemar",
  toPersonId: "jodian",
  title: "Runbook",
  state,
  stepsDone,
  stepsTotal: 4,
});

describe("handover arrows", () => {
  it("a step moves k of m and stays in progress", () => {
    const r = applyHandover(runbook("not_started", 0), { type: "STEPS_DONE", done: 1 });
    expect(r.outcome).toMatchObject({ ok: true, from: "not_started", to: "in_progress" });
    expect(r.record.stepsDone).toBe(1);
  });

  it("the last step hands it over", () => {
    expect(applyHandover(runbook("in_progress", 3), { type: "STEPS_DONE", done: 4 }).record).toMatchObject({
      state: "handed_over",
      stepsDone: 4,
    });
    // "Handed to Jodian" in one edit, from not started
    expect(applyHandover(runbook("not_started", 0), { type: "STEPS_DONE", done: 4 }).record.state).toBe("handed_over");
  });

  it("steps only move forward, and never past the total", () => {
    for (const done of [2, 1, 5, 2.5]) {
      const record = runbook();
      const r = applyHandover(record, { type: "STEPS_DONE", done });
      expect(r.outcome.ok).toBe(false);
      expect(r.record).toBe(record);
    }
    expect(applyHandover(runbook(), { type: "STEPS_DONE", done: 1 }).outcome).toMatchObject({
      ok: false,
      reason: "steps only move forward (2 of 4 done)",
    });
  });

  it("cancels when the leave is cancelled, and cancelled is final", () => {
    for (const s of ["not_started", "in_progress", "handed_over"] as const) {
      expect(applyHandover(runbook(s), { type: "CANCEL" }).record.state).toBe("cancelled");
    }
    expect(applyHandover(runbook("cancelled"), { type: "CANCEL" }).outcome.ok).toBe(false);
    expect(applyHandover(runbook("cancelled"), { type: "STEPS_DONE", done: 3 }).outcome.ok).toBe(false);
  });

  it("refuses steps once handed over", () => {
    expect(applyHandover(runbook("handed_over", 4), { type: "STEPS_DONE", done: 4 }).outcome).toMatchObject({
      ok: false,
      reason: "no arrow from handed_over on STEPS_DONE",
    });
  });
});

describe("use case 1: 'Jodian has the runbook already'", () => {
  it("completes one step (2 of 4 to 3 of 4) and does not make Jodian cover", () => {
    const before = runbook();
    const after = applyHandover(before, { type: "STEPS_DONE", done: 3 }).record;
    expect(after).toEqual({ ...before, stepsDone: 3 });
    expect(Object.keys(after).some((k) => k.toLowerCase().includes("cover"))).toBe(false);
  });
});

describe("handovers keep their rules", () => {
  const event = fc.oneof(
    fc.integer({ min: -1, max: 6 }).map((done): HandoverEvent => ({ type: "STEPS_DONE", done })),
    fc.constant<HandoverEvent>({ type: "CANCEL" }),
  );

  it("steps never go back or past the total; handed over exactly at m of m; people never change", () => {
    fc.assert(
      fc.property(fc.constantFrom(...HANDOVER_STATES), fc.array(event, { maxLength: 20 }), (start, events) => {
        let record = runbook(start, start === "not_started" ? 0 : start === "handed_over" ? 4 : 2);
        for (const e of events) {
          const r = applyHandover(record, e);
          if (!r.outcome.ok) expect(r.record).toBe(record);
          expect(r.record.stepsDone).toBeGreaterThanOrEqual(record.stepsDone);
          expect(r.record.stepsDone).toBeLessThanOrEqual(r.record.stepsTotal);
          if (r.record.state !== "cancelled") expect(r.record.state === "handed_over").toBe(r.record.stepsDone === r.record.stepsTotal);
          expect([r.record.fromPersonId, r.record.toPersonId]).toEqual(["kemar", "jodian"]);
          record = r.record;
        }
      }),
      { numRuns: 2000 },
    );
  });
});
