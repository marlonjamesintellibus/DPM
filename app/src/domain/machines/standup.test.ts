// M28 (conversational plan, section 12): every arrow, its guards, and the model check's fixes: the timer reads
// the skip guard first and skips when the M23 rules fail; STOP or the last SKIP with nothing answered is
// abandoned; START from none, scheduled and skipped, and never a second standup that asked (SU10).
import { describe, expect, it } from "vitest";
import {
  applyStandupEvent,
  draftStandup,
  STANDUP_STATES,
  standupIdle,
  standupMachine,
  workAsked,
  type StandupEvent,
  type StandupQuestion,
  type StandupRecord,
  type StandupState,
} from "./standup";

const ASKED = new Date("2026-10-20T14:10:00Z");
const later = (minutes: number) => new Date(ASKED.getTime() + minutes * 60_000);

const W208 = { type: "work_item" as const, id: "wi-208", projectId: "insights", label: "#208 Weekly sales export", number: "#208" };
const q = (n: number, fields: Partial<StandupQuestion> = {}): StandupQuestion => ({ n, kind: "in_progress", subject: W208, text: "#208 Weekly sales export is In progress. Done, still going, or stuck?", askedIn: "cap-1", ...fields });
const NEW = q(2, { kind: "new", subject: null, text: "Anything new blocking you?" });
const DONE = { tap: "done" as const, words: null, by: null };

const at = (state: StandupState, fields: Partial<StandupRecord> = {}): StandupRecord => ({
  ...draftStandup({ id: "su-kemar-2026-10-20", personId: "kemar", day: "2026-10-20", conversationId: "conv-1" }),
  state,
  ...(state === "asking" ? { current: q(1), askedAt: ASKED } : {}),
  ...fields,
});
const answered = { steps: [{ ...q(1), answer: DONE }], current: NEW };

const base = { actorId: "kemar", now: later(5), next: NEW as StandupQuestion | null, ownChat: true, updatedToday: false, hasOpenWork: true, rulesPass: true };

describe("standup arrows", () => {
  const rows: [StandupState, StandupEvent, Partial<StandupRecord>, Partial<typeof base>, StandupState][] = [
    ["none", { type: "SCHEDULE" }, {}, {}, "scheduled"],
    ["scheduled", { type: "TIMER" }, {}, { updatedToday: true }, "skipped"],
    ["scheduled", { type: "TIMER" }, {}, { rulesPass: false }, "skipped"],
    ["scheduled", { type: "TIMER" }, {}, {}, "asking"],
    ["none", { type: "START" }, {}, {}, "asking"],
    ["scheduled", { type: "START" }, {}, {}, "asking"],
    ["skipped", { type: "START" }, {}, {}, "asking"],
    ["asking", { type: "ANSWER", n: 1, answer: DONE }, {}, {}, "asking"],
    ["asking", { type: "ANSWER", n: 1, answer: DONE }, {}, { next: null }, "composed"],
    ["asking", { type: "SKIP", n: 1 }, {}, {}, "asking"],
    ["asking", { type: "SKIP", n: 2 }, answered, { next: null }, "composed"],
    ["asking", { type: "SKIP", n: 1 }, {}, { next: null }, "abandoned"],
    ["asking", { type: "STOP" }, answered, {}, "composed"],
    ["asking", { type: "STOP" }, {}, {}, "abandoned"],
    ["asking", { type: "IDLE" }, answered, { now: later(60) }, "composed"],
    ["asking", { type: "IDLE" }, {}, { now: later(60) }, "abandoned"],
  ];
  it.each(rows)("%s --%o--> (%o, %o) %s", (from, event, fields, ctx, to) => {
    expect(applyStandupEvent(at(from, fields), event, { ...base, ...ctx }).record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(standupMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([from, e, , , to]) => `${from} ${e.type} ${to}`));
    expect(tested).toEqual(drawn);
  });

  it("rule 2: nothing leaves composed or abandoned, and nothing else moves from where no arrow is drawn", () => {
    const events: StandupEvent[] = [{ type: "SCHEDULE" }, { type: "TIMER" }, { type: "START" }, { type: "ANSWER", n: 1, answer: DONE }, { type: "SKIP", n: 1 }, { type: "STOP" }, { type: "IDLE" }];
    for (const state of STANDUP_STATES) {
      for (const e of events) {
        const r = applyStandupEvent(at(state), e, { ...base, now: later(90) });
        if (state === "composed" || state === "abandoned") expect(r.outcome.ok).toBe(false);
        if (!r.outcome.ok) expect(r.record).toEqual(at(state));
      }
    }
  });
});

