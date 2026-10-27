import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { BRAID_KINDS, landsAs, mayDecide, mayResolve, PROJECT_ROLES, type BraidKind, type ProjectRole } from "../rights";
import { evaluateCause, LIVE, type InboxItemRef, type InboxPlan } from "./inbox-item";
import { linkConflict } from "./match";
import {
  applyBraidEvent,
  applyToLog,
  braidEntryCauses,
  braidEntryMachine,
  braidReminderDue,
  draftEntry,
  KIND_STATES,
  ON_LOG_AS,
  type BraidActor,
  type BraidCtx,
  type BraidEntryRecord,
  type BraidEntryState,
  type BraidEvent,
  type BraidLog,
  type BraidSource,
  type ProjectMember,
} from "./braid-entry";

const TODAY = "2026-10-20"; // Tuesday
const P = "forager";

const kemar: BraidActor = { id: "kemar", role: "member" };
const jodian: BraidActor = { id: "jodian", role: "member", ownsBlockedWork: true };
const alicia: BraidActor = { id: "alicia", role: "pm" };
const andre: BraidActor = { id: "andre", role: "lead" };
const outsider: BraidActor = { id: "sam", role: null };

const src = (id: string, personId = "kemar"): BraidSource => ({ id, personId, captureId: "c1", span: { start: 0, end: 10 }, at: `${TODAY}T08:58:00-05:00` });
const ctx = (actor: BraidActor | null, extra: Partial<BraidCtx> = {}): BraidCtx => ({ actor, today: TODAY, ...extra });
const apply = (r: BraidEntryRecord, e: BraidEvent, actor: BraidActor | null, extra: Partial<BraidCtx> = {}) => applyBraidEvent(r, e, ctx(actor, extra));

function reported(kind: BraidKind, by: BraidActor = kemar, id = "e1"): BraidEntryRecord {
  const r = apply(draftEntry({ id, projectId: P, kind, title: `a ${kind}` }), { type: "REPORT", source: src(`${id}-s1`, by.id) }, by);
  if (!r.outcome.ok) throw new Error(r.outcome.reason);
  return r.record;
}

// An entry already in a state, for arrow tests. Records are plain data, so this is the same row the database would hold.
function at(kind: BraidKind, state: BraidEntryState, patch: Partial<BraidEntryRecord> = {}): BraidEntryRecord {
  const base = draftEntry({ id: "e1", projectId: P, kind, title: `a ${kind}` });
  if (state === "none") return { ...base, ...patch };
  return { ...base, state, reportedBy: "kemar", sources: [src("s1")], round: 1, proposedOn: TODAY, ...patch };
}

const kindFor = (s: BraidEntryState): BraidKind => BRAID_KINDS.find((k) => KIND_STATES[k].includes(s))!;

