import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog, loadProject, persistBraidLog, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { applyToLog, draftEntry, type BraidActor, type BraidEvent } from "../domain/machines/braid-entry";
import { displayedStatus } from "../domain/machines/set-status";
import type { BraidKind, ProjectRole } from "../domain/rights";
import { AT_910, at, seededDb } from "../test/seeded-db";
import {
  acknowledgeBlocker,
  decideBraidEntry,
  keepOpen,
  linkConflictingDecisions,
  mergeBraidEntries,
  progressEntry,
  replyToRequest,
  resolveBraidEntry,
  runBraidReminders,
  unmergeBraidEntry,
  withdrawEntry,
} from "./braid";
import { CommandRefused, StaleVersion } from "./core";
import { evaluateProject } from "./evaluate";
import { draftReason, saveReason } from "./status";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

const DAY = 24 * 60;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const kemar: BraidActor = { id: "kemar", role: "member" };

async function entry(id: string, projectId = "forager") {
  return (await loadBraidLog(db, projectId)).log[id];
}

async function inbox(ownerId: string) {
  const rows = await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, ownerId)).orderBy(t.inboxItems.createdAt, t.inboxItems.episode);
  return rows.map((i) => [i.causeKey, i.state]);
}

async function liveCauses(ownerId: string) {
  return (await inbox(ownerId)).filter(([, s]) => s === "open" || s === "snoozed").map(([k]) => k);
}

const setRole = (projectId: string, personId: string, role: ProjectRole) =>
  db.update(t.projectMemberships).set({ role }).where(and(eq(t.projectMemberships.projectId, projectId), eq(t.projectMemberships.personId, personId)));

/** An event from the Apply job (REPORT or ADD_SOURCE), written the way infra.test.ts does, then the rules. */
async function applyFromCapture(projectId: string, entryId: string, actor: BraidActor, event: BraidEvent, draft?: { kind: BraidKind; title: string }, minutes = 0) {
  const { log, versions } = await loadBraidLog(db, projectId);
  const start = draft ? { ...log, [entryId]: draftEntry({ id: entryId, projectId, ...draft }) } : log;
  const r = applyToLog(start, entryId, event, { actor, today: "2026-10-20" });
  expect(r.outcome).toMatchObject({ ok: true });
  await db.transaction(async (tx) => {
    await persistBraidLog(tx, log, r.log, versions, at(minutes));
    await evaluateProject(tx, projectId, at(minutes), { actorId: actor.id });
  });
}

const source = (id: string, personId: string) => ({ id, personId, captureId: null, span: null, at: AT_910.toISOString() });

function report(projectId: string, id: string, kind: BraidKind, title: string, actor: BraidActor = kemar) {
  return applyFromCapture(projectId, id, actor, { type: "REPORT", source: source(`src-${id}`, actor.id) }, { kind, title });
}

const reportSlip = () => report("forager", "br-slip", "risk", "Trend model may slip to 24 Oct");
const reportRefresh = (id = "br-refresh", title = "Move the daily refresh to 6am", actor: BraidActor = kemar) => report("insights", id, "decision", title, actor);

