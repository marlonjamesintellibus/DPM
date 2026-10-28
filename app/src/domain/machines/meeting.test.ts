// M33 (conversational plan, section 17): every arrow and its guards, with the model check's fix ownNotes (MT4,
// CD17), and MT7's match of a second note of the same meeting (CD18).
import { describe, expect, it } from "vitest";
import { config } from "../config";
import { addDays } from "../dates";
import { applyMeetingEvent, meetingMachine, receiveMeeting, sameMeeting, type MeetingEvent, type MeetingRecord, type MeetingState } from "./meeting";

const TODAY = "2026-10-20";
const at = (state: MeetingState, fields: Partial<MeetingRecord> = {}): MeetingRecord => ({
  ...receiveMeeting({ id: "mtg-cap-1", captureId: "cap-1", recorderId: "kemar", projectId: "forager", attendees: ["alicia", "kyle"], receivedOn: TODAY }),
  state,
  ...fields,
});
const onForager = (p: string) => ["alicia", "kemar", "jodian", "kyle"].includes(p);
const base: { actorId: string | null; today: string; mayAttend: (p: string) => boolean; settled: boolean } = { actorId: "kemar", today: TODAY, mayAttend: onForager, settled: true };

describe("meeting arrows", () => {
  const rows: [MeetingState, MeetingEvent, Partial<typeof base>, MeetingState][] = [
    ["received", { type: "ATTENDEES_CONFIRMED", attendees: ["alicia", "kyle"], told: true }, {}, "transcribing"],
    ["received", { type: "OWN_NOTES_ONLY" }, {}, "transcribing"],
    ["received", { type: "EXPIRE" }, { actorId: null, today: addDays(TODAY, config.reviewExpiryDays) }, "expired"],
    ["transcribing", { type: "TRANSCRIBED" }, { actorId: null }, "reading"],
    ["reading", { type: "PROPOSALS_READY" }, { actorId: null }, "split"],
    ["reading", { type: "READ_FAILED" }, { actorId: null }, "failed"],
    ["transcribing", { type: "READ_FAILED" }, { actorId: null }, "failed"],
    ["split", { type: "DONE" }, { actorId: null }, "done"],
  ];
  it.each(rows)("%s --%o--> (%o) %s", (from, event, ctx, to) => {
    const r = applyMeetingEvent(at(from), event, { ...base, ...ctx });
    expect(r.outcome.ok).toBe(true);
    expect(r.record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(meetingMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([f, e, , t]) => `${f} ${e.type} ${t}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });
});

describe("meeting guards", () => {
  const confirm = (fields: Partial<Extract<MeetingEvent, { type: "ATTENDEES_CONFIRMED" }>> = {}, actorId = "kemar") =>
    applyMeetingEvent(at("received"), { type: "ATTENDEES_CONFIRMED", attendees: ["alicia"], told: true, ...fields }, { ...base, actorId });

  it("only the recorder confirms the attendees, or says it is their own notes", () => {
    expect(confirm({}, "alicia").outcome.ok).toBe(false);
    expect(applyMeetingEvent(at("received"), { type: "OWN_NOTES_ONLY" }, { ...base, actorId: "alicia" }).outcome.ok).toBe(false);
  });

  it("MT4: attendees who were not told are never read as theirs; own notes is the drawn way (CD17)", () => {
    const r = confirm({ told: false });
    expect(r.outcome).toMatchObject({ ok: false, reason: expect.stringContaining("own notes") });
    const own = applyMeetingEvent(at("received"), { type: "OWN_NOTES_ONLY" }, base);
    expect(own.record).toMatchObject({ state: "transcribing", mode: "own" });
  });

  it("MT3: everyone there must be on the project or one of its contacts; the recorder is never an attendee", () => {
    expect(confirm({ attendees: ["andre"] }).outcome.ok).toBe(false);
    expect(confirm({ attendees: ["kemar"] }).outcome.ok).toBe(false);
    expect(confirm({ attendees: ["kemar", "alicia", "alicia"] }).record).toMatchObject({ mode: "meeting", attendees: ["alicia"] });
  });

  it("MT7: a merge taken with the attendees is kept; own notes merge with nothing", () => {
    expect(confirm({ mergeWith: "mtg-cap-0" }).record.mergedWith).toBe("mtg-cap-0");
  });

  it("an unconfirmed note expires only after config.reviewExpiryDays", () => {
    const early = applyMeetingEvent(at("received"), { type: "EXPIRE" }, { ...base, actorId: null, today: addDays(TODAY, config.reviewExpiryDays - 1) });
    expect(early.outcome.ok).toBe(false);
    // Once read it never expires from here: the split's parts have their own timers
    expect(applyMeetingEvent(at("split"), { type: "EXPIRE" }, { ...base, actorId: null, today: addDays(TODAY, 30) }).outcome.ok).toBe(false);
  });

  it("DONE waits for every part to settle", () => {
    expect(applyMeetingEvent(at("split"), { type: "DONE" }, { ...base, settled: false }).outcome.ok).toBe(false);
  });

  it("final states take no event", () => {
    for (const s of ["done", "failed", "expired"] as const) {
      for (const e of [{ type: "DONE" }, { type: "EXPIRE" }, { type: "OWN_NOTES_ONLY" }] as const) expect(applyMeetingEvent(at(s), e, base).outcome.ok).toBe(false);
    }
  });
});

describe("MT7, sameMeeting", () => {
  const first = { projectId: "forager", recorderId: "alicia", at: new Date("2026-10-20T15:00:00Z"), attendees: ["jodian", "kemar"], mode: "meeting" as const, state: "split" as const };
  const second = { projectId: "forager", recorderId: "kemar", at: first.at, attendees: null };
  it("the same project, someone else, within the window", () => {
    expect(sameMeeting({ ...second, at: new Date("2026-10-20T16:30:00Z") }, first)).toBe(true);
    expect(sameMeeting({ ...second, attendees: ["alicia", "jodian"] }, first)).toBe(true);
  });
  it("not the same: another project, the same recorder, too far apart, own notes, or a note that was never read", () => {
    expect(sameMeeting({ ...second, projectId: "gq" }, first)).toBe(false);
    expect(sameMeeting({ ...second, recorderId: "alicia" }, first)).toBe(false);
    expect(sameMeeting({ ...second, at: new Date(first.at.getTime() + (config.meetingMatchMinutes + 1) * 60_000) }, first)).toBe(false);
    expect(sameMeeting(second, { ...first, mode: "own" })).toBe(false);
    expect(sameMeeting(second, { ...first, state: "expired" })).toBe(false);
  });
  it("M1, P10: never a note whose recorder did not name this one as there, nor, once said, one whose recorder this one did not name", () => {
    expect(sameMeeting(second, { ...first, attendees: ["jodian"] })).toBe(false);
    expect(sameMeeting({ ...second, attendees: ["jodian"] }, first)).toBe(false);
  });
});
