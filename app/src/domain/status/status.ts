// The five statuses (KB A4.1). Only things with a target get one; a thing with no
// target has no status (null), and is left out of every roll-up.

export const STATUSES = ["not_started", "on_track", "at_risk", "off_track", "done"] as const;
export type Status = (typeof STATUSES)[number];

// What an owner may set by hand (C3): never Not started or Done
export const SETTABLE = ["on_track", "at_risk", "off_track"] as const;
export type SettableStatus = (typeof SETTABLE)[number];

// A4.2 worst first: Off track > At risk > On track > Not started > Done
export const RANK: Record<Status, number> = { done: 0, not_started: 1, on_track: 2, at_risk: 3, off_track: 4 };

export function isSettable(status: Status): status is SettableStatus {
  return (SETTABLE as readonly string[]).includes(status);
}

/** Worst of the children that have a status; null when none has a target. */
export function worst(statuses: readonly (Status | null)[]): Status | null {
  let result: Status | null = null;
  for (const s of statuses) if (s !== null && (result === null || RANK[s] > RANK[result])) result = s;
  return result;
}
