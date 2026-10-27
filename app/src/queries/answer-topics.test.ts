// Section 18 and the due topic against PGlite: each new answer from the seeded db, read from the asker's
// own data through the per-viewer queries (P10), with edge cases CQ1 to CQ13 and CQ16 to CQ19. A question
// goes through the same read as an update, with the recorded fixture, whose rule spots it.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Drafter, Extractor } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { decideBraidEntry, withdrawEntry } from "../commands/braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "../commands/capture";
import { loadItems } from "../db/records";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import type { RawQuestion } from "../domain/question";
import { at, seededDb } from "../test/seeded-db";
import { dueWindow, dueWords } from "./answers/due";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });

/** Someone asks in the chat at `when` (9:40am by default), optionally in a conversation. */
async function ask(who: string, text: string, opts: { when?: Date; extractor?: Extractor; conversationId?: string | null; drafter?: Drafter } = {}) {
  const when = opts.when ?? at(30);
  const ctx = { db, now: when, actorId: who };
  const created = await createCapture(ctx, { channel: "app", messageId: `t-${++n}`, kind: "text", text, messageAt: when, receivedAt: when, conversationId: opts.conversationId ?? null });
  await readCapture(ctx, created.captureId, opts.extractor ?? createFixtureExtractor(), { ...noWait, drafter: opts.drafter ?? null });
  const [row] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { row, answer: row.answer!, conversationId: created.conversationId };
}

