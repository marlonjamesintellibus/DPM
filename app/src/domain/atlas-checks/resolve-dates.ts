// Server check 5: dates in a person's words, read against when they spoke (M1: message time,
// not processing time) in the org time zone. The model's own reading of a date is never used.
//
// "relative" means the date came only from words relative to the message ("yesterday",
// "Monday", "slips a day"). A stated day number ("Monday the 26th", "the 26th", "Fri 23 Oct")
// is explicit, so it does not lower confidence unless its weekday disagrees (E13).
import { config } from "../config";
import { addDays, addWorkingDays, dateInZone, daysBetween, isIsoDate, weekday, WEEKDAYS, type IsoDate } from "../dates";

export type ResolvedDate = {
  date: IsoDate;
  /** Read only from words relative to the message, with no day number. Lowers confidence (check 4). */
  relative: boolean;
  /** The weekday said does not fall on the date said ("Monday the 27th"). The day number wins (E13). */
  weekdayMismatch: boolean;
  /** Where the words are in the text searched: [start, end). */
  start: number;
  end: number;
};

const WEEKDAY_WORDS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

const alternation = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join("|");
// Short forms ("sat", "wed", "sun") are ordinary words too, so they count only next to a day number
const ANY_WD = alternation(Object.keys(WEEKDAY_WORDS));
const FULL_WD = alternation(WEEKDAYS.map((d) => d.toLowerCase()));
const MONTH = alternation(Object.keys(MONTH_WORDS));
const NUM = `(\\d+|${alternation(Object.keys(NUMBER_WORDS))})`;
const MOD = "(?:(?:last|next|this|coming)\\s+)?";
const ORD = "(?:st|nd|rd|th)";

type Parts = { year?: number; month?: number; day?: number; wd?: number; mod?: string; offset?: number; workingOffset?: number };
type Pattern = { re: RegExp; parts: (m: RegExpExecArray) => Parts };

const wdOf = (s: string | undefined) => (s ? WEEKDAY_WORDS[s.toLowerCase()] : undefined);

