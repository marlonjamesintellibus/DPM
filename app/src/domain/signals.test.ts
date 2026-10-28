// Phase K: the six signal rules over one project (conversational plan, section 13), and their texts.
// Each rule holds exactly when the table says, with its level ("worse") and its episode (since when).
import { describe, expect, it } from "vitest";
import { draftEntry, type BraidEntryRecord, type BraidLog } from "./machines/braid-entry";
import { ownerCheckText, riskTitle, signalConditions, signalText, type SignalWorld } from "./signals";

const TODAY = "2026-10-27"; // Tuesday
const entry = (patch: Partial<BraidEntryRecord> & { id: string; kind: BraidEntryRecord["kind"] }): BraidEntryRecord => ({ ...draftEntry({ projectId: "forager", title: patch.id, ...patch }), ...patch });
const src = (personId: string, at = "2026-10-14T15:00:00Z") => ({ id: `src-${personId}-${at}`, personId, captureId: null, span: null, at });

function world(patch: Partial<SignalWorld> = {}): SignalWorld {
  return {
    projectId: "forager",
    projectName: "Forager 2.0",
    paused: false,
    startDate: "2026-10-12",
    today: TODAY,
    workItems: [],
    milestones: [],
    log: {},
    kindRequests: [],
    lastActivity: new Map(),
    slips: new Map(),
    reportedSince: new Map(),
    lastUpdateOn: TODAY,
    names: new Map([
      ["alicia", "Alicia"],
      ["kemar", "Kemar"],
      ["jodian", "Jodian"],
    ]),
    ...patch,
  };
}
const rules = (w: SignalWorld) => signalConditions(w).map((c) => `${c.rule}:${c.subjectId}:${c.level}:${c.episode}`);

