import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import type { World } from "./membership";
import {
  acceptExtractedLeave,
  applyLeaveEvent,
  changeLeave,
  fitLeave,
  LEAVE_STATES,
  leaveAdmins,
  leaveImpactOwners,
  leaveSeenByLead,
  leaveWaiting,
  LIVE_LEAVE,
  type ExtractedLeave,
  type LeaveActor,
  type LeaveRecord,
} from "./leave";

// Kemar's approved leave, 26 to 30 Oct, and a request for 11 to 13 Nov
const APPROVED: LeaveRecord = { id: "leave-1", personId: "kemar", start: "2026-10-26", end: "2026-10-30", state: "approved" };
const REQUESTED: LeaveRecord = { id: "leave-2", personId: "kemar", start: "2026-11-11", end: "2026-11-13", state: "requested" };
const out = (start: string, end: string | null = null, personId = "kemar"): ExtractedLeave => ({ personId, start, end });

const ADMIN: LeaveActor = { id: "alicia", isPerson: false, isAdmin: true };
const KEMAR: LeaveActor = { id: "kemar", isPerson: true, isAdmin: false };
const JODIAN: LeaveActor = { id: "jodian", isPerson: false, isAdmin: false };

describe("leave matching (M8, D6)", () => {
  it("'I'm out from Monday the 26th' matches approved leave and changes nothing (L16 #5)", () => {
    expect(fitLeave(out("2026-10-26"), [APPROVED])).toEqual({ kind: "matches", leaveId: "leave-1", requested: false, range: { start: "2026-10-26", end: "2026-10-30" } });
    expect(acceptExtractedLeave(out("2026-10-26", "2026-10-30"), [APPROVED])).toEqual({ kind: "no_change", leaveId: "leave-1" });
  });

  it("D6: out 11 to 13 Nov with a request for 11 to 13 Nov matches that request; no second request", () => {
    expect(fitLeave(out("2026-11-11", "2026-11-13"), [APPROVED, REQUESTED])).toMatchObject({ kind: "matches", leaveId: "leave-2", requested: true });
    expect(acceptExtractedLeave(out("2026-11-12", "2026-11-12"), [REQUESTED])).toEqual({ kind: "no_change", leaveId: "leave-2" });
  });

  it("D6: with no leave that fits, a new request; never approved leave", () => {
    expect(acceptExtractedLeave(out("2026-12-02", "2026-12-04"), [APPROVED, REQUESTED])).toEqual({
      kind: "request",
      request: { personId: "kemar", start: "2026-12-02", end: "2026-12-04", state: "requested" },
    });
    expect(fitLeave(out("2026-10-26", null, "jodian"), [APPROVED]).kind).toBe("new");
  });

  it("D6: dates that overlap live leave change it, not a second request", () => {
    expect(fitLeave(out("2026-11-11", "2026-11-14"), [REQUESTED])).toEqual({
      kind: "change",
      leaveId: "leave-2",
      requested: true,
      from: { start: "2026-11-11", end: "2026-11-13" },
      to: { start: "2026-11-11", end: "2026-11-14" },
    });
    // "From the 28th" inside approved leave: the leave starts later
    expect(fitLeave(out("2026-10-28"), [APPROVED])).toMatchObject({ kind: "change", to: { start: "2026-10-28", end: "2026-10-30" } });
  });

  it("declined, withdrawn and ended leave does not count", () => {
    for (const state of ["declined", "withdrawn", "ended"] as const) expect(fitLeave(out("2026-11-11", "2026-11-13"), [{ ...REQUESTED, state }]).kind).toBe("new");
  });

  it("the new dates of a change waiting on approved leave count as no change", () => {
    const waiting = changeLeave(APPROVED, { start: "2026-10-26", end: "2026-11-02" });
    expect(fitLeave(out("2026-10-26", "2026-11-02"), [waiting]).kind).toBe("matches");
  });

  it("refuses leave that ends before it starts (E22)", () => {
    expect(acceptExtractedLeave(out("2026-11-13", "2026-11-09"), [])).toEqual({ kind: "refused", reason: "leave ends before it starts" });
    expect(acceptExtractedLeave(out("Monday"), []).kind).toBe("refused");
  });
});

