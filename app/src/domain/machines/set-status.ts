// M9. Set status (Switch) and its reason (Ask). Port of research/state-machines/js/models/trackedStatus.mjs
// with ExpiryPolicy "when_done" and ReasonStale on (decision S1, model checked 26 Oct: all properties pass).
import { config } from "../config";
import { defineMachine, transition, type Outcome } from "../machine";
import { isSettable, type SettableStatus, type Status } from "../status/status";

export const OVERRIDE_STATES = ["calculated_only", "reason_required", "explained", "reason_stale"] as const;
export type OverrideState = (typeof OVERRIDE_STATES)[number];

/** What is stored for a project's set status. The calculated status is never stored (P6). */
export type SetStatusRecord = {
  override: OverrideState;
  setStatus: SettableStatus | null;
  /** The calculated status when the reason was given or last kept; shown as "given when the plan said ...". */
  reasonGivenAt: Status | null;
};

export const NO_SET_STATUS: SetStatusRecord = { override: "calculated_only", setStatus: null, reasonGivenAt: null };

export type SetStatusEvent =
  | { type: "OWNER_SETS"; status: Status }
  | { type: "GIVE_REASON"; linksOnLog: number }
  | { type: "KEEP" }
  | { type: "CALCULATED_CHANGED"; previous: Status | null; next: Status | null };

type Ctx = { record: SetStatusRecord; calculated: Status | null };

const ANY = OVERRIDE_STATES;
const HAS_SET = ["reason_required", "explained", "reason_stale"] as const;

// The set status ends when the plan agrees with it again, or the work is Done (policy "when_done").
function expires(record: SetStatusRecord, previous: Status | null, next: Status | null): boolean {
  if (next === record.setStatus) return true;
  if (config.setStatusExpiry === "when_done" && next === "done") return true;
  return config.setStatusExpiry === "on_any_change" && next !== previous;
}

export const setStatusMachine = defineMachine<OverrideState, SetStatusEvent, Ctx>({
  name: "set_status",
  states: OVERRIDE_STATES,
  arrows: [
    // "Use At risk instead": setting the calculated status clears the override
    {
      from: HAS_SET,
      on: "OWNER_SETS",
      to: "calculated_only",
      guard: ({ calculated }, e) => (e.status === calculated ? null : "differs from the plan"),
    },
    {
      from: ANY,
      on: "OWNER_SETS",
      to: "reason_required",
      guard: ({ record, calculated }, { status }) => {
        if (calculated === "done") return "the work is Done; a set status cannot override it (DoneWins)";
        if (!isSettable(status)) return `${status} cannot be set by hand`;
        if (status === calculated) return "matches the plan; nothing to store";
        if (status === record.setStatus) return "already set";
        return null;
      },
    },
    {
      from: ["reason_required"],
      on: "GIVE_REASON",
      to: "explained",
      guard: (_, { linksOnLog }) => (linksOnLog >= 1 ? null : "a reason links at least one BRAID entry on the log"),
    },
    { from: ["reason_stale"], on: "KEEP", to: "explained" },
    {
      from: HAS_SET,
      on: "CALCULATED_CHANGED",
      to: "calculated_only",
      guard: ({ record }, { previous, next }) => (expires(record, previous, next) ? null : "the set status still stands"),
    },
    {
      from: ["explained"],
      on: "CALCULATED_CHANGED",
      to: "reason_stale",
      guard: (_, { previous, next }) => (config.reasonStale && next !== previous ? null : "the plan did not move"),
    },
  ],
});

export type SetStatusResult = { outcome: Outcome<OverrideState>; record: SetStatusRecord };

/** Applies an event to a project's set status. A refused event returns the record unchanged. */
export function applySetStatus(record: SetStatusRecord, calculated: Status | null, event: SetStatusEvent): SetStatusResult {
  const outcome = transition(setStatusMachine, record.override, event, { record, calculated });
  if (!outcome.ok) return { outcome, record };
  if (outcome.to === "calculated_only") return { outcome, record: NO_SET_STATUS };
  switch (event.type) {
    case "OWNER_SETS":
      return { outcome, record: { override: outcome.to, setStatus: event.status as SettableStatus, reasonGivenAt: null } };
    case "GIVE_REASON":
    case "KEEP":
      return { outcome, record: { ...record, override: outcome.to, reasonGivenAt: calculated } };
    default:
      return { outcome, record: { ...record, override: outcome.to } };
  }
}

/** A4.3: once a reason is given (even a stale one), the set status wins for display. */
export function displayedStatus(record: SetStatusRecord, calculated: Status | null): Status | null {
  return (record.override === "explained" || record.override === "reason_stale") && record.setStatus
    ? record.setStatus
    : calculated;
}

/** The inbox cause this record raises for the owner (M10 keeps one item per cause). */
export function setStatusCause(record: SetStatusRecord): "status_set_with_no_reason" | "keep_set_status" | null {
  if (record.override === "reason_required") return "status_set_with_no_reason";
  if (record.override === "reason_stale") return "keep_set_status";
  return null;
}
