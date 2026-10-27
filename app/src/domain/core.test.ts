import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isIsoDate, weekday } from "./dates";
import { defineMachine, eventsFrom, transition } from "./machine";
import { BRAID_KINDS, landsAs, mayDecide, mayReport, mayResolve, needsApproval } from "./rights";
import { milestoneStatus, projectCalculatedStatus, threadStatus, workItemStatus } from "./status/rules";
import { worst } from "./status/status";

describe("transition engine", () => {
  type S = "a" | "b";
  type E = { type: "GO" } | { type: "STOP" };
  const m = defineMachine<S, E, { allowed: boolean }>({
    name: "test",
    states: ["a", "b"],
    arrows: [{ from: ["a"], on: "GO", to: "b", guard: (ctx) => (ctx.allowed ? null : "not allowed") }],
  });

  it("moves along a drawn arrow whose guard passes", () => {
    expect(transition(m, "a", { type: "GO" }, { allowed: true })).toEqual({ ok: true, machine: "test", event: "GO", from: "a", to: "b" });
  });

  it("refuses with the guard's reason", () => {
    expect(transition(m, "a", { type: "GO" }, { allowed: false })).toMatchObject({ ok: false, reason: "not allowed" });
  });

  it("refuses an arrow that is not drawn", () => {
    expect(transition(m, "b", { type: "GO" }, { allowed: true })).toMatchObject({ ok: false, reason: "no arrow from b on GO" });
    expect(eventsFrom(m, "b")).toEqual([]);
  });

  it("rejects a table that names an unknown state", () => {
    expect(() => defineMachine<S, E, null>({ name: "bad", states: ["a", "b"], arrows: [{ from: ["a"], on: "GO", to: "c" as S }] })).toThrow(/unknown state/);
  });
});

describe("dates", () => {
  it("counts calendar days and knows weekdays", () => {
    expect(daysBetween("2026-10-23", "2026-10-24")).toBe(1);
    expect(daysBetween("2026-10-24", "2026-10-23")).toBe(-1);
    expect(addDays("2026-10-20", 6)).toBe("2026-10-26");
    expect(weekday("2026-10-20")).toBe("Tuesday");
    expect(weekday("2026-10-26")).toBe("Monday");
  });

  it("rejects dates that do not exist", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26 Oct")).toBe(false);
  });
});

describe("calculated status rules (M12)", () => {
  const today = "2026-10-20";

  it("work items", () => {
    expect(workItemStatus({ state: "in_progress", dueDate: null }, today)).toBeNull(); // E50
    expect(workItemStatus({ state: "cancelled", dueDate: "2026-10-22" }, today)).toBeNull();
    expect(workItemStatus({ state: "done", dueDate: "2026-10-01" }, today)).toBe("done");
    expect(workItemStatus({ state: "blocked", dueDate: "2026-10-19" }, today)).toBe("off_track"); // E49
    expect(workItemStatus({ state: "blocked", dueDate: "2026-10-22" }, today)).toBe("at_risk");
    expect(workItemStatus({ state: "to_do", dueDate: "2026-10-22" }, today)).toBe("not_started");
    expect(workItemStatus({ state: "in_progress", dueDate: "2026-10-20" }, today)).toBe("on_track");
  });

  it("milestones: Kemar's trend model forecast moves one day (story step 5)", () => {
    const m = { state: "in_progress" as const, targetDate: "2026-10-23" };
    expect(milestoneStatus({ ...m, forecastDate: null })).toBe("on_track");
    expect(milestoneStatus({ ...m, forecastDate: "2026-10-24" })).toBe("at_risk"); // E52: a Saturday is fine
    expect(milestoneStatus({ ...m, forecastDate: "2026-10-27" }, 3)).toBe("off_track");
    expect(milestoneStatus({ ...m, forecastDate: "2026-10-21" })).toBe("on_track"); // E53
    expect(milestoneStatus({ ...m, state: "missed", forecastDate: null })).toBe("off_track");
  });

  it("roll-up is worst child, ignoring children with no target (E51)", () => {
    expect(worst(["on_track", "off_track", "at_risk"])).toBe("off_track");
    expect(worst(["done", "not_started"])).toBe("not_started");
    expect(threadStatus([null, null])).toBeNull();
    expect(projectCalculatedStatus(["on_track", null, "at_risk"])).toBe("at_risk");
  });
});

describe("rights table (S10 to S13)", () => {
  it("anyone on the project can report any kind", () => {
    for (const kind of BRAID_KINDS) expect(mayReport("member", kind)).toBe(true);
  });

  it("only a PM or Lead approves risks, assumptions, dependencies and decisions", () => {
    for (const kind of ["risk", "assumption", "dependency", "decision"] as const) {
      expect(needsApproval(kind)).toBe(true);
      expect(mayDecide("pm", kind)).toBe(true);
      expect(mayDecide("lead", kind)).toBe(true);
      expect(mayDecide("member", kind)).toBe(false);
    }
    expect(needsApproval("blocker")).toBe(false);
    expect(needsApproval("issue")).toBe(false);
  });

  it("a blocker is resolved by the owner of the blocked work or a PM or Lead (S13)", () => {
    expect(mayResolve({ role: "member", isOwner: true }, "blocker")).toBe(true);
    expect(mayResolve({ role: "member", isOwner: false }, "blocker")).toBe(false);
    expect(mayResolve({ role: "lead", isOwner: false }, "blocker")).toBe(true);
  });

  it("where a new entry lands (E92, S12)", () => {
    expect(landsAs("blocker", "member")).toBe("reported");
    expect(landsAs("risk", "member")).toBe("proposed");
    expect(landsAs("risk", "pm")).toBe("on_log");
    expect(landsAs("decision", "pm")).toBe("proposed"); // decisions are always approved explicitly
  });
});
