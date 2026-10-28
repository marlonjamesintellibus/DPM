// M22 (conversational plan, phase E): every arrow, its guards, and the model check's fixes: DONE, DROP and a
// new date from open, due and checking, withdrawing a check-in that is out (anyLive); a second check-in, then
// lapsed (checking --TIMER--> checking); CM11's question asked once and answered by any reply; CM9's unlink.
import { describe, expect, it } from "vitest";
import { config } from "../config";
import {
  applyCommitmentEvent,
  asksDrop,
  COMMITMENT_STATES,
  commitmentCauses,
  commitmentMachine,
  openCommitment,
  type CommitmentCtx,
  type CommitmentEvent,
  type CommitmentRecord,
  type CommitmentState,
} from "./commitment";

const LINK = { type: "work_item" as const, id: "wi-151", projectId: "forager" };
const fresh = openCommitment({ id: "cm-1", ownerId: "kemar", captureId: "cap-1", extractionId: "ext-1", what: "Send Kyle the access request", dueOn: "2026-10-21", link: LINK, savedOn: "2026-10-20" });
const at = (state: CommitmentState, fields: Partial<CommitmentRecord> = {}): CommitmentRecord => ({
  ...fresh,
  state,
  ...(state === "checking" ? { checkIns: 1, checkInOut: true, checkInOn: "2026-10-22" } : {}),
  ...fields,
});
// Thursday 22 Oct: the day after the due day, a working day Kemar is in
const base: CommitmentCtx = { actorId: "kemar", today: "2026-10-22", ownerIn: true, linked: "in_progress" };
const rule: CommitmentCtx = { ...base, actorId: null };

describe("commitment arrows", () => {
  const rows: [CommitmentState, CommitmentEvent, Partial<CommitmentRecord>, Partial<CommitmentCtx>, CommitmentState][] = [
    ["open", { type: "DONE", by: "owner" }, {}, {}, "done"],
    ["due", { type: "DONE", by: "owner" }, {}, {}, "done"],
    ["checking", { type: "DONE", by: "owner" }, {}, {}, "done"],
    ["open", { type: "DROP" }, {}, {}, "dropped"],
    ["due", { type: "DROP" }, {}, {}, "dropped"],
    ["checking", { type: "DROP" }, {}, {}, "dropped"],
    ["open", { type: "NEW_DATE", dueOn: "2026-10-23" }, {}, {}, "open"],
    ["due", { type: "NEW_DATE", dueOn: "2026-10-23" }, {}, {}, "open"],
    ["checking", { type: "NEW_DATE", dueOn: "2026-10-23" }, {}, {}, "open"],
    ["open", { type: "KEEP" }, { stands: "asked" }, {}, "open"],
    ["due", { type: "KEEP" }, { stands: "asked" }, {}, "due"],
    ["checking", { type: "KEEP" }, { stands: "asked" }, {}, "checking"],
    ["open", { type: "DUE" }, {}, { actorId: null }, "due"],
    ["due", { type: "CHECK_IN" }, {}, { actorId: null }, "checking"],
    ["checking", { type: "CHECK_IN" }, { checkInOut: false }, { actorId: null }, "checking"],
    ["checking", { type: "NO_REPLY" }, { checkIns: config.commitmentCheckIns }, { actorId: null, today: "2026-10-23" }, "lapsed"],
    ["checking", { type: "NO_REPLY" }, {}, { actorId: null, today: "2026-10-23" }, "checking"],
    ["open", { type: "WORK_CANCELLED" }, {}, { actorId: null, linked: "cancelled" }, "open"],
    ["due", { type: "WORK_CANCELLED" }, {}, { actorId: null, linked: "cancelled" }, "due"],
    ["checking", { type: "WORK_CANCELLED" }, {}, { actorId: null, linked: "cancelled" }, "checking"],
    ...COMMITMENT_STATES.map((s): [CommitmentState, CommitmentEvent, Partial<CommitmentRecord>, Partial<CommitmentCtx>, CommitmentState] => [s, { type: "UNLINK" }, {}, { actorId: null }, s]),
  ];
  it.each(rows)("%s --%o--> (%o, %o) %s", (from, event, fields, ctx, to) => {
    const r = applyCommitmentEvent(at(from, fields), event, { ...base, ...ctx });
    expect(r.outcome).toMatchObject({ ok: true });
    expect(r.record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(commitmentMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([from, e, , , to]) => `${from} ${e.type} ${to}`));
    expect(tested).toEqual(drawn);
  });

  it("rule 2: nothing leaves done, dropped or lapsed (but CM9's unlink), and a refused event changes nothing", () => {
    const events: CommitmentEvent[] = [{ type: "DONE", by: "owner" }, { type: "DONE", by: "work_done" }, { type: "DROP" }, { type: "NEW_DATE", dueOn: "2026-10-30" }, { type: "KEEP" }, { type: "DUE" }, { type: "CHECK_IN" }, { type: "NO_REPLY" }, { type: "WORK_CANCELLED" }];
    for (const state of COMMITMENT_STATES) {
      for (const e of events) {
        const r = applyCommitmentEvent(at(state, { stands: "asked" }), e, { ...base, linked: "done", today: "2026-10-30" });
        if (state === "done" || state === "dropped" || state === "lapsed") expect(r.outcome.ok).toBe(false);
        if (!r.outcome.ok) expect(r.record).toEqual(at(state, { stands: "asked" }));
      }
    }
  });
});

