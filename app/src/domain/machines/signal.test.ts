// Phase K, M29 Signal (research model signal.mjs with Memory 'perEpisode' and Escalate, the fixed design).
// Every arrow, the right checked when an answer runs, the memory per episode, the escalation and expiry
// clocks, and who a signal is raised to.
import { describe, expect, it } from "vitest";
import { draftEntry, type BraidLog } from "./braid-entry";
import {
  applySignalEvent,
  draftSignal,
  rememberOf,
  shouldRaise,
  signalCause,
  signalKey,
  signalMachine,
  signalRecipients,
  type SignalMemory,
  type SignalRecord,
} from "./signal";
import type { SignalCondition } from "../signals";

const TODAY = "2026-10-21"; // Wednesday
const stale = (patch: Partial<SignalCondition> = {}): SignalCondition => ({
  rule: "stale_work",
  subjectType: "work_item",
  subjectId: "wi-145",
  level: 1,
  episode: "2026-10-14",
  facts: { rule: "stale_work", label: "#145 Google Trends connector", ownerId: "kemar", days: 5, since: "2026-10-14" },
  ...patch,
});
const blocker = (patch: Partial<SignalCondition> = {}): SignalCondition => ({
  rule: "repeated_blocker",
  subjectType: "braid_entry",
  subjectId: "br-feed-blocker",
  level: 3,
  episode: "2026-10-14",
  facts: { rule: "repeated_blocker", title: "Store sales feed access", reporters: ["Alicia", "Kemar", "Jodian"], reports: 3, reopenedOn: null },
  ...patch,
});
const raised = (condition: SignalCondition, patch: Partial<SignalRecord> = {}): SignalRecord => ({ ...draftSignal("sig-1", "forager", condition, TODAY), state: "raised", ...patch });
const memory = (patch: Partial<SignalMemory> = {}): SignalMemory => ({ episode: "2026-10-14", level: 3, answer: "dismissed", by: "alicia", on: TODAY, reason: "Kyle is on it", seenGone: false, ...patch });
const alicia = { id: "alicia", role: "pm" as const };
const jodian = { id: "jodian", role: "lead" as const };
const kemar = { id: "kemar", role: "member" as const };
const leads = ["alicia", "jodian"];

