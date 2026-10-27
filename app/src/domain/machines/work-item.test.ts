import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { threadStatus, workItemStatus, type WorkItemState } from "../status/rules";
import type { Actor } from "./membership";
import { applyWorkItem, WORK_ITEM_STATES, workItemEventTo, type WorkItemEvent, type WorkItemRecord } from "./work-item";

const KEMAR: Actor = { personId: "kemar", role: "member" };
const ALICIA: Actor = { personId: "alicia", role: "pm" };
const JODIAN: Actor = { personId: "jodian", role: "member" };

const item = (state: WorkItemState, over: Partial<WorkItemRecord> = {}): WorkItemRecord => ({
  id: "151",
  projectId: "forager",
  ownerId: "kemar",
  state,
  dueDate: "2026-10-23",
  forecastDate: null,
  blockedNote: state === "blocked" ? "waiting on Kyle" : null,
  blockedLinks: [],
  ...over,
});
const apply = (record: WorkItemRecord, event: WorkItemEvent, actor: Actor = KEMAR) => applyWorkItem(record, event, actor);

describe("work item arrows", () => {
  it("to_do -> in_progress -> done", () => {
    const started = apply(item("to_do"), { type: "START" });
    expect(started.outcome).toMatchObject({ ok: true, to: "in_progress" });
    expect(apply(started.record, { type: "FINISH" }).record.state).toBe("done");
  });

  it("S2: to_do -> done and blocked -> done are drawn", () => {
    expect(apply(item("to_do"), { type: "FINISH" }).outcome).toMatchObject({ ok: true, from: "to_do", to: "done" });
    const done = apply(item("blocked"), { type: "FINISH" });
    expect(done.outcome).toMatchObject({ ok: true, from: "blocked", to: "done" });
    expect(done.record.blockedNote).toBeNull();
  });

  it("blocking carries a note and its BRAID links; unblocking clears the note and keeps the links (E93)", () => {
    const blocked = apply(item("in_progress"), { type: "BLOCK", note: " waiting on Kyle (Sprouts IT) ", links: ["dep-1", "blk-1"] });
    expect(blocked.record).toMatchObject({ state: "blocked", blockedNote: "waiting on Kyle (Sprouts IT)", blockedLinks: ["dep-1", "blk-1"] });
    const unblocked = apply(blocked.record, { type: "UNBLOCK" });
    // The links say which blockers held this work, so its owner may resolve them (S13)
    expect(unblocked.record).toMatchObject({ state: "in_progress", blockedNote: null, blockedLinks: ["dep-1", "blk-1"] });
  });

  it("refuses a block with no note", () => {
    const record = item("in_progress");
    const r = apply(record, { type: "BLOCK", note: "  " });
    expect(r.outcome).toMatchObject({ ok: false, reason: "a blocked item says what it is waiting on" });
    expect(r.record).toBe(record);
  });

  it("a blocked item's note can be refreshed and keeps its links unless new ones are given", () => {
    const record = item("blocked", { blockedLinks: ["blk-1"] });
    expect(apply(record, { type: "UPDATE_BLOCKED_NOTE", note: "Kyle says Friday" }).record).toMatchObject({
      state: "blocked",
      blockedNote: "Kyle says Friday",
      blockedLinks: ["blk-1"],
    });
  });

  it("reopen is for the owner, a PM or a Lead only", () => {
    const done = item("done");
    expect(apply(done, { type: "REOPEN" }, KEMAR).outcome).toMatchObject({ ok: true, to: "in_progress" });
    expect(apply(done, { type: "REOPEN" }, ALICIA).outcome.ok).toBe(true);
    expect(apply(done, { type: "REOPEN" }, { personId: "andre", role: "lead" }).outcome.ok).toBe(true);
    const refused = apply(done, { type: "REOPEN" }, JODIAN);
    expect(refused.outcome).toMatchObject({ ok: false, reason: "only the owner, a PM or a Lead reopens finished work" });
    expect(refused.record).toBe(done);
  });

  it("anything can be cancelled, and cancelled is final", () => {
    for (const s of ["to_do", "in_progress", "blocked", "done"] as const) {
      expect(apply(item(s), { type: "CANCEL" }).record).toMatchObject({ state: "cancelled", blockedNote: null });
    }
    const events: WorkItemEvent[] = [
      { type: "START" },
      { type: "FINISH" },
      { type: "BLOCK", note: "x" },
      { type: "UNBLOCK" },
      { type: "REOPEN" },
      { type: "CANCEL" },
    ];
    for (const e of events) expect(apply(item("cancelled"), e, ALICIA).outcome.ok).toBe(false);
  });

  it("refuses arrows that are not drawn", () => {
    expect(apply(item("to_do"), { type: "BLOCK", note: "x" }).outcome).toMatchObject({ ok: false, reason: "no arrow from to_do on BLOCK" });
    expect(apply(item("in_progress"), { type: "START" }).outcome.ok).toBe(false);
    expect(apply(item("in_progress"), { type: "UNBLOCK" }).outcome.ok).toBe(false);
    expect(apply(item("in_progress"), { type: "REOPEN" }).outcome.ok).toBe(false);
    expect(apply(item("done"), { type: "FINISH" }).outcome.ok).toBe(false);
    expect(apply(item("done"), { type: "BLOCK", note: "x" }).outcome.ok).toBe(false);
  });

  it("workItemEventTo finds the event behind an update's old and new value", () => {
    expect(workItemEventTo("in_progress", "done")).toEqual({ type: "FINISH" });
    expect(workItemEventTo("in_progress", "blocked", "waiting on Kyle")).toEqual({ type: "BLOCK", note: "waiting on Kyle" });
    expect(workItemEventTo("blocked", "blocked", "Kyle says Friday")).toEqual({ type: "UPDATE_BLOCKED_NOTE", note: "Kyle says Friday" });
    expect(workItemEventTo("blocked", "in_progress")).toEqual({ type: "UNBLOCK" });
    expect(workItemEventTo("done", "in_progress")).toEqual({ type: "REOPEN" });
    expect(workItemEventTo("in_progress", "to_do")).toBeNull();
    expect(workItemEventTo("done", "done")).toBeNull();
  });
});

