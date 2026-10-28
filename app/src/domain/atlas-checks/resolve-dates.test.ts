import { describe, expect, it } from "vitest";
import { findDates, findShift, messageDay, readDateValue, readLeaveRange, resolveDate } from "./resolve-dates";

// Snapshot: Kemar speaks at 8:58am on Tuesday 20 Oct 2026, America/Jamaica
const AT = new Date("2026-10-20T13:58:00Z");
const date = (phrase: string, at = AT) => resolveDate(phrase, at)?.date ?? null;

describe("check 5: relative words read against message time", () => {
  it("today, yesterday, tomorrow", () => {
    expect(messageDay(AT)).toBe("2026-10-20");
    expect(date("today")).toBe("2026-10-20");
    expect(date("Finished the TikTok ingest yesterday")).toBe("2026-10-19");
    expect(date("tomorrow")).toBe("2026-10-21");
    expect(date("in two days")).toBe("2026-10-22");
    expect(resolveDate("yesterday", AT)).toMatchObject({ relative: true, weekdayMismatch: false });
  });

  it("uses the org's calendar day, not UTC: 11:30pm in Jamaica is still the 20th", () => {
    const late = new Date("2026-10-21T04:30:00Z");
    expect(messageDay(late)).toBe("2026-10-20");
    expect(date("tomorrow", late)).toBe("2026-10-21");
  });

  it("a weekday alone is the coming one; last and next move it", () => {
    expect(date("Monday")).toBe("2026-10-26");
    expect(date("next Monday")).toBe("2026-10-26");
    expect(date("last Monday")).toBe("2026-10-19");
    expect(date("Tuesday")).toBe("2026-10-20");
    expect(date("next Tuesday")).toBe("2026-10-27");
    expect(date("last Tuesday")).toBe("2026-10-13");
    expect(resolveDate("Monday", AT)).toMatchObject({ relative: true });
  });

  it("a stated day number is explicit: Monday the 26th, the 26th, Fri 23 Oct", () => {
    expect(resolveDate("I'm out from Monday the 26th", AT)).toMatchObject({ date: "2026-10-26", relative: false, weekdayMismatch: false });
    expect(resolveDate("the 26th", AT)).toMatchObject({ date: "2026-10-26", relative: false });
    expect(resolveDate("Fri 23 Oct", AT)).toMatchObject({ date: "2026-10-23", relative: false, weekdayMismatch: false });
    expect(date("Friday, October 23rd")).toBe("2026-10-23");
    expect(date("23 October 2026")).toBe("2026-10-23");
    expect(date("2026-10-24")).toBe("2026-10-24");
  });

  it("E13: a weekday and date that disagree resolve to the date, flagged", () => {
    expect(resolveDate("Monday the 27th", AT)).toMatchObject({ date: "2026-10-27", weekdayMismatch: true });
    expect(resolveDate("Friday 24 Oct", AT)).toMatchObject({ date: "2026-10-24", weekdayMismatch: true });
  });

  it("a day number with no month takes the nearest month, and skips months without that day", () => {
    expect(date("the 5th")).toBe("2026-10-05");
    expect(date("the 31st")).toBe("2026-10-31");
    expect(date("the 2nd", new Date("2026-12-30T15:00:00Z"))).toBe("2027-01-02");
    expect(date("Jan 3", new Date("2026-12-30T15:00:00Z"))).toBe("2027-01-03");
  });

  it("is not fooled by numbers and ordinary words", () => {
    expect(findDates("move the refresh to 6am", AT)).toEqual([]);
    expect(findDates("9 updates for 2 projects", AT)).toEqual([]);
    expect(findDates("I sat with Jodian and we wed the configs", AT)).toEqual([]);
    expect(findDates("30 Feb", AT)).toEqual([]);
  });

  it("reads every date in a sentence, keeping the longest reading", () => {
    // "Friday" is read from the message day, so it is the coming Friday, not the one after the 26th
    const found = findDates("Monday the 26th, back Friday", AT);
    expect(found.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-23"]);
    expect(found[0]).toMatchObject({ start: 0, end: "Monday the 26th".length });
  });
});

describe("shifts from a date on record", () => {
  it("slips a day from the current forecast (story item 4)", () => {
    expect(findShift("so I think the model slips a day", "2026-10-23")).toMatchObject({ date: "2026-10-26", relative: true });
    expect(findShift("it's two days late", "2026-10-23")?.date).toBe("2026-10-27");
    expect(findShift("pushed back a week", "2026-10-23")?.date).toBe("2026-10-30");
    expect(findShift("pulled in by 2 days", "2026-10-23")?.date).toBe("2026-10-21");
    expect(findShift("nothing moves", "2026-10-23")).toBeNull();
  });

  it("a date field prefers a stated date, then a shift, then a relative word", () => {
    expect(readDateValue("slips a day, so Fri 24 Oct", AT, "2026-10-23")?.date).toBe("2026-10-24");
    expect(readDateValue("finished yesterday so it slips a day", AT, "2026-10-23")?.date).toBe("2026-10-26");
    expect(readDateValue("done by Monday", AT, "2026-10-23")).toMatchObject({ date: "2026-10-26", relative: true });
    expect(readDateValue("no dates here", AT, "2026-10-23")).toBeNull();
  });
});

describe("dates said only to rule them out", () => {
  it("next Monday, not Friday: the new date is Monday", () => {
    expect(readDateValue("Trend model will land next Monday now, not Friday", AT, "2026-10-23")?.date).toBe("2026-10-26");
    expect(readDateValue("lands Thursday instead of Friday", AT, "2026-10-23")?.date).toBe("2026-10-22");
    expect(readLeaveRange("I'm out Thursday, not Friday", AT)).toMatchObject({ start: "2026-10-22", end: "2026-10-22" });
  });
});

describe("leave ranges", () => {
  it("from a day: start only (story item 5)", () => {
    expect(readLeaveRange("I'm out from Monday the 26th", AT)).toMatchObject({ start: "2026-10-26", end: null, relative: false });
  });

  it("a range and a single day", () => {
    expect(readLeaveRange("out from the 26th to the 30th", AT)).toMatchObject({ start: "2026-10-26", end: "2026-10-30" });
    expect(readLeaveRange("I'm out Monday", AT)).toMatchObject({ start: "2026-10-26", end: "2026-10-26", relative: true });
    expect(readLeaveRange("no dates", AT)).toBeNull();
  });

  it("phase P: a whole week said with no day is its working days; this week is what is left of it", () => {
    expect(readLeaveRange("I'm off next week", AT)).toMatchObject({ start: "2026-10-26", end: "2026-10-30", relative: true, span: { start: 8, end: 17 } });
    expect(readLeaveRange("Mi off nex week", AT)).toMatchObject({ start: "2026-10-26", end: "2026-10-30" });
    expect(readLeaveRange("I'm out the rest of this week", AT)).toMatchObject({ start: "2026-10-20", end: "2026-10-23" });
    // On a weekend, this week is already over: the next one
    expect(readLeaveRange("I'm off this week", new Date("2026-10-24T15:00:00Z"))).toMatchObject({ start: "2026-10-26", end: "2026-10-30" });
    // A day said wins over the week around it
    expect(readLeaveRange("I'm off next week from Tuesday the 27th", AT)).toMatchObject({ start: "2026-10-27", end: null });
  });

  it("phase P, LV6: back early is the day they are back, today when no day is said", () => {
    expect(readLeaveRange("I'm back early, back to work today", AT)).toMatchObject({ start: "2026-10-20", end: null, back: true, relative: true });
    expect(readLeaveRange("I'm back early", AT)).toMatchObject({ start: "2026-10-20", end: null, back: true, relative: true, span: { start: 0, end: 8 } });
    expect(readLeaveRange("Back at work Thursday", AT)).toMatchObject({ start: "2026-10-22", back: true });
    expect(readLeaveRange("Mi back a work from tomorrow", AT)).toMatchObject({ start: "2026-10-21", back: true });
    // Leave said with the day back is still the leave: two days are not a day back
    expect(readLeaveRange("I'm off Thursday to Friday, back Monday", AT)).toMatchObject({ start: "2026-10-22", end: "2026-10-23" });
    expect(readLeaveRange("I'm off from Thursday, back Monday", AT)?.back).toBeUndefined();
    expect(readLeaveRange("I'm off next week", AT)?.back).toBeUndefined();
  });
});

// Section 20, U8 (question 3): a counted time is in working days; a named day keeps its date
describe("counted slips use working days (section 20, U8)", () => {
  it("WD1: a day from a Friday is the Monday", () => {
    expect(findShift("slips a day", "2026-10-23")?.date).toBe("2026-10-26");
  });

  it("WD2: a week is 5 working days, from any day", () => {
    expect(findShift("slips a week", "2026-10-21")?.date).toBe("2026-10-28");
  });

  it("WD3: a named day is kept as said, even a Saturday", () => {
    expect(readDateValue("lands Saturday", AT, "2026-10-23")?.date).toBe("2026-10-24");
    expect(resolveDate("tomorrow", new Date("2026-10-23T13:58:00Z"))?.date).toBe("2026-10-24");
  });

  it('WD4: "in two days" counts working days from the message day', () => {
    expect(resolveDate("in two days", AT)?.date).toBe("2026-10-22");
    expect(resolveDate("in two days", new Date("2026-10-22T13:58:00Z"))?.date).toBe("2026-10-26");
    expect(resolveDate("in a week", AT)?.date).toBe("2026-10-27");
  });
});