describe("M29 arrows", () => {
  it("draws only these (rule 2)", () => {
    expect(signalMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)).sort()).toEqual([
      "dismissed SNOOZE_OVER ended",
      "none DETECTED raised",
      "raised ACCEPT accepted",
      "raised CONDITION_GONE cleared",
      "raised DISMISS dismissed",
      "raised ESCALATE raised",
      "raised EXPIRE expired",
      "raised REFRESH raised",
    ]);
  });

  it("(none) --DETECTED--> raised: stale work to its owner first, every other rule to PM and Leads", () => {
    const s = applySignalEvent(draftSignal("sig-1", "forager", stale(), TODAY), { type: "DETECTED", condition: stale(), memory: null, away: false }, { actor: null, today: TODAY });
    expect(s.record).toMatchObject({ state: "raised", stage: "owner", raisedOn: TODAY, stageOn: TODAY, level: 1, episode: "2026-10-14" });
    const b = applySignalEvent(draftSignal("sig-2", "forager", blocker(), TODAY), { type: "DETECTED", condition: blocker(), memory: null, away: false }, { actor: null, today: TODAY });
    expect(b.record).toMatchObject({ state: "raised", stage: "leads" });
  });

  it("SG4: stale work whose owner is on leave is not raised while they are away", () => {
    const r = applySignalEvent(draftSignal("sig-1", "forager", stale(), TODAY), { type: "DETECTED", condition: stale(), memory: null, away: true }, { actor: null, today: TODAY });
    expect(r.outcome).toMatchObject({ ok: false, reason: "its owner is on leave" });
  });

  it("SG3 and the model's fix: an answered signal is not raised again on the same facts; a new episode or worse is", () => {
    const detect = (condition: SignalCondition, m: SignalMemory | null) =>
      applySignalEvent(draftSignal("sig-9", "forager", condition, TODAY), { type: "DETECTED", condition, memory: m, away: false }, { actor: null, today: TODAY }).outcome.ok;
    expect(detect(blocker(), memory())).toBe(false); // same episode, same level: accepted, dismissed or expired, it stays answered
    expect(detect(blocker(), memory({ answer: "accepted" }))).toBe(false);
    expect(detect(blocker(), memory({ answer: "expired" }))).toBe(false);
    expect(detect(blocker({ level: 4 }), memory())).toBe(true); // SG2: worse
    expect(detect(blocker({ episode: "2026-10-20" }), memory())).toBe(true); // it ended and came back
    expect(detect(blocker(), memory({ seenGone: true }))).toBe(true); // a run saw it end
    expect(detect(blocker(), null)).toBe(true);
  });

  it("SG2: a dismissal in memory is shown with the signal raised again", () => {
    const r = applySignalEvent(draftSignal("sig-9", "forager", blocker({ level: 4 }), TODAY), { type: "DETECTED", condition: blocker({ level: 4 }), memory: memory(), away: false }, { actor: null, today: TODAY });
    expect(r.record.earlier).toEqual({ by: "alicia", on: TODAY, reason: "Kyle is on it" });
    const after = applySignalEvent(draftSignal("sig-9", "forager", blocker({ level: 4 }), TODAY), { type: "DETECTED", condition: blocker({ level: 4 }), memory: memory({ answer: "accepted", reason: null }), away: false }, { actor: null, today: TODAY });
    expect(after.record.earlier).toBeNull();
  });

  it("raised --REFRESH--> raised only when worse, with the new facts", () => {
    const worse = blocker({ level: 4, facts: { rule: "repeated_blocker", title: "Store sales feed access", reporters: ["Alicia", "Kemar", "Jodian"], reports: 4, reopenedOn: null } });
    expect(applySignalEvent(raised(blocker()), { type: "REFRESH", condition: worse }, { actor: null, today: TODAY }).record).toMatchObject({ state: "raised", level: 4, facts: { reports: 4 } });
    expect(applySignalEvent(raised(blocker()), { type: "REFRESH", condition: blocker() }, { actor: null, today: TODAY }).outcome.ok).toBe(false);
  });

  it("SG1: raised --CONDITION_GONE--> cleared; a dismissed one waits for its snooze", () => {
    expect(applySignalEvent(raised(blocker()), { type: "CONDITION_GONE" }, { actor: null, today: TODAY }).record.state).toBe("cleared");
    expect(applySignalEvent(raised(blocker(), { state: "dismissed" }), { type: "CONDITION_GONE" }, { actor: null, today: TODAY }).outcome.ok).toBe(false);
  });

  it("the model's fix: raised(owner) --TIMER ownerAnswerDays--> raised(PM and Leads), and the expiry clock starts there", () => {
    const s = raised(stale()); // raised Wednesday 21 Oct
    expect(applySignalEvent(s, { type: "ESCALATE" }, { actor: null, today: "2026-10-22" }).outcome.ok).toBe(false);
    const up = applySignalEvent(s, { type: "ESCALATE" }, { actor: null, today: "2026-10-23" });
    expect(up.record).toMatchObject({ state: "raised", stage: "leads", stageOn: "2026-10-23", raisedOn: TODAY });
    expect(applySignalEvent(up.record, { type: "ESCALATE" }, { actor: null, today: "2026-10-30" }).outcome.ok).toBe(false);
    // Never expires while only the owner has it (StaleWorkReachesLeads)
    expect(applySignalEvent(s, { type: "EXPIRE" }, { actor: null, today: "2026-12-01" }).outcome).toMatchObject({ ok: false, reason: "it is with its owner first" });
    expect(applySignalEvent(up.record, { type: "EXPIRE" }, { actor: null, today: "2026-11-05" }).outcome.ok).toBe(false);
    expect(applySignalEvent(up.record, { type: "EXPIRE" }, { actor: null, today: "2026-11-06" }).record.state).toBe("expired");
  });

  it("raised --ACCEPT--> accepted, by a PM or Lead it is raised to, as they are when it runs (rule 4)", () => {
    const facts = blocker().facts;
    const r = applySignalEvent(raised(blocker()), { type: "ACCEPT", facts }, { actor: jodian, recipients: leads, today: TODAY });
    expect(r.record).toMatchObject({ state: "accepted", decidedBy: "jodian", decidedOn: TODAY });
    expect(applySignalEvent(raised(blocker()), { type: "ACCEPT", facts }, { actor: kemar, recipients: [...leads, "kemar"], today: TODAY }).outcome.ok).toBe(false);
    // SG9: someone who left (no role now, not raised to them) has no right, whatever card they saw
    expect(applySignalEvent(raised(blocker()), { type: "ACCEPT", facts }, { actor: { id: "alicia", role: null }, recipients: ["jodian"], today: TODAY }).outcome.ok).toBe(false);
    expect(applySignalEvent(raised(blocker()), { type: "ACCEPT", facts }, { actor: alicia, recipients: ["jodian"], today: TODAY }).outcome).toMatchObject({ ok: false, reason: "this signal is not raised to you" });
    // The owner's copy of stale work has no Accept, and no PM or Lead has it yet
    expect(applySignalEvent(raised(stale()), { type: "ACCEPT", facts: stale().facts }, { actor: alicia, recipients: leads, today: TODAY }).outcome.ok).toBe(false);
  });

  it("raised --DISMISS(reason)--> dismissed, with a reason; the snooze ends it after signalSnoozeDays", () => {
    expect(applySignalEvent(raised(blocker()), { type: "DISMISS", reason: "  " }, { actor: alicia, recipients: leads, today: TODAY }).outcome.ok).toBe(false);
    const d = applySignalEvent(raised(blocker()), { type: "DISMISS", reason: " Kyle is on it " }, { actor: alicia, recipients: leads, today: TODAY });
    expect(d.record).toMatchObject({ state: "dismissed", dismissReason: "Kyle is on it", decidedBy: "alicia" });
    expect(applySignalEvent(d.record, { type: "SNOOZE_OVER" }, { actor: null, today: "2026-10-27" }).outcome.ok).toBe(false);
    expect(applySignalEvent(d.record, { type: "SNOOZE_OVER" }, { actor: null, today: "2026-10-28" }).record.state).toBe("ended");
  });

  it("final states take nothing (rule 6: a second tap files nothing)", () => {
    for (const state of ["accepted", "cleared", "expired", "ended"] as const) {
      for (const e of [{ type: "ACCEPT", facts: blocker().facts }, { type: "DISMISS", reason: "x" }, { type: "CONDITION_GONE" }, { type: "EXPIRE" }, { type: "ESCALATE" }, { type: "SNOOZE_OVER" }] as const) {
        expect(applySignalEvent(raised(blocker(), { state }), e, { actor: alicia, recipients: leads, today: "2026-12-31" }).outcome.ok).toBe(false);
      }
    }
  });
});

