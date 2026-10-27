import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, dateInZone, daysBetween, weekday } from "../dates";
import { milestoneStatus, type MilestoneState } from "../status/rules";
import type { Actor } from "./membership";
import { applyMilestone, ASK_THE_OWNER, forecastChangeBy, MILESTONE_STATES, type MilestoneEvent, type MilestoneRecord } from "./milestone";

const KEMAR: Actor = { personId: "kemar", role: "member" };
const ALICIA: Actor = { personId: "alicia", role: "pm" };

// The trend model milestone: Kemar owns it, target 23 Oct
const trend = (state: MilestoneState = "in_progress", over: Partial<MilestoneRecord> = {}): MilestoneRecord => ({
  id: "trend-model",
  projectId: "forager",
  ownerId: "kemar",
  state,
  targetDate: "2026-10-23",
  forecastDate: null,
  ...over,
});
// 00:00 on a date in America/Jamaica (UTC-5, no daylight saving)
const midnightJamaica = (date: string) => new Date(`${date}T05:00:00Z`);

describe("milestone arrows", () => {
  it("planned -> in_progress -> done", () => {
    const started = applyMilestone(trend("planned"), { type: "START" }, KEMAR);
    expect(started.outcome).toMatchObject({ ok: true, to: "in_progress" });
    expect(applyMilestone(started.record, { type: "FINISH" }, KEMAR).record.state).toBe("done");
  });

  it("in_progress -> missed when the target date passes, and missed -> done", () => {
    const missed = applyMilestone(trend(), { type: "TARGET_PASSED", at: midnightJamaica("2026-10-24") }, null);
    expect(missed.outcome).toMatchObject({ ok: true, to: "missed" });
    expect(milestoneStatus(missed.record)).toBe("off_track");
    expect(applyMilestone(missed.record, { type: "FINISH" }, KEMAR).record.state).toBe("done");
  });

  it("is not missed on its target date", () => {
    const r = applyMilestone(trend(), { type: "TARGET_PASSED", at: midnightJamaica("2026-10-23") }, null);
    expect(r.outcome).toMatchObject({ ok: false, reason: "the target date has not passed in America/Jamaica" });
  });

  it("the owner moves the forecast; the state stays and the status follows (L16 #4)", () => {
    const r = applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "2026-10-24" }, KEMAR);
    expect(r.outcome).toMatchObject({ ok: true, from: "in_progress", to: "in_progress" });
    expect(r.record).toMatchObject({ state: "in_progress", forecastDate: "2026-10-24", targetDate: "2026-10-23" });
    expect(milestoneStatus(r.record)).toBe("at_risk");
  });

  it("S5: anyone else's forecast change is refused with 'ask the owner'", () => {
    const record = trend();
    const r = applyMilestone(record, { type: "FORECAST_CHANGED", forecast: "2026-10-24" }, ALICIA);
    expect(r.outcome).toMatchObject({ ok: false, reason: ASK_THE_OWNER });
    expect(r.record).toBe(record);
    expect(forecastChangeBy(record, ALICIA)).toBe("ask_owner");
    expect(forecastChangeBy(record, KEMAR)).toBe("edit");
  });

  it("refuses a forecast that is not a date, or the same forecast again", () => {
    expect(applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "Friday" }, KEMAR).outcome.ok).toBe(false);
    const moved = applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "2026-10-24" }, KEMAR).record;
    expect(applyMilestone(moved, { type: "FORECAST_CHANGED", forecast: "2026-10-24" }, KEMAR).outcome.ok).toBe(false);
  });

  it("D5 a planned milestone whose target passes is missed, and finishing it still moves it to done", () => {
    const missed = applyMilestone(trend("planned"), { type: "TARGET_PASSED", at: midnightJamaica("2026-11-01") }, null).record;
    expect(missed.state).toBe("missed");
    expect(applyMilestone(trend("planned"), { type: "TARGET_PASSED", at: midnightJamaica("2026-10-23") }, null).outcome.ok).toBe(false);
    expect(applyMilestone(missed, { type: "FINISH" }, KEMAR).record.state).toBe("done");
  });

  it("refuses arrows that are not drawn", () => {
    expect(applyMilestone(trend("planned"), { type: "FINISH" }, KEMAR).outcome.ok).toBe(false);
    expect(applyMilestone(trend("done"), { type: "FORECAST_CHANGED", forecast: "2026-10-30" }, KEMAR).outcome.ok).toBe(false);
    expect(applyMilestone(trend("done"), { type: "START" }, KEMAR).outcome.ok).toBe(false);
    expect(applyMilestone(trend("missed"), { type: "TARGET_PASSED", at: midnightJamaica("2026-11-01") }, null).outcome.ok).toBe(false);
  });
});

