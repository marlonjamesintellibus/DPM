import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { worst, type Status } from "../status/status";
import {
  applySetStatus,
  displayedStatus,
  NO_SET_STATUS,
  setStatusCause,
  type SetStatusEvent,
  type SetStatusRecord,
} from "./set-status";

const set = (record: SetStatusRecord, calculated: Status | null, event: SetStatusEvent) => applySetStatus(record, calculated, event);

describe("set status arrows", () => {
  it("setting a status that differs from the plan asks for a reason (ReasonRule)", () => {
    const r = set(NO_SET_STATUS, "on_track", { type: "OWNER_SETS", status: "off_track" });
    expect(r.outcome.ok).toBe(true);
    expect(r.record).toEqual({ override: "reason_required", setStatus: "off_track", reasonGivenAt: null });
    expect(setStatusCause(r.record)).toBe("status_set_with_no_reason");
  });

  it("refuses to override finished work (DoneWins, E43)", () => {
    const r = set(NO_SET_STATUS, "done", { type: "OWNER_SETS", status: "off_track" });
    expect(r.outcome.ok).toBe(false);
    expect(r.record).toBe(NO_SET_STATUS);
  });

  it("refuses Not started and Done as hand-set statuses", () => {
    expect(set(NO_SET_STATUS, "on_track", { type: "OWNER_SETS", status: "done" }).outcome.ok).toBe(false);
    expect(set(NO_SET_STATUS, "on_track", { type: "OWNER_SETS", status: "not_started" }).outcome.ok).toBe(false);
  });

  it("stores nothing when the set status matches the plan, and refuses setting the same status twice (E44)", () => {
    expect(set(NO_SET_STATUS, "at_risk", { type: "OWNER_SETS", status: "at_risk" }).outcome.ok).toBe(false);
    const once = set(NO_SET_STATUS, "at_risk", { type: "OWNER_SETS", status: "off_track" }).record;
    expect(set(once, "at_risk", { type: "OWNER_SETS", status: "off_track" }).outcome.ok).toBe(false);
  });

  it("a reason must link at least one BRAID entry on the log", () => {
    const required = set(NO_SET_STATUS, "at_risk", { type: "OWNER_SETS", status: "off_track" }).record;
    expect(set(required, "at_risk", { type: "GIVE_REASON", linksOnLog: 0 }).outcome.ok).toBe(false);
    const explained = set(required, "at_risk", { type: "GIVE_REASON", linksOnLog: 2 }).record;
    expect(explained).toEqual({ override: "explained", setStatus: "off_track", reasonGivenAt: "at_risk" });
    expect(displayedStatus(explained, "at_risk")).toBe("off_track");
  });

  it('"Use At risk instead" clears the set status', () => {
    const required = set(NO_SET_STATUS, "at_risk", { type: "OWNER_SETS", status: "off_track" }).record;
    expect(set(required, "at_risk", { type: "OWNER_SETS", status: "at_risk" }).record).toEqual(NO_SET_STATUS);
  });

  it("refuses arrows that are not drawn", () => {
    expect(set(NO_SET_STATUS, "on_track", { type: "GIVE_REASON", linksOnLog: 1 }).outcome).toMatchObject({ ok: false });
    expect(set(NO_SET_STATUS, "on_track", { type: "KEEP" }).outcome).toMatchObject({ ok: false });
  });
});