/** Someone says something in Atlas; Atlas proposes these; they accept every item and save. */
async function says(who: string, text: string, proposals: RawProposal[], minutes = 1) {
  const { captureId } = await createCapture(as(who, minutes), { channel: "atlas", messageId: `atl-t-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as(who, minutes), captureId, proposals);
  await openReview(as(who, minutes), captureId);
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as(who, minutes), i.id, { type: "accept" });
  const r = await saveCapture(as(who, minutes), captureId);
  if (r.outcome !== "saved") throw new Error(`save: ${JSON.stringify(r)}`);
  return { captureId, items };
}

/** Kemar saves his 8:58 note at 9:11am, accepting the four that need his OK (story step 4). */
async function kemarSaves() {
  await openReview(as("kemar", 1), "cap-kemar-0858");
  for (const i of (await loadItems(db, "cap-kemar-0858")).items) if (i.state === "needs_ok") await decideExtraction(as("kemar", 1), i.id, { type: "accept" });
  expect((await saveCapture(as("kemar", 1), "cap-kemar-0858")).outcome).toBe("saved");
}

/** A new risk on the project the words name ("On GQ"). */
const risk = (projectId: string, title: string, quote: string): RawProposal => ({
  kind: "braid_new",
  projectId,
  routingReason: { basis: "reference", evidence: { forager: "Forager", insights: "Store Insights", gq: "GQ" }[projectId]!, label: projectId },
  braidKind: "risk",
  braidTitle: title,
  quote,
  confidence: "high",
  rationale: "A risk",
});

const titles = (a: { cards: { title: string }[] }) => a.cards.map((c) => c.title);

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("my_work: what am I working on?", () => {
  it("Kemar's open work, Blocked then In progress then To do by due date, his milestone and his blocker, each linked", async () => {
    const { row, answer } = await ask("kemar", "What am I working on?");
    expect(row.state).toBe("answered");
    expect(answer.text).toBe("You have 5 open work items, 1 milestone and 1 entry on the BRAID log.");
    expect(answer.cards.map((c) => [c.title, c.detail, c.tag])).toEqual([
      ["#145 Google Trends connector", "Forager 2.0: due Wed 21 Oct", "In progress"],
      ["#151 Store sales feed access", "Forager 2.0: due Thu 22 Oct", "In progress"],
      ["#147 Trend scoring model", "Forager 2.0: due Fri 23 Oct", "In progress"],
      ["#208 Weekly sales export", "Store Insights: due Fri 23 Oct", "In progress"],
      ["#152 Store feed connector", "Forager 2.0: due Tue 27 Oct", "To do"],
      ["Trend model", "Forager 2.0: forecast Fri 23 Oct", "Milestone · On track"],
      ["Store sales feed access", "Forager 2.0: Reported", "Blocker"],
    ]);
    // Every card opens something he can open
    expect(answer.cards.every((c) => c.href.startsWith("/projects/forager") || c.href === "/projects/insights")).toBe(true);
  });

  it("CQ1 nothing is Andre's: he is told so, then what needs him (Kemar's decision waits for him)", async () => {
    expect((await ask("andre", "What am I working on?")).answer).toMatchObject({ text: "Nothing is assigned to you right now.", cards: [] });
    await kemarSaves();
    const { answer } = await ask("andre", "What am I working on?");
    expect(answer.text).toBe("Nothing is assigned to you right now. Here is what needs you.");
    expect(answer.cards.map((c) => c.title)).toEqual(["Kemar proposed a decision: move the daily refresh to 6am"]);
  });

  it("CQ2 Alicia asks about Store Insights, which she is not in: her own work on her projects, Store Insights never named", async () => {
    const { row, answer } = await ask("alicia", "My tasks on Store Insights?");
    expect(row.question).toMatchObject({ topic: "my_work", projectId: null });
    // Her milestones, then her entries in the log's order of kinds
    expect(titles(answer)).toEqual(["Buyer pilot · Release 1", "Production checks", "Rollout · Release 2", "Only Kemar can run the pipeline", "Buyers available for the pilot week of 26 Oct", "Store sales feed access from Sprouts IT"]);
    expect(JSON.stringify(answer)).not.toContain("Insights");
  });

  it("CQ3 work he owns on a project he has left is not listed", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const { answer } = await ask("kemar", "What am I working on?");
    expect(titles(answer)).not.toContain("#208 Weekly sales export");
    expect(JSON.stringify(answer)).not.toContain("Store Insights");
  });

  it("a follow-up 'and on Store Insights?' is his work there (section 16)", async () => {
    const first = await ask("kemar", "What am I working on?");
    const { row, answer } = await ask("kemar", "and on Store Insights?", { when: at(31), conversationId: first.conversationId });
    expect(row.question).toEqual({ asked: "and on Store Insights?", topic: "my_work", projectId: "insights", follows: ["What am I working on?"] });
    expect(answer.text).toBe("You have 1 open work item on Store Insights.");
  });
});

describe("due: what's due, and the next milestone", () => {
  it("this week on a Tuesday: Kemar's work due today to Sunday, and the next milestone", async () => {
    const { answer } = await ask("kemar", "What's due this week?");
    expect(answer.text).toBe("4 work items of yours are due this week. The next milestone is Trend model, forecast Fri 23 Oct.");
    expect(answer.cards.map((c) => [c.title, c.detail, c.tag])).toEqual([
      ["#145 Google Trends connector", "Forager 2.0: In progress, due Wed 21 Oct", "On track"],
      ["#151 Store sales feed access", "Forager 2.0: In progress, due Thu 22 Oct", "On track"],
      ["#147 Trend scoring model", "Forager 2.0: In progress, due Fri 23 Oct", "On track"],
      ["#208 Weekly sales export", "Store Insights: In progress, due Fri 23 Oct", "On track"],
      ["Trend model", "Forager 2.0: forecast Fri 23 Oct", "Next milestone · On track"],
    ]);
  });

  it("CQ17 'What's due this week?' on a Friday: today to Sunday, and what is past due marked late", async () => {
    const { answer } = await ask("kemar", "What's due this week?", { when: new Date("2026-10-23T14:30:00Z") });
    expect(answer.text).toBe("2 work items of yours are due this week, and 2 work items are late. The next milestone is Trend model, forecast Fri 23 Oct.");
    expect(answer.cards.map((c) => [c.title, c.tag])).toEqual([
      ["#145 Google Trends connector", "Late"],
      ["#151 Store sales feed access", "Late"],
      ["#147 Trend scoring model", expect.any(String)],
      ["#208 Weekly sales export", expect.any(String)],
      ["Trend model", expect.any(String)],
    ]);
  });

  it("the window comes from the words: today, tomorrow, this week, next week (Monday to Sunday)", () => {
    expect(dueWindow("What's due today?", "2026-10-23")).toEqual({ from: "2026-10-23", to: "2026-10-23", label: "today", late: true });
    expect(dueWindow("Anything due tomorrow?", "2026-10-23")).toEqual({ from: "2026-10-24", to: "2026-10-24", label: "tomorrow", late: false });
    expect(dueWindow("What's due?", "2026-10-23")).toEqual({ from: "2026-10-23", to: "2026-10-25", label: "this week", late: true });
    expect(dueWindow("What's due next week?", "2026-10-23")).toEqual({ from: "2026-10-26", to: "2026-11-01", label: "next week", late: false });
    expect(dueWindow("What's due this week?", "2026-10-25")).toEqual({ from: "2026-10-25", to: "2026-10-25", label: "this week", late: true });
  });

  it("phase R: the window as the team writes it too", () => {
    expect(dueWindow("Wah due tideh?", "2026-10-23")).toMatchObject({ label: "today" });
    expect(dueWindow("Anyting due tumaro?", "2026-10-23")).toMatchObject({ label: "tomorrow" });
    expect(dueWindow("Wah due nex week?", "2026-10-23")).toMatchObject({ label: "next week" });
    expect(dueWindow("Wah due dis week?", "2026-10-23")).toMatchObject({ label: "this week" });
    expect(dueWords("and on GQ?", ["Wah due tumaro?"])).toBe("Wah due tumaro?");
  });

  it("CQ14 every spelling that sets a window is one a follow-up reads too", () => {
    const spellings = ["today", "tiday", "tideh", "tomorrow", "tumaro", "tumoro", "tomorra", "this week", "dis week", "next week", "nex week"];
    for (const w of spellings) expect(dueWords("and on GQ?", [`Wah due ${w}?`, "What's due next week?"]), w).toBe(`Wah due ${w}?`);
  });

  it("phase R: 'Wah due tumaro?' with no model is answered as 'Anything due tomorrow?' is, in standard English", async () => {
    expect((await ask("kemar", "Wah due tumaro?")).answer.text).toBe("1 work item of yours is due tomorrow. The next milestone is Trend model, forecast Fri 23 Oct.");
  });

  it("tomorrow and next week", async () => {
    expect((await ask("kemar", "Anything due tomorrow?")).answer.text).toBe("1 work item of yours is due tomorrow. The next milestone is Trend model, forecast Fri 23 Oct.");
    expect(titles((await ask("kemar", "What's due next week?", { when: at(31) })).answer)).toEqual(["#152 Store feed connector", "Trend model"]);
  });

  it("a named project gives its due work whoever owns it", async () => {
    const { answer } = await ask("alicia", "What's due on Forager this week?");
    expect(answer.text).toBe("3 work items on Forager 2.0 are due this week. The next milestone is Trend model, forecast Fri 23 Oct.");
    expect(answer.cards[0]).toMatchObject({ title: "#145 Google Trends connector", detail: "Forager 2.0: In progress, due Wed 21 Oct, Kemar" });
  });

  it("CQ18 no milestones left on Store Insights: said so, and never a milestone from another project", async () => {
    const { answer } = await ask("kemar", "When's the next milestone on Store Insights?");
    expect(answer).toMatchObject({ text: "No milestones left on Store Insights.", cards: [] });
    expect(JSON.stringify(answer)).not.toContain("Trend");
    expect((await ask("kemar", "When's the next milestone?", { when: at(31) })).answer.text).toBe("The next milestone on Forager 2.0 is Trend model, forecast Fri 23 Oct.");
  });

  it("CV8, CQ14 a follow-up keeps what the question before it asked: milestones, or the window", async () => {
    const first = await ask("kemar", "When's the next milestone?");
    const { row, answer } = await ask("kemar", "and on Store Insights?", { when: at(31), conversationId: first.conversationId });
    expect(row.question).toEqual({ asked: "and on Store Insights?", topic: "due", projectId: "insights", follows: ["When's the next milestone?"] });
    expect(answer).toMatchObject({ text: "No milestones left on Store Insights.", cards: [] });

    const tomorrow = await ask("kemar", "What's due tomorrow?", { when: at(32) });
    expect((await ask("kemar", "and on Forager?", { when: at(33), conversationId: tomorrow.conversationId })).answer.text).toMatch(/^1 work item on Forager 2\.0 is due tomorrow\./);
    // Its own words win: "and next week?" after "What's due tomorrow?" is next week
    expect((await ask("kemar", "and next week?", { when: at(34), conversationId: tomorrow.conversationId })).answer.text).toMatch(/due next week/);
  });

  it("dueWords: the follow-up's own words when they say what they want, else the newest question it follows that does", () => {
    expect(dueWords("and on Forager?", ["What's due tomorrow?"])).toBe("What's due tomorrow?");
    expect(dueWords("and on GQ?", ["and on Forager?", "When's the next milestone?"])).toBe("When's the next milestone?");
    expect(dueWords("and today?", ["What's due tomorrow?"])).toBe("and today?");
    expect(dueWords("and on Forager?", ["What's due?"])).toBe("and on Forager?");
  });

  it("CQ19 a forecast that differs from the target says both, and which is later", async () => {
    await db.update(t.milestones).set({ forecastDate: "2026-10-24" }).where(eq(t.milestones.id, "ms-trend"));
    const { answer } = await ask("kemar", "When's the next milestone on Forager?");
    expect(answer.text).toBe("The next milestone on Forager 2.0 is Trend model, forecast Sat 24 Oct, later than its target Fri 23.");
  });
});

describe("updates: what's new since you last asked", () => {
  it("CQ4 the first time: the last 7 days, newest first: Alicia's status and the entries she logged", async () => {
    const { answer } = await ask("kemar", "Any updates?");
    expect(answer.text).toBe("In the last 7 days: 4 updates on your projects.");
    expect(answer.cards.map((c) => [c.title, c.detail, c.tag])).toEqual([
      ["Alicia set Forager 2.0 Off track", "Forager 2.0: 9:02am", "Status"],
      ["Only Kemar can run the pipeline", "Forager 2.0: new risk from Alicia, 5 days ago", "Risk"],
      ["Store sales feed access", "Forager 2.0: new blocker from Alicia, 6 days ago", "Blocker"],
      ["Store sales feed access from Sprouts IT", "Forager 2.0: new dependency from Alicia, 6 days ago", "Dependency"],
    ]);
  });

  it("CQ5 asked twice in a minute: nothing new since the first answer", async () => {
    await ask("kemar", "Any updates?");
    expect((await ask("kemar", "Any updates?", { when: at(31) })).answer).toMatchObject({ text: "Nothing new since 9:40am.", cards: [] });
  });

  it("CQ5 a risk reported before he asked, approved after: new when it went on the log, so the next ask has it", async () => {
    await says("jodian", "On Forager, the vendor may change the API.", [risk("forager", "Vendor may change the API", "the vendor may change the API")], 20);
    const proposed = (await db.select().from(t.braidEntries).where(eq(t.braidEntries.title, "Vendor may change the API")))[0];
    expect(proposed.state).toBe("proposed");
    expect(titles((await ask("kemar", "Any updates?")).answer)).not.toContain("Vendor may change the API");
    await decideBraidEntry(as("alicia", 40), proposed.id, { type: "approve" });
    const { answer } = await ask("kemar", "Any updates?", { when: at(50) });
    expect(answer.text).toBe("Since 9:40am: 1 update on your projects.");
    expect(answer.cards).toEqual([expect.objectContaining({ title: "Vendor may change the API", detail: "Forager 2.0: new risk from Jodian, 9:50am" })]);
    // CQ6: Alicia put it on the log herself, so it is not news to her
    expect(titles((await ask("alicia", "Any updates?", { when: at(51) })).answer)).not.toContain("Vendor may change the API");
  });

  it("CQ5 a report said before he asked and saved from review after: new when it was saved", async () => {
    const said = at(20);
    const blocker: RawProposal = { ...risk("forager", "Test data is missing", "the test data is missing"), braidKind: "blocker", rationale: "A blocker" };
    const { captureId } = await createCapture(as("jodian", 20), { channel: "atlas", messageId: "atl-late-save", kind: "text", text: "On Forager, the test data is missing.", messageAt: said, receivedAt: said });
    const { items } = await proposeItems(as("jodian", 20), captureId, [blocker]);
    await ask("kemar", "Any updates?");
    await openReview(as("jodian", 40), captureId);
    for (const i of items) if (i.state === "needs_ok") await decideExtraction(as("jodian", 40), i.id, { type: "accept" });
    expect((await saveCapture(as("jodian", 40), captureId)).outcome).toBe("saved");
    const { answer } = await ask("kemar", "Any updates?", { when: at(50) });
    expect(answer.cards).toEqual([expect.objectContaining({ title: "Test data is missing", detail: "Forager 2.0: new blocker from Jodian, 9:50am" })]);
  });

  it("CQ6, CQ7 Alicia sees Kemar's saved changes on Forager, told as review tells them, with no quote; never his Store Insights words", async () => {
    await kemarSaves();
    const { answer } = await ask("alicia", "What's new?");
    expect(answer.cards.map((c) => [c.title, c.detail])).toEqual(
      expect.arrayContaining([
        ["Kemar: Issue #145 Google Trends connector", "Forager 2.0: In progress to Done"],
        ["Kemar: Milestone Trend model", "Forager 2.0: Forecast 23 Oct to 26 Oct"],
      ]),
    );
    const said = JSON.stringify(answer);
    expect(said).not.toContain("Store Insights");
    expect(said).not.toContain("Weekly sales export");
    expect(said).not.toContain("Still waiting on Kyle");
    // CQ6: her own status and her own entries are not news to her
    expect(said).not.toContain("Alicia set");
    expect(said).not.toContain("from Alicia");
  });

  it("CQ6 his own saves are not news to him; a notice to him is", async () => {
    await kemarSaves();
    const proposed = (await db.select().from(t.braidEntries).where(eq(t.braidEntries.title, "Trend model may slip to 26 Oct")))[0];
    await decideBraidEntry(as("alicia", 2), proposed.id, { type: "approve" });
    const { answer } = await ask("kemar", "Any updates?");
    expect(answer.cards[0]).toMatchObject({ title: "Alicia approved your risk: Trend model may slip to 26 Oct.", tag: "For you", href: "/projects/forager?view=table" });
    expect(JSON.stringify(answer)).not.toContain("Kemar:");
  });

  it("a named project only: nothing new on GQ", async () => {
    expect((await ask("alicia", "What changed on GQ?")).answer.text).toBe("Nothing new on GQ & Academy in the last 7 days.");
  });

  it("CQ16 'What's new with Kyle?' is updates on all his projects", async () => {
    const { row, answer } = await ask("kemar", "What's new with Kyle?");
    expect(row.question).toEqual({ asked: "What's new with Kyle?", topic: "updates", projectId: null });
    expect(answer.text).toBe("In the last 7 days: 4 updates on your projects.");
  });
});

describe("mentions: who has mentioned me?", () => {
  it("Jodian is named in Kemar's note on Forager: one mention, though the words feed two items", async () => {
    await kemarSaves();
    const { answer } = await ask("jodian", "Who has mentioned me?");
    expect(answer.text).toBe("You were mentioned 1 time in the last 14 days.");
    expect(answer.cards).toEqual([expect.objectContaining({ title: "Kemar on Forager 2.0", detail: 'Today: "Jodian has the runbook already"', href: expect.stringMatching(/^\/projects\/forager/) })]);
  });

  it("Andre is named on Store Insights, and sees only that sentence of the note", async () => {
    await kemarSaves();
    const { answer } = await ask("andre", "Did anyone mention me?");
    expect(answer.cards.map((c) => [c.title, c.detail])).toEqual([["Kemar on Store Insights", 'Today: "Andre and I agreed to move the refresh to 6am"']]);
  });

  it("CQ8 words naming Alicia routed to Store Insights, which she is not in: not listed, not counted", async () => {
    await says("kemar", "On Store Insights, Alicia may not sign off the export in time.", [risk("insights", "Export sign-off may be late", "Alicia may not sign off the export in time")]);
    expect((await ask("alicia", "Who has mentioned me?")).answer).toMatchObject({ text: "Nobody has mentioned you in the last 14 days.", cards: [] });
    // Once she is in Store Insights, the same words are hers to see
    await db.insert(t.projectMemberships).values({ projectId: "insights", personId: "alicia", role: "member", state: "member" });
    expect(titles((await ask("alicia", "Who has mentioned me?", { when: at(31) })).answer)).toEqual(["Kemar on Store Insights"]);
  });

  it("CQ9 a first name another member of the project shares counts only as a full name", async () => {
    await db.insert(t.people).values({ id: "kemar-l", name: "Kemar Lewis", initials: "KL", title: "Analyst", orgRole: "employee" });
    await db.insert(t.projectMemberships).values({ projectId: "forager", personId: "kemar-l", role: "member", state: "member" });
    await says("alicia", "On Forager, Waiting on Kemar for the store feed. On GQ, Kemar may not have time for the Academy slides.", [
      risk("forager", "Store feed waits on one person", "Waiting on Kemar for the store feed"),
      risk("gq", "Academy slides may slip", "Kemar may not have time for the Academy slides"),
    ]);
    expect((await ask("kemar", "Who has mentioned me?")).answer.cards.map((c) => c.title)).toEqual(["Alicia on GQ & Academy"]);
    await says("alicia", "On Forager, Kemar Brown owns the feed contact with Sprouts IT.", [risk("forager", "Feed contact is one person", "Kemar Brown owns the feed contact")], 2);
    expect((await ask("kemar", "Who has mentioned me?", { when: at(31) })).answer.cards.map((c) => c.detail)).toEqual([
      'Today: "Kemar Brown owns the feed contact"',
      'Today: "Kemar may not have time for the Academy slides"',
    ]);
  });

  it("CQ10 naming himself is not a mention", async () => {
    await says("kemar", "On GQ, Kemar here: the Academy slides may slip.", [risk("gq", "Academy slides may slip", "Kemar here: the Academy slides may slip")]);
    expect((await ask("kemar", "Who has mentioned me?")).answer.cards).toEqual([]);
  });

  it("CQ11 a report taken back is not a mention", async () => {
    const same: RawProposal = {
      kind: "braid_same",
      projectId: "forager",
      routingReason: { basis: "target", evidence: "store feed", label: "store feed" },
      braidKind: "blocker",
      matchEntryId: "br-feed-blocker",
      quote: "Jodian can't test the feed either",
      confidence: "high",
      rationale: "Same blocker",
    };
    await says("kemar", "Jodian can't test the feed either.", [same]);
    expect((await ask("jodian", "Who has mentioned me?")).answer.cards).toHaveLength(1);
    await withdrawEntry(as("kemar", 2), "br-feed-blocker");
    expect((await ask("jodian", "Who has mentioned me?", { when: at(31) })).answer.cards).toEqual([]);
  });
});

describe("project_status for one named project", () => {
  it("'Tell me about Forager': its status, next milestone, live blockers and risks, and what needs him on it", async () => {
    const { row, answer } = await ask("kemar", "Tell me about Forager");
    expect(row.question).toMatchObject({ topic: "project_status", projectId: "forager" });
    expect(answer.text).toBe("Forager 2.0 is On track. The next milestone is Trend model, forecast Fri 23 Oct. 1 blocker and 1 risk are live, and 4 things need you on it.");
    expect(answer.cards.slice(0, 3).map((c) => [c.title, c.tag, c.href])).toEqual([
      ["Forager 2.0", "On track", "/projects/forager"],
      ["Trend model", "Next milestone · On track", "/projects/forager"],
      ["1 blocker and 1 risk on the log", "BRAID log", "/projects/forager?view=table"],
    ]);
    expect(answer.cards.slice(3).every((c) => c.accept?.captureId === "cap-kemar-0858")).toBe(true);
    expect(answer.cards).toHaveLength(7);
  });

  it("a project she is not in is dropped: how her own projects stand, nothing more", async () => {
    const { answer } = await ask("alicia", "Tell me about Store Insights");
    expect(titles(answer)).toEqual(["Forager 2.0", "GQ & Academy"]);
    expect(JSON.stringify(answer)).not.toContain("Insights");
  });

  it("Store Insights for Andre: no milestones left, nothing live, nothing needs him", async () => {
    const { answer } = await ask("andre", "How is Store Insights?");
    expect(answer.text).toBe("Store Insights is On track. No milestones left on it. 0 blockers and 0 risks are live, and nothing on it needs you.");
  });
});

describe("small talk", () => {
  it("CQ12 'Hi' with no model is answered by the rule, not 'not connected'", async () => {
    const { row, answer } = await ask("kemar", "Hi");
    expect(row.state).toBe("answered");
    expect(answer).toMatchObject({
      topic: "small_talk",
      wording: "rules",
      text: "Hi Kemar. Send me an update, or ask what you're working on, what needs you, any updates or who mentioned you.",
      cards: [],
    });
    expect((await ask("kemar", "Thanks!", { when: at(31) })).answer.text).toBe("Any time.");
  });

  it("CQ13 'Morning! Finished #145.' is an update: no small talk reply", async () => {
    expect((await ask("kemar", "Morning! Finished #145.")).row.state).toBe("failed");
    const done: RawProposal = {
      kind: "update",
      projectId: "forager",
      routingReason: { basis: "target", evidence: "#145", label: "#145" },
      targetId: "wi-145",
      field: "state",
      newValue: "done",
      quote: "Finished #145",
      confidence: "high",
      rationale: "Done",
    };
    const model: Extractor = { name: "fake", extract: async () => ({ proposals: [done], question: null, malformed: [], model: "fake", usage: null }) };
    const { row } = await ask("kemar", "Morning! Finished #145.", { when: at(31), extractor: model });
    expect(row.state).toBe("proposed");
    expect(row.answer).toBeNull();
    // A model that calls the greeting small talk is not believed: the server checks the whole message (section 15)
    const hello: RawQuestion = { asked: "Morning!", topic: "small_talk", projectId: null };
    const wrong: Extractor = { name: "fake", extract: async () => ({ proposals: [done], question: hello, malformed: [], model: "fake", usage: null }) };
    const again = await ask("kemar", "Morning! Finished #145.", { when: at(32), extractor: wrong });
    expect(again.row).toMatchObject({ state: "proposed", question: null, answer: null });
  });

  it("JA5 'Wha gwaan?' with no model gets the hello; 'Tank yuh' gets 'Any time.'; both in standard English (CD20)", async () => {
    const { row, answer } = await ask("kemar", "Wha gwaan?");
    expect(row.state).toBe("answered");
    expect(answer).toMatchObject({ topic: "small_talk", wording: "rules", text: expect.stringMatching(/^Hi Kemar\. Send me an update/) });
    expect((await ask("kemar", "Tank yuh", { when: at(31) })).answer.text).toBe("Any time.");
  });

  it("JA6 'Weh mi fi do today?' with no model is answered from what needs him", async () => {
    const { row, answer } = await ask("kemar", "Weh mi fi do today?");
    expect(row.state).toBe("answered");
    expect(answer.topic).toBe("needs_me");
  });

  it("JA1 to JA3 a Patois update with no model is not taken for a question: it waits for Atlas", async () => {
    for (const [i, text] of ["Di access nuh come yet", "Mi done wid #208", "Him a go send it"].entries()) {
      const { row } = await ask("kemar", text, { when: at(31 + i) });
      expect(row).toMatchObject({ state: "failed", answer: null });
    }
  });

  it("small talk is not worded: DPM's reply stands, and the model is not called", async () => {
    let calls = 0;
    const drafter: Drafter = { name: "fake", draft: async () => (calls++, { text: "Hello there!", model: "fake", usage: null }) };
    const asked: RawQuestion = { asked: "Good morning", topic: "small_talk", projectId: null };
    const model: Extractor = { name: "fake", extract: async () => ({ proposals: [], question: asked, malformed: [], model: "fake", usage: null }) };
    const { answer } = await ask("kemar", "Good morning", { extractor: model, drafter });
    expect(answer).toMatchObject({ wording: "rules", text: expect.stringMatching(/^Hi Kemar\./) });
    expect(calls).toBe(0);
  });
});