describe("milestone edge cases", () => {
  it("E52 a forecast on a weekend is allowed, and tolerance counts calendar days (S9)", () => {
    expect(weekday("2026-10-24")).toBe("Saturday");
    const r = applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "2026-10-24" }, KEMAR);
    expect(r.outcome.ok).toBe(true);
    expect(milestoneStatus(applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "2026-10-26" }, KEMAR).record)).toBe("at_risk");
    expect(milestoneStatus(applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "2026-10-27" }, KEMAR).record)).toBe("off_track");
  });

  it("E53 a forecast earlier than the target is On track", () => {
    expect(milestoneStatus(applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "2026-10-21" }, KEMAR).record)).toBe("on_track");
  });

  it("E54 a forecast past a release date makes the milestone Off track and leaves the release alone", () => {
    const release = trend("in_progress", { id: "release-1", targetDate: "2026-10-30" });
    const r = applyMilestone(trend(), { type: "FORECAST_CHANGED", forecast: "2026-10-31" }, KEMAR);
    expect(milestoneStatus(r.record)).toBe("off_track");
    expect(r.record.targetDate).toBe("2026-10-23");
    expect(milestoneStatus(release)).toBe("on_track");
  });

  it("E55 the target date is read in the org time zone, which is an input", () => {
    // 22:00 on 23 Oct in Jamaica is already 24 Oct in UTC
    const at = new Date("2026-10-24T03:00:00Z");
    expect(applyMilestone(trend(), { type: "TARGET_PASSED", at }, null, "America/Jamaica").outcome.ok).toBe(false);
    expect(applyMilestone(trend(), { type: "TARGET_PASSED", at }, null, "UTC").outcome.ok).toBe(true);
  });
});

// Property test: random events, holding the target, the owner rule and the missed rule on every step.
describe("milestones keep their rules", () => {
  const actor = fc.constantFrom<Actor | null>(KEMAR, ALICIA, null);
  const day = fc.integer({ min: -10, max: 15 }).map((d) => addDays("2026-10-23", d));
  const event = fc.oneof(
    fc.constantFrom<MilestoneEvent>({ type: "START" }, { type: "FINISH" }),
    day.map((d): MilestoneEvent => ({ type: "TARGET_PASSED", at: midnightJamaica(d) })),
    day.map((forecast): MilestoneEvent => ({ type: "FORECAST_CHANGED", forecast })),
  );

  it("the target never changes; only the owner moves the forecast; missed only after the target date; done is final", () => {
    fc.assert(
      fc.property(fc.constantFrom(...MILESTONE_STATES), fc.array(fc.tuple(event, actor), { maxLength: 30 }), (start, steps) => {
        let record = trend(start);
        for (const [e, who] of steps) {
          const r = applyMilestone(record, e, who);
          if (!r.outcome.ok) expect(r.record).toBe(record);
          expect(r.record.targetDate).toBe("2026-10-23");
          if (r.record.forecastDate !== record.forecastDate) expect(who?.personId).toBe("kemar");
          if (r.record.state === "missed" && record.state !== "missed" && e.type === "TARGET_PASSED") {
            expect(daysBetween(record.targetDate, dateInZone(e.at, "America/Jamaica"))).toBeGreaterThan(0);
          }
          if (record.state === "done") expect(r.record).toBe(record);
          record = r.record;
        }
      }),
      { numRuns: 2000 },
    );
  });
});
