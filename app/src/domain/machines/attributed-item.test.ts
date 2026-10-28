// M34 (conversational plan, section 17): every arrow and its guards, with the model check's fixes holdUnsure
// (MT2), sendToMembers (MT1), withdrawOnLeave and pauseOnLeave (MT12), and rule 10: only the person it is about
// confirms, edits or declines it.
import { describe, expect, it } from "vitest";
import { config } from "../config";
import type { ExtractedItemDraft } from "../shared";
import {
  applyAttributedEvent,
  attributedCauses,
  attributedItemMachine,
  confirmedValue,
  promiseDay,
  sameAttributed,
  workingDaysIn,
  type AttributedEvent,
  type AttributedItemRecord,
  type AttributedState,
} from "./attributed-item";

const TODAY = "2026-10-20";
const PROMISE: ExtractedItemDraft = {
  ordinal: 2,
  kind: "commitment",
  scope: "personal",
  projectId: null,
  routing: "routed",
  routingReason: "Said in the meeting",
  spans: [{ start: 0, end: 30 }],
  confidence: "high",
  mark: "needs_ok",
  rationale: "Alicia promised to send it.",
  commitment: { act: "promise", what: "Send Kyle the buyer list", dueOn: "2026-10-23", dueFrom: "said", dueWords: "Friday", link: null, commitmentId: null, seenDue: null },
  speaker: { personId: "alicia", sure: true },
};
const UPDATE: ExtractedItemDraft = {
  ...PROMISE,
  kind: "update",
  scope: "project",
  projectId: "forager",
  commitment: undefined,
  speaker: undefined,
  target: { type: "work_item", id: "wi-160", field: "state", oldValue: "in_progress", newValue: "done" },
};

const at = (state: AttributedState, fields: Partial<AttributedItemRecord> = {}): AttributedItemRecord => ({
  id: "att-cap-1-2",
  meetingId: "mtg-cap-1",
  captureId: "cap-1",
  recorderId: "kemar",
  personId: "alicia",
  projectId: "forager",
  kind: "commitment",
  draft: PROMISE,
  quote: "Alicia: I'll send Kyle the buyer list Friday",
  state,
  wording: null,
  dueOn: null,
  askedOn: state === "proposed" ? TODAY : null,
  decidedOn: null,
  reason: null,
  alsoFrom: [],
  ...fields,
});

type Ctx = Parameters<typeof applyAttributedEvent>[2];
const base: Ctx = { actorId: "alicia", today: TODAY, ownNotes: false, sure: true, member: true, away: false, reviewOpen: true, current: "in_progress", inDays: config.attributedExpiryDays };