const PATTERNS: Pattern[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/gi, parts: (m) => ({ year: +m[1], month: +m[2], day: +m[3] }) },
  // "Fri 23 Oct", "Monday the 26th of October 2026", "26 Oct"
  {
    re: new RegExp(`\\b${MOD}(?:(${ANY_WD})\\.?,?\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}?\\s+(?:of\\s+)?(${MONTH})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, "gi"),
    parts: (m) => ({ wd: wdOf(m[1]), day: +m[2], month: MONTH_WORDS[m[3].toLowerCase()], year: m[4] ? +m[4] : undefined }),
  },
  // "Friday, October 23rd", "Oct 23"
  {
    re: new RegExp(`\\b${MOD}(?:(${ANY_WD})\\.?,?\\s+)?(${MONTH})\\.?\\s+(?:the\\s+)?(\\d{1,2})${ORD}?\\b(?:,?\\s+(\\d{4})\\b)?`, "gi"),
    parts: (m) => ({ wd: wdOf(m[1]), month: MONTH_WORDS[m[2].toLowerCase()], day: +m[3], year: m[4] ? +m[4] : undefined }),
  },
  // "Monday the 26th", "Mon 26"
  {
    re: new RegExp(`\\b${MOD}(${ANY_WD})\\.?,?\\s+(?:the\\s+)?(\\d{1,2})${ORD}?\\b`, "gi"),
    parts: (m) => ({ wd: wdOf(m[1]), day: +m[2] }),
  },
  // "the 26th", "26th"; a bare number ("6am", "2 projects") is never a date
  { re: new RegExp(`\\b(?:the\\s+)?(\\d{1,2})${ORD}\\b`, "gi"), parts: (m) => ({ day: +m[1] }) },
  {
    re: new RegExp(`\\b(?:(last|next|this|coming)\\s+)?(${FULL_WD})\\b`, "gi"),
    parts: (m) => ({ mod: m[1]?.toLowerCase(), wd: wdOf(m[2]) }),
  },
  {
    re: /\b(today|tonight|tomorrow|yesterday)\b/gi,
    parts: (m) => ({ offset: { today: 0, tonight: 0, tomorrow: 1, yesterday: -1 }[m[1].toLowerCase()] }),
  },
  // Section 20, U8: a counted time ("in two days") is in working days; a named day keeps its date
  { re: new RegExp(`\\bin\\s+${NUM}\\s+(days?|weeks?)\\b`, "gi"), parts: (m) => ({ workingOffset: count(m[1]) * unit(m[2]) }) },
];

function count(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word.toLowerCase()];
}
/** Working days in a counted unit (section 20, U8): a week is 5. */
function unit(word: string): number {
  return word.toLowerCase().startsWith("week") ? 5 : 1;
}

const pad = (n: number) => String(n).padStart(2, "0");
function makeDate(year: number, month: number, day: number): IsoDate | null {
  const d = `${year}-${pad(month)}-${pad(day)}`;
  return isIsoDate(d) ? d : null;
}

// The candidate nearest the message day; a tie goes to the future (people mostly talk about what is next)
function nearest(today: IsoDate, candidates: IsoDate[]): IsoDate | null {
  let best: IsoDate | null = null;
  for (const c of candidates) {
    if (best === null) best = c;
    else {
      const dc = Math.abs(daysBetween(today, c));
      const db = Math.abs(daysBetween(today, best));
      if (dc < db || (dc === db && c > best)) best = c;
    }
  }
  return best;
}

function resolveParts(p: Parts, today: IsoDate): { date: IsoDate; relative: boolean; weekdayMismatch: boolean } | null {
  const [y, m] = today.split("-").map(Number);
  if (p.offset !== undefined) return { date: addDays(today, p.offset), relative: true, weekdayMismatch: false };
  if (p.workingOffset !== undefined) return { date: addWorkingDays(today, p.workingOffset), relative: true, weekdayMismatch: false };
  if (p.day === undefined) {
    // A weekday alone: the coming one (today counts), "next" strictly after today, "last" strictly before
    if (p.wd === undefined) return null;
    const ahead = (p.wd - WEEKDAYS.indexOf(weekday(today)) + 7) % 7;
    if (p.mod === "last") return { date: addDays(today, ahead === 0 ? -7 : ahead - 7), relative: true, weekdayMismatch: false };
    const days = p.mod === "next" && ahead === 0 ? 7 : ahead;
    return { date: addDays(today, days), relative: true, weekdayMismatch: false };
  }
  let candidates: IsoDate[];
  if (p.year !== undefined && p.month !== undefined) candidates = [makeDate(p.year, p.month, p.day)].filter((d) => d !== null);
  else if (p.month !== undefined) candidates = [y - 1, y, y + 1].map((yy) => makeDate(yy, p.month!, p.day!)).filter((d) => d !== null);
  else
    candidates = [-1, 0, 1]
      .map((k) => {
        const idx = y * 12 + (m - 1) + k;
        return makeDate(Math.floor(idx / 12), (idx % 12) + 1, p.day!);
      })
      .filter((d) => d !== null);
  if (!candidates.length) return null;
  // With a month, the year is the nearest one; a weekday only checks it, never picks another year
  if (p.month !== undefined) candidates = [nearest(today, candidates)!];
  if (p.wd === undefined) return { date: nearest(today, candidates)!, relative: false, weekdayMismatch: false };
  const agreeing = candidates.filter((c) => WEEKDAYS.indexOf(weekday(c)) === p.wd);
  if (agreeing.length) return { date: nearest(today, agreeing)!, relative: false, weekdayMismatch: false };
  return { date: nearest(today, candidates)!, relative: false, weekdayMismatch: true };
}

/** The calendar day the author spoke on, in the org time zone. */
export function messageDay(messageAt: Date, timeZone: string = config.timeZone): IsoDate {
  return dateInZone(messageAt, timeZone);
}

/** Every date in the text, in order. Overlapping readings keep the longest ("Monday the 26th", not "Monday"). */
export function findDates(text: string, messageAt: Date, timeZone: string = config.timeZone): ResolvedDate[] {
  const today = messageDay(messageAt, timeZone);
  const found: ResolvedDate[] = [];
  for (const { re, parts } of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const r = resolveParts(parts(m), today);
      if (r) found.push({ ...r, start: m.index, end: m.index + m[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const picked: ResolvedDate[] = [];
  for (const d of found) if (!picked.length || d.start >= picked[picked.length - 1].end) picked.push(d);
  return picked;
}

/** The first date in a phrase, or null. */
export function resolveDate(phrase: string, messageAt: Date, timeZone: string = config.timeZone): ResolvedDate | null {
  return findDates(phrase, messageAt, timeZone)[0] ?? null;
}

const SHIFTS: { re: RegExp; sign: 1 | -1 }[] = [
  {
    re: new RegExp(`\\b(?:slip|slips|slipped|slipping|push(?:es|ed)?\\s+(?:back|out)|move(?:s|d)?\\s+out|delay(?:s|ed)?|late\\s+by|behind\\s+by)\\s+(?:by\\s+)?${NUM}\\s+(days?|weeks?)\\b`, "gi"),
    sign: 1,
  },
  { re: new RegExp(`\\b${NUM}\\s+(days?|weeks?)\\s+(?:late|later|behind)\\b`, "gi"), sign: 1 },
  { re: new RegExp(`\\bpull(?:s|ed)?\\s+in\\s+(?:by\\s+)?${NUM}\\s+(days?|weeks?)\\b`, "gi"), sign: -1 },
  { re: new RegExp(`\\b${NUM}\\s+(days?|weeks?)\\s+(?:early|earlier|ahead)\\b`, "gi"), sign: -1 },
];

/** A move relative to a date already on record: "the model slips a day" from a forecast of 23 Oct. */
export function findShift(text: string, base: IsoDate): ResolvedDate | null {
  for (const { re, sign } of SHIFTS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      // Section 20, U8: "the model slips a day" from Friday 23 Oct is Monday 26 Oct
      const days = sign * count(m[1]) * unit(m[2]);
      return { date: addWorkingDays(base, days), relative: true, weekdayMismatch: false, start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

// "next Monday now, not Friday": a date said only to rule it out is not the new date (phase 4 eval)
const NEGATED = /\b(?:not|instead\s+of|rather\s+than)\s+(?:on\s+|by\s+)?$/i;

/** The dates in a quote, without the ones it rules out. */
function saidDates(text: string, messageAt: Date, timeZone: string): ResolvedDate[] {
  return findDates(text, messageAt, timeZone).filter((d) => !NEGATED.test(text.slice(0, d.start)));
}

/**
 * The one date a date field takes from a quote (a milestone forecast). A stated date wins, then a
 * shift from the current value, then a relative word. With several, the last one said wins.
 */
export function readDateValue(text: string, messageAt: Date, base: IsoDate | null, timeZone: string = config.timeZone): ResolvedDate | null {
  const dates = saidDates(text, messageAt, timeZone);
  const stated = dates.filter((d) => !d.relative);
  if (stated.length) return stated[stated.length - 1];
  const shift = base && isIsoDate(base) ? findShift(text, base) : null;
  if (shift) return shift;
  return dates.length ? dates[dates.length - 1] : null;
}

export type LeaveRange = {
  start: IsoDate;
  /** Null when only a start was said ("I'm out from Monday the 26th"). */
  end: IsoDate | null;
  relative: boolean;
  weekdayMismatch: boolean;
  /** The date words in the text searched. */
  span: { start: number; end: number };
};

/** Leave dates: "from X" (start only), "X to Y", or a single day "X". */
export function readLeaveRange(text: string, messageAt: Date, timeZone: string = config.timeZone): LeaveRange | null {
  const dates = saidDates(text, messageAt, timeZone);
  if (!dates.length) return null;
  const [first, second] = dates;
  const flags = (ds: ResolvedDate[]) => ({
    relative: ds.some((d) => d.relative),
    weekdayMismatch: ds.some((d) => d.weekdayMismatch),
  });
  if (second && /^\s*(?:to|until|till|through|thru|-|–)\s*$/i.test(text.slice(first.end, second.start))) {
    if (second.date < first.date) return null;
    return { start: first.date, end: second.date, ...flags([first, second]), span: { start: first.start, end: second.end } };
  }
  const startOnly = /\b(?:from|starting)\s+$/i.test(text.slice(0, first.start));
  return { start: first.date, end: startOnly ? null : first.date, ...flags([first]), span: { start: first.start, end: first.end } };
}
