// Section 13 against PGlite: changing a BRAID entry's kind, members asking for it (M17), and what
// follows: blocked work (D32), saved reasons (BK11), later reports (BK12), notices and the inbox.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { loadBraidLog } from "../db/records";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { switchedTo } from "../domain/machines/braid-entry";
import { getChatSummary } from "../queries/chat";
import { at, seededDb } from "../test/seeded-db";
import { answerKindChange, askKindChange, resolveBraidEntry, runKindRequestReminders, switchEntryKind, withdrawKindChange } from "./braid";
import { createCapture, openReview, proposeItems, saveCapture } from "./capture";
import { CommandRefused, StaleVersion } from "./core";

let db: Db;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const log = async () => (await loadBraidLog(db, "forager")).log;
const open = async (who: string) =>
  (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open").map((i) => i.causeKey).sort();
const notices = async (who: string) => (await getChatSummary(db, who)).notices.map((n) => n.text);
const audits = async (subjectId: string) => (await db.select().from(t.auditEntries).where(eq(t.auditEntries.subjectId, subjectId))).map((a) => `${a.actorType} ${a.action} ${a.fromState ?? "-"}>${a.toState ?? "-"}`);

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("a PM or Lead switches the kind", () => {
  it("the risk happened: it ends realised and an issue takes its report, owner and reporter", async () => {
    const r = await switchEntryKind(as("alicia"), "br-pipeline-risk", "issue", "Kemar is away and nobody else ran it");
    const l = await log();
    expect(l["br-pipeline-risk"]).toMatchObject({ state: "realised", sources: [], switchedBy: "alicia", switchReason: "Kemar is away and nobody else ran it", stateBeforeSwitch: "mitigating" });
    expect(l[r.targetId]).toMatchObject({ kind: "issue", state: "reported", title: "Only Kemar can run the pipeline", ownerId: "alicia", reportedBy: "alicia" });
    expect(l[r.targetId].sources.map((s) => s.id)).toEqual(["src-pipeline-alicia"]);
    expect(switchedTo(l["br-pipeline-risk"])).toBe(r.targetId);
    expect(await audits("br-pipeline-risk")).toContain("person SWITCH_KIND mitigating>realised");
    expect(await audits(r.targetId)).toContain("person SWITCH_IN ->reported");
  });

  it("BK4, BK5 a member cannot switch; the right is read when it runs", async () => {
    await expect(switchEntryKind(as("kemar"), "br-feed-dependency", "blocker", "no date")).rejects.toThrow(CommandRefused);
    await db.update(t.projectMemberships).set({ role: "member" }).where(and(eq(t.projectMemberships.personId, "alicia"), eq(t.projectMemberships.projectId, "forager")));
    await expect(switchEntryKind(as("alicia"), "br-feed-dependency", "blocker", "no date")).rejects.toThrow("ask them instead");
  });

  it("BK6 a switch on a version someone else moved is StaleVersion", async () => {
    const before = await db.select().from(t.braidEntries).where(eq(t.braidEntries.id, "br-feed-dependency"));
    await switchEntryKind(as("alicia"), "br-feed-dependency", "blocker", "Kyle has no date", { seenVersion: before[0].version });
    await expect(switchEntryKind(as("alicia"), "br-feed-dependency", "issue", "again", { seenVersion: before[0].version })).rejects.toThrow(StaleVersion);
  });

  it("BK2 a resolved issue keeps its kind", async () => {
    await expect(switchEntryKind(as("alicia"), "br-rate-limit", "blocker", "x")).rejects.toThrow(CommandRefused);
  });

  it("related links follow: the feed blocker and dependency stay linked when the dependency becomes a blocker", async () => {
    const r = await switchEntryKind(as("alicia"), "br-feed-dependency", "blocker", "Kyle has no date");
    const l = await log();
    // The seed links the blocker to the dependency one way; that link now points at where the dependency lives
    expect(l["br-feed-blocker"].links).toEqual([{ relation: "related", entryId: r.targetId }]);
    expect(l[r.targetId].newAlert).toBe(false); // the PM switched it in herself
  });

  it("BK13 switching back reopens the original with its report", async () => {
    const r = await switchEntryKind(as("alicia"), "br-pipeline-risk", "issue", "it happened");
    const back = await switchEntryKind(as("alicia", 1), r.targetId, "risk", "it has not, Jodian ran it");
    expect(back.targetId).toBe("br-pipeline-risk");
    const l = await log();
    expect(l["br-pipeline-risk"]).toMatchObject({ state: "mitigating", switchedBy: null, stateBeforeSwitch: null });
    expect(l["br-pipeline-risk"].sources.map((s) => s.id)).toEqual(["src-pipeline-alicia"]);
    expect(l[r.targetId]).toMatchObject({ state: "switched", sources: [] });
    expect(await audits("br-pipeline-risk")).toContain("person RESTORE realised>mitigating");
  });
});

describe("D32 blocked work when a blocker changes kind (BK9)", () => {
  beforeEach(async () => {
    await db.update(t.workItems).set({ state: "blocked", blockedLinks: ["br-feed-blocker"] }).where(eq(t.workItems.id, "wi-151"));
  });

  it("the work stays Blocked and Kemar, who owns it, is asked; switching back settles it", async () => {
    const r = await switchEntryKind(as("alicia"), "br-feed-blocker", "issue", "it no longer stops work");
    const [w] = await db.select().from(t.workItems).where(eq(t.workItems.id, "wi-151"));
    expect(w).toMatchObject({ state: "blocked", blockedLinks: ["br-feed-blocker"] });
    expect(await open("kemar")).toContain("blocked_without_blocker:wi-151");
    await switchEntryKind(as("alicia", 1), r.targetId, "blocker", "it does stop #151");
    expect(await open("kemar")).not.toContain("blocked_without_blocker:wi-151");
  });
});

describe("BK11 a saved reason follows the entry", () => {
  it("the link moves to the entry it became", async () => {
    await db.insert(t.statusReasons).values({ id: "rs-1", projectId: "forager", text: "The pipeline risk", savedBy: "alicia", savedAt: at(0) });
    await db.insert(t.statusReasonLinks).values({ reasonId: "rs-1", braidEntryId: "br-pipeline-risk" });
    const r = await switchEntryKind(as("alicia"), "br-pipeline-risk", "issue", "it happened");
    const links = await db.select().from(t.statusReasonLinks).where(eq(t.statusReasonLinks.reasonId, "rs-1"));
    expect(links.map((l) => l.braidEntryId)).toEqual([r.targetId]);
  });
});

describe("BK12 a later report of the old words joins the live entry", () => {
  it("Kemar repeats the pipeline risk after it became an issue: the report goes to the issue", async () => {
    const r = await switchEntryKind(as("alicia"), "br-pipeline-risk", "issue", "it happened");
    const proposal: RawProposal = {
      kind: "braid_same",
      projectId: "forager",
      routingReason: { basis: "target", evidence: "Only Kemar can run the pipeline", label: "Same subject" },
      braidKind: "risk",
      matchEntryId: "br-pipeline-risk",
      quote: "only I can run the pipeline",
      confidence: "high",
      rationale: "Reported again",
    };
    const { captureId } = await createCapture(as("kemar", 2), { channel: "atlas", messageId: "atl-ks-1", kind: "text", text: "Still, only I can run the pipeline.", messageAt: at(2), receivedAt: at(2) });
    await proposeItems(as("kemar", 2), captureId, [proposal]);
    await openReview(as("kemar", 2), captureId);
    expect((await saveCapture(as("kemar", 2), captureId)).outcome).toBe("saved");
    const l = await log();
    expect(l["br-pipeline-risk"].sources).toEqual([]);
    expect(l[r.targetId].sources.map((s) => s.personId).sort()).toEqual(["alicia", "kemar"]);
  });
});

describe("M17 a member asks", () => {
  it("Kemar asks; PMs and Leads are asked; Alicia switches it and Kemar is told", async () => {
    const { request } = await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "Kyle has no date yet and #151 can't start");
    expect(request).toMatchObject({ state: "asked", askedBy: "kemar", toKind: "blocker" });
    expect(await open("alicia")).toContain(`kind_change:${request.id}`);
    // BK16: one request per entry
    await expect(askKindChange(as("jodian"), "br-feed-dependency", "issue", "x")).rejects.toThrow("Kemar already asked to make this a blocker");

    const answered = await answerKindChange(as("alicia", 1), request.id, { type: "switch" });
    const l = await log();
    expect(l["br-feed-dependency"]).toMatchObject({ state: "late", switchReason: "Kyle has no date yet and #151 can't start" });
    expect(l[answered.targetId!]).toMatchObject({ kind: "blocker", state: "reported" });
    expect(await open("alicia")).not.toContain(`kind_change:${request.id}`);
    expect(await notices("kemar")).toContain('Alicia made "Store sales feed access from Sprouts IT" a blocker, as you asked.');
    const [row] = await db.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.id, request.id));
    expect(row).toMatchObject({ state: "switched", answeredBy: "alicia" });
  });

  it("a PM switching directly to the asked kind meets the request", async () => {
    const { request } = await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "no date");
    await switchEntryKind(as("alicia", 1), "br-feed-dependency", "blocker", "Kyle confirmed: no date");
    const [row] = await db.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.id, request.id));
    expect(row.state).toBe("switched");
  });

  it("Alicia keeps it with a reason; Kemar hears why", async () => {
    const { request } = await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "no date");
    await expect(answerKindChange(as("alicia"), request.id, { type: "keep", reason: " " })).rejects.toThrow(CommandRefused);
    await answerKindChange(as("alicia"), request.id, { type: "keep", reason: "Kyle gave Friday" });
    expect((await log())["br-feed-dependency"].state).toBe("open");
    expect(await notices("kemar")).toContain('Alicia kept "Store sales feed access from Sprouts IT" as a dependency. Reason: Kyle gave Friday');
    expect(await open("alicia")).not.toContain(`kind_change:${request.id}`);
  });

  it("a member cannot answer; only the asker withdraws", async () => {
    const { request } = await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "no date");
    await expect(answerKindChange(as("jodian"), request.id, { type: "switch" })).rejects.toThrow(CommandRefused);
    await expect(withdrawKindChange(as("jodian"), request.id)).rejects.toThrow(CommandRefused);
    await withdrawKindChange(as("kemar"), request.id);
    expect(await open("alicia")).not.toContain(`kind_change:${request.id}`);
  });

  it("BK17 the risk is closed while the request waits: it lapses and Kemar is told", async () => {
    const { request } = await askKindChange(as("kemar"), "br-pipeline-risk", "issue", "Kemar is away");
    await resolveBraidEntry(as("alicia", 1), "br-pipeline-risk", "closed");
    const [row] = await db.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.id, request.id));
    expect(row.state).toBe("lapsed");
    expect(await notices("kemar")).toContain('"Only Kemar can run the pipeline" can no longer change kind, so your request to make it an issue is closed.');
    expect(await open("alicia")).not.toContain(`kind_change:${request.id}`);
  });

  it("a PM switching to another kind lapses the request", async () => {
    const { request } = await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "no date");
    await switchEntryKind(as("alicia", 1), "br-feed-dependency", "risk", "it might slip, it has not");
    const [row] = await db.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.id, request.id));
    expect(row.state).toBe("lapsed");
  });

  it("reminds the deciders after 2 working days and never decides", async () => {
    const { request } = await askKindChange(as("kemar"), "br-feed-dependency", "blocker", "no date");
    expect(await runKindRequestReminders({ db, now: at(60) })).toEqual([]);
    expect(await runKindRequestReminders({ db, now: at(2 * 24 * 60) })).toEqual([{ requestId: request.id, projectId: "forager" }]);
    const [row] = await db.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.id, request.id));
    expect(row).toMatchObject({ state: "asked", remindersSent: 1 });
  });
});
