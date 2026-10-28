// M35 (conversational plan, phase P): every arrow, its guards, and the model check's four fixes: an offer withdrawn
// when the leave starts, is cancelled or on DISMISS (suggestedWayOut); a declined leave acts as a cancelled one
// (declineCancels: LEAVE_OFF either way); an ask withdrawn when the person or the teammate can no longer read an item
// (leaveProjectWithdraws); PICK refused for an item in an asked request or a live cover (oneCoverPerItem).
import { describe, expect, it } from "vitest";
import { config } from "../config";
import {
  applyCoverEvent,
  COVER_STATES,
  coverCauses,
  coverMachine,
  offerCover,
  takenBy,
  type CoverCtx,
  type CoverEvent,
  type CoverItem,
  type CoverRecord,
  type CoverState,
} from "./cover-request";

const TREND: CoverItem = { type: "milestone", id: "ms-trend", projectId: "forager" };
const W152: CoverItem = { type: "work_item", id: "wi-152", projectId: "forager" };
const W208: CoverItem = { type: "work_item", id: "wi-208", projectId: "insights" };
const ASKED_AT = new Date("2026-10-20T14:10:00Z");
const offer = offerCover({ id: "cv-1", leaveId: "lv-1", askerId: "kemar", captureId: "cap-1" });
const at = (state: CoverState, fields: Partial<CoverRecord> = {}): CoverRecord => ({
  ...offer,
  state,
  ...(state === "suggested" ? {} : { toId: "jodian", projectId: "forager", items: [TREND, W152], askedAt: ASKED_AT }),
  ...(state === "accepted" ? { handover: "proposed" as const } : {}),
  ...fields,
});
// 9:10am, the leave approved and not started; both read both Forager items
const base: CoverCtx = {
  actorId: "kemar",
  now: ASKED_AT,
  leaveLive: true,
  leaveApproved: true,
  leaveStarted: false,
  due: ["milestone:ms-trend", "work_item:wi-152", "work_item:wi-208"],
  taken: [],
  teammateReads: ["milestone:ms-trend", "work_item:wi-152"],
  teammateAway: false,
  askerReads: true,
};
const later = new Date(ASKED_AT.getTime() + config.coverAskHours * 3_600_000);
const PICK: CoverEvent = { type: "PICK", toId: "jodian", items: [TREND, W152] };

describe("cover request arrows", () => {
  const rows: [CoverState, CoverEvent, Partial<CoverRecord>, Partial<CoverCtx>, CoverState][] = [
    ["suggested", PICK, {}, {}, "asked"],
    ["suggested", { type: "DISMISS" }, {}, {}, "withdrawn"],
    ["suggested", { type: "LAPSE" }, {}, { actorId: null, leaveStarted: true }, "withdrawn"],
    ["suggested", { type: "LEAVE_OFF" }, {}, { actorId: null, leaveLive: false }, "withdrawn"],
    ["asked", { type: "ACCEPT" }, {}, { actorId: "jodian" }, "accepted"],
    ["asked", { type: "DECLINE" }, {}, { actorId: "jodian" }, "declined"],
    ["asked", { type: "DECLINE_ITEM", item: W152 }, {}, { actorId: "jodian" }, "asked"],
    ["asked", { type: "NO_ANSWER" }, {}, { actorId: null, now: later }, "unanswered"],
    ["asked", { type: "LEAVE_OFF" }, {}, { actorId: null, leaveLive: false }, "withdrawn"],
    ["asked", { type: "DATES" }, {}, { actorId: null, due: ["milestone:ms-trend"] }, "asked"],
    ["asked", { type: "DATES" }, {}, { actorId: null, due: [] }, "withdrawn"],
    ["asked", { type: "LEFT_PROJECT" }, {}, { actorId: null, teammateReads: [] }, "withdrawn"],
    ["asked", { type: "LEFT_PROJECT" }, {}, { actorId: null, askerReads: false }, "withdrawn"],
    ["accepted", { type: "LEAVE_OFF" }, {}, { actorId: null, leaveLive: false }, "accepted"],
    ["accepted", { type: "LEAVE_APPROVED" }, { handover: "waiting" }, { actorId: null }, "accepted"],
  ];
  it.each(rows)("%s --%o--> (%o, %o) %s", (from, event, fields, ctx, to) => {
    const r = applyCoverEvent(at(from, fields), event, { ...base, ...ctx });
    expect(r.outcome).toMatchObject({ ok: true });
    expect(r.record.state).toBe(to);
  });

  it("every drawn arrow is in the table above, and nothing leaves a final state but an accepted cover's handover", () => {
    const drawn = coverMachine.arrows.flatMap((a) => a.from.map((f) => `${f}>${a.on}>${a.to}`)).sort();
    const tested = [...new Set(rows.map(([f, e, , , to]) => `${f}>${e.type}>${to}`))].sort();
    expect(tested).toEqual([...new Set(drawn)]);
    for (const s of ["declined", "unanswered", "withdrawn"] as const) expect(coverMachine.arrows.filter((a) => a.from.includes(s))).toEqual([]);
    expect(COVER_STATES).toHaveLength(6);
  });
});