describe("M29 memory, recipients and causes", () => {
  it("ACCEPT, DISMISS and expiry each leave a memory of the level and episode; clearing leaves none", () => {
    expect(rememberOf(raised(blocker(), { state: "accepted", decidedBy: "alicia", decidedOn: TODAY }), TODAY)).toEqual({ episode: "2026-10-14", level: 3, answer: "accepted", by: "alicia", on: TODAY, reason: null, seenGone: false });
    expect(rememberOf(raised(blocker(), { state: "expired" }), TODAY)).toMatchObject({ answer: "expired", by: null, on: TODAY });
    expect(rememberOf(raised(blocker(), { state: "cleared" }), TODAY)).toBeNull();
    expect(shouldRaise(rememberOf(raised(blocker(), { state: "expired" }), TODAY), blocker())).toBe(false);
  });

  it("SG9: raised to the PM and Leads it has now; quiet projects to the PM; waiting decisions to the deciders", () => {
    const members = [
      { id: "alicia", role: "pm" as const },
      { id: "jodian", role: "lead" as const },
      { id: "kemar", role: "member" as const },
    ];
    const log: BraidLog = { "br-risk": { ...draftEntry({ id: "br-risk", projectId: "forager", kind: "risk", title: "Trend model may slip" }), state: "proposed", reportedBy: "kemar" } };
    expect(signalRecipients(raised(blocker()), members, log)).toEqual(["alicia", "jodian"]);
    expect(signalRecipients(raised(blocker()), members.filter((m) => m.id !== "alicia"), log)).toEqual(["jodian"]);
    expect(signalRecipients(raised(stale()), members, log)).toEqual(["kemar"]);
    expect(signalRecipients(raised(stale()), members.filter((m) => m.id !== "kemar"), log)).toEqual([]);
    expect(signalRecipients(raised(stale(), { stage: "leads" }), members, log)).toEqual(["alicia", "jodian"]);
    const quiet: SignalCondition = { rule: "quiet_project", subjectType: "project", subjectId: "forager", level: 1, episode: "2026-10-15", facts: { rule: "quiet_project", project: "Forager 2.0", days: 3, lastOn: "2026-10-15" } };
    expect(signalRecipients(raised(quiet), members, log)).toEqual(["alicia"]);
    const waiting: SignalCondition = {
      rule: "waiting_decision",
      subjectType: "braid_entry",
      subjectId: "br-risk",
      level: 1,
      episode: "1@2026-10-13",
      facts: { rule: "waiting_decision", request: false, kind: "risk", toKind: null, title: "Trend model may slip", by: "Kemar", days: 6 },
    };
    expect(signalRecipients(raised(waiting), members, log)).toEqual(["alicia", "jodian"]);
  });

  it("SG10: one cause per project per day it reached them; only while raised", () => {
    expect(signalCause(raised(blocker()))).toBe("signals:forager@2026-10-21");
    expect(signalCause(raised(blocker(), { state: "dismissed" }))).toBeNull();
    expect(signalKey({ projectId: "forager", rule: "stale_work", subjectId: "wi-145" })).toBe("forager|stale_work|wi-145");
  });
});