describe("use case 1: Off track survives Kemar's save (machine map story)", () => {
  it("replays the six steps", () => {
    let rec = NO_SET_STATUS;
    let calc: Status = "on_track";
    const change = (next: Status) => {
      rec = set(rec, calc, { type: "CALCULATED_CHANGED", previous: calc, next }).record;
      calc = next;
    };
    rec = set(rec, calc, { type: "OWNER_SETS", status: "off_track" }).record; // 9:02 Alicia sets Off track
    expect(setStatusCause(rec)).toBe("status_set_with_no_reason");
    change("at_risk"); // Kemar saves: plan moves to At risk (E40)
    expect(rec.setStatus).toBe("off_track");
    expect(displayedStatus(rec, calc)).toBe("at_risk");
    rec = set(rec, calc, { type: "GIVE_REASON", linksOnLog: 2 }).record; // reason saved
    expect(displayedStatus(rec, calc)).toBe("off_track");
    change("at_risk"); // store feed opens: plan unchanged, reason stands
    expect(rec.override).toBe("explained");
    change("on_track"); // trend model back on plan (E42)
    expect(rec.override).toBe("reason_stale");
    expect(setStatusCause(rec)).toBe("keep_set_status");
    expect(rec.reasonGivenAt).toBe("at_risk");
    rec = set(rec, calc, { type: "OWNER_SETS", status: "on_track" }).record; // Alicia uses On track
    expect(rec).toEqual(NO_SET_STATUS);
  });
});

// Property test: random runs of the same moves as the TrackedStatus model, holding its properties.
describe("set status keeps the model-checked properties", () => {
  const CHILD_MOVES: Record<Status, Status[]> = {
    not_started: ["on_track"],
    on_track: ["at_risk", "done"],
    at_risk: ["on_track", "off_track", "done"],
    off_track: ["at_risk", "done"],
    done: [],
  };
  const step = fc.oneof(
    fc.record({ kind: fc.constant("child" as const), i: fc.integer({ min: 0, max: 2 }), pick: fc.nat() }),
    fc.record({ kind: fc.constant("set" as const), status: fc.constantFrom<Status>("on_track", "at_risk", "off_track") }),
    fc.record({ kind: fc.constant("reason" as const) }),
    fc.record({ kind: fc.constant("keep" as const) }),
  );

  it("ReasonRule, OverrideConsistent, NoSilentDisagreement, DoneWins, StaleReasonAsked, SetStatusRespected, StaleReasonFlagged", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const child: Status[] = ["not_started", "not_started", "not_started"];
        let rec: SetStatusRecord = NO_SET_STATUS;
        for (const s of steps) {
          const before = { rec, calc: worst(child) };
          if (s.kind === "child") {
            const options = CHILD_MOVES[child[s.i]];
            if (!options.length) continue;
            child[s.i] = options[s.pick % options.length];
            rec = applySetStatus(rec, worst(child), { type: "CALCULATED_CHANGED", previous: before.calc, next: worst(child) }).record;
          } else if (s.kind === "set") {
            rec = applySetStatus(rec, before.calc, { type: "OWNER_SETS", status: s.status }).record;
          } else if (s.kind === "reason") {
            rec = applySetStatus(rec, before.calc, { type: "GIVE_REASON", linksOnLog: 1 }).record;
          } else {
            rec = applySetStatus(rec, before.calc, { type: "KEEP" }).record;
          }
          const calc = worst(child);
          const hasReason = rec.override === "explained" || rec.override === "reason_stale";
          // ReasonRule: a disagreement is explained, or waiting in the owner's inbox
          if (rec.setStatus && rec.setStatus !== calc) expect(hasReason || setStatusCause(rec) === "status_set_with_no_reason").toBe(true);
          // OverrideConsistent
          expect(rec.override === "calculated_only").toBe(rec.setStatus === null);
          // NoSilentDisagreement: the screen never shows a status nobody explained
          if (displayedStatus(rec, calc) !== calc) expect(hasReason).toBe(true);
          // DoneWins
          if (calc === "done") expect(displayedStatus(rec, calc)).toBe("done");
          // StaleReasonAsked
          if (rec.override === "reason_stale") expect(setStatusCause(rec)).toBe("keep_set_status");
          if (s.kind === "child") {
            // SetStatusRespected: a rule clears a set status only when the plan agrees or the work is Done
            if (before.rec.setStatus && !rec.setStatus) expect([before.rec.setStatus, "done"]).toContain(calc);
            // StaleReasonFlagged: a reason never silently explains a plan that has since moved
            if (before.rec.override === "explained" && rec.setStatus && calc !== before.calc) expect(rec.override).toBe("reason_stale");
          }
        }
      }),
      { numRuns: 2000 },
    );
  });
});
