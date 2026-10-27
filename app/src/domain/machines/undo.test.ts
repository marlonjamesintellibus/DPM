// Phase L, M30 Undo, and the UNDO arrow each record machine gains (research model undoAndVocabulary.mjs,
// Undo "with the fixes"). Every arrow is tested, and each refusal the guard can give.
import { describe, expect, it } from "vitest";
import { applyHandover, handoverMachine, type HandoverRecord } from "./handover";
import { applyLeaveEvent, leaveMachine, type LeaveRecord } from "./leave";
import { applyMilestone, milestoneMachine, type MilestoneRecord } from "./milestone";
import { applySetStatus, NO_SET_STATUS, setStatusMachine, UNDO_BACK as STATUS_UNDO, type SetStatusRecord } from "./set-status";
import { applyUndo, keyOf, projectsOf, undoMachine, undoVerdict, withinUndoWindow, type SavedRecord, type UndoRecord } from "./undo";
import { applyWorkItem, UNDO_BACK as WORK_UNDO, workItemMachine, type WorkItemRecord } from "./work-item";

const drawn = (m: { arrows: readonly { from: readonly string[]; on: string; to: string }[] }, on: string) =>
  m.arrows.filter((a) => a.on === on).flatMap((a) => a.from.map((f) => `${f}>${a.to}`)).sort();

const SAVED_AT = new Date("2026-10-20T14:30:00Z"); // 9:30am
const mins = (n: number) => new Date(SAVED_AT.getTime() + n * 60_000);
const job = (state: UndoRecord["state"] = "requested"): UndoRecord => ({ id: "u1", captureId: "cap-1", ownerId: "kemar", state, refusal: null });

const W151: SavedRecord = { type: "work_item", id: "wi-151", projectId: "forager", version: 2, before: { state: "in_progress", blockedNote: null, blockedLinks: [], forecastDate: null } };
const B1: SavedRecord = { type: "braid_entry", id: "br-feed-blocker", projectId: "forager", version: 3, before: null };

describe("M30 Undo arrows", () => {
  it("requested --CHECK--> undoing when nothing stops it, and refused with the reason otherwise (UN1, UN2)", () => {
    expect(applyUndo(job(), { type: "CHECK", refusal: null })).toMatchObject({ outcome: { ok: true, to: "undoing" }, record: { state: "undoing", refusal: null } });
    const refusal = { why: "moved" as const, records: [{ type: "work_item" as const, id: "wi-151" }] };
    expect(applyUndo(job(), { type: "CHECK", refusal })).toMatchObject({ outcome: { ok: true, to: "refused" }, record: { refusal } });
  });

  it("undoing --RUN--> undone, or refused when the recheck or an arrow refuses (the model's undoing --> refused)", () => {
    expect(applyUndo(job("undoing"), { type: "RUN", refusal: null }).record.state).toBe("undone");
    expect(applyUndo(job("undoing"), { type: "RUN", refusal: { why: "failed", records: [] } }).record.state).toBe("refused");
  });

  it("draws only these arrows, and the final states take nothing (UN5: once only)", () => {
    expect(undoMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)).sort()).toEqual([
      "requested CHECK refused",
      "requested CHECK undoing",
      "undoing RUN refused",
      "undoing RUN undone",
    ]);
    for (const s of ["undone", "refused"] as const) {
      expect(applyUndo(job(s), { type: "CHECK", refusal: null }).outcome.ok).toBe(false);
      expect(applyUndo(job(s), { type: "RUN", refusal: null }).outcome.ok).toBe(false);
    }
    // Requested never skips the guard (the planted bug skipCheck)
    expect(applyUndo(job(), { type: "RUN", refusal: null }).outcome.ok).toBe(false);
  });
});

describe("the guard (M30, checked at the start and again when the arrows run)", () => {
  const current = new Map([[keyOf(W151), 2], [keyOf(B1), 3]]);
  const verdict = (over: Partial<Parameters<typeof undoVerdict>[0]> = {}) => undoVerdict({ savedAt: SAVED_AT, now: mins(5), records: [W151, B1], current, rightHeld: true, ...over });

  it("passes within undoMinutes, every record at the version the save wrote, the right held", () => {
    expect(verdict()).toBeNull();
    expect(withinUndoWindow(SAVED_AT, mins(15))).toBe(true);
  });

  it("UN1: after the window", () => {
    expect(verdict({ now: mins(16) })).toMatchObject({ why: "too_late" });
  });

  it("UN2: a record someone changed since, or that is gone, is named", () => {
    expect(verdict({ current: new Map([[keyOf(W151), 3], [keyOf(B1), 3]]) })).toEqual({ why: "moved", records: [{ type: "work_item", id: "wi-151" }] });
    expect(verdict({ current: new Map([[keyOf(W151), 2]]) })).toEqual({ why: "moved", records: [{ type: "braid_entry", id: "br-feed-blocker" }] });
  });

  it("rule 4: the right is held now", () => {
    expect(verdict({ rightHeld: false })).toMatchObject({ why: "no_right" });
  });

  it("the projects a save touched; leave is personal", () => {
    expect(projectsOf({ records: [W151, B1, { type: "leave", id: "lv", projectId: null, version: 1, before: null }] })).toEqual(["forager"]);
  });
});