describe("the model check's fixes", () => {
  it("anyLive: Done and Drop from a check-in withdraw it, so nothing still asks once it is done", () => {
    for (const e of [{ type: "DONE", by: "owner" }, { type: "DROP" }] as CommitmentEvent[]) {
      const r = applyCommitmentEvent(at("checking"), e, base);
      expect(r.record).toMatchObject({ checkInOut: false, endedOn: "2026-10-22", endedBy: "owner" });
      expect(commitmentCauses(r.record)).toEqual([]);
    }
  });

  it("anyLive, CM5: a new date from due or checking goes back to open, counted as a move, check-ins from zero", () => {
    const r = applyCommitmentEvent(at("checking", { checkIns: 2, moves: 1 }), { type: "NEW_DATE", dueOn: "2026-10-23" }, base);
    expect(r.record).toMatchObject({ state: "open", dueOn: "2026-10-23", moves: 2, checkIns: 0, checkInOut: false, checkInOn: null });
  });

  it("a second check-in: no reply makes room for the next, which goes out the next working day; the last one lapses it", () => {
    const first = applyCommitmentEvent(at("due"), { type: "CHECK_IN" }, rule).record;
    expect(first).toMatchObject({ state: "checking", checkIns: 1, checkInOut: true, checkInOn: "2026-10-22" });
    // The same day: the reply timer waits for the day to end
    expect(applyCommitmentEvent(first, { type: "NO_REPLY" }, rule).outcome.ok).toBe(false);
    const quiet = applyCommitmentEvent(first, { type: "NO_REPLY" }, { ...rule, today: "2026-10-23" }).record;
    expect(quiet).toMatchObject({ state: "checking", checkInOut: false });
    const second = applyCommitmentEvent(quiet, { type: "CHECK_IN" }, { ...rule, today: "2026-10-23" }).record;
    expect(second).toMatchObject({ checkIns: 2, checkInOut: true, checkInOn: "2026-10-23" });
    // Never a third: every check-in was sent
    expect(applyCommitmentEvent({ ...second, checkInOut: false }, { type: "CHECK_IN" }, rule).outcome).toMatchObject({ ok: false, reason: "every check-in was sent" });
    const lapsed = applyCommitmentEvent(second, { type: "NO_REPLY" }, { ...rule, today: "2026-10-26" }).record;
    expect(lapsed).toMatchObject({ state: "lapsed", checkInOut: false, endedBy: "no_reply" });
  });

  it("CM11: asked once on cancelled work; any reply answers it, and it is never asked again once kept", () => {
    const asked = applyCommitmentEvent(at("open"), { type: "WORK_CANCELLED" }, { ...rule, linked: "cancelled" }).record;
    expect(asked.stands).toBe("asked");
    expect(commitmentCauses(asked)).toEqual(["commitment_stands:cm-1"]);
    expect(applyCommitmentEvent(asked, { type: "KEEP" }, base).record.stands).toBe("kept");
    expect(applyCommitmentEvent(asked, { type: "NEW_DATE", dueOn: "2026-10-23" }, base).record.stands).toBe("kept");
    expect(applyCommitmentEvent(asked, { type: "DONE", by: "owner" }, base).record.stands).toBeNull();
    const kept = { ...asked, stands: "kept" as const };
    expect(applyCommitmentEvent(kept, { type: "WORK_CANCELLED" }, { ...rule, linked: "cancelled" }).outcome.ok).toBe(false);
  });

  it("recordAtSave: a promise about cancelled work opens with CM11's question already asked", () => {
    const saved = openCommitment({ ...fresh, standsAsked: true });
    expect(saved).toMatchObject({ state: "open", stands: "asked" });
    expect(openCommitment({ ...fresh, link: null, standsAsked: true }).stands).toBeNull();
  });
});