describe("use case 1, story steps 6 and 7", () => {
  it("Alicia approves the risk and saves a reason; Andre approves the decision; each item closes as acted", async () => {
    // Kemar's 9:10 save, as far as these steps need it
    await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
    await db.update(t.workItems).set({ state: "blocked", blockedNote: "waiting on Kyle (Sprouts IT)", blockedLinks: ["br-feed-blocker"] }).where(eq(t.workItems.id, "wi-151"));
    await applyFromCapture("forager", "br-feed-blocker", kemar, { type: "ADD_SOURCE", projectId: "forager", kind: "blocker", source: source("src-feed-kemar", "kemar") });
    await reportSlip();
    await reportRefresh();
    expect(await liveCauses("alicia")).toEqual(["status_set_with_no_reason:forager", "approve:br-slip"]);
    expect(await liveCauses("andre")).toEqual(["approve:br-refresh"]);

    // Step 6: item 2, then back on item 1
    const approved = await decideBraidEntry(as("alicia", 2), "br-slip", { type: "approve" });
    expect(approved.outcome).toMatchObject({ from: "proposed", to: "open" });
    expect(approved.entry).toMatchObject({ decidedBy: "alicia", selfApproved: false });
    expect(await inbox("alicia")).toContainEqual(["approve:br-slip", "acted"]);

    const draft = await draftReason(db, "forager", at(3));
    expect(draft.text).toContain("Store sales feed access has been blocked for 6 days (#151).");
    expect(draft.entryIds).toEqual(expect.arrayContaining(["br-feed-blocker", "br-slip"]));
    const saved = await saveReason(as("alicia", 4), "forager", { text: draft.text, entryIds: ["br-feed-blocker", "br-slip"], draftedByAtlas: true, edited: false });
    expect(saved.evaluation.calculated).toBe("at_risk");
    const project = (await loadProject(db, "forager"))!;
    expect(displayedStatus(setStatusRecordOf(project), saved.evaluation.calculated)).toBe("off_track");
    expect(await inbox("alicia")).toEqual([
      ["status_set_with_no_reason:forager", "acted"],
      ["approve:br-slip", "acted"],
    ]);
    expect((await entry("br-feed-blocker")).sources.map((s) => s.personId)).toEqual(["alicia", "kemar"]);

    // Step 7
    const decided = await decideBraidEntry(as("andre", 30), "br-refresh", { type: "approve" });
    expect(decided.entry).toMatchObject({ state: "approved", decidedBy: "andre", reportedBy: "kemar", selfApproved: false });
    expect(decided.entry.sources.map((s) => s.personId)).toEqual(["kemar"]);
    expect(await inbox("andre")).toEqual([["approve:br-refresh", "acted"]]);
    const [audited] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.action, "APPROVE"), eq(t.auditEntries.subjectId, "br-refresh")));
    expect(audited).toMatchObject({ actorType: "person", actorId: "andre", fromState: "proposed", toState: "approved" });
  });
});

