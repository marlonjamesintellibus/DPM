// M36 (conversational plan, section 21): every arrow, its guards, and what each state keeps of the
// person's words (LF1 to LF4, and the model check's fixes optOut and dropText).
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../dates";
import {
  applyEvalCandidateEvent,
  candidateExpired,
  draftCandidate,
  evalCandidateMachine,
  type EvalCandidateEvent,
  type EvalCandidateRecord,
  type EvalCandidateState,
} from "./eval-candidate";

const LOGGED_AT = new Date("2026-10-20T14:10:00Z");
const later = (days: number) => new Date(LOGGED_AT.getTime() + days * DAY_MS);

const at = (state: EvalCandidateState): EvalCandidateRecord => ({
  ...draftCandidate({ id: "ec-1", personId: "kemar", cause: "thumbs_down", captureId: "cap-1", text: "What's due on Forager?", detail: { topic: "due", wrong: "#151 is done" } }),
  state,
  loggedAt: state === "none" ? null : LOGGED_AT,
});

/** The two ways a maintainer decides. */
const DECISIONS: EvalCandidateEvent[] = [
  { type: "ACCEPT", caseText: "What's due on Forager?", expected: "due" },
  { type: "DISMISS", note: null },
];

// Who acts and what holds when the event runs, per event
const as: Record<EvalCandidateEvent["type"], { actorId: string; allows: boolean; maintainer: boolean; now: Date }> = {
  LOGGED: { actorId: "kemar", allows: true, maintainer: false, now: LOGGED_AT },
  ACCEPT: { actorId: "dev", allows: true, maintainer: true, now: later(1) },
  DISMISS: { actorId: "dev", allows: true, maintainer: true, now: later(1) },
  EXPIRE: { actorId: "system", allows: true, maintainer: false, now: later(30) },
  OPTED_OUT: { actorId: "kemar", allows: false, maintainer: false, now: later(2) },
};