describe("guards", () => {
  it("rule 10: only the owner says done, drops, moves or keeps it", () => {
    for (const e of [{ type: "DONE", by: "owner" }, { type: "DROP" }, { type: "NEW_DATE", dueOn: "2026-10-23" }, { type: "KEEP" }] as CommitmentEvent[]) {
      expect(applyCommitmentEvent(at("open", { stands: "asked" }), e, { ...base, actorId: "alicia" }).outcome.ok).toBe(false);
    }
  });

  it("M22: the rule's Done needs its linked work Done now, and a person cannot say it for the rule", () => {
    expect(applyCommitmentEvent(at("open"), { type: "DONE", by: "work_done" }, rule).outcome.ok).toBe(false);
    expect(applyCommitmentEvent(at("open"), { type: "DONE", by: "work_done" }, { ...rule, linked: "done" }).record).toMatchObject({ state: "done", endedBy: "work_done" });
    expect(applyCommitmentEvent(at("open"), { type: "DONE", by: "work_done" }, { ...base, linked: "done" }).outcome.ok).toBe(false);
    expect(applyCommitmentEvent(at("open", { link: null }), { type: "DONE", by: "work_done" }, { ...rule, linked: "done" }).outcome.ok).toBe(false);
  });

  it("TIMER due fires only once the due day has ended, in the org time zone", () => {
    expect(applyCommitmentEvent(at("open"), { type: "DUE" }, { ...rule, today: "2026-10-21" }).outcome.ok).toBe(false);
    expect(applyCommitmentEvent(at("open"), { type: "DUE" }, { ...rule, today: "2026-10-22" }).outcome.ok).toBe(true);
  });

  it("CM7, CM8: no check-in on a weekend or while the owner is on leave", () => {
    expect(applyCommitmentEvent(at("due"), { type: "CHECK_IN" }, { ...rule, ownerIn: false }).outcome).toMatchObject({ ok: false, reason: "not on a working day they are in" });
  });

  it("a new date is a day still to come, and the same date on an open one is no move", () => {
    expect(applyCommitmentEvent(at("due"), { type: "NEW_DATE", dueOn: "2026-10-21" }, base).outcome.ok).toBe(false);
    expect(applyCommitmentEvent(at("open", { dueOn: "2026-10-23" }), { type: "NEW_DATE", dueOn: "2026-10-23" }, base).outcome.ok).toBe(false);
    // Today is fine: it is due at the end of it
    expect(applyCommitmentEvent(at("due"), { type: "NEW_DATE", dueOn: "2026-10-22" }, base).outcome.ok).toBe(true);
  });

  it("CD24, CM10: from 3 moves the check-in asks whether to drop it", () => {
    expect(asksDrop({ moves: 2 })).toBe(false);
    expect(asksDrop({ moves: 3 })).toBe(true);
  });

  it("CD3: the inbox items are the owner's own causes, and only while a check-in is out or CM11 asks", () => {
    expect(commitmentCauses(at("open"))).toEqual([]);
    expect(commitmentCauses(at("due"))).toEqual([]);
    expect(commitmentCauses(at("checking"))).toEqual(["commitment_check:cm-1"]);
    expect(commitmentCauses(at("checking", { checkInOut: false }))).toEqual([]);
    expect(commitmentCauses(at("dropped", { stands: "asked" }))).toEqual([]);
  });
});