describe("repeated blocker", () => {
  const blocker = (sources: ReturnType<typeof src>[], state: BraidEntryRecord["state"] = "reported") => ({ "br-feed": entry({ id: "br-feed", kind: "blocker", title: "Store sales feed access", state, sources }) });

  it("three or more people report the same open blocker; worse is another report", () => {
    expect(rules(world({ log: blocker([src("alicia"), src("kemar")]) }))).toEqual([]);
    const log = blocker([src("alicia"), src("kemar"), src("jodian")]);
    const w = world({ log, reportedSince: new Map([["br-feed", { on: "2026-10-14", reopened: false }]]) });
    expect(rules(w)).toEqual(["repeated_blocker:br-feed:3:2026-10-14"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe('The blocker "Store sales feed access" was reported by 3 people: Alicia, Kemar and Jodian');
    // The same person twice is one person
    expect(rules(world({ log: blocker([src("alicia"), src("kemar"), src("kemar", "2026-10-20T15:00:00Z")]) }))).toEqual([]);
  });

  it("reported again after it was resolved; a resolved or merged one holds nothing", () => {
    const w = world({ log: blocker([src("alicia"), src("kemar", "2026-10-26T15:00:00Z")]), reportedSince: new Map([["br-feed", { on: "2026-10-26", reopened: true }]]) });
    expect(rules(w)).toEqual(["repeated_blocker:br-feed:2:2026-10-26"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe('The blocker "Store sales feed access" was reported again on 26 Oct after it was resolved');
    expect(rules(world({ log: blocker([src("alicia"), src("kemar"), src("jodian")], "resolved") }))).toEqual([]);
    expect(rules(world({ log: blocker([src("alicia"), src("kemar"), src("jodian")], "merged") }))).toEqual([]);
  });
});

describe("stale work", () => {
  const item = (state: "in_progress" | "blocked" | "done" = "in_progress") => ({ id: "wi-145", number: "#145", title: "Google Trends connector", ownerId: "kemar", state, milestoneId: null, dueDate: "2026-10-30" });

  it("In progress for staleWorkDays with no change and no mention; each further stretch is worse", () => {
    expect(rules(world({ workItems: [item()], lastActivity: new Map([["wi-145", "2026-10-21"]]) }))).toEqual([]); // 4 working days
    const w = world({ workItems: [item()], lastActivity: new Map([["wi-145", "2026-10-20"]]) }); // 5
    expect(rules(w)).toEqual(["stale_work:wi-145:1:2026-10-20"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe("#145 Google Trends connector has been In progress for 5 working days with no change and no mention in any update");
    expect(ownerCheckText(signalConditions(w)[0].facts as never)).toBe("Is #145 Google Trends connector still going? No change or mention for 5 working days");
    expect(rules(world({ workItems: [item()], lastActivity: new Map([["wi-145", "2026-10-13"]]) }))).toEqual(["stale_work:wi-145:2:2026-10-13"]); // 10
  });

  it("only In progress counts; Blocked or Done work is not stale", () => {
    for (const state of ["blocked", "done"] as const) expect(rules(world({ workItems: [item(state)], lastActivity: new Map([["wi-145", "2026-10-01"]]) }))).toEqual([]);
  });
});

describe("slipping forecast", () => {
  const ms = { id: "ms-trend", name: "Trend model", state: "in_progress" as const, targetDate: "2026-10-23", forecastDate: "2026-11-04" };

  it("moved later slipCount times; another slip is worse; the target is the episode", () => {
    expect(rules(world({ milestones: [ms], slips: new Map([["ms-trend", ["2026-10-26", "2026-10-28"]]]) }))).toEqual([]);
    const w = world({ milestones: [ms], slips: new Map([["ms-trend", ["2026-10-23", "2026-10-28", "2026-11-04"]]]) });
    expect(rules(w)).toEqual(["slipping_forecast:ms-trend:3:2026-10-23"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe("Forecast for Trend model moved 3 times: 23 Oct, 28 Oct, 4 Nov");
    expect(riskTitle(signalConditions(w)[0].facts)).toBe("Trend model may keep slipping");
    expect(rules(world({ milestones: [{ ...ms, state: "done" }], slips: new Map([["ms-trend", ["a", "b", "c"]]]) }))).toEqual([]);
  });
});

describe("waiting decision", () => {
  const risk = (patch: Partial<BraidEntryRecord> = {}) => entry({ id: "br-risk", kind: "risk", title: "Trend model may slip to 26 Oct", state: "proposed", reportedBy: "kemar", proposedOn: "2026-10-20", round: 1, remindersSent: 1, ...patch });

  it("a proposal waiting decisionWaitDays after the S18 reminders; a reply is a new episode", () => {
    expect(rules(world({ log: { "br-risk": risk({ proposedOn: "2026-10-21" }) } }))).toEqual([]); // 4 working days
    expect(rules(world({ log: { "br-risk": risk({ remindersSent: 0 }) } }))).toEqual([]); // the reminders first
    const w = world({ log: { "br-risk": risk() } });
    expect(rules(w)).toEqual(["waiting_decision:br-risk:1:1@2026-10-20"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe(`Kemar's risk "Trend model may slip to 26 Oct" has waited 5 working days for a decision`);
    expect(rules(world({ log: { "br-risk": risk({ state: "more_info" }) } }))).toEqual([]); // waiting on the reporter, not the deciders
  });

  it("a kind change request waiting as long", () => {
    const log: BraidLog = { "br-risk": entry({ id: "br-risk", kind: "risk", title: "Only Kemar can run the pipeline", state: "open" }) };
    const w = world({ log, kindRequests: [{ id: "kr-1", entryId: "br-risk", toKind: "issue", askedBy: "jodian", askedOn: "2026-10-20", remindersSent: 1, state: "asked" }] });
    expect(rules(w)).toEqual(["waiting_decision:kr-1:1:2026-10-20"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe(`Jodian's request to make "Only Kemar can run the pipeline" an issue has waited 5 working days for a PM or Lead`);
  });
});

describe("milestone at risk from its work", () => {
  const ms = { id: "ms-trend", name: "Trend model", state: "in_progress" as const, targetDate: "2026-10-30", forecastDate: null };
  const work = (id: string, state: "in_progress" | "blocked" | "done" | "cancelled", dueDate: string) => ({ id, number: `#${id}`, title: id, ownerId: "kemar", state, milestoneId: "ms-trend", dueDate });

  it("most of its work Blocked or past due while it still shows On track; worse is more of it", () => {
    const half = [work("1", "blocked", "2026-10-30"), work("2", "in_progress", "2026-10-30")];
    expect(rules(world({ milestones: [ms], workItems: half }))).toEqual([]);
    const most = [work("1", "blocked", "2026-10-30"), work("2", "in_progress", "2026-10-26"), work("3", "in_progress", "2026-10-30"), work("4", "cancelled", "2026-10-01")];
    const w = world({ milestones: [ms], workItems: most });
    expect(rules(w)).toEqual(["milestone_at_risk:ms-trend:2:"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe("Trend model still shows On track, but 2 of its 3 work items are blocked or past due: #1 1 and #2 2");
  });

  it("not when the milestone already shows the trouble, and not when the late work is done", () => {
    const most = [work("1", "blocked", "2026-10-30"), work("2", "in_progress", "2026-10-26")];
    expect(rules(world({ milestones: [{ ...ms, forecastDate: "2026-11-02" }], workItems: most }))).toEqual([]); // At risk already
    expect(rules(world({ milestones: [ms], workItems: [work("1", "done", "2026-10-26"), work("2", "done", "2026-10-26")] }))).toEqual([]);
  });
});

describe("quiet project", () => {
  it("no update from any member for quietProjectDays working days; each further stretch is worse", () => {
    expect(rules(world({ lastUpdateOn: "2026-10-23" }))).toEqual([]); // Fri: 2 working days
    const w = world({ lastUpdateOn: "2026-10-22" });
    expect(rules(w)).toEqual(["quiet_project:forager:1:2026-10-22"]);
    expect(signalText(signalConditions(w)[0].facts)).toBe("No update on Forager 2.0 from anyone for 3 working days, since 22 Oct");
    expect(rules(world({ lastUpdateOn: "2026-10-19" }))).toEqual(["quiet_project:forager:2:2026-10-19"]);
  });

  it("SG7 and CD13: a project marked paused is never quiet; nothing to count from, nothing raised", () => {
    expect(rules(world({ lastUpdateOn: "2026-10-01", paused: true }))).toEqual([]);
    expect(rules(world({ lastUpdateOn: null }))).toEqual([]);
  });
});