describe("what each arrow does", () => {
  it("PICK names the teammate, the project and the items; ACCEPT proposes the handover, or waits on the approval (LV9)", () => {
    const asked = applyCoverEvent(offer, PICK, base).record;
    expect(asked).toMatchObject({ state: "asked", toId: "jodian", projectId: "forager", items: [TREND, W152], askedAt: ASKED_AT });
    expect(applyCoverEvent(asked, { type: "ACCEPT" }, { ...base, actorId: "jodian" }).record.handover).toBe("proposed");
    const waiting = applyCoverEvent(asked, { type: "ACCEPT" }, { ...base, actorId: "jodian", leaveApproved: false }).record;
    expect(waiting.handover).toBe("waiting");
    expect(applyCoverEvent(waiting, { type: "LEAVE_APPROVED" }, { ...base, actorId: null }).record.handover).toBe("proposed");
  });

  it("LV4: the leave off cancels an accepted cover's handover, waiting or proposed; one already cancelled has nothing to cancel", () => {
    for (const handover of ["waiting", "proposed"] as const) {
      expect(applyCoverEvent(at("accepted", { handover }), { type: "LEAVE_OFF" }, { ...base, actorId: null, leaveLive: false }).record.handover).toBe("cancelled");
    }
    expect(applyCoverEvent(at("accepted", { handover: "cancelled" }), { type: "LEAVE_OFF" }, { ...base, actorId: null, leaveLive: false }).outcome).toMatchObject({ ok: false, reason: "no handover to cancel" });
  });

  it("LV8: one item declined leaves the rest asked; the last one is declined with the request", () => {
    const r = applyCoverEvent(at("asked"), { type: "DECLINE_ITEM", item: W152 }, { ...base, actorId: "jodian" }).record;
    expect([r.items, r.declined]).toEqual([[TREND], [W152]]);
    expect(applyCoverEvent(r, { type: "DECLINE_ITEM", item: TREND }, { ...base, actorId: "jodian" }).outcome).toMatchObject({ ok: false, reason: "it is the only thing asked: decline the request" });
    expect(applyCoverEvent(r, { type: "DECLINE_ITEM", item: W208 }, { ...base, actorId: "jodian" }).outcome).toMatchObject({ ok: false, reason: "that is not in this request" });
  });

  it("LV3: what is no longer due leaves the ask, which ends when none is left", () => {
    const r = applyCoverEvent(at("asked"), { type: "DATES" }, { ...base, actorId: null, due: ["work_item:wi-152"] });
    expect(r.record.items).toEqual([W152]);
    expect(applyCoverEvent(at("asked"), { type: "DATES" }, { ...base, actorId: null }).outcome).toMatchObject({ ok: false, reason: "everything asked is still due then" });
    expect(applyCoverEvent(at("asked"), { type: "DATES" }, { ...base, actorId: null, due: [] }).record.endedWhy).toBe("not_due");
  });

  it("an end says why: dismissed, the leave started, the leave off, left the project", () => {
    expect(applyCoverEvent(offer, { type: "DISMISS" }, base).record.endedWhy).toBe("dismissed");
    expect(applyCoverEvent(offer, { type: "LAPSE" }, { ...base, actorId: null, leaveStarted: true }).record.endedWhy).toBe("leave_started");
    expect(applyCoverEvent(at("asked"), { type: "LEAVE_OFF" }, { ...base, actorId: null, leaveLive: false }).record.endedWhy).toBe("leave_off");
    expect(applyCoverEvent(at("asked"), { type: "LEFT_PROJECT" }, { ...base, actorId: null, askerReads: false }).record.endedWhy).toBe("left_project");
  });
});