describe("the UNDO arrow on each record machine", () => {
  const work = (state: WorkItemRecord["state"], extra: Partial<WorkItemRecord> = {}): WorkItemRecord => ({
    id: "wi-151",
    projectId: "forager",
    ownerId: "kemar",
    state,
    dueDate: null,
    forecastDate: null,
    blockedNote: state === "blocked" ? "waiting on Kyle" : null,
    blockedLinks: state === "blocked" ? ["br-feed-blocker"] : [],
    ...extra,
  });
  const kemar = { personId: "kemar", role: "member" as const };

  it("M5: one UNDO back for each move a save makes, with the note and links as they were", () => {
    expect(drawn(workItemMachine, "UNDO")).toEqual(WORK_UNDO.map(([f, t]) => `${f}>${t}`).sort());
    for (const [from, to] of WORK_UNDO) {
      const r = applyWorkItem(work(from), { type: "UNDO", to, note: to === "blocked" ? "waiting on Kyle" : null, links: to === "blocked" ? ["br-feed-blocker"] : [], forecast: null }, kemar);
      expect(r.outcome).toMatchObject({ ok: true, from, to });
      expect(r.record).toMatchObject({ state: to, blockedNote: to === "blocked" ? "waiting on Kyle" : null });
    }
    // #151 blocked by the save, undone: In progress, no note, the links it had before
    expect(applyWorkItem(work("blocked"), { type: "UNDO", to: "in_progress", note: null, links: [], forecast: null }, kemar).record).toMatchObject({ state: "in_progress", blockedNote: null, blockedLinks: [] });
    // Section 20, U6: a forecast the save set goes back, keeping the state; Done's cleared forecast comes back with REOPEN's undo
    expect(applyWorkItem(work("in_progress", { forecastDate: "2026-10-26" }), { type: "UNDO", to: "in_progress", note: null, links: [], forecast: null }, kemar).record).toMatchObject({ state: "in_progress", forecastDate: null });
    expect(applyWorkItem(work("done"), { type: "UNDO", to: "in_progress", note: null, links: [], forecast: "2026-10-26" }, kemar).record).toMatchObject({ state: "in_progress", forecastDate: "2026-10-26" });
    // ForecastOnlyByOwner: someone else in the project does not take the owner's forecast back
    expect(applyWorkItem(work("in_progress", { forecastDate: "2026-10-26" }), { type: "UNDO", to: "in_progress", note: null, links: [], forecast: null }, { personId: "alicia", role: "pm" }).outcome.ok).toBe(false);
  });

  it("M5: refused for someone no longer in the project, or to a state the save did not leave", () => {
    expect(applyWorkItem(work("blocked"), { type: "UNDO", to: "in_progress", note: null, links: [], forecast: null }, { personId: "kemar", role: null }).outcome).toMatchObject({ ok: false, reason: "only a project member can undo this" });
    expect(applyWorkItem(work("done"), { type: "UNDO", to: "cancelled", note: null, links: [], forecast: null }, kemar).outcome.ok).toBe(false);
    expect(applyWorkItem(work("cancelled"), { type: "UNDO", to: "in_progress", note: null, links: [], forecast: null }, kemar).outcome.ok).toBe(false);
    expect(applyWorkItem(work("in_progress"), { type: "UNDO", to: "blocked", note: "", links: [], forecast: null }, kemar).outcome.ok).toBe(false);
  });

  const trend = (state: MilestoneRecord["state"] = "in_progress"): MilestoneRecord => ({ id: "ms-trend", projectId: "forager", ownerId: "kemar", state, targetDate: "2026-10-23", forecastDate: "2026-10-26" });

  it("M6: the forecast goes back, in every open state, for the owner only", () => {
    expect(drawn(milestoneMachine, "UNDO")).toEqual(["in_progress>in_progress", "missed>missed", "planned>planned"]);
    for (const s of ["planned", "in_progress", "missed"] as const) {
      expect(applyMilestone(trend(s), { type: "UNDO", forecast: "2026-10-23" }, kemar).record).toMatchObject({ state: s, forecastDate: "2026-10-23" });
    }
    // No forecast before means the forecast is the target
    expect(applyMilestone(trend(), { type: "UNDO", forecast: null }, kemar).record.forecastDate).toBeNull();
    expect(applyMilestone(trend(), { type: "UNDO", forecast: "2026-10-23" }, { personId: "alicia", role: "pm" }).outcome.ok).toBe(false);
    expect(applyMilestone(trend("done"), { type: "UNDO", forecast: "2026-10-23" }, kemar).outcome.ok).toBe(false);
  });

  const runbook = (state: HandoverRecord["state"], stepsDone: number): HandoverRecord => ({ id: "ho", projectId: "forager", fromPersonId: "kemar", toPersonId: "jodian", title: "Runbook", state, stepsDone, stepsTotal: 4 });

  it("M7: steps done go back to what they were", () => {
    expect(drawn(handoverMachine, "UNDO")).toEqual(["handed_over>in_progress", "handed_over>not_started", "in_progress>in_progress", "in_progress>not_started"]);
    expect(applyHandover(runbook("in_progress", 3), { type: "UNDO", done: 2 }).record).toMatchObject({ state: "in_progress", stepsDone: 2 });
    expect(applyHandover(runbook("in_progress", 1), { type: "UNDO", done: 0 }).record).toMatchObject({ state: "not_started", stepsDone: 0 });
    expect(applyHandover(runbook("handed_over", 4), { type: "UNDO", done: 3 }).record).toMatchObject({ state: "in_progress", stepsDone: 3 });
    expect(applyHandover(runbook("handed_over", 4), { type: "UNDO", done: 0 }).record).toMatchObject({ state: "not_started", stepsDone: 0 });
    expect(applyHandover(runbook("in_progress", 2), { type: "UNDO", done: 3 }).outcome.ok).toBe(false);
    expect(applyHandover(runbook("cancelled", 2), { type: "UNDO", done: 1 }).outcome.ok).toBe(false);
  });

  it("M9: a set status the save's plan change cleared or made stale comes back as it was", () => {
    expect(drawn(setStatusMachine, "UNDO")).toEqual(STATUS_UNDO.map(([f, t]) => `${f}>${t}`).sort());
    const offTrack: SetStatusRecord = { override: "explained", setStatus: "off_track", reasonGivenAt: "at_risk" };
    expect(applySetStatus(NO_SET_STATUS, "on_track", { type: "UNDO", before: offTrack }).record).toEqual(offTrack);
    expect(applySetStatus({ ...offTrack, override: "reason_stale" }, "on_track", { type: "UNDO", before: offTrack }).record).toEqual(offTrack);
    const noReason: SetStatusRecord = { override: "reason_required", setStatus: "off_track", reasonGivenAt: null };
    expect(applySetStatus(NO_SET_STATUS, null, { type: "UNDO", before: noReason }).record).toEqual(noReason);
    // Only back to what it was
    expect(applySetStatus({ ...offTrack, override: "reason_stale" }, null, { type: "UNDO", before: noReason }).outcome.ok).toBe(false);
    expect(applySetStatus(offTrack, null, { type: "UNDO", before: offTrack }).outcome.ok).toBe(false);
  });

  const leave = (state: LeaveRecord["state"], change: LeaveRecord["change"] = null): LeaveRecord => ({ id: "lv", personId: "kemar", start: "2026-10-26", end: "2026-10-30", state, change });
  const me = { id: "kemar", isPerson: true, isAdmin: false };

  it("M8: dates the person's own save moved go back; a request it made is withdrawn", () => {
    expect(drawn(leaveMachine, "UNDO")).toEqual(["approved>approved", "covered>covered", "handover_in_progress>handover_in_progress", "requested>requested", "uncovered>uncovered"]);
    expect(applyLeaveEvent(leave("requested"), { type: "UNDO", before: { start: "2026-10-27", end: "2026-10-30", change: null } }, me).record).toMatchObject({ start: "2026-10-27", state: "requested" });
    expect(applyLeaveEvent(leave("approved", { start: "2026-10-27", end: "2026-10-30" }), { type: "UNDO", before: { start: "2026-10-26", end: "2026-10-30", change: null } }, me).record).toMatchObject({ state: "approved", change: null });
    expect(applyLeaveEvent(leave("requested"), { type: "WITHDRAW" }, me).record.state).toBe("withdrawn");
    expect(applyLeaveEvent(leave("requested"), { type: "UNDO", before: { start: "2026-10-27", end: "2026-10-30", change: null } }, { id: "alicia", isPerson: false, isAdmin: true }).outcome.ok).toBe(false);
  });
});