describe("BRAID entry arrows (every drawn arrow)", () => {
  type Row = { kind: BraidKind; from: BraidEntryState; event: BraidEvent; actor: BraidActor | null; to: BraidEntryState; patch?: Partial<BraidEntryRecord>; extra?: Partial<BraidCtx> };
  const S = src("s2", "jodian");
  const rows: Row[] = [
    { kind: "blocker", from: "none", event: { type: "REPORT", source: S }, actor: kemar, to: "reported" },
    { kind: "risk", from: "none", event: { type: "REPORT", source: S }, actor: kemar, to: "proposed" },
    { kind: "risk", from: "none", event: { type: "REPORT", source: S }, actor: alicia, to: "open" },
    { kind: "assumption", from: "none", event: { type: "REPORT", source: S }, actor: andre, to: "holding" },
    { kind: "risk", from: "proposed", event: { type: "APPROVE" }, actor: alicia, to: "open" },
    { kind: "assumption", from: "proposed", event: { type: "APPROVE" }, actor: andre, to: "holding" },
    { kind: "decision", from: "proposed", event: { type: "APPROVE" }, actor: andre, to: "approved" },
    { kind: "decision", from: "proposed", event: { type: "APPROVE" }, actor: andre, to: "proposed", extra: { policy: { approversNeeded: 2 } } },
    { kind: "risk", from: "proposed", event: { type: "DECLINE", reason: "covered by R2" }, actor: alicia, to: "declined" },
    { kind: "risk", from: "proposed", event: { type: "REQUEST_INFO", question: "which feed?" }, actor: alicia, to: "more_info" },
    { kind: "risk", from: "more_info", event: { type: "REPLY", answer: "the store feed" }, actor: kemar, to: "proposed" },
    { kind: "risk", from: "proposed", event: { type: "WITHDRAW" }, actor: kemar, to: "withdrawn" },
    { kind: "risk", from: "more_info", event: { type: "WITHDRAW" }, actor: kemar, to: "withdrawn" },
    { kind: "blocker", from: "reported", event: { type: "WITHDRAW" }, actor: kemar, to: "withdrawn" },
    // D11: with others' reports on it, withdrawing takes back only Kemar's; the entry stays
    { kind: "risk", from: "proposed", event: { type: "WITHDRAW" }, actor: kemar, to: "proposed", patch: { sources: [src("s1"), src("s2", "jodian")] } },
    { kind: "risk", from: "more_info", event: { type: "WITHDRAW" }, actor: kemar, to: "more_info", patch: { sources: [src("s1"), src("s2", "jodian")] } },
    { kind: "blocker", from: "reported", event: { type: "WITHDRAW" }, actor: kemar, to: "reported", patch: { sources: [src("s1"), src("s2", "jodian")] } },
    // D10: a PM or Lead drops a follow up Atlas drafted
    { kind: "issue", from: "none", event: { type: "WITHDRAW" }, actor: alicia, to: "withdrawn", patch: { links: [{ relation: "raised_from", entryId: "r9" }] } },
    { kind: "blocker", from: "reported", event: { type: "RESOLVE" }, actor: jodian, to: "resolved" },
    { kind: "risk", from: "open", event: { type: "RESOLVE", outcome: "closed" }, actor: alicia, to: "closed" },
    { kind: "risk", from: "mitigating", event: { type: "RESOLVE", outcome: "closed" }, actor: alicia, to: "closed" },
    { kind: "risk", from: "open", event: { type: "RESOLVE", outcome: "realised" }, actor: alicia, to: "realised" },
    { kind: "risk", from: "mitigating", event: { type: "RESOLVE", outcome: "realised" }, actor: andre, to: "realised" },
    { kind: "assumption", from: "holding", event: { type: "RESOLVE", outcome: "confirmed" }, actor: andre, to: "confirmed" },
    { kind: "assumption", from: "holding", event: { type: "RESOLVE", outcome: "broken" }, actor: alicia, to: "broken" },
    { kind: "dependency", from: "open", event: { type: "RESOLVE", outcome: "met" }, actor: alicia, to: "met" },
    { kind: "dependency", from: "waiting", event: { type: "RESOLVE", outcome: "met" }, actor: alicia, to: "met" },
    { kind: "dependency", from: "open", event: { type: "RESOLVE", outcome: "late" }, actor: andre, to: "late" },
    { kind: "dependency", from: "waiting", event: { type: "RESOLVE", outcome: "late" }, actor: andre, to: "late" },
    { kind: "blocker", from: "resolved", event: { type: "REOPEN" }, actor: andre, to: "reported" },
    { kind: "risk", from: "open", event: { type: "PROGRESS" }, actor: alicia, to: "mitigating" },
    { kind: "dependency", from: "open", event: { type: "PROGRESS" }, actor: andre, to: "waiting" },
    { kind: "blocker", from: "reported", event: { type: "PROPOSE_RESOLVE" }, actor: kemar, to: "reported" },
    { kind: "blocker", from: "reported", event: { type: "KEEP_OPEN" }, actor: alicia, to: "reported", patch: { resolveProposedBy: "kemar" } },
    { kind: "blocker", from: "reported", event: { type: "ACKNOWLEDGE" }, actor: alicia, to: "reported", patch: { newAlert: true } },
    { kind: "risk", from: "proposed", event: { type: "REMIND" }, actor: null, to: "proposed", patch: { proposedOn: "2026-10-16" } },
    {
      kind: "decision",
      from: "approved",
      event: { type: "SUPERSEDE", by: { ...at("decision", "approved"), id: "e2", links: [{ relation: "conflicts_with", entryId: "e1" }] } },
      actor: null,
      to: "superseded",
      patch: { links: [{ relation: "conflicts_with", entryId: "e2" }] },
    },
  ];
  // Every live state takes a repeat report; resolved and declined ones are decided again (S14, E85)
  for (const s of braidEntryMachine.arrows.filter((a) => a.on === "ADD_SOURCE").flatMap((a) => a.from)) {
    const kind = kindFor(s);
    rows.push({ kind, from: s, event: { type: "ADD_SOURCE", projectId: P, kind, source: S }, actor: jodian, to: s === "resolved" ? "reported" : s === "declined" ? "proposed" : s });
  }
  for (const s of braidEntryMachine.arrows.find((a) => a.on === "MERGE")!.from) {
    const kind = kindFor(s);
    rows.push({ kind, from: s, event: { type: "MERGE", into: { ...at(kind, s), id: "e2" } }, actor: alicia, to: "merged" });
    rows.push({ kind, from: "merged", event: { type: "UNMERGE", target: { ...at(kind, s), id: "e2" } }, actor: alicia, to: s, patch: { mergedInto: "e2", stateBeforeMerge: s } });
  }

  it.each(rows.map((r) => [`${r.kind} ${r.from} --${r.event.type}--> ${r.to}`, r] as const))("%s", (_, row) => {
    const result = apply(at(row.kind, row.from, row.patch), row.event, row.actor, row.extra);
    expect(result.outcome).toMatchObject({ ok: true, to: row.to });
    expect(result.record.state).toBe(row.to);
  });

  it("the rows above cover every drawn arrow", () => {
    const drawn = new Set(braidEntryMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map((r) => `${r.from} ${r.event.type} ${r.to}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });

  it("each kind only ever reaches its own states", () => {
    for (const row of rows) expect(KIND_STATES[row.kind]).toContain(row.to);
  });
});

describe("BRAID entry refusals", () => {
  const refused = (r: BraidEntryRecord, e: BraidEvent, actor: BraidActor | null, extra?: Partial<BraidCtx>) => {
    const result = apply(r, e, actor, extra);
    expect(result.outcome.ok).toBe(false);
    expect(result.record).toBe(r); // a refused event changes nothing
    return result.outcome.ok ? "" : result.outcome.reason;
  };

  it("REPORT lands where the rights table says, for every kind and role", () => {
    for (const kind of BRAID_KINDS) {
      for (const role of PROJECT_ROLES) {
        const r = apply(draftEntry({ id: "e1", projectId: P, kind, title: "t" }), { type: "REPORT", source: src("s") }, { id: "x", role });
        const where = landsAs(kind, role);
        expect(r.record.state).toBe(where === "reported" ? "reported" : where === "proposed" ? "proposed" : ON_LOG_AS[kind]);
      }
    }
  });

  it("REPORT can never produce approved: no arrow from none to approved", () => {
    expect(braidEntryMachine.arrows.filter((a) => a.on === "REPORT").map((a) => a.to)).not.toContain("approved");
  });

  it("refuses a report from someone who is not on the project, and a second report", () => {
    expect(refused(at("blocker", "none"), { type: "REPORT", source: src("s") }, outsider)).toMatch(/member/);
    expect(refused(reported("blocker"), { type: "REPORT", source: src("s") }, kemar)).toMatch(/no arrow/);
  });

  it("only a PM or Lead decides, checked by the role they hold now", () => {
    for (const kind of ["risk", "assumption", "dependency", "decision"] as const) {
      expect(refused(at(kind, "proposed"), { type: "APPROVE" }, kemar)).toMatch(/member may not decide/);
      refused(at(kind, "proposed"), { type: "DECLINE", reason: "no" }, kemar);
      refused(at(kind, "proposed"), { type: "REQUEST_INFO", question: "?" }, kemar);
      refused(at(kind, "proposed"), { type: "APPROVE" }, outsider);
    }
  });

  it("refuses deciding anything that is not proposed", () => {
    for (const s of ["more_info", "open", "declined", "withdrawn", "merged"] as const) refused(at("risk", s), { type: "APPROVE" }, alicia);
    refused(at("blocker", "reported"), { type: "APPROVE" }, alicia); // blockers need no approval
  });

  it("a decline needs a reason and a request for more needs a question", () => {
    expect(refused(at("risk", "proposed"), { type: "DECLINE", reason: " " }, alicia)).toMatch(/reason/);
    expect(refused(at("risk", "proposed"), { type: "REQUEST_INFO", question: "" }, alicia)).toMatch(/need/);
  });

  it("only the reporter replies or withdraws", () => {
    refused(at("risk", "more_info"), { type: "REPLY", answer: "x" }, alicia);
    refused(at("risk", "proposed"), { type: "WITHDRAW" }, alicia);
    refused(at("risk", "open"), { type: "WITHDRAW" }, kemar); // decided already
  });

  it("D11 withdrawing a blocker others reported takes back only your own report", () => {
    const r = apply(at("blocker", "reported", { sources: [src("s1"), src("s2", "jodian")] }), { type: "WITHDRAW" }, kemar);
    expect(r.record).toMatchObject({ state: "reported", reportedBy: "jodian" });
    expect(r.record.sources.map((s) => s.personId)).toEqual(["jodian"]);
    // Jodian, who reported it too, may take back theirs even though Kemar reported it first
    expect(apply(at("blocker", "reported", { sources: [src("s1"), src("s2", "jodian")] }), { type: "WITHDRAW" }, jodian).record.sources.map((s) => s.personId)).toEqual(["kemar"]);
    refused(at("blocker", "reported"), { type: "WITHDRAW" }, jodian); // never reported it
  });

  it("D11 the last report goes only after anyone who said it is cleared is answered", () => {
    expect(refused(at("blocker", "reported", { resolveProposedBy: "jodian" }), { type: "WITHDRAW" }, kemar)).toMatch(/answers first/);
  });

  it("D10 only a PM or Lead drops a drafted follow up, and only a drafted one", () => {
    refused(at("issue", "none", { links: [{ relation: "raised_from", entryId: "r9" }] }), { type: "WITHDRAW" }, kemar);
    refused(at("issue", "none"), { type: "WITHDRAW" }, alicia);
  });

  it("S13: a blocker is resolved by the owner of the blocked work or a PM or Lead, nobody else", () => {
    expect(refused(at("blocker", "reported"), { type: "RESOLVE" }, kemar)).toMatch(/owner of the blocked work/);
    refused(at("blocker", "reported"), { type: "RESOLVE" }, outsider);
    for (const who of [jodian, alicia, andre]) expect(apply(at("blocker", "reported"), { type: "RESOLVE" }, who).record.resolvedBy).toBe(who.id);
    refused(at("blocker", "resolved"), { type: "REOPEN" }, kemar);
  });

  it("an issue is resolved by a PM, Lead or the entry's owner", () => {
    refused(at("issue", "reported"), { type: "RESOLVE" }, kemar);
    expect(apply(at("issue", "reported", { ownerId: "kemar" }), { type: "RESOLVE" }, kemar).outcome.ok).toBe(true);
    refused(at("issue", "reported"), { type: "RESOLVE" }, jodian); // owning blocked work means nothing for an issue
  });

  it("risks, assumptions and dependencies are resolved by a PM or Lead, with how they ended", () => {
    refused(at("risk", "open"), { type: "RESOLVE", outcome: "closed" }, kemar);
    expect(refused(at("risk", "open"), { type: "RESOLVE" }, alicia)).toMatch(/outcome/);
    refused(at("risk", "open"), { type: "RESOLVE", outcome: "met" }, alicia);
    refused(at("assumption", "holding"), { type: "RESOLVE", outcome: "closed" }, alicia);
    refused(at("decision", "approved"), { type: "RESOLVE", outcome: "closed" }, alicia); // superseded only by a later decision
    refused(at("risk", "open"), { type: "PROGRESS" }, kemar);
  });

  it("only someone without the right proposes a blocker is cleared, once", () => {
    expect(refused(at("blocker", "reported"), { type: "PROPOSE_RESOLVE" }, jodian)).toMatch(/yourself/);
    refused(at("blocker", "reported", { resolveProposedBy: "kemar" }), { type: "PROPOSE_RESOLVE" }, kemar);
    // D7: an issue can be said to be cleared too, by someone who may not resolve it
    expect(apply(at("issue", "reported"), { type: "PROPOSE_RESOLVE" }, kemar).record.resolveProposedBy).toBe("kemar");
    refused(at("issue", "reported", { ownerId: "kemar" }), { type: "PROPOSE_RESOLVE" }, kemar); // he may resolve it himself
    refused(at("risk", "open"), { type: "PROPOSE_RESOLVE" }, kemar);
    refused(at("blocker", "reported"), { type: "KEEP_OPEN" }, alicia);
    refused(at("blocker", "reported", { resolveProposedBy: "kemar" }), { type: "KEEP_OPEN" }, kemar);
    refused(at("blocker", "reported", { newAlert: true }), { type: "ACKNOWLEDGE" }, andre);
  });

  it("ADD_SOURCE refuses another project, another kind, a merged or withdrawn entry, and the same report twice", () => {
    const e = at("blocker", "reported");
    refused(e, { type: "ADD_SOURCE", projectId: "insights", kind: "blocker", source: src("s9") }, kemar);
    expect(refused(e, { type: "ADD_SOURCE", projectId: P, kind: "risk", source: src("s9") }, kemar)).toMatch(/kinds never merge/);
    refused(at("blocker", "merged"), { type: "ADD_SOURCE", projectId: P, kind: "blocker", source: src("s9") }, kemar);
    refused(at("blocker", "withdrawn"), { type: "ADD_SOURCE", projectId: P, kind: "blocker", source: src("s9") }, kemar);
    expect(refused(e, { type: "ADD_SOURCE", projectId: P, kind: "blocker", source: src("s1") }, kemar)).toMatch(/already/);
    refused(e, { type: "ADD_SOURCE", projectId: P, kind: "blocker", source: src("s9") }, outsider);
  });

  it("MERGE: PM only, same project and kind, never into itself or a gone entry", () => {
    const other = { ...at("blocker", "reported"), id: "e2" };
    expect(refused(at("blocker", "reported"), { type: "MERGE", into: other }, andre)).toMatch(/PM/);
    expect(refused(at("blocker", "reported"), { type: "MERGE", into: { ...other, kind: "risk", state: "open" } }, alicia)).toMatch(/kinds never merge/);
    refused(at("blocker", "reported"), { type: "MERGE", into: { ...other, projectId: "insights" } }, alicia);
    refused(at("blocker", "reported"), { type: "MERGE", into: at("blocker", "reported") }, alicia);
    refused(at("blocker", "reported"), { type: "MERGE", into: { ...other, state: "withdrawn" } }, alicia);
  });

  it("UNMERGE only in reverse order", () => {
    const merged = at("blocker", "merged", { mergedInto: "e2", stateBeforeMerge: "reported" });
    const target = { ...at("blocker", "merged", { mergedInto: "e3" }), id: "e2" };
    expect(refused(merged, { type: "UNMERGE", target }, alicia)).toMatch(/reverse order/);
    refused(merged, { type: "UNMERGE", target: { ...target, id: "e9", mergedInto: null } }, alicia);
  });

  it("SUPERSEDE needs an approved decision linked as conflicting, and never comes from a person", () => {
    const by = { ...at("decision", "approved"), id: "e2" };
    expect(refused(at("decision", "approved"), { type: "SUPERSEDE", by }, null)).toMatch(/not linked/);
    const log: BraidLog = { e1: at("decision", "approved") };
    expect(applyToLog(log, "e1", { type: "SUPERSEDE", by }, ctx(alicia)).outcome.ok).toBe(false);
    expect(applyToLog(log, "e1", { type: "MERGE", into: by }, ctx(alicia)).outcome.ok).toBe(false);
  });
});

describe("BRAID edge cases (machines doc 3.8)", () => {
  const members: ProjectMember[] = [
    { id: "kemar", role: "member" },
    { id: "alicia", role: "pm" },
    { id: "andre", role: "lead" },
  ];

  it("E85 a declined risk is reported again: the PM decides again and sees the earlier decline", () => {
    let e = reported("risk");
    e = apply(e, { type: "DECLINE", reason: "already covered" }, alicia).record;
    expect(braidEntryCauses(e, members)).toEqual([]);
    e = apply(e, { type: "ADD_SOURCE", projectId: P, kind: "risk", source: src("s2") }, kemar).record;
    expect(e.state).toBe("proposed");
    expect(e.round).toBe(2);
    expect(e.decidedBy).toBeNull();
    expect(e.answers).toMatchObject([{ by: "alicia", act: "decline", note: "already covered", round: 1 }]);
    expect(braidEntryCauses(e, members)).toEqual(["approve:e1"]);
  });

  it("E89 the proposer holds the right and approves their own decision: self-approved", () => {
    let e = reported("decision", andre);
    expect(e.state).toBe("proposed"); // S12: still a separate, explicit act
    e = apply(e, { type: "APPROVE" }, andre).record;
    expect(e).toMatchObject({ state: "approved", decidedBy: "andre", selfApproved: true });
    // With self-approval off, the proposer cannot, and nobody else is there to decide
    const off = { policy: { selfApproval: false } };
    expect(apply(reported("decision", andre), { type: "APPROVE" }, andre, off).outcome.ok).toBe(false);
    expect(braidEntryCauses(reported("decision", andre), [{ id: "andre", role: "lead" }], off.policy)).toEqual(["no_decider:e1"]);
  });

  it("E90 two approvers needed: one approves, one declines; declined with both answers kept", () => {
    const two = { policy: { approversNeeded: 2 } };
    let e = reported("decision");
    e = apply(e, { type: "APPROVE" }, andre, two).record;
    expect(e.state).toBe("proposed");
    expect(apply(e, { type: "APPROVE" }, andre, two).outcome.ok).toBe(false); // the same person twice counts once
    expect(braidEntryCauses(e, members, two.policy)).toEqual(["approve:e1"]); // Alicia still asked
    e = apply(e, { type: "DECLINE", reason: "keep 5am" }, alicia, two).record;
    expect(e.state).toBe("declined");
    expect(e.answers.map((a) => [a.by, a.act])).toEqual([
      ["andre", "approve"],
      ["alicia", "decline"],
    ]);
    const both = apply(apply(reported("decision"), { type: "APPROVE" }, andre, two).record, { type: "APPROVE" }, alicia, two);
    expect(both.record).toMatchObject({ state: "approved", decidedBy: "alicia" });
  });

  it("E91 nobody holds PM or Lead: the proposal waits and the owner is told", () => {
    const e = reported("risk");
    expect(braidEntryCauses(e, [{ id: "kemar", role: "member" }])).toEqual(["no_decider:e1"]);
    expect(braidEntryCauses(e, [{ id: "kemar", role: "member" }, { id: "andre", role: "lead" }])).toEqual(["approve:e1"]);
  });

  it("E92 the reporter holds the right: straight on the log, reported and approved by them", () => {
    expect(reported("risk", alicia)).toMatchObject({ state: "open", reportedBy: "alicia", decidedBy: "alicia" });
    expect(reported("dependency", andre).state).toBe("open");
    expect(reported("assumption", alicia).state).toBe("holding");
  });

  it("E93 resolution by conversation: the owner resolves; anyone else's 'it's cleared' waits for them", () => {
    let e = reported("blocker", alicia);
    e = apply(e, { type: "ACKNOWLEDGE" }, alicia).record;
    expect(apply(e, { type: "RESOLVE" }, kemar).outcome.ok).toBe(false);
    e = apply(e, { type: "PROPOSE_RESOLVE" }, kemar).record;
    expect(braidEntryCauses(e, members)).toEqual(["clear:e1"]);
    e = apply(e, { type: "RESOLVE" }, { ...kemar, ownsBlockedWork: true }).record;
    expect(e).toMatchObject({ state: "resolved", resolvedBy: "kemar", resolveProposedBy: null });
    expect(braidEntryCauses(e, members)).toEqual([]);
  });

  it("E96 'Andre approved moving the refresh' is still a proposed decision", () => {
    const e = apply(draftEntry({ id: "d1", projectId: "insights", kind: "decision", title: "Refresh at 6am" }), { type: "REPORT", source: src("s"), wordsClaimApproval: true }, kemar).record;
    expect(e).toMatchObject({ state: "proposed", decidedBy: null });
    expect(braidEntryCauses(e, members)).toEqual(["approve:d1"]);
  });

  it("E97 the PM's role is removed while the approval is open: refused when it runs, others are asked", () => {
    const e = reported("risk");
    const demoted = { ...alicia, role: "member" as const };
    expect(apply(e, { type: "APPROVE" }, demoted).outcome).toMatchObject({ ok: false, reason: "a member may not decide a risk" });
    expect(braidEntryCauses(e, [{ id: "kemar", role: "member" }, { id: "alicia", role: "member" }, { id: "andre", role: "lead" }])).toEqual(["approve:e1"]);
  });

  it("E98 a proposed risk is never answered: reminders on the S18 schedule, never a decision", () => {
    let e: BraidEntryRecord = { ...reported("risk"), proposedOn: "2026-10-16" }; // a Friday
    expect(braidReminderDue(e, "2026-10-18")).toBe(false); // the weekend is not working days
    expect(braidReminderDue(e, "2026-10-19")).toBe(false);
    expect(braidReminderDue(e, "2026-10-20")).toBe(true);
    let today = "2026-10-20";
    for (let i = 0; i < 10; i++) {
      const r = apply(e, { type: "REMIND" }, null, { today });
      expect(r.outcome.ok).toBe(true);
      e = r.record;
      expect(e.state).toBe("proposed");
      expect(apply(e, { type: "REMIND" }, null, { today: addDays(today, 6) }).outcome.ok).toBe(false); // weekly after the first
      today = addDays(today, 7);
    }
    expect(e).toMatchObject({ remindersSent: 10, decidedBy: null });
    expect(apply(e, { type: "WITHDRAW" }, kemar).record.state).toBe("withdrawn");
  });

  it("E99 the reporter withdraws after the PM asked for more: the item closes", () => {
    let e = reported("risk");
    e = apply(e, { type: "REQUEST_INFO", question: "Which milestone?" }, alicia).record;
    expect(braidEntryCauses(e, members)).toEqual(["more_info:e1"]);
    e = apply(e, { type: "WITHDRAW" }, kemar).record;
    expect(e.state).toBe("withdrawn");
    expect(braidEntryCauses(e, members)).toEqual([]);
  });

  it("E84 (entry side) only the first report raises 'New blocker'; added sources never do", () => {
    let e = reported("blocker", alicia);
    expect(braidEntryCauses(e, members)).toEqual(["blocker_new:e1"]);
    e = apply(e, { type: "ACKNOWLEDGE" }, alicia).record;
    for (let i = 2; i <= 7; i++) e = apply(e, { type: "ADD_SOURCE", projectId: P, kind: "blocker", source: src(`s${i}`) }, kemar).record;
    expect(e.sources).toHaveLength(7);
    expect(braidEntryCauses(e, members)).toEqual([]);
  });

  it("S14 a resolved blocker reported again is the same entry, reopened", () => {
    let e = apply(reported("blocker"), { type: "RESOLVE" }, alicia).record;
    e = apply(e, { type: "ADD_SOURCE", projectId: P, kind: "blocker", source: src("s2", "jodian") }, jodian).record;
    expect(e).toMatchObject({ id: "e1", state: "reported", resolvedBy: null, newAlert: false });
    expect(e.sources.map((s) => s.id)).toEqual(["e1-s1", "s2"]);
  });
});

describe("decisions that conflict (E87, E88)", () => {
  function twoDecisions(): BraidLog {
    let log: BraidLog = {
      d5: reported("decision", kemar, "d5"),
      d6: reported("decision", kemar, "d6"),
    };
    const linked = linkConflict(log, "d5", "d6");
    if (!linked.ok) throw new Error(linked.reason);
    log = linked.log;
    return log;
  }

  it("E87 approving a decision that contradicts an approved one supersedes it", () => {
    let log = twoDecisions();
    log = applyToLog(log, "d5", { type: "APPROVE" }, ctx(andre)).log;
    log = applyToLog(log, "d6", { type: "APPROVE" }, ctx(andre)).log;
    expect(log.d6.state).toBe("approved");
    expect(log.d5.state).toBe("superseded");
    expect(log.d6.links).toContainEqual({ relation: "supersedes", entryId: "d5" });
  });

  it("E88 two pending decisions conflict: approving one does not decline the other", () => {
    let log = twoDecisions();
    log = applyToLog(log, "d6", { type: "APPROVE" }, ctx(andre)).log;
    expect(log.d5.state).toBe("proposed");
    expect(log.d5.links).toContainEqual({ relation: "conflicts_with", entryId: "d6" });
  });
});

describe("use case 1: who decides on the BRAID log (machine map story braid-approvals)", () => {
  const members: ProjectMember[] = [
    { id: "kemar", role: "member" },
    { id: "alicia", role: "pm" },
    { id: "andre", role: "lead" },
  ];
  const inbox = (log: BraidLog) => Object.values(log).flatMap((e) => braidEntryCauses(e, members)).sort();

  it("replays the five steps", () => {
    let log: BraidLog = {
      e1: draftEntry({ id: "e1", projectId: P, kind: "risk", title: "Trend model may slip to 24 Oct" }),
      e2: draftEntry({ id: "e2", projectId: P, kind: "decision", title: "Refresh at 6am" }),
      e3: draftEntry({ id: "e3", projectId: P, kind: "decision", title: "Keep the refresh at 5am" }),
    };
    // 9:10am. Kemar saves; "Andre and I agreed" is only words
    log = applyToLog(log, "e1", { type: "REPORT", source: src("i8") }, ctx(kemar)).log;
    log = applyToLog(log, "e2", { type: "REPORT", source: src("i11"), wordsClaimApproval: true }, ctx(kemar)).log;
    expect([log.e1.state, log.e2.state]).toEqual(["proposed", "proposed"]);
    expect(inbox(log)).toEqual(["approve:e1", "approve:e2"]);
    // Alicia approves the risk
    log = applyToLog(log, "e1", { type: "APPROVE" }, ctx(alicia)).log;
    expect(log.e1).toMatchObject({ state: "open", decidedBy: "alicia" });
    expect(inbox(log)).toEqual(["approve:e2"]);
    // Andre approves the 6am refresh
    log = applyToLog(log, "e2", { type: "APPROVE" }, ctx(andre)).log;
    expect(log.e2).toMatchObject({ state: "approved", decidedBy: "andre" });
    expect(inbox(log)).toEqual([]);
    // Thursday. Kemar passes on "keep 5am"; Atlas notes it may conflict
    log = applyToLog(log, "e3", { type: "REPORT", source: src("j1") }, ctx(kemar, { today: "2026-10-22" })).log;
    const linked = linkConflict(log, "e3", "e2");
    expect(linked.ok).toBe(true);
    log = linked.log;
    expect(log.e3.state).toBe("proposed");
    expect(inbox(log)).toEqual(["approve:e3"]);
    // Andre approves keeping 5am; 6am is superseded, not deleted
    log = applyToLog(log, "e3", { type: "APPROVE" }, ctx(andre, { today: "2026-10-22" })).log;
    expect(log.e3).toMatchObject({ state: "approved", decidedBy: "andre" });
    expect(log.e2.state).toBe("superseded");
    expect(inbox(log)).toEqual([]);
  });
});

function applyPlan(items: InboxItemRef[], key: string, plan: InboxPlan): InboxItemRef[] {
  const next = items.map((i) => {
    const c = plan.close.find((x) => x.id === i.id);
    return c ? { ...i, state: c.to } : i;
  });
  if (plan.create) next.push({ id: `${key}#${plan.create.episode}`, causeKey: key, episode: plan.create.episode, state: "open" });
  return next;
}

/** Runs evaluateCause (M10) for every cause key seen so far, as evaluate() does after each change. */
function syncInbox(items: InboxItemRef[], causes: readonly string[]): InboxItemRef[] {
  const keys = new Set([...items.map((i) => i.causeKey), ...causes]);
  let next = items;
  for (const key of keys) next = applyPlan(next, key, evaluateCause(key, next, causes.includes(key)));
  return next;
}

// Property test: the BraidEntry model's moves (one risk, two conflicting decisions, roles that come and go),
// holding OnLogOnlyWithRight, DecisionNeverApprovedByText, NothingDecidesItself, ConflictsNeverSilent,
// SomeoneIsAsked and NoOrphanItems.
describe("BRAID entries keep the model-checked properties", () => {
  const ENTRIES = { e1: "risk", e2: "decision", e3: "decision" } as const;
  type Id = keyof typeof ENTRIES;
  const DECIDERS = { alicia: "pm", andre: "lead" } as const;
  const PEOPLE = ["kemar", "alicia", "andre"] as const;
  const id = fc.constantFrom<Id>("e1", "e2", "e3");
  const decider = fc.constantFrom("alicia", "andre");
  const move = fc.oneof(
    fc.record({ m: fc.constant("report" as const), p: fc.constantFrom("kemar", "alicia"), e: id, says: fc.boolean() }),
    fc.record({ m: fc.constantFrom("approve" as const, "decline" as const, "info" as const), p: decider, e: id }),
    fc.record({ m: fc.constantFrom("reply" as const, "withdraw" as const, "remind" as const), e: id }),
    fc.record({ m: fc.constant("role" as const), p: decider, toMember: fc.boolean() }),
  );

  it("OnLogOnlyWithRight, DecisionNeverApprovedByText, NothingDecidesItself, ConflictsNeverSilent, SomeoneIsAsked, NoOrphanItems", () => {
    fc.assert(
      fc.property(fc.array(move, { maxLength: 30, size: "max" }), (moves) => {
        let log: BraidLog = Object.fromEntries(Object.entries(ENTRIES).map(([e, kind]) => [e, draftEntry({ id: e, projectId: P, kind, title: e })]));
        const roles: Record<string, ProjectRole> = { kemar: "member", ...DECIDERS };
        let today = TODAY;
        let items: InboxItemRef[] = [];
        let n = 0;
        for (const mv of moves) {
          const before = log;
          const rolesBefore = { ...roles };
          const as = (p: string): BraidActor => ({ id: p, role: roles[p] });
          if (mv.m === "report") {
            // Who reports a decision changes no rule, so only Kemar does (as in the model)
            const p = ENTRIES[mv.e] === "decision" ? "kemar" : mv.p;
            log = applyToLog(log, mv.e, { type: "REPORT", source: src(`s${n++}`, p), wordsClaimApproval: mv.says }, ctx(as(p), { today })).log;
            if (log.e2.state !== "none" && log.e3.state !== "none" && !log.e2.links.length) {
              const linked = linkConflict(log, "e2", "e3");
              if (linked.ok) log = linked.log;
            }
          } else if (mv.m === "approve" || mv.m === "decline" || mv.m === "info") {
            const event: BraidEvent = mv.m === "approve" ? { type: "APPROVE" } : mv.m === "decline" ? { type: "DECLINE", reason: "no" } : { type: "REQUEST_INFO", question: "why?" };
            log = applyToLog(log, mv.e, event, ctx(as(mv.p), { today })).log;
          } else if (mv.m === "reply" || mv.m === "withdraw") {
            const p = log[mv.e].reportedBy ?? "kemar";
            log = applyToLog(log, mv.e, mv.m === "reply" ? { type: "REPLY", answer: "more" } : { type: "WITHDRAW" }, ctx(as(p), { today })).log;
          } else if (mv.m === "remind") {
            today = addDays(today, 7);
            log = applyToLog(log, mv.e, { type: "REMIND" }, ctx(null, { today })).log;
          } else if (mv.m === "role") {
            roles[mv.p] = mv.toMember ? "member" : DECIDERS[mv.p];
          }
          const members = PEOPLE.map((p) => ({ id: p, role: roles[p] }));
          const causes = Object.values(log).flatMap((e) => braidEntryCauses(e, members));
          items = syncInbox(items, causes);
          const live = items.filter((i) => LIVE.includes(i.state)).map((i) => i.causeKey);

          for (const e of Object.keys(ENTRIES) as Id[]) {
            const [was, now] = [before[e], log[e]];
            const onLog = ON_LOG_AS[now.kind];
            if (was.state !== onLog && now.state === onLog) {
              // OnLogOnlyWithRight: a person who held PM or Lead at that moment
              expect(PEOPLE).toContain(now.decidedBy);
              expect(mayDecide(rolesBefore[now.decidedBy!], now.kind)).toBe(true);
              // DecisionNeverApprovedByText: a decision is approved only by someone pressing Approve
              if (now.kind === "decision") expect(mv).toMatchObject({ m: "approve", p: now.decidedBy });
            }
            // NothingDecidesItself: reminders and role changes never move an entry
            if (mv.m === "remind" || mv.m === "role") expect(now.state).toBe(was.state);
            // SomeoneIsAsked
            if (now.state === "proposed") {
              const holders = members.filter((m) => mayDecide(m.role, now.kind));
              expect(live).toContain(holders.length ? `approve:${e}` : `no_decider:${e}`);
            }
          }
          // ConflictsNeverSilent
          expect(log.e2.state === "approved" && log.e3.state === "approved").toBe(false);
          // NoOrphanItems: every live item still has its cause
          for (const key of live) {
            const [kind, e] = key.split(":");
            expect(log[e].state).toBe(kind === "more_info" ? "more_info" : "proposed");
          }
          expect(live.length).toBe(new Set(live).size);
        }
      }),
      { numRuns: 2000 },
    );
  });

  // Any event, any kind, any actor: the kind's own states only, refusals change nothing, and only
  // the right holders decide or resolve.
  const actors: BraidActor[] = [kemar, jodian, alicia, andre, outsider];
  const anyEvent = fc.oneof(
    fc.constantFrom<BraidEvent>(
      { type: "APPROVE" },
      { type: "DECLINE", reason: "no" },
      { type: "REQUEST_INFO", question: "?" },
      { type: "REPLY", answer: "x" },
      { type: "REOPEN" },
      { type: "PROGRESS" },
      { type: "PROPOSE_RESOLVE" },
      { type: "KEEP_OPEN" },
      { type: "ACKNOWLEDGE" },
      { type: "REMIND" },
      { type: "WITHDRAW" },
      { type: "RESOLVE" },
    ),
    fc.constantFrom<"closed" | "realised" | "confirmed" | "broken" | "met" | "late">("closed", "realised", "confirmed", "broken", "met", "late").map((outcome): BraidEvent => ({ type: "RESOLVE", outcome })),
    fc.constant("source" as const),
  );

  it("each kind stays in its states; only right holders decide or resolve; refused events change nothing", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BRAID_KINDS),
        fc.constantFrom(...actors),
        fc.array(fc.record({ e: anyEvent, a: fc.integer({ min: 0, max: actors.length - 1 }) }), { maxLength: 25, size: "max" }),
        (kind, reporter, steps) => {
          let rec = draftEntry({ id: "e1", projectId: P, kind, title: "t", ownerId: "kemar" });
          let today = TODAY;
          rec = applyBraidEvent(rec, { type: "REPORT", source: src("s0", reporter.id) }, ctx(reporter)).record;
          steps.forEach(({ e, a }, i) => {
            const actor = actors[a];
            today = addDays(today, 3);
            const event: BraidEvent = e === "source" ? { type: "ADD_SOURCE", projectId: P, kind, source: src(`s${i + 1}`, actor.id) } : e;
            const r = applyBraidEvent(rec, event, ctx(event.type === "REMIND" ? null : actor, { today }));
            if (!r.outcome.ok) {
              expect(r.record).toBe(rec);
              return;
            }
            expect(KIND_STATES[kind]).toContain(r.record.state);
            if (["APPROVE", "DECLINE", "REQUEST_INFO"].includes(event.type)) expect(mayDecide(actor.role!, kind)).toBe(true);
            if (["RESOLVE", "REOPEN", "PROGRESS"].includes(event.type)) {
              const isOwner = kind === "blocker" ? !!actor.ownsBlockedWork : kind === "issue" && actor.id === "kemar";
              expect(mayResolve({ role: actor.role!, isOwner }, kind)).toBe(true);
            }
            if (event.type === "REMIND") expect(r.record.state).toBe(rec.state);
            if (kind === "decision" && r.record.state === "approved" && rec.state !== "approved") expect(event.type).toBe("APPROVE");
            rec = r.record;
          });
        },
      ),
      { numRuns: 2000 },
    );
  });
});