describe("deciding leave (D6)", () => {
  it("the admin approves or declines a request; the person may withdraw it; nobody else may", () => {
    expect(applyLeaveEvent(REQUESTED, { type: "APPROVE" }, ADMIN).record.state).toBe("approved");
    expect(applyLeaveEvent(REQUESTED, { type: "DECLINE" }, ADMIN).record.state).toBe("declined");
    expect(applyLeaveEvent(REQUESTED, { type: "WITHDRAW" }, KEMAR).record.state).toBe("withdrawn");
    expect(applyLeaveEvent(REQUESTED, { type: "APPROVE" }, JODIAN).outcome).toMatchObject({ ok: false, reason: "only an admin of one of their projects decides leave" });
    expect(applyLeaveEvent(REQUESTED, { type: "APPROVE" }, { ...KEMAR, isAdmin: true }).outcome.ok).toBe(false); // never their own
    expect(applyLeaveEvent(REQUESTED, { type: "WITHDRAW" }, ADMIN).outcome.ok).toBe(false);
  });

  it("a change to approved leave keeps the approved dates until the admin decides", () => {
    const waiting = changeLeave(APPROVED, { start: "2026-10-26", end: "2026-11-02" });
    expect(waiting).toMatchObject({ state: "approved", start: "2026-10-26", end: "2026-10-30", change: { end: "2026-11-02" } });
    expect(leaveWaiting(waiting)).toBe(true);
    expect(applyLeaveEvent(waiting, { type: "APPROVE" }, ADMIN).record).toMatchObject({ state: "approved", end: "2026-11-02", change: null });
    expect(applyLeaveEvent(waiting, { type: "DECLINE" }, ADMIN).record).toMatchObject({ state: "approved", end: "2026-10-30", change: null });
    expect(applyLeaveEvent(waiting, { type: "WITHDRAW" }, KEMAR).record).toMatchObject({ state: "approved", end: "2026-10-30", change: null });
    expect(applyLeaveEvent(APPROVED, { type: "APPROVE" }, ADMIN).outcome).toMatchObject({ ok: false, reason: "no change is waiting" });
  });

  it("a change to a request just moves its dates", () => {
    expect(changeLeave(REQUESTED, { start: "2026-11-11", end: "2026-11-14" })).toMatchObject({ state: "requested", end: "2026-11-14" });
  });
});

describe("who sees and decides it (D4, D6)", () => {
  const world: World = {
    projects: [
      { id: "forager", name: "Forager 2.0", orgTag: "A", connected: true, adminId: "alicia" },
      { id: "insights", name: "Store Insights", orgTag: "A", connected: true, adminId: "andre" },
      { id: "other", name: "Other", orgTag: "A", connected: true, adminId: "malik" },
    ],
    memberships: [
      { projectId: "forager", personId: "alicia", state: "member", role: "pm" },
      { projectId: "forager", personId: "kemar", state: "member", role: "member" },
      { projectId: "forager", personId: "jodian", state: "member", role: "lead" },
      { projectId: "insights", personId: "andre", state: "member", role: "pm" },
      { projectId: "insights", personId: "kemar", state: "member", role: "member" },
      { projectId: "other", personId: "kemar", state: "left", role: "member" },
    ],
  };

  it("each project's PMs, Leads and admin see that project's part; only the projects the person is in", () => {
    expect(leaveImpactOwners("kemar", world)).toEqual([
      { ownerId: "alicia", projectId: "forager" },
      { ownerId: "jodian", projectId: "forager" },
      { ownerId: "andre", projectId: "insights" },
    ]);
    expect(leaveAdmins("kemar", world)).toEqual(["alicia", "andre"]);
  });

  it("a lead's own leave is not shown to them", () => {
    expect(leaveImpactOwners("jodian", world)).toEqual([{ ownerId: "alicia", projectId: "forager" }]);
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

  it("a capture never approves leave, never makes a second overlapping request, and copies dates only (Leave model)", () => {
    fc.assert(
      fc.property(
        fc.record({ personId: fc.constantFrom("kemar", "jodian"), start: day, end: fc.option(day, { nil: null }), reason: fc.string() }),
        fc.array(leave, { maxLength: 4 }).map((ls) => ls.map((l, i): LeaveRecord => ({ ...l, id: `l${i}` }))),
        (extracted, leaves) => {
          const r = acceptExtractedLeave(extracted, leaves);
          if (r.kind === "request") {
            expect(r.request.state).toBe("requested");
            expect(Object.keys(r.request).sort()).toEqual(["end", "personId", "start", "state"]);
            // NoOverlappingLeave: a new request never overlaps live leave of the same person
            const live = leaves.filter((l) => l.personId === extracted.personId && LIVE_LEAVE.includes(l.state) && l.start <= l.end);
            expect(live.some((l) => l.start <= r.request.end && r.request.start <= l.end)).toBe(false);
          }
          if (r.kind === "no_change" || r.kind === "change") {
            const hit = leaves.find((l) => l.id === r.leaveId);
            expect(hit?.personId).toBe(extracted.personId);
            expect(LIVE_LEAVE).toContain(hit?.state);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