describe("guards", () => {
  const refused = (state: CoverState, event: CoverEvent, ctx: Partial<CoverCtx>, reason: string, fields: Partial<CoverRecord> = {}) =>
    expect(applyCoverEvent(at(state, fields), event, { ...base, ...ctx }).outcome).toMatchObject({ ok: false, reason });

  it("PICK: only the person, while the leave is on and not started, one project, their own things due then, someone else who reads them", () => {
    refused("suggested", PICK, { actorId: "jodian" }, "only the person going on leave");
    refused("suggested", PICK, { leaveLive: false }, "the leave is off");
    refused("suggested", PICK, { leaveStarted: true }, "your leave has started");
    refused("suggested", { type: "PICK", toId: "jodian", items: [] }, {}, "pick at least one thing to cover");
    refused("suggested", { type: "PICK", toId: "jodian", items: [W152, W208] }, {}, "ask for one project at a time");
    refused("suggested", PICK, { due: ["work_item:wi-152"] }, "that is not yours, or not due while you're away");
    refused("suggested", { type: "PICK", toId: "kemar", items: [W152] }, {}, "pick someone else");
    // P10: Andre is not on Forager
    refused("suggested", { type: "PICK", toId: "andre", items: [W152] }, { teammateReads: [] }, "I can't ask them about that");
  });

  it("PICK: LV2 someone the project shows away then; oneCoverPerItem an item asked or covered elsewhere", () => {
    refused("suggested", PICK, { teammateAway: true }, "they are away then");
    refused("suggested", PICK, { taken: ["work_item:wi-152"] }, "someone is already asked, or covers it");
  });

  it("ACCEPT and DECLINE: only the teammate asked (rule 10), and ACCEPT only while both still read every item and the leave is on (rule 4)", () => {
    refused("asked", { type: "ACCEPT" }, { actorId: "kemar" }, "only the teammate asked");
    refused("asked", { type: "ACCEPT" }, { actorId: null }, "only the teammate asked");
    refused("asked", { type: "DECLINE" }, { actorId: "alicia" }, "only the teammate asked");
    refused("asked", { type: "ACCEPT" }, { actorId: "jodian", teammateReads: ["work_item:wi-152"] }, "that is no longer on a project you share");
    refused("asked", { type: "ACCEPT" }, { actorId: "jodian", askerReads: false }, "that is no longer on a project you share");
    refused("asked", { type: "ACCEPT" }, { actorId: "jodian", leaveLive: false }, "the leave is off");
  });

  it("the timers and rules: nobody's tap, and only when it holds", () => {
    refused("asked", { type: "NO_ANSWER" }, { actorId: null, now: new Date(later.getTime() - 1) }, "not asked that long ago");
    refused("asked", { type: "NO_ANSWER" }, { actorId: "kemar", now: later }, "only a timer or a rule");
    refused("suggested", { type: "LAPSE" }, { actorId: null }, "the leave has not started");
    refused("suggested", { type: "LEAVE_OFF" }, { actorId: null }, "the leave is still on");
    refused("asked", { type: "LEFT_PROJECT" }, { actorId: null }, "both still read every item");
    refused("accepted", { type: "LEAVE_APPROVED" }, { actorId: null }, "no handover waits on the approval");
    refused("accepted", { type: "LEAVE_APPROVED" }, { actorId: null, leaveApproved: false }, "no handover waits on the approval", { handover: "waiting" });
    refused("suggested", { type: "DISMISS" }, { actorId: "jodian" }, "only the person going on leave");
  });

  it("a late tap after the timer has no arrow (the model's lateAccept)", () => {
    refused("unanswered", { type: "ACCEPT" }, { actorId: "jodian" }, "no arrow from unanswered on ACCEPT");
  });
});

describe("helpers", () => {
  it("takenBy: items in an asked request or a live cover, never one declined, ended or cancelled", () => {
    const rows = [at("asked", { id: "a" }), at("accepted", { id: "b", items: [W208], handover: "waiting" }), at("accepted", { id: "c", items: [W152], handover: "cancelled" }), at("declined", { id: "d" })];
    expect(takenBy(rows).sort()).toEqual(["milestone:ms-trend", "work_item:wi-152", "work_item:wi-208"]);
    expect(takenBy(rows, "a")).toEqual(["work_item:wi-208"]);
  });

  it("an asked request is an inbox item for the teammate alone", () => {
    expect(coverCauses(at("asked"))).toEqual(["cover_ask:cv-1"]);
    for (const s of ["suggested", "accepted", "declined", "unanswered", "withdrawn"] as const) expect(coverCauses(at(s))).toEqual([]);
  });
});
