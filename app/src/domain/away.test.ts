// Phase P, LV10 and the days a leave covers: a promise due while away is proposed to move to the first working day
// back, once per promise, quoting the leave's own words; none is proposed for a promise already in the message, one
// due outside the leave, or a leave with an open end.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "./atlas-checks/kemar-note.fixture";
import { runChecks } from "./atlas-checks/checks";
import type { CheckContext, RawProposal } from "./atlas-checks/types";
import { firstDayBack, leaveMoves, whileAway } from "./away";
import type { ExtractedItemDraft } from "./shared";

const LEAVE: RawProposal = {
  kind: "update",
  projectId: null,
  routingReason: { basis: "personal", evidence: "I'm off", label: "Personal" },
  targetId: "leave-kemar",
  field: "dates",
  newValue: "",
  quote: "I'm off Monday 26 Oct to Friday 30 Oct",
  confidence: "high",
  rationale: "Leave",
};
const ctx = (commitments: CheckContext["commitments"]): CheckContext => ({ ...KEMAR_CONTEXT, text: "I'm off Monday 26 Oct to Friday 30 Oct.", commitments });
const PROMISE = { id: "cm-wed", what: "Send Andre the export notes", dueOn: "2026-10-28", state: "open", linkId: null };

describe("the days a leave covers", () => {
  it("counts its first and last day; the first day back skips the weekend (CM7, CM8)", () => {
    const range = { start: "2026-10-26", end: "2026-10-30" };
    expect([whileAway("2026-10-26", range), whileAway("2026-10-30", range), whileAway("2026-10-31", range), whileAway(null, range)]).toEqual([true, true, false, false]);
    expect(firstDayBack(range)).toBe("2026-11-02");
    expect(firstDayBack({ start: "2026-10-26", end: "2026-10-28" })).toBe("2026-10-29");
  });
});

describe("LV10: a promise due while away", () => {
  it("is a commitment item moving it to the first working day back, needing the author's OK, quoting the leave", () => {
    const { items } = runChecks([LEAVE], ctx([PROMISE, { ...PROMISE, id: "cm-later", dueOn: "2026-11-04" }]));
    expect(items).toHaveLength(2);
    const [leave, move] = items;
    expect(move).toMatchObject({
      ordinal: 2,
      kind: "commitment",
      scope: "personal",
      projectId: null,
      mark: "needs_ok",
      spans: leave.spans,
      commitment: { act: "promise", what: "Send Andre the export notes", dueOn: "2026-11-02", dueFrom: "leave", commitmentId: "cm-wed", seenDue: "2026-10-28" },
    });
  });

  it("proposes nothing for a promise the message already moves, nor twice for one promise", () => {
    const leave = runChecks([LEAVE], ctx([])).items[0];
    const already: ExtractedItemDraft = { ...leave, ordinal: 2, kind: "commitment", target: undefined, leave: undefined, commitment: { act: "promise", what: "x", dueOn: "2026-11-03", dueFrom: "said", dueWords: null, link: null, commitmentId: "cm-wed", seenDue: "2026-10-28" } };
    expect(leaveMoves([leave, already], { commitments: [PROMISE] })).toEqual([]);
    expect(leaveMoves([leave, { ...leave, ordinal: 2 }], { commitments: [PROMISE] })).toHaveLength(1);
  });

  it("proposes nothing with no promise due then, or for a leave with an open end", () => {
    expect(runChecks([LEAVE], ctx([])).items).toHaveLength(1);
    const leave = runChecks([LEAVE], ctx([])).items[0];
    expect(leaveMoves([{ ...leave, target: { ...leave.target!, newValue: "2026-10-26/.." } }], { commitments: [PROMISE] })).toEqual([]);
    // "From Monday the 26th" matches the leave that starts that day, so its days are known and the promise moves
    const from = runChecks([{ ...LEAVE, quote: "I'm out from Monday the 26th" }], { ...ctx([PROMISE]), text: "I'm out from Monday the 26th." }).items;
    expect(from.map((i) => i.commitment?.dueOn ?? i.target?.newValue)).toEqual(["2026-10-26/2026-10-30", "2026-11-02"]);
  });
});
