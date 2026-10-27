// M6. Milestone (Stage), C7. The forecast is a field, not a state: FORECAST_CHANGED keeps the
// state and only moves the calculated status (M12). No event here changes the target date:
// moving a target is "accept a slip", a Decision for the lead, never an edit from a capture.
import { config } from "../config";
import { dateInZone, daysBetween, isIsoDate, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { MilestoneState } from "../status/rules";
import type { Actor } from "./membership";

export const MILESTONE_STATES = ["planned", "in_progress", "done", "missed"] as const satisfies readonly MilestoneState[];

export type MilestoneRecord = {
  id: string;
  projectId: string;
  ownerId: string;
  state: MilestoneState;
  targetDate: IsoDate;
  /** null means the forecast is the target. */
  forecastDate: IsoDate | null;
};

export type MilestoneEvent =
  | { type: "START" }
  | { type: "FINISH" }
  // The daily timer at 00:00 in the org time zone; `at` is when it ran
  | { type: "TARGET_PASSED"; at: Date }
  | { type: "FORECAST_CHANGED"; forecast: IsoDate }
  // Phase L, M30: the owner's own save is undone; the forecast goes back to what it was (null: the target)
  | { type: "UNDO"; forecast: IsoDate | null };

type Ctx = { record: MilestoneRecord; actor: Actor | null; timeZone: string };

export const ASK_THE_OWNER = "only the milestone owner changes its forecast; ask the owner instead (S5)";

function forecastGuard({ record, actor }: Ctx, { forecast }: { forecast: IsoDate }): string | null {
  if (!isIsoDate(forecast)) return `${forecast} is not a date`;
  if (actor?.personId !== record.ownerId) return ASK_THE_OWNER;
  return forecast === record.forecastDate ? "already the forecast" : null;
}

// Rule 4: only the owner sets the forecast, so only the owner, still the owner now, takes it back
function undoGuard({ record, actor }: Ctx, { forecast }: { forecast: IsoDate | null }): string | null {
  if (forecast !== null && !isIsoDate(forecast)) return `${forecast} is not a date`;
  if (actor?.personId !== record.ownerId) return ASK_THE_OWNER;
  return forecast === record.forecastDate ? "already the forecast" : null;
}

export const milestoneMachine = defineMachine<MilestoneState, MilestoneEvent, Ctx>({
  name: "milestone",
  states: MILESTONE_STATES,
  arrows: [
    { from: ["planned"], on: "START", to: "in_progress" },
    { from: ["in_progress", "missed"], on: "FINISH", to: "done" },
    // D5: a planned milestone whose target passes is missed too, so it reads Off track
    {
      from: ["planned", "in_progress"],
      on: "TARGET_PASSED",
      to: "missed",
      // E55: the date is read in the org's time zone, which is config, never the server's
      guard: ({ record, timeZone }, { at }) =>
        daysBetween(record.targetDate, dateInZone(at, timeZone)) > 0 ? null : `the target date has not passed in ${timeZone}`,
    },
    // The forecast moves in any open state and leaves the state where it is
    { from: ["planned"], on: "FORECAST_CHANGED", to: "planned", guard: forecastGuard },
    { from: ["in_progress"], on: "FORECAST_CHANGED", to: "in_progress", guard: forecastGuard },
    { from: ["missed"], on: "FORECAST_CHANGED", to: "missed", guard: forecastGuard },
    // Phase L, M30: the forecast is a field, so its UNDO arrow keeps the state, like FORECAST_CHANGED
    ...(["planned", "in_progress", "missed"] as const).map((s) => ({ from: [s], on: "UNDO" as const, to: s, guard: undoGuard })),
  ],
});

export type MilestoneResult = { outcome: Outcome<MilestoneState>; record: MilestoneRecord };

/** Applies an event to a milestone. A refused event returns the record unchanged. Timer events pass actor null. */
export function applyMilestone(
  record: MilestoneRecord,
  event: MilestoneEvent,
  actor: Actor | null,
  timeZone: string = config.timeZone,
): MilestoneResult {
  const outcome = transition(milestoneMachine, record.state, event, { record, actor, timeZone });
  if (!outcome.ok) return { outcome, record };
  const forecastDate = event.type === "FORECAST_CHANGED" || event.type === "UNDO" ? event.forecast : record.forecastDate;
  return { outcome, record: { ...record, state: outcome.to, forecastDate } };
}

/** S5: a forecast change from the owner is an edit; from anyone else it becomes an Ask to the owner. */
export function forecastChangeBy(record: MilestoneRecord, actor: Actor): "edit" | "ask_owner" {
  return actor.personId === record.ownerId ? "edit" : "ask_owner";
}