describe("work item edge cases", () => {
  it("E27 an illegal arrow on the target is refused and changes nothing", () => {
    const record = item("to_do");
    const r = apply(record, { type: "UNBLOCK" });
    expect(r.outcome.ok).toBe(false);
    expect(r.record).toBe(record);
  });

  it("E50 a work item with no due date has no status, whatever its state", () => {
    let record = item("to_do", { dueDate: null });
    for (const e of [{ type: "START" }, { type: "BLOCK", note: "x" }, { type: "FINISH" }] as const) {
      record = apply(record, e).record;
      expect(workItemStatus(record, "2026-10-20")).toBeNull();
    }
  });

  it("E51 a thread with only cancelled items has no target and does not drag the project", () => {
    const cancelled = [item("in_progress"), item("blocked")].map((r) => apply(r, { type: "CANCEL" }).record);
    expect(threadStatus(cancelled.map((r) => workItemStatus(r, "2026-10-30")))).toBeNull();
  });
});

// Property test: random events by random people, holding the table's rules on every step.
describe("work items keep their rules", () => {
  const actor = fc.constantFrom(KEMAR, ALICIA, JODIAN);
  const event = fc.oneof(
    fc.constantFrom<WorkItemEvent>({ type: "START" }, { type: "FINISH" }, { type: "UNBLOCK" }, { type: "REOPEN" }, { type: "CANCEL" }),
    fc.string({ maxLength: 4 }).map((note): WorkItemEvent => ({ type: "BLOCK", note })),
    fc.string({ maxLength: 4 }).map((note): WorkItemEvent => ({ type: "UPDATE_BLOCKED_NOTE", note })),
  );

  it("a note exactly while blocked; refusals change nothing; reopen only by owner or lead; cancelled is final", () => {
    fc.assert(
      fc.property(fc.constantFrom(...WORK_ITEM_STATES), fc.array(fc.tuple(event, actor), { maxLength: 30 }), (start, steps) => {
        let record = item(start);
        for (const [e, who] of steps) {
          const r = applyWorkItem(record, e, who);
          if (!r.outcome.ok) expect(r.record).toBe(record);
          if (record.state === "cancelled") expect(r.outcome.ok).toBe(false);
          if (r.outcome.ok && record.state === "done" && r.record.state === "in_progress") {
            expect(who.personId === record.ownerId || who.role === "pm" || who.role === "lead").toBe(true);
          }
          record = r.record;
          expect(record.blockedNote !== null).toBe(record.state === "blocked");
          if (record.blockedNote !== null) expect(record.blockedNote.trim()).not.toBe("");
        }
      }),
      { numRuns: 2000 },
    );
  });
});

// Section 20, U6 (research model workForecast.mjs): a forecast is its owner's; Done clears it; it never hides a missed due date
describe("a work item's forecast (section 20, U6)", () => {
  it("only its owner sets it, on work not finished", () => {
    expect(apply(item("in_progress"), { type: "SET_FORECAST", forecast: "2026-10-26" }).record.forecastDate).toBe("2026-10-26");
    expect(apply(item("in_progress"), { type: "SET_FORECAST", forecast: "2026-10-26" }, JODIAN).outcome.ok).toBe(false);
    expect(apply(item("in_progress"), { type: "SET_FORECAST", forecast: "2026-10-26" }, ALICIA).outcome.ok).toBe(false);
    expect(apply(item("done"), { type: "SET_FORECAST", forecast: "2026-10-26" }).outcome.ok).toBe(false);
  });

  it("DoneHasNoForecast: finishing clears it", () => {
    const r = apply(item("in_progress", { forecastDate: "2026-10-26" }), { type: "FINISH" });
    expect([r.record.state, r.record.forecastDate]).toEqual(["done", null]);
  });

  it("the status: at risk when forecast after due, off track beyond the tolerance, and a forecast never hides a missed due date", () => {
    const w = (forecastDate: string | null, state: WorkItemState = "in_progress") => ({ state, dueDate: "2026-10-23", forecastDate });
    expect(workItemStatus(w("2026-10-23"), "2026-10-21")).toBe("on_track");
    expect(workItemStatus(w("2026-10-26"), "2026-10-21")).toBe("at_risk");
    expect(workItemStatus(w("2026-10-27"), "2026-10-21")).toBe("off_track");
    // ForecastNeverHidesLate: past due and not done is Off track whatever the forecast says
    expect(workItemStatus(w("2026-10-30"), "2026-10-26")).toBe("off_track");
    expect(workItemStatus(w("2026-10-21", "to_do"), "2026-10-20")).toBe("not_started");
  });

  it("property: past due and not done is always Off track (ForecastNeverHidesLate)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.option(fc.integer({ min: 0, max: 30 })), fc.constantFrom<WorkItemState>("to_do", "in_progress", "blocked"), (late, f, state) => {
        const today = `2026-10-${String(23 + Math.min(late, 8)).padStart(2, "0")}`;
        const forecastDate = f === null ? null : `2026-11-${String(1 + (f % 28)).padStart(2, "0")}`;
        expect(workItemStatus({ state, dueDate: "2026-10-23", forecastDate }, today)).toBe("off_track");
      }),
    );
  });
});
