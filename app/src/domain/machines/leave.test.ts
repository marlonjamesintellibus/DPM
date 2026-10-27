import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { acceptExtractedLeave, LEAVE_STATES, leaveSeenByLead, matchLeave, type ExtractedLeave, type LeaveRecord } from "./leave";

// Kemar's approved leave, 26 to 30 Oct
const APPROVED: LeaveRecord = { id: "leave-1", personId: "kemar", start: "2026-10-26", end: "2026-10-30", state: "approved" };
const out = (start: string, end: string | null = null, personId = "kemar"): ExtractedLeave => ({ personId, start, end });

describe("leave matching (M8)", () => {
  it("'I'm out from Monday the 26th' matches approved leave and changes nothing (L16 #5)", () => {
    expect(matchLeave(out("2026-10-26"), [APPROVED])).toEqual({ mark: "matches_leave", leaveId: "leave-1" });
    expect(acceptExtractedLeave(out("2026-10-26", "2026-10-30"), [APPROVED])).toEqual({ kind: "no_change", leaveId: "leave-1" });
  });

  it("days inside approved leave match; days outside it, another person's leave, or a request do not", () => {
    expect(matchLeave(out("2026-10-28", "2026-10-29"), [APPROVED]).mark).toBe("matches_leave");
    expect(matchLeave(out("2026-10-29", "2026-11-03"), [APPROVED]).mark).toBe("needs_ok");
    expect(matchLeave(out("2026-10-26", null, "jodian"), [APPROVED]).mark).toBe("needs_ok");
    expect(matchLeave(out("2026-10-26"), [{ ...APPROVED, state: "requested" }]).mark).toBe("needs_ok");
  });

  it("leave with no match becomes a leave request once accepted, never approved leave", () => {
    expect(acceptExtractedLeave(out("2026-11-09", "2026-11-13"), [APPROVED])).toEqual({
      kind: "request",
      request: { personId: "kemar", start: "2026-11-09", end: "2026-11-13", state: "requested" },
    });
  });

  it("refuses leave that ends before it starts (E22)", () => {
    expect(acceptExtractedLeave(out("2026-11-13", "2026-11-09"), [])).toEqual({ kind: "refused", reason: "leave ends before it starts" });
    expect(acceptExtractedLeave(out("Monday"), []).kind).toBe("refused");
  });
});

describe("leave edge cases", () => {
  it("E17 health words never reach a leave record", () => {
    const extracted = { ...out("2026-11-02"), reason: "not feeling well", quote: "I'm out Monday, not feeling well" };
    const r = acceptExtractedLeave(extracted, []);
    expect(r).toEqual({ kind: "request", request: { personId: "kemar", start: "2026-11-02", end: "2026-11-02", state: "requested" } });
    expect(JSON.stringify(r)).not.toContain("feeling");
  });

  it("E80 a lead sees leave dates and state, never the reason HR holds", () => {
    const row = { ...APPROVED, reason: "medical" };
    expect(leaveSeenByLead(row)).toEqual(APPROVED);
    expect(JSON.stringify(leaveSeenByLead(row))).not.toContain("medical");
  });
});

describe("leave keeps its rules", () => {
  const day = fc.integer({ min: -5, max: 12 }).map((d) => addDays("2026-10-24", d));
  const leave = fc.record({
    personId: fc.constantFrom("kemar", "jodian"),
    start: day,
    end: day,
    state: fc.constantFrom(...LEAVE_STATES),
  });

  it("a capture never approves leave; a match only for the same person's approved leave; nothing but dates is copied", () => {
    fc.assert(
      fc.property(
        fc.record({ personId: fc.constantFrom("kemar", "jodian"), start: day, end: fc.option(day, { nil: null }), reason: fc.string() }),
        fc.array(leave, { maxLength: 4 }).map((ls) => ls.map((l, i): LeaveRecord => ({ ...l, id: `l${i}` }))),
        (extracted, leaves) => {
          const r = acceptExtractedLeave(extracted, leaves);
          if (r.kind === "request") {
            expect(r.request.state).toBe("requested");
            expect(Object.keys(r.request).sort()).toEqual(["end", "personId", "start", "state"]);
          }
          if (r.kind === "no_change") {
            const hit = leaves.find((l) => l.id === r.leaveId);
            expect(hit?.personId).toBe(extracted.personId);
            expect(hit?.state).not.toBe("requested");
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