describe("the model check's fixes", () => {
  it("skipFirst: an update today, or no open work, is skipped before the M23 rules are read (SU1, SU2)", () => {
    const r = applyStandupEvent(at("scheduled"), { type: "TIMER" }, { ...base, hasOpenWork: false });
    expect(r.record).toMatchObject({ state: "skipped", current: null });
  });

  it("timerSkips: a day the M23 rules rule out (leave, turned off, the cap) is skipped, never left scheduled (SU9, rule 5)", () => {
    expect(applyStandupEvent(at("scheduled"), { type: "TIMER" }, { ...base, rulesPass: false }).record.state).toBe("skipped");
  });

  it("emptyAbandons: STOP or the last SKIP with nothing answered is abandoned, not an empty capture", () => {
    expect(applyStandupEvent(at("asking"), { type: "STOP" }, base).record).toMatchObject({ state: "abandoned", endedBy: "stop", current: null });
    expect(applyStandupEvent(at("asking"), { type: "SKIP", n: 1 }, { ...base, next: null }).record).toMatchObject({ state: "abandoned", endedBy: "answers", steps: [{ n: 1, answer: null }] });
  });

  it("startAfterSkip: a person who asks gets one after a skip; one that asked today has no START (SU10)", () => {
    expect(applyStandupEvent(at("skipped"), { type: "START" }, base).outcome.ok).toBe(true);
    for (const state of ["asking", "composed", "abandoned"] as const) expect(applyStandupEvent(at(state), { type: "START" }, base).outcome.ok).toBe(false);
  });

  it("SU1: with no open work a person who asks still gets one, with only \"Anything blocking you?\"", () => {
    const only = q(1, { kind: "new", subject: null, text: "Anything blocking you?" });
    expect(applyStandupEvent(at("none"), { type: "START" }, { ...base, next: only, hasOpenWork: false }).record).toMatchObject({ state: "asking", current: only, askedAt: later(5) });
  });
});

describe("guards", () => {
  it("rules 3 and 8: a standup runs only in the person's own chat", () => {
    expect(applyStandupEvent(at("none"), { type: "START" }, { ...base, ownChat: false }).outcome).toMatchObject({ ok: false, reason: "a standup runs only in your own chat" });
  });

  it("rule 10: only the person answers, skips or stops their standup", () => {
    for (const e of [{ type: "ANSWER", n: 1, answer: DONE }, { type: "SKIP", n: 1 }, { type: "STOP" }] as StandupEvent[]) {
      expect(applyStandupEvent(at("asking"), e, { ...base, actorId: "alicia" }).outcome).toMatchObject({ ok: false, reason: "only the person whose standup it is can answer it" });
    }
    expect(applyStandupEvent(at("none"), { type: "START" }, { ...base, actorId: "alicia" }).outcome.ok).toBe(false);
  });

  it("rule 6: a tap on an earlier question, or one sent twice, changes nothing (AnswerMatchesQuestion)", () => {
    const r = applyStandupEvent(at("asking", answered), { type: "ANSWER", n: 1, answer: DONE }, base);
    expect(r.outcome).toMatchObject({ ok: false, reason: "that question was already answered" });
    expect(applyStandupEvent(at("asking", answered), { type: "SKIP", n: 1 }, base).outcome.ok).toBe(false);
  });

  it("SU7: the idle timer fires only after config.standupIdleMinutes", () => {
    expect(applyStandupEvent(at("asking"), { type: "IDLE" }, { ...base, now: later(59) }).outcome.ok).toBe(false);
    expect(standupIdle(at("asking"), later(59))).toBe(false);
    expect(standupIdle(at("asking"), later(60))).toBe(true);
    expect(standupIdle(at("composed"), later(600))).toBe(false);
  });
});

describe("what a move files", () => {
  it("an answer files the question with what they said and asks the next one, from now", () => {
    const r = applyStandupEvent(at("asking"), { type: "ANSWER", n: 1, answer: DONE }, base);
    expect(r.record).toMatchObject({ state: "asking", steps: [{ ...q(1), answer: DONE }], current: NEW, askedAt: later(5), endedBy: null });
  });

  it("Stuck asks \"What's it waiting on?\" next: asking(k) --ANSWER Stuck--> asking(k, wait), not counted in the n", () => {
    const wait = q(2, { kind: "wait", text: "What's it waiting on?" });
    const r = applyStandupEvent(at("asking"), { type: "ANSWER", n: 1, answer: { tap: "stuck", words: null, by: null } }, { ...base, next: wait });
    expect(r.record.current).toEqual(wait);
    expect(workAsked([...r.record.steps, wait])).toBe(1);
  });

  it("SU6: STOP files nothing more; the question left is not asked again", () => {
    const r = applyStandupEvent(at("asking", answered), { type: "STOP" }, base);
    expect(r.record).toMatchObject({ state: "composed", endedBy: "stop", current: null, askedAt: null, steps: answered.steps });
  });

  it("SU7: the idle timer composes what was answered", () => {
    expect(applyStandupEvent(at("asking", answered), { type: "IDLE" }, { ...base, now: later(61) }).record).toMatchObject({ state: "composed", endedBy: "idle" });
  });
});
