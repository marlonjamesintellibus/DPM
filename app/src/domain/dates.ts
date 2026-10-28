// Calendar dates in the org's time zone, as "YYYY-MM-DD" strings. Rules compare
// dates, never instants, so a due date means the whole day wherever it is read.

export type IsoDate = string;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const DAY_MS = 86_400_000;

function toUtcMs(date: IsoDate): number {
  if (!ISO.test(date)) throw new Error(`not an ISO date: ${date}`);
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw new Error(`not a real date: ${date}`);
  return ms;
}

export function isIsoDate(value: string): boolean {
  try {
    toUtcMs(value);
    return true;
  } catch {
    return false;
  }
}

/** Calendar days from a to b (negative when b is before a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function weekday(date: IsoDate): Weekday {
  return WEEKDAYS[new Date(toUtcMs(date)).getUTCDay()];
}

/** Monday to Friday. Jamaican public holidays are not counted yet (KB B1). */
export function isWorkingDay(date: IsoDate): boolean {
  const d = weekday(date);
  return d !== "Saturday" && d !== "Sunday";
}

/**
 * Section 20, U8: `n` working days after `date` (before it when negative), Monday to Friday. A counted
 * slip ("a day", "two days", "a week" as 5) is in working days: Friday plus a day is Monday.
 */
export function addWorkingDays(date: IsoDate, n: number): IsoDate {
  let d = date;
  for (let left = Math.abs(n); left > 0; ) {
    d = addDays(d, Math.sign(n));
    if (isWorkingDay(d)) left--;
  }
  return d;
}

/** Working days after `from`, up to and including `to`. */
export function workingDaysBetween(from: IsoDate, to: IsoDate): number {
  let n = 0;
  for (let d = addDays(from, 1); daysBetween(d, to) >= 0; d = addDays(d, 1)) if (isWorkingDay(d)) n++;
  return n;
}

/** The calendar date of an instant in a time zone, for example "today" in America/Jamaica. */
export function dateInZone(instant: Date, timeZone: string): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** The first instant of a calendar day in a time zone (whole-hour offsets, as the org's): phase P's "since your leave began". */
export function startOfDayIn(date: IsoDate, timeZone: string): Date {
  const midnight = toUtcMs(date);
  for (let h = -14; h <= 14; h++) {
    const at = new Date(midnight + h * 3_600_000);
    if (dateInZone(at, timeZone) === date) return at;
  }
  return new Date(midnight);
}
