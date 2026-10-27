// Calculated status rules (machines doc M12, KB A10.2). Statuses come from these
// rules only (P6): no model call, no stored value, recomputed on every read.
// Conversational plan phase C, "Needed first": each rule also says which fact gave the status, so
// "why" can say it (WY2). The status is always the one the fact gives; there is one rule, not two.
import { config } from "../config";
import { daysBetween, type IsoDate } from "../dates";
import { worst, type Status } from "./status";

export type WorkItemState = "to_do" | "in_progress" | "blocked" | "done" | "cancelled";
export type MilestoneState = "planned" | "in_progress" | "done" | "missed";

/** What the work item rule read: no target, done, past due (by daysLate), blocked, to do, or moving. */
export type WorkItemWhy = { status: Status | null; because: "no_target" | "done" | "past_due" | "blocked" | "to_do" | "moving"; daysLate: number };

/** What the milestone rule read: done, missed, its forecast against its target (daysLate after it), and the tolerance. */
export type MilestoneWhy = {
  status: Status;
  because: "done" | "missed" | "beyond_tolerance" | "after_target" | "on_target";
  daysLate: number;
  toleranceDays: number;
};

/** Done; Off track if past due and not done; At risk if blocked (ASSUMPTION); Not started if to do; else On track. */
export function workItemWhy(item: { state: WorkItemState; dueDate: IsoDate | null }, today: IsoDate): WorkItemWhy {
  if (item.state === "cancelled" || item.dueDate === null) return { status: null, because: "no_target", daysLate: 0 }; // E50, E51: no target
  if (item.state === "done") return { status: "done", because: "done", daysLate: 0 };
  const late = daysBetween(item.dueDate, today);
  if (late > 0) return { status: "off_track", because: "past_due", daysLate: late };
  if (item.state === "blocked") return { status: "at_risk", because: "blocked", daysLate: 0 };
  if (item.state === "to_do") return { status: "not_started", because: "to_do", daysLate: 0 };
  return { status: "on_track", because: "moving", daysLate: 0 };
}

export function workItemStatus(item: { state: WorkItemState; dueDate: IsoDate | null }, today: IsoDate): Status | null {
  return workItemWhy(item, today).status;
}

/** Done; Off track if missed or forecast beyond target + tolerance; At risk if forecast after target; else On track. */
export function milestoneWhy(
  milestone: { state: MilestoneState; targetDate: IsoDate; forecastDate: IsoDate | null },
  toleranceDays: number = config.milestoneToleranceDays,
): MilestoneWhy {
  const late = daysBetween(milestone.targetDate, milestone.forecastDate ?? milestone.targetDate);
  const why = (status: Status, because: MilestoneWhy["because"]): MilestoneWhy => ({ status, because, daysLate: Math.max(0, late), toleranceDays });
  if (milestone.state === "done") return why("done", "done");
  if (milestone.state === "missed") return why("off_track", "missed");
  if (late > toleranceDays) return why("off_track", "beyond_tolerance");
  if (late > 0) return why("at_risk", "after_target");
  return why("on_track", "on_target"); // E53: a forecast earlier than the target is On track
}

export function milestoneStatus(
  milestone: { state: MilestoneState; targetDate: IsoDate; forecastDate: IsoDate | null },
  toleranceDays: number = config.milestoneToleranceDays,
): Status {
  return milestoneWhy(milestone, toleranceDays).status;
}

/** A thread is the worst of its milestones and work items; null when nothing in it has a target. */
export function threadStatus(children: readonly (Status | null)[]): Status | null {
  return worst(children);
}

/** A project's calculated status is its worst thread (the set status is applied separately, see set-status). */
export function projectCalculatedStatus(threads: readonly (Status | null)[]): Status | null {
  return worst(threads);
}

type PlanMilestone = { threadId: string | null; state: MilestoneState; targetDate: IsoDate; forecastDate: IsoDate | null };
type PlanWorkItem = { threadId: string | null; state: WorkItemState; dueDate: IsoDate | null };

export type PlanRows = {
  threads: readonly { id: string }[];
  milestones: readonly PlanMilestone[];
  workItems: readonly PlanWorkItem[];
};

/** One row behind a plan's status, with what its rule read. */
export type PlanFact<M, W> = { type: "milestone"; row: M; why: MilestoneWhy } | { type: "work_item"; row: W; why: WorkItemWhy };

/**
 * The whole roll-up for one project from its rows (A4.2): each thread is the worst of its milestones
 * and work items, and the project is the worst thread. Items in no thread count at project level.
 * Phase C: facts are the rows that gave the project its status (every row as bad as the worst one),
 * milestones first, each with what its rule read. The rows come back as given, so a caller keeps its ids.
 */
export function explainPlan<M extends PlanMilestone, W extends PlanWorkItem>(
  rows: { threads: readonly { id: string }[]; milestones: readonly M[]; workItems: readonly W[] },
  today: IsoDate,
): { threads: Record<string, Status | null>; project: Status | null; facts: PlanFact<M, W>[] } {
  const all: PlanFact<M, W>[] = [
    ...rows.milestones.map((row) => ({ type: "milestone" as const, row, why: milestoneWhy(row) })),
    ...rows.workItems.map((row) => ({ type: "work_item" as const, row, why: workItemWhy(row, today) })),
  ];
  const statusOf = (threadId: string | null) => threadStatus(all.filter((f) => f.row.threadId === threadId).map((f) => f.why.status));
  const threads = Object.fromEntries(rows.threads.map((t) => [t.id, statusOf(t.id)]));
  const project = projectCalculatedStatus([...Object.values(threads), statusOf(null)]);
  return { threads, project, facts: project === null ? [] : all.filter((f) => f.why.status === project) };
}

export function calculatePlan(rows: PlanRows, today: IsoDate): { threads: Record<string, Status | null>; project: Status | null } {
  const { threads, project } = explainPlan(rows, today);
  return { threads, project };
}
