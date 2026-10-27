// M8. Leave, read only in this slice (C9). An extracted leave either matches approved leave and
// changes nothing, or, once the author accepts it, becomes a leave request. A capture never
// creates approved leave, and a leave reason never reaches a record a lead can see (A5.2, A7.3):
// the types below have no reason field, and every function copies dates only.
import { daysBetween, isIsoDate, type IsoDate } from "../dates";

// C9: requested -> approved -> handover_in_progress -> covered | uncovered -> active -> ended
export const LEAVE_STATES = ["requested", "approved", "handover_in_progress", "covered", "uncovered", "active", "ended"] as const;
export type LeaveState = (typeof LEAVE_STATES)[number];

/** Leave as the rest of DPM sees it. HR may hold a reason; it is never part of this record. */
export type LeaveRecord = { id: string; personId: string; start: IsoDate; end: IsoDate; state: LeaveState };

/** What Atlas may extract about leave: dates only, never why ("not feeling well" stays out, E17). */
export type ExtractedLeave = { personId: string; start: IsoDate; end: IsoDate | null };

export type LeaveRequest = { personId: string; start: IsoDate; end: IsoDate; state: "requested" };

// Approved and every state after it; a request is not approved yet
const APPROVED: readonly LeaveState[] = LEAVE_STATES.filter((s) => s !== "requested");

export type LeaveMatch = { mark: "matches_leave"; leaveId: string } | { mark: "needs_ok" };

/**
 * Server check 8 for leave. Matches when the extracted days fall inside approved leave of the same
 * person; "out from Monday the 26th" with no end is read as that one day.
 */
export function matchLeave(extracted: ExtractedLeave, leaves: readonly LeaveRecord[]): LeaveMatch {
  const end = extracted.end ?? extracted.start;
  if (!isIsoDate(extracted.start) || !isIsoDate(end)) return { mark: "needs_ok" };
  const hit = leaves.find(
    (l) =>
      l.personId === extracted.personId &&
      APPROVED.includes(l.state) &&
      daysBetween(l.start, extracted.start) >= 0 &&
      daysBetween(end, l.end) >= 0,
  );
  return hit ? { mark: "matches_leave", leaveId: hit.id } : { mark: "needs_ok" };
}

export type LeaveOutcome =
  | { kind: "no_change"; leaveId: string }
  | { kind: "request"; request: LeaveRequest }
  | { kind: "refused"; reason: string };

/** What an accepted leave item does when the capture is saved. Never approved leave. */
export function acceptExtractedLeave(extracted: ExtractedLeave, leaves: readonly LeaveRecord[]): LeaveOutcome {
  const match = matchLeave(extracted, leaves);
  if (match.mark === "matches_leave") return { kind: "no_change", leaveId: match.leaveId };
  const end = extracted.end ?? extracted.start;
  if (!isIsoDate(extracted.start) || !isIsoDate(end)) return { kind: "refused", reason: "leave needs real dates" };
  if (daysBetween(extracted.start, end) < 0) return { kind: "refused", reason: "leave ends before it starts" };
  // Copy the fields by name, so nothing else the extraction carried can ride along
  return { kind: "request", request: { personId: extracted.personId, start: extracted.start, end, state: "requested" } };
}

/** The leave a lead sees: dates and state only, whatever the stored row holds besides. */
export function leaveSeenByLead(row: LeaveRecord): LeaveRecord {
  return { id: row.id, personId: row.personId, start: row.start, end: row.end, state: row.state };
}