describe("decideBraidEntry: who may decide (rule 7)", () => {
  beforeEach(reportSlip);

  it("a member cannot approve a risk, and nothing changes", async () => {
    await expect(decideBraidEntry(as("kemar"), "br-slip", { type: "approve" })).rejects.toThrow("a member may not decide a risk");
    await expect(decideBraidEntry(as("jodian"), "br-slip", { type: "decline", reason: "no" })).rejects.toBeInstanceOf(CommandRefused);
    await expect(decideBraidEntry(as("andre"), "br-slip", { type: "approve" })).rejects.toThrow("only a project member");
    expect((await entry("br-slip")).state).toBe("proposed");
  });

  it("E97: a PM who just lost the role cannot approve; the item moves to whoever holds it now", async () => {
    await setRole("forager", "alicia", "member");
    await setRole("forager", "jodian", "lead");
    await expect(decideBraidEntry(as("alicia", 1), "br-slip", { type: "approve" })).rejects.toThrow("a member may not decide a risk");
    await db.transaction((tx) => evaluateProject(tx, "forager", at(2)));
    expect(await inbox("alicia")).toContainEqual(["approve:br-slip", "auto_closed"]);
    expect(await liveCauses("jodian")).toEqual(["approve:br-slip"]);

    await decideBraidEntry(as("jodian", 3), "br-slip", { type: "approve" });
    expect(await inbox("jodian")).toEqual([["approve:br-slip", "acted"]]);
  });

  it("a decline needs a reason and a request needs a question", async () => {
    await expect(decideBraidEntry(as("alicia"), "br-slip", { type: "decline", reason: " " })).rejects.toThrow("needs a reason");
    await expect(decideBraidEntry(as("alicia"), "br-slip", { type: "request_info", question: "" })).rejects.toThrow("what you need to know");
    await expect(decideBraidEntry(as("alicia"), "br-nothing", { type: "approve" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("E85: a declined risk reported again goes back to the PM, who sees the earlier decline and decides again", async () => {
    await decideBraidEntry(as("alicia", 1), "br-slip", { type: "decline", reason: "the forecast is not agreed yet" });
    expect((await entry("br-slip")).state).toBe("declined");
    await applyFromCapture("forager", "br-slip", kemar, { type: "ADD_SOURCE", projectId: "forager", kind: "risk", source: source("src-slip-2", "kemar") }, undefined, 5);
    const again = await entry("br-slip");
    expect(again).toMatchObject({ state: "proposed", round: 2 });
    expect(again.answers).toMatchObject([{ by: "alicia", act: "decline", note: "the forecast is not agreed yet", round: 1 }]);
    expect(await inbox("alicia")).toEqual([
      ["status_set_with_no_reason:forager", "open"],
      ["approve:br-slip", "acted"],
      ["approve:br-slip", "open"],
    ]);
    const r = await decideBraidEntry(as("alicia", 6), "br-slip", { type: "approve" });
    expect(r.entry.state).toBe("open");
  });

  it("two sessions approve the same entry: one approval, the other gets a refusal or StaleVersion", async () => {
    const results = await Promise.allSettled([
      decideBraidEntry(as("alicia", 1), "br-slip", { type: "approve" }),
      decideBraidEntry(as("alicia", 1), "br-slip", { type: "approve" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected")!;
    expect((failed as PromiseRejectedResult).reason).toSatisfy((e) => e instanceof StaleVersion || e instanceof CommandRefused);
    const answers = await db.select().from(t.braidAnswers).where(eq(t.braidAnswers.entryId, "br-slip"));
    expect(answers.map((a) => a.act)).toEqual(["approve"]);
  });

  it("a decision made on a stale screen gets StaleVersion, never a second answer", async () => {
    await setRole("forager", "jodian", "lead");
    const [{ version }] = await db.select({ version: t.braidEntries.version }).from(t.braidEntries).where(eq(t.braidEntries.id, "br-slip"));
    await decideBraidEntry(as("jodian", 1), "br-slip", { type: "request_info", question: "Which day exactly?" }, { seenVersion: version });
    await expect(decideBraidEntry(as("alicia", 2), "br-slip", { type: "approve" }, { seenVersion: version })).rejects.toBeInstanceOf(StaleVersion);
    expect((await entry("br-slip")).answers.map((a) => a.act)).toEqual(["request_info"]);
  });
});

describe("more information, withdrawing and reminders", () => {
  beforeEach(reportSlip);

  it("the PM asks for more; Kemar replies; the entry is back in front of the PM", async () => {
    await decideBraidEntry(as("alicia", 1), "br-slip", { type: "request_info", question: "Which day exactly?" });
    expect(await liveCauses("kemar")).toEqual(["more_info:br-slip"]);
    await expect(replyToRequest(as("jodian", 2), "br-slip", "Friday")).rejects.toThrow("only the reporter");
    await expect(replyToRequest(as("kemar", 2), "br-slip", " ")).rejects.toThrow("write your answer");
    const r = await replyToRequest(as("kemar", 3), "br-slip", "Saturday 24 Oct");
    expect(r.entry.state).toBe("proposed");
    expect(await inbox("kemar")).toEqual([["more_info:br-slip", "acted"]]);
    expect(await liveCauses("alicia")).toContain("approve:br-slip");
  });

  it("E99: Kemar withdraws after the PM asked for more; his item closes and the entry is withdrawn", async () => {
    await decideBraidEntry(as("alicia", 1), "br-slip", { type: "request_info", question: "Which day exactly?" });
    await expect(withdrawEntry(as("alicia", 2), "br-slip")).rejects.toThrow("only the reporter");
    const r = await withdrawEntry(as("kemar", 3), "br-slip");
    expect(r.entry.state).toBe("withdrawn");
    expect(await inbox("kemar")).toEqual([["more_info:br-slip", "acted"]]);
    expect(await liveCauses("alicia")).not.toContain("approve:br-slip");
  });

  it("E98: an unanswered risk gets reminders on the S18 schedule and is never decided by them", async () => {
    expect(await runBraidReminders({ db, now: at(DAY) })).toEqual([]); // Wed: 1 working day
    expect(await runBraidReminders({ db, now: at(2 * DAY) })).toEqual([{ entryId: "br-slip", projectId: "forager", deciders: ["alicia"] }]);
    expect(await runBraidReminders({ db, now: at(2 * DAY + 60) })).toEqual([]);
    expect(await runBraidReminders({ db, now: at(8 * DAY) })).toEqual([]); // 6 days after the first
    expect(await runBraidReminders({ db, now: at(9 * DAY) })).toHaveLength(1);
    expect(await entry("br-slip")).toMatchObject({ state: "proposed", remindersSent: 2, decidedBy: null, answers: [] });
    const reminds = await db.select().from(t.auditEntries).where(eq(t.auditEntries.action, "REMIND"));
    expect(reminds.map((a) => [a.actorType, a.fromState, a.toState])).toEqual([
      ["rule", "proposed", "proposed"],
      ["rule", "proposed", "proposed"],
    ]);
    expect(await liveCauses("alicia")).toContain("approve:br-slip");

    // The reporter can still take it back
    await withdrawEntry(as("kemar", 9 * DAY + 5), "br-slip");
    expect(await inbox("alicia")).toContainEqual(["approve:br-slip", "auto_closed"]);
  });
});

describe("decisions (S11, S12, E87 to E91)", () => {
  it("E89: Andre proposes a decision and approves it himself, labelled and audited as self-approved", async () => {
    await reportRefresh("br-own", "Freeze the schema until 30 Oct", { id: "andre", role: "pm" });
    expect((await entry("br-own", "insights")).state).toBe("proposed"); // a PM's decision still starts as a proposal
    const r = await decideBraidEntry(as("andre", 1), "br-own", { type: "approve" });
    expect(r.entry).toMatchObject({ state: "approved", selfApproved: true });
    const [audited] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.action, "APPROVE"), eq(t.auditEntries.subjectId, "br-own")));
    expect(audited.detail).toMatchObject({ selfApproved: true });
  });

  it("E89: with self-approval off, the proposer may not approve their own decision", async () => {
    await reportRefresh("br-own", "Freeze the schema until 30 Oct", { id: "andre", role: "pm" });
    await expect(decideBraidEntry(as("andre", 1), "br-own", { type: "approve" }, { policy: { selfApproval: false } })).rejects.toThrow("may not approve their own");
  });

  it("E87: approving a decision that conflicts with an approved one supersedes the old one", async () => {
    await reportRefresh("br-5am", "Move the daily refresh to 5am", { id: "andre", role: "pm" });
    await decideBraidEntry(as("andre", 1), "br-5am", { type: "approve" });
    await reportRefresh();
    await linkConflictingDecisions(as("kemar", 2), "br-refresh", "br-5am");
    expect((await entry("br-refresh", "insights")).links).toContainEqual({ relation: "conflicts_with", entryId: "br-5am" });

    const r = await decideBraidEntry(as("andre", 3), "br-refresh", { type: "approve" });
    expect(r.entry.links).toContainEqual({ relation: "supersedes", entryId: "br-5am" });
    expect((await entry("br-5am", "insights")).state).toBe("superseded");
    const [superseded] = await db.select().from(t.auditEntries).where(and(eq(t.auditEntries.action, "SUPERSEDE"), eq(t.auditEntries.subjectId, "br-5am")));
    expect(superseded).toMatchObject({ actorType: "rule", fromState: "approved", toState: "superseded", detail: { via: "br-refresh" } });
  });

  it("E88: two pending decisions that conflict are both flagged; approving one leaves the other for Andre", async () => {
    await reportRefresh();
    await reportRefresh("br-7am", "Move the daily refresh to 7am");
    await expect(linkConflictingDecisions(as("kemar"), "br-refresh", "br-feed-blocker")).rejects.toThrow("two different entries on this log");
    await expect(linkConflictingDecisions(as("alicia"), "br-refresh", "br-7am")).rejects.toMatchObject({ code: "not_allowed" });
    await linkConflictingDecisions(as("kemar", 1), "br-refresh", "br-7am");
    await decideBraidEntry(as("andre", 2), "br-refresh", { type: "approve" });
    expect((await entry("br-7am", "insights")).state).toBe("proposed");
    expect(await liveCauses("andre")).toEqual(["approve:br-7am"]);
  });

  it("E90: with 2 approvers, one approves and one declines: declined, with both answers kept", async () => {
    await db.insert(t.projectMemberships).values({ projectId: "insights", personId: "alicia", state: "member", role: "lead" });
    await reportRefresh();
    const policy = { approversNeeded: 2 };
    const first = await decideBraidEntry(as("andre", 1), "br-refresh", { type: "approve" }, { policy });
    expect(first.outcome).toMatchObject({ from: "proposed", to: "proposed" });
    expect(await inbox("andre")).toEqual([["approve:br-refresh", "acted"]]);
    expect(await liveCauses("alicia")).toContain("approve:br-refresh");
    await expect(decideBraidEntry(as("andre", 2), "br-refresh", { type: "approve" }, { policy })).rejects.toThrow("already approved by you");

    const r = await decideBraidEntry(as("alicia", 3), "br-refresh", { type: "decline", reason: "6am clashes with the store close" }, { policy });
    expect(r.entry.state).toBe("declined");
    expect(r.entry.answers.map((a) => [a.by, a.act, a.round])).toEqual([
      ["andre", "approve", 1],
      ["alicia", "decline", 1],
    ]);
  });

  it("E91: nobody on the project can decide; the proposal waits and the owner is told", async () => {
    await setRole("insights", "andre", "member");
    await reportRefresh();
    expect(await liveCauses("andre")).toEqual(["no_decider:br-refresh"]);
    await expect(decideBraidEntry(as("andre", 1), "br-refresh", { type: "approve" })).rejects.toThrow("a member may not decide a decision");
    expect((await entry("br-refresh", "insights")).state).toBe("proposed");
  });
});

describe("blockers (S13, E84, E86, E93)", () => {
  it("E93: Jodian cannot resolve the blocker; her 'it's cleared' is a proposal that Kemar confirms", async () => {
    const proposed = await resolveBraidEntry(as("jodian"), "br-feed-blocker");
    expect(proposed.outcome).toMatchObject({ event: "PROPOSE_RESOLVE", from: "reported", to: "reported" });
    expect(proposed.entry.resolveProposedBy).toBe("jodian");
    expect(await liveCauses("kemar")).toEqual(["clear:br-feed-blocker"]);
    expect(await liveCauses("alicia")).toContain("clear:br-feed-blocker");
    expect(await liveCauses("jodian")).toEqual([]);
    await expect(resolveBraidEntry(as("jodian", 1), "br-feed-blocker")).rejects.toThrow("already proposed as cleared");

    const resolved = await resolveBraidEntry(as("kemar", 5), "br-feed-blocker");
    expect(resolved.outcome).toMatchObject({ event: "RESOLVE", to: "resolved" });
    expect(resolved.entry).toMatchObject({ resolvedBy: "kemar", resolveProposedBy: null });
    expect(await inbox("kemar")).toEqual([["clear:br-feed-blocker", "acted"]]);
    expect(await inbox("alicia")).toContainEqual(["clear:br-feed-blocker", "auto_closed"]);
  });

  it("the PM keeps a blocker open when the clearing is wrong; only the owner or a PM or Lead may", async () => {
    await resolveBraidEntry(as("jodian"), "br-feed-blocker");
    await expect(keepOpen(as("jodian", 1), "br-feed-blocker")).rejects.toBeInstanceOf(CommandRefused);
    const r = await keepOpen(as("alicia", 2), "br-feed-blocker");
    expect(r.entry).toMatchObject({ state: "reported", resolveProposedBy: null });
    expect(await inbox("alicia")).toContainEqual(["clear:br-feed-blocker", "acted"]);
    expect(await inbox("kemar")).toEqual([["clear:br-feed-blocker", "auto_closed"]]);
  });

  it("whoever owns a work item the blocker blocks may resolve it directly", async () => {
    await db.update(t.workItems).set({ state: "blocked", blockedLinks: ["br-feed-blocker"] }).where(eq(t.workItems.id, "wi-160"));
    const r = await resolveBraidEntry(as("jodian"), "br-feed-blocker");
    expect(r.outcome).toMatchObject({ event: "RESOLVE", to: "resolved" });
  });

  it("a member cannot resolve a risk; the PM resolves it with an outcome and progresses it first", async () => {
    await expect(resolveBraidEntry(as("kemar"), "br-pipeline-risk", "closed")).rejects.toThrow("a member may not resolve a risk");
    await expect(progressEntry(as("kemar"), "br-feed-dependency")).rejects.toBeInstanceOf(CommandRefused);
    expect((await progressEntry(as("alicia", 1), "br-feed-dependency")).entry.state).toBe("waiting");
    expect((await resolveBraidEntry(as("alicia", 2), "br-feed-dependency", "met")).entry.state).toBe("met");
  });

  it("the PM acknowledges a new blocker; nobody else can", async () => {
    await report("forager", "br-gpu", "blocker", "No GPU quota for training", { id: "jodian", role: "member" });
    expect(await liveCauses("alicia")).toContain("blocker_new:br-gpu");
    await expect(acknowledgeBlocker(as("kemar"), "br-gpu")).rejects.toThrow("the PM acknowledges");
    await acknowledgeBlocker(as("alicia", 1), "br-gpu");
    expect(await inbox("alicia")).toContainEqual(["blocker_new:br-gpu", "acted"]);
  });

  it("E86: the PM merges a duplicate and unmerges it, sources moved and given back through the database", async () => {
    await report("forager", "br-dup", "blocker", "Store feed blocked", { id: "jodian", role: "member" });
    await expect(mergeBraidEntries(as("kemar"), "br-dup", "br-feed-blocker")).rejects.toThrow("only a PM merges");
    await expect(mergeBraidEntries(as("alicia"), "br-dup", "br-pipeline-risk")).rejects.toThrow("kinds never merge");

    const merged = await mergeBraidEntries(as("alicia", 1), "br-dup", "br-feed-blocker");
    expect(merged.entry).toMatchObject({ state: "merged", mergedInto: "br-feed-blocker", sources: [] });
    expect((await entry("br-feed-blocker")).sources.map((s) => s.id)).toEqual(["src-feed-alicia", "src-br-dup"]);
    expect(await inbox("alicia")).toContainEqual(["blocker_new:br-dup", "acted"]);
    const moves = await db.select().from(t.auditEntries).where(eq(t.auditEntries.action, "MERGE"));
    expect(moves.map((a) => [a.subjectId, a.fromState, a.toState])).toEqual([
      ["br-dup", "reported", "merged"],
      ["br-feed-blocker", "reported", "reported"],
    ]);

    await expect(unmergeBraidEntry(as("kemar", 2), "br-dup")).rejects.toThrow("only a PM unmerges");
    const back = await unmergeBraidEntry(as("alicia", 3), "br-dup");
    expect(back.entry).toMatchObject({ state: "reported", mergedInto: null });
    expect(back.entry.sources.map((s) => s.id)).toEqual(["src-br-dup"]);
    expect((await entry("br-feed-blocker")).sources.map((s) => s.id)).toEqual(["src-feed-alicia"]);
  });
});