describe("eval candidate arrows", () => {
  const rows: [EvalCandidateState, EvalCandidateEvent, EvalCandidateState][] = [
    ["none", { type: "LOGGED" }, "logged"],
    ["logged", { type: "ACCEPT", caseText: "What's due on Forager?", expected: "due, project forager" }, "in_eval_set"],
    ["logged", { type: "DISMISS", note: "The answer was right" }, "dismissed"],
    ["logged", { type: "EXPIRE" }, "deleted"],
    ["logged", { type: "OPTED_OUT" }, "deleted"],
  ];
  it.each(rows)("%s --%o--> %s", (from, event, to) => {
    expect(applyEvalCandidateEvent(at(from), event, as[event.type]).record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(evalCandidateMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([f, e, t]) => `${f} ${e.type} ${t}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });

  it("final states have no way out, and nothing is logged twice (rule 6)", () => {
    for (const state of ["in_eval_set", "dismissed", "deleted"] as const) {
      for (const event of rows.map(([, e]) => e)) expect(applyEvalCandidateEvent(at(state), event, as[event.type]).outcome.ok).toBe(false);
    }
    expect(applyEvalCandidateEvent(at("logged"), { type: "LOGGED" }, as.LOGGED).outcome.ok).toBe(false);
  });
});

describe("the guards", () => {
  it("LF1: with Help improve Atlas off nothing is logged", () => {
    const r = applyEvalCandidateEvent(at("none"), { type: "LOGGED" }, { ...as.LOGGED, allows: false });
    expect(r.outcome.ok || r.outcome.reason).toBe("Help improve Atlas is off, so only the counts are kept");
    expect(r.record.state).toBe("none");
  });

  it("only the person's own words are logged", () => {
    const r = applyEvalCandidateEvent(at("none"), { type: "LOGGED" }, { ...as.LOGGED, actorId: "alicia" });
    expect(r.outcome.ok || r.outcome.reason).toBe("only the person's own words are logged");
  });

  it("rule 4: only a maintainer accepts or dismisses, checked when it runs", () => {
    for (const event of DECISIONS) {
      const r = applyEvalCandidateEvent(at("logged"), event, { ...as[event.type], maintainer: false });
      expect(r.outcome.ok || r.outcome.reason).toBe("only a DPM maintainer decides a candidate");
    }
  });

  it("LF2: the OK is checked again on accept and dismiss", () => {
    for (const event of DECISIONS) {
      const r = applyEvalCandidateEvent(at("logged"), event, { ...as[event.type], allows: false });
      expect(r.outcome.ok || r.outcome.reason).toBe("the person no longer allows it");
    }
  });

  it.each([
    [{ caseText: "  ", expected: "due" }, "give the words with seed names and ids"],
    [{ caseText: "x".repeat(2001), expected: "due" }, "the words are at most 2000 characters"],
    [{ caseText: "What's due on Forager?", expected: " " }, "say what Atlas should have done"],
  ])("LF3: accept with %o is refused", (fields, reason) => {
    const r = applyEvalCandidateEvent(at("logged"), { type: "ACCEPT", ...fields }, as.ACCEPT);
    expect(r.outcome.ok || r.outcome.reason).toBe(reason);
  });

  it("rule 5: deleted after 30 days, not before", () => {
    expect(candidateExpired(at("logged"), later(29.9))).toBe(false);
    expect(candidateExpired(at("logged"), later(30))).toBe(true);
    const early = applyEvalCandidateEvent(at("logged"), { type: "EXPIRE" }, { ...as.EXPIRE, now: later(29) });
    expect(early.outcome.ok || early.outcome.reason).toBe("kept for 30 days");
  });

  it("LF2: only the person opts out, and only once the setting is off", () => {
    const other = applyEvalCandidateEvent(at("logged"), { type: "OPTED_OUT" }, { ...as.OPTED_OUT, actorId: "alicia" });
    expect(other.outcome.ok || other.outcome.reason).toBe("only the person turns it off");
    const stillOn = applyEvalCandidateEvent(at("logged"), { type: "OPTED_OUT" }, { ...as.OPTED_OUT, allows: true });
    expect(stillOn.outcome.ok || stillOn.outcome.reason).toBe("Help improve Atlas is still on");
  });
});

describe("what each state keeps of the person's words (M1)", () => {
  it("logged keeps the words and what DPM did with them", () => {
    expect(applyEvalCandidateEvent(at("none"), { type: "LOGGED" }, as.LOGGED).record).toMatchObject({ text: "What's due on Forager?", detail: { wrong: "#151 is done" }, loggedAt: LOGGED_AT });
  });

  it("LF3: accepted keeps only the case with seed names, and who accepted it", () => {
    const r = applyEvalCandidateEvent(at("logged"), { type: "ACCEPT", caseText: " What's due on Forager? ", expected: "due" }, as.ACCEPT).record;
    expect(r).toMatchObject({ text: null, detail: null, caseText: "What's due on Forager?", expected: "due", decidedBy: "dev", decidedAt: later(1) });
  });

  it("LF4: dismissed keeps the maintainer's note only", () => {
    const r = applyEvalCandidateEvent(at("logged"), { type: "DISMISS", note: " The answer was right " }, as.DISMISS).record;
    expect(r).toMatchObject({ text: null, detail: null, note: "The answer was right", decidedBy: "dev" });
    expect(applyEvalCandidateEvent(at("logged"), { type: "DISMISS", note: "  " }, as.DISMISS).record.note).toBeNull();
  });

  it("LF2 and the timer: deleted keeps nothing of theirs", () => {
    for (const event of [{ type: "EXPIRE" }, { type: "OPTED_OUT" }] as const) {
      expect(applyEvalCandidateEvent(at("logged"), event, as[event.type]).record).toMatchObject({ state: "deleted", text: null, detail: null });
    }
  });
});