describe("attributed item arrows", () => {
  const rows: [AttributedState, AttributedEvent, Partial<Ctx>, Partial<AttributedItemRecord>, AttributedState][] = [
    ["none", { type: "SPLIT" }, { actorId: null, ownNotes: true }, {}, "mine"],
    ["none", { type: "SPLIT" }, { actorId: null, sure: false }, {}, "held"],
    ["none", { type: "SPLIT" }, { actorId: null, member: false }, {}, "mine"],
    ["none", { type: "SPLIT" }, { actorId: null, away: true }, {}, "waiting"],
    ["none", { type: "SPLIT" }, { actorId: null }, {}, "proposed"],
    ["held", { type: "FIX_SPEAKER", personId: "kemar" }, { actorId: "kemar" }, {}, "mine"],
    ["held", { type: "FIX_SPEAKER", personId: "alicia" }, { actorId: "kemar", away: true }, {}, "waiting"],
    ["held", { type: "FIX_SPEAKER", personId: "alicia" }, { actorId: "kemar" }, {}, "proposed"],
    ["held", { type: "REVIEW_ENDED", how: "discarded" }, { actorId: "kemar" }, {}, "withdrawn"],
    ["held", { type: "REVIEW_ENDED", how: "expired" }, { actorId: null }, {}, "expired"],
    ["waiting", { type: "BACK" }, { actorId: null }, {}, "proposed"],
    ["waiting", { type: "LEFT" }, { actorId: null, member: false }, {}, "withdrawn"],
    ["proposed", { type: "LEFT" }, { actorId: null, member: false }, {}, "withdrawn"],
    ["proposed", { type: "EDIT", value: "Send Kyle the full buyer list", dueOn: "2026-10-26" }, {}, {}, "proposed"],
    ["proposed", { type: "CONFIRM" }, {}, {}, "confirmed"],
    ["proposed", { type: "DECLINE", reason: "Andre is sending it" }, {}, {}, "declined"],
    ["proposed", { type: "EXPIRE" }, { actorId: null }, {}, "expired"],
  ];
  it.each(rows)("%s --%o--> (%o) %s", (from, event, ctx, fields, to) => {
    const r = applyAttributedEvent(at(from, fields), event, { ...base, ...ctx });
    expect(r.outcome.ok).toBe(true);
    expect(r.record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(attributedItemMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([f, e, , , t]) => `${f} ${e.type} ${t}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });
});

describe("attributed item guards", () => {
  it("rule 10: only the person it is about confirms, edits or declines; never the recorder", () => {
    for (const e of [{ type: "CONFIRM" }, { type: "DECLINE" }, { type: "EDIT", value: "x" }] as const) {
      expect(applyAttributedEvent(at("proposed"), e, { ...base, actorId: "kemar" }).outcome.ok).toBe(false);
    }
  });

  it("rule 4: a confirm is refused once they left the project, whatever the Ask showed", () => {
    expect(applyAttributedEvent(at("proposed"), { type: "CONFIRM" }, { ...base, member: false }).outcome).toMatchObject({ ok: false, reason: "you are no longer on this project" });
  });

  it("an update confirms only while the record is as the note saw it (NeverOverwriteUnseen)", () => {
    const r = applyAttributedEvent(at("proposed", { kind: "update", draft: UPDATE, personId: "jodian" }), { type: "CONFIRM" }, { ...base, actorId: "jodian", current: "blocked" });
    expect(r.outcome).toMatchObject({ ok: false, reason: "it is blocked now, not in_progress as the note saw it" });
  });

  it("a promise whose day passed is confirmed only with a new day (EDIT, then CONFIRM)", () => {
    const late = { ...base, today: "2026-10-26" };
    expect(applyAttributedEvent(at("proposed"), { type: "CONFIRM" }, late).outcome.ok).toBe(false);
    const edited = applyAttributedEvent(at("proposed"), { type: "EDIT", value: "Send Kyle the buyer list", dueOn: "2026-10-28" }, late).record;
    expect(applyAttributedEvent(edited, { type: "CONFIRM" }, late).outcome.ok).toBe(true);
    expect(applyAttributedEvent(at("proposed"), { type: "EDIT", value: "x", dueOn: "2026-10-19" }, base).outcome.ok).toBe(false);
    expect(applyAttributedEvent(at("proposed"), { type: "EDIT", value: "  " }, base).outcome.ok).toBe(false);
  });

  it("MT2 (holdUnsure): an unsure item is held, and only the recorder fixes it while the review is open", () => {
    expect(applyAttributedEvent(at("none"), { type: "SPLIT" }, { ...base, actorId: null, sure: false, away: true, member: false }).record.state).toBe("held");
    expect(applyAttributedEvent(at("held"), { type: "FIX_SPEAKER", personId: "alicia" }, { ...base, actorId: "alicia" }).outcome.ok).toBe(false);
    expect(applyAttributedEvent(at("held"), { type: "FIX_SPEAKER", personId: "alicia" }, { ...base, actorId: "kemar", reviewOpen: false }).outcome.ok).toBe(false);
    const fixed = applyAttributedEvent(at("held", { personId: null }), { type: "FIX_SPEAKER", personId: "alicia" }, { ...base, actorId: "kemar" }).record;
    expect(fixed).toMatchObject({ state: "proposed", personId: "alicia", askedOn: TODAY, draft: { speaker: { personId: "alicia", sure: true } } });
  });

  it("MT1 (sendToMembers): someone who is not a member is never asked; fixed to them it is the recorder's", () => {
    expect(applyAttributedEvent(at("held"), { type: "FIX_SPEAKER", personId: "kyle" }, { ...base, actorId: "kemar", member: false }).record.state).toBe("mine");
  });

  it("CD17: own notes send nothing to anyone, sure or not", () => {
    expect(applyAttributedEvent(at("none"), { type: "SPLIT" }, { ...base, actorId: null, ownNotes: true, sure: false }).record.state).toBe("mine");
  });

  it("MT12 (pauseOnLeave): no expiry on a day away, nor before the working days they were in", () => {
    expect(applyAttributedEvent(at("proposed"), { type: "EXPIRE" }, { ...base, actorId: null, away: true }).outcome.ok).toBe(false);
    expect(applyAttributedEvent(at("proposed"), { type: "EXPIRE" }, { ...base, actorId: null, inDays: config.attributedExpiryDays - 1 }).outcome.ok).toBe(false);
    expect(applyAttributedEvent(at("waiting"), { type: "BACK" }, { ...base, actorId: null, away: true }).outcome.ok).toBe(false);
    // Back from leave, the timer starts that day
    expect(applyAttributedEvent(at("waiting"), { type: "BACK" }, { ...base, actorId: null, today: "2026-11-02" }).record.askedOn).toBe("2026-11-02");
  });

  it("LEFT only when they are no longer a member; held items wait for the recorder, not for them", () => {
    expect(applyAttributedEvent(at("proposed"), { type: "LEFT" }, { ...base, actorId: null }).outcome.ok).toBe(false);
    expect(applyAttributedEvent(at("held"), { type: "LEFT" }, { ...base, actorId: null, member: false }).outcome.ok).toBe(false);
  });

  it("once only: a final item takes no answer again", () => {
    for (const s of ["confirmed", "declined", "expired", "mine", "withdrawn"] as const) {
      for (const e of [{ type: "CONFIRM" }, { type: "DECLINE" }, { type: "EXPIRE" }] as const) expect(applyAttributedEvent(at(s), e, { ...base, actorId: e.type === "EXPIRE" ? null : "alicia" }).outcome.ok).toBe(false);
    }
  });
});

describe("attributed item helpers", () => {
  it("workingDaysIn counts the working days after it reached them, leaving out days away", () => {
    // Tue 20 Oct to Mon 26 Oct: Wed, Thu, Fri, Mon
    expect(workingDaysIn("2026-10-20", "2026-10-26", () => false)).toBe(4);
    expect(workingDaysIn("2026-10-20", "2026-10-26", (d) => d === "2026-10-22" || d === "2026-10-23")).toBe(2);
    expect(workingDaysIn("2026-10-20", "2026-10-20", () => false)).toBe(0);
  });

  it("their words and day win over the note's", () => {
    expect(confirmedValue(at("proposed"))).toBe("Send Kyle the buyer list");
    expect(confirmedValue(at("proposed", { wording: "Send Kyle the full list" }))).toBe("Send Kyle the full list");
    expect(promiseDay(at("proposed"))).toBe("2026-10-23");
    expect(promiseDay(at("proposed", { dueOn: "2026-10-27" }))).toBe("2026-10-27");
    expect(confirmedValue(at("proposed", { kind: "update", draft: UPDATE }))).toBe("done");
  });

  it("an inbox item only while it is asked of them", () => {
    expect(attributedCauses(at("proposed"))).toEqual(["attributed:att-cap-1-2"]);
    expect(attributedCauses(at("waiting"))).toEqual([]);
    expect(attributedCauses(at("held"))).toEqual([]);
  });

  it("MT7: the same change, or the same promise by the same day, from the same person", () => {
    const a = at("proposed");
    expect(sameAttributed(a, at("proposed", { draft: { ...PROMISE, commitment: { ...PROMISE.commitment!, what: "Send the buyer list to Kyle" } } }))).toBe(true);
    expect(sameAttributed(a, at("proposed", { draft: { ...PROMISE, commitment: { ...PROMISE.commitment!, dueOn: "2026-10-26" } } }))).toBe(false);
    expect(sameAttributed(a, at("proposed", { personId: "jodian" }))).toBe(false);
    const u = at("proposed", { kind: "update", draft: UPDATE, personId: "jodian" });
    expect(sameAttributed(u, { ...u })).toBe(true);
    expect(sameAttributed(u, at("proposed", { kind: "update", personId: "jodian", draft: { ...UPDATE, target: { ...UPDATE.target!, newValue: "blocked" } } }))).toBe(false);
  });
});
