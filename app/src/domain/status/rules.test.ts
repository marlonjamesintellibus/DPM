// Conversational plan phase C, "Needed first": the status rules say which fact gave each status. The
// statuses themselves are tested in core.test.ts and stay as they were; these check the facts agree.
import { describe, expect, it } from "vitest";
import { calculatePlan, explainPlan, milestoneStatus, milestoneWhy, workItemStatus, workItemWhy, type MilestoneState, type WorkItemState } from "./rules";

const today = "2026-10-20";

describe("work items say why", () => {
  it.each([
    [{ state: "in_progress", dueDate: null }, null, "no_target", 0],
    [{ state: "cancelled", dueDate: "2026-10-22" }, null, "no_target", 0],
    [{ state: "done", dueDate: "2026-10-01" }, "done", "done", 0],
    [{ state: "blocked", dueDate: "2026-10-18" }, "off_track", "past_due", 2],
    [{ state: "blocked", dueDate: "2026-10-22" }, "at_risk", "blocked", 0],
    [{ state: "to_do", dueDate: "2026-10-22" }, "not_started", "to_do", 0],
    [{ state: "in_progress", dueDate: "2026-10-20" }, "on_track", "moving", 0],
  ] as const)("%o is %s because %s", (item, status, because, daysLate) => {
    const w = item as { state: WorkItemState; dueDate: string | null };
    expect(workItemWhy(w, today)).toEqual({ status, because, daysLate });
    expect(workItemStatus(w, today)).toBe(status);
  });
});

describe("milestones say why", () => {
  const m = { state: "in_progress" as MilestoneState, targetDate: "2026-10-23" };
  it.each([
    [{ ...m, forecastDate: null }, "on_track", "on_target", 0],
    [{ ...m, forecastDate: "2026-10-21" }, "on_track", "on_target", 0],
    [{ ...m, forecastDate: "2026-10-24" }, "at_risk", "after_target", 1],
    [{ ...m, forecastDate: "2026-10-27" }, "off_track", "beyond_tolerance", 4],
    [{ ...m, state: "missed" as MilestoneState, forecastDate: null }, "off_track", "missed", 0],
    [{ ...m, state: "done" as MilestoneState, forecastDate: "2026-10-30" }, "done", "done", 7],
  ] as const)("%o is %s because %s", (milestone, status, because, daysLate) => {
    expect(milestoneWhy(milestone, 3)).toEqual({ status, because, daysLate, toleranceDays: 3 });
    expect(milestoneStatus(milestone, 3)).toBe(status);
  });
});

describe("a plan says which rows gave it its status", () => {
  const rows = {
    threads: [{ id: "a" }, { id: "b" }],
    milestones: [
      { id: "ms-1", threadId: "a", state: "in_progress" as const, targetDate: "2026-10-23", forecastDate: "2026-10-24" },
      { id: "ms-2", threadId: "b", state: "planned" as const, targetDate: "2026-10-30", forecastDate: null },
    ],
    workItems: [
      { id: "w-1", threadId: "a", state: "blocked" as const, dueDate: "2026-10-22" },
      { id: "w-2", threadId: "b", state: "in_progress" as const, dueDate: "2026-10-22" },
      { id: "w-3", threadId: null, state: "to_do" as const, dueDate: null },
    ],
  };

  it("the same statuses as calculatePlan, and the rows as bad as the worst, milestones first, with their ids", () => {
    const explained = explainPlan(rows, today);
    expect({ threads: explained.threads, project: explained.project }).toEqual(calculatePlan(rows, today));
    expect(explained.project).toBe("at_risk");
    expect(explained.facts.map((f) => [f.type, f.row.id, f.why.because])).toEqual([
      ["milestone", "ms-1", "after_target"],
      ["work_item", "w-1", "blocked"],
    ]);
  });

  it("a plan with nothing that has a target has no status and no facts", () => {
    expect(explainPlan({ threads: [], milestones: [], workItems: [{ threadId: null, state: "to_do", dueDate: null }] }, today)).toEqual({ threads: {}, project: null, facts: [] });
  });
});
