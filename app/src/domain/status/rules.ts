// Calculated status rules (machines doc M12, KB A10.2). Statuses come from these
// rules only (P6): no model call, no stored value, recomputed on every read.
import { config } from "../config";
import { daysBetween, type IsoDate } from "../dates";
import { worst, type Status } from "./status";

export type WorkItemState = "to_do" | "in_progress" | "blocked" | "done" | "cancelled";
export type MilestoneState = "planned" | "in_progress" | "done" | "missed";

/** Done; Off track if past due and not done; At risk if blocked (ASSUMPTION); Not started if to do; else On track. */
export function workItemStatus(item: { state: WorkItemState; dueDate: IsoDate | null }, today: IsoDate): Status | null {
  if (item.state === "cancelled" || item.dueDate === null) return null; // E50, E51: no target
  if (item.state === "done") return "done";
  if (daysBetween(item.dueDate, today) > 0) return "off_track";
  if (item.state === "blocked") return "at_risk";
  if (item.state === "to_do") return "not_started";
  return "on_track";
}

/** Done; Off track if missed or forecast beyond target + tolerance; At risk if forecast after target; else On track. */
export function milestoneStatus(
  milestone: { state: MilestoneState; targetDate: IsoDate; forecastDate: IsoDate | null },
  toleranceDays: number = config.milestoneToleranceDays,
): Status {
  if (milestone.state === "done") return "done";
  if (milestone.state === "missed") return "off_track";
  const late = daysBetween(milestone.targetDate, milestone.forecastDate ?? milestone.targetDate);
  if (late > toleranceDays) return "off_track";
  if (late > 0) return "at_risk";
  return "on_track"; // E53: a forecast earlier than the target is On track
}

/** A thread is the worst of its milestones and work items; null when nothing in it has a target. */
export function threadStatus(children: readonly (Status | null)[]): Status | null {
  return worst(children);
}

/** A project's calculated status is its worst thread (the set status is applied separately, see set-status). */
export function projectCalculatedStatus(threads: readonly (Status | null)[]): Status | null {
  return worst(threads);
}

export type PlanRows = {
  threads: readonly { id: string }[];
  milestones: readonly { threadId: string | null; state: MilestoneState; targetDate: IsoDate; forecastDate: IsoDate | null }[];
  workItems: readonly { threadId: string | null; state: WorkItemState; dueDate: IsoDate | null }[];
};

/**
 * The whole roll-up for one project from its rows (A4.2): each thread is the worst of its milestones
 * and work items, and the project is the worst thread. Items in no thread count at project level.
 */
export function calculatePlan(rows: PlanRows, today: IsoDate): { threads: Record<string, Status | null>; project: Status | null } {
  const statusOf = (threadId: string | null) =>
    threadStatus([
      ...rows.milestones.filter((m) => m.threadId === threadId).map((m) => milestoneStatus(m)),
      ...rows.workItems.filter((w) => w.threadId === threadId).map((w) => workItemStatus(w, today)),
    ]);
  const threads = Object.fromEntries(rows.threads.map((t) => [t.id, statusOf(t.id)]));
  return { threads, project: projectCalculatedStatus([...Object.values(threads), statusOf(null)]) };
}
