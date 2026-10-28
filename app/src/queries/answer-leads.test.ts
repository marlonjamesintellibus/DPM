// Phase N against PGlite: questions for leads and executives from the seeded db, read through the
// per-viewer queries (P10), with edge cases LD1 to LD10. A question goes through the same read as an
// update, with the recorded fixture, whose rule spots it. In the seed Alicia is PM of Forager and GQ,
// Andre PM of Store Insights, Kemar a member of all three and Jodian of Forager; Kyle is Forager's
// outside contact; Kemar's 8:58 note says things about Forager and Store Insights and waits for his
// review (not saved), and he is on leave 26 to 30 Oct. It is 9:40am on Tuesday 20 Oct unless a test says
// otherwise.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Drafter } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { askKindChange, decideBraidEntry, reportBraidEntry } from "../commands/braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "../commands/capture";
import { saveReason } from "../commands/status";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { at, seededDb } from "../test/seeded-db";
import { LEADS_ONLY, TODAY_ONLY } from "./answers/not-updated";
import { FREE_FOR_WHAT } from "./answers/who-free";
import { peopleSeenBy, personSeenBy } from "./people";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };
const DAY = 24 * 60;
const as = (actorId: string, minutes = 30) => ({ db, now: at(minutes), actorId });

/** Someone asks in the chat at `minutes` after 9:10am (9:40am by default), in a conversation when given. */
async function ask(who: string, text: string, minutes = 30, conversationId: string | null = null, drafter: Drafter | null = null) {
  const ctx = as(who, minutes);
  const created = await createCapture(ctx, { channel: "app", messageId: `n-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, conversationId });
  await readCapture(ctx, created.captureId, createFixtureExtractor(), { ...noWait, drafter });
  const [row] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { row, answer: row.answer!, conversationId: created.conversationId };
}

const titles = (a: { cards: { title: string }[] }) => a.cards.map((c) => c.title);
const everything = (a: { text: string; cards: { title: string; detail: string | null; tag: string | null }[] }) => JSON.stringify([a.text, a.cards]);
const role = (projectId: string, personId: string, r: "pm" | "lead" | "member") =>
  db.update(t.projectMemberships).set({ role: r }).where(and(eq(t.projectMemberships.projectId, projectId), eq(t.projectMemberships.personId, personId)));

/**
 * Someone sends an update finishing their work item `targetId` on `projectId`, `minutes` after 9:10am, on
 * a channel; with `save`, they review it and save it, otherwise it waits in their review.
 */
async function updateOn(who: string, minutes: number, { projectId = "forager", targetId = "wi-160", channel = "atlas", save = false }: { projectId?: string; targetId?: string; channel?: "app" | "atlas"; save?: boolean } = {}) {
  const proposal: RawProposal = {
    kind: "update",
    projectId,
    routingReason: { basis: "target", evidence: "feature store backfill", label: "It is on the project" },
    targetId,
    field: "state",
    newValue: "done",
    quote: "Finished the feature store backfill, my secret plan worked",
    confidence: "high",
    rationale: "You finished it.",
  };
  const { captureId } = await createCapture(as(who, minutes), { channel, messageId: `u-${++n}`, kind: "text", text: `${proposal.quote}.`, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as(who, minutes), captureId, [proposal]);
  if (save) {
    await openReview(as(who, minutes), captureId);
    for (const i of items) if (i.state === "needs_ok") await decideExtraction(as(who, minutes), i.id, { type: "accept" });
    expect((await saveCapture(as(who, minutes), captureId)).outcome).toBe("saved");
  }
  return captureId;
}

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("not_updated: who has no update saved today (LD1 to LD10)", () => {
  it("Alicia, PM of Forager and GQ: names only, per project", async () => {
    const { row, answer } = await ask("alicia", "Who hasn't updated today?");
    expect(row.question).toMatchObject({ topic: "not_updated" });
    expect(answer.text).toBe("2 people have no update saved today on Forager 2.0: Jodian Taylor and Kemar Brown. 1 person has no update saved today on GQ & Academy: Kemar Brown.");
    expect(answer.cards.map((c) => [c.title, c.detail])).toEqual([
      ["Jodian Taylor", "Forager 2.0: no update saved today"],
      ["Kemar Brown", "Forager 2.0: no update saved today"],
      ["Kemar Brown", "GQ & Academy: no update saved today"],
    ]);
  });

  it("LD1: a member asks: only PMs and Leads, and nothing about anyone", async () => {
    const { answer } = await ask("kemar", "Who hasn't updated today?");
    expect(answer).toMatchObject({ text: LEADS_ONLY, cards: [], more: null });
    // A project they name where they are a member says the same, about that project only
    expect((await ask("kemar", "Who hasn't updated on Forager?", 31)).answer.text).toBe("Only PMs and Leads of Forager 2.0 can see that.");
  });

  it("the role is read per project when it is answered: a PM on Forager and a member on GQ hears about Forager only", async () => {
    await role("gq", "alicia", "member");
    const { answer } = await ask("alicia", "Who hasn't updated today?");
    expect(answer.text).toBe("2 people have no update saved today on Forager 2.0: Jodian Taylor and Kemar Brown.");
    expect(everything(answer)).not.toMatch(/GQ/);
    // Made a Lead again, the next answer has GQ back (rule 7)
    await role("gq", "alicia", "lead");
    expect((await ask("alicia", "Who hasn't updated today?", 31)).answer.text).toContain("on GQ & Academy: Kemar Brown");
  });

  it("P10: Andre hears about Store Insights only", async () => {
    const { answer } = await ask("andre", "Who hasn't updated today?");
    expect(answer.text).toBe("1 person has no update saved today on Store Insights: Kemar Brown.");
    expect(everything(answer)).not.toMatch(/Jodian|Forager|GQ/);
  });

  it("LD9: a saved update from any channel counts; only who and where are read, never the words", async () => {
    await updateOn("jodian", 20, { channel: "app", save: true });
    await updateOn("kemar", 25, { targetId: "wi-152", save: true });
    const { answer } = await ask("alicia", "Who hasn't updated on Forager?");
    expect(answer.text).toBe("Everyone on Forager 2.0 has saved an update today.");
    expect(everything(answer)).not.toMatch(/secret|backfill/);
  });

  it("rule 9, PP8: an update still in its author's review is theirs alone, so it is not counted nor hinted at", async () => {
    // Kemar's 8:58 note about Forager waits for his review, and so does Jodian's
    await updateOn("jodian", 20, { channel: "app" });
    const { answer } = await ask("alicia", "Who hasn't updated on Forager?");
    expect(answer.text).toBe("2 people have no update saved today on Forager 2.0: Jodian Taylor and Kemar Brown.");
    expect(everything(answer)).not.toMatch(/review|draft|8:58|secret|backfill/);
  });

  it("an update yesterday, or a question today, is not an update today", async () => {
    await updateOn("jodian", -DAY, { save: true });
    await ask("jodian", "What am I working on?", 5);
    expect((await ask("alicia", "Who hasn't updated on Forager?")).answer.text).toBe("2 people have no update saved today on Forager 2.0: Jodian Taylor and Kemar Brown.");
  });

  it("LD2: someone on leave today is not missing, and is named as on leave", async () => {
    await db.insert(t.leave).values({ id: "lv-jodian", personId: "jodian", startDate: "2026-10-19", endDate: "2026-10-23", state: "approved" });
    await updateOn("kemar", 25, { targetId: "wi-152", save: true });
    const { answer } = await ask("alicia", "Who hasn't updated on Forager?");
    expect(answer.text).toBe("Everyone on Forager 2.0 has saved an update today, or is on leave. Jodian Taylor is on leave until Fri 23 Oct.");
    expect(answer.cards).toEqual([]);
  });

  it("LD2: Kemar on his approved leave is not missing on GQ; a leave only asked for is not leave", async () => {
    expect((await ask("alicia", "Who hasn't updated on GQ?", 7 * DAY)).answer.text).toBe("Everyone on GQ & Academy has saved an update today, or is on leave. Kemar Brown is on leave until Fri 30 Oct.");
    await db.insert(t.leave).values({ id: "lv-jodian", personId: "jodian", startDate: "2026-10-20", endDate: "2026-10-23", state: "requested" });
    expect((await ask("alicia", "Who hasn't updated on Forager?")).answer.text).toBe("2 people have no update saved today on Forager 2.0: Jodian Taylor and Kemar Brown.");
  });

  it("LD2: \"or is on leave\" is said of a project only for its own people on leave", async () => {
    // Kemar is on leave on 27 Oct and on both of Alicia's projects; he saved an update about GQ that day
    await db.insert(t.workItems).values({ id: "wi-gq-1", projectId: "gq", number: "#301", title: "Academy outline", ownerId: "kemar", state: "in_progress" });
    await updateOn("kemar", 7 * DAY + 10, { projectId: "gq", targetId: "wi-gq-1", save: true });
    const { answer } = await ask("alicia", "Who hasn't updated today?", 7 * DAY + 30);
    expect(answer.text).toBe(
      "1 person has no update saved today on Forager 2.0: Jodian Taylor. Everyone on GQ & Academy has saved an update today. Kemar Brown is on leave until Fri 30 Oct.",
    );
  });

  it("LD3, CD27: before the standup time it is early; on a weekend nobody is expected", async () => {
    const early = await ask("alicia", "Who hasn't updated today?", -20);
    expect(early.answer.text).toBe("It's early: updates usually come in by 9am. Ask again after that.");
    expect(early.answer.cards).toEqual([]);
    expect((await ask("alicia", "Who hasn't updated today?", 4 * DAY)).answer.text).toBe("It's the weekend, so nobody is expected to send an update today.");
    // A member hears LD1 whatever the time: the role comes first
    expect((await ask("kemar", "Who hasn't updated today?", -20)).answer.text).toBe(LEADS_ONLY);
  });

  it("LD5: an outside contact is never listed", async () => {
    const { answer } = await ask("alicia", "Who hasn't updated on Forager?");
    expect(everything(answer)).not.toMatch(/Kyle/);
  });

  it("LD6: a project with nobody else on it", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "gq"), eq(t.projectMemberships.personId, "kemar")));
    expect((await ask("alicia", "Who hasn't updated on GQ?")).answer.text).toBe("Only you on GQ & Academy.");
  });

  it("LD10, CD16: a follow-up about another day is today only, with no history", async () => {
    const first = await ask("alicia", "Who hasn't updated today?");
    // "and on GQ?" keeps today
    expect((await ask("alicia", "and on GQ?", 31, first.conversationId)).answer.text).toBe("1 person has no update saved today on GQ & Academy: Kemar Brown.");
    const next = await ask("alicia", "And last week?", 32, first.conversationId);
    expect(next.row.question).toMatchObject({ topic: "not_updated" });
    expect(next.answer).toMatchObject({ text: TODAY_ONLY, cards: [] });
    // A follow-up after it keeps the day said last (CV8)
    expect((await ask("alicia", "and on GQ?", 33, first.conversationId)).answer.text).toBe(TODAY_ONLY);
    expect((await ask("alicia", "Who didn't update yesterday?", 34)).answer.text).toBe(TODAY_ONLY);
    // LD1 comes first: a member asking about another day hears only that it is not theirs to see
    expect((await ask("kemar", "Who didn't update yesterday?", 35)).answer.text).toBe(LEADS_ONLY);
  });

  it("LD10: \"so far today\" asks about today", async () => {
    const { row, answer } = await ask("alicia", "Who hasn't updated so far today?");
    expect(row.question).toMatchObject({ topic: "not_updated" });
    expect(answer.text).toBe("2 people have no update saved today on Forager 2.0: Jodian Taylor and Kemar Brown. 1 person has no update saved today on GQ & Academy: Kemar Brown.");
  });
});

describe("my_decisions: what waits for the asker's decision, oldest first", () => {
  it("Alicia's set status waits for its reason; Kemar has nothing to decide", async () => {
    const { row, answer } = await ask("alicia", "What needs a decision from me?");
    expect(row.question).toMatchObject({ topic: "my_decisions" });
    expect(answer.text).toBe("1 decision waits on you, oldest first.");
    expect(answer.cards).toMatchObject([{ title: "Forager 2.0 is set Off track, but the plan says On track", detail: "Forager 2.0: waiting since 9:02am", tag: "Status you set" }]);
    // Phase B: it offers what its inbox item offers
    expect(answer.cards[0].actions?.map((a) => a.act)).toEqual(["give_reason"]);
    expect((await ask("kemar", "What needs a decision from me?")).answer.text).toBe("Nothing waits for your decision right now.");
  });

  it("proposals and kind changes, oldest first; what is not a decision is not listed", async () => {
    const risk = await reportBraidEntry(as("jodian", 10), "forager", { kind: "risk", title: "Pilot buyers may not reply in time" });
    await askKindChange(as("kemar", 20), "br-pipeline-risk", "issue", "Kemar is away next week and nobody else has run it");
    await reportBraidEntry(as("jodian", 25), "forager", { kind: "blocker", title: "Test data missing" });
    const { answer } = await ask("alicia", "What needs a decision from me?");
    expect(answer.text).toBe("3 decisions wait on you, oldest first.");
    expect(answer.cards.map((c) => c.tag)).toEqual(["Status you set", "Proposal", "Kind change"]);
    expect(answer.cards[1]).toMatchObject({ title: "Jodian raised a risk: Pilot buyers may not reply in time", subject: { type: "braid_entry", id: risk.entry.id } });
    expect(answer.cards[1].actions?.map((a) => a.act)).toEqual(["approve", "decline"]);
    // A new blocker needs her, but it is not hers to decide: needs_me lists it, my_decisions does not
    expect(everything(answer)).not.toMatch(/Test data missing/);
    expect(everything((await ask("alicia", "What needs me today?", 31)).answer)).toMatch(/New blocker on Forager 2.0: Test data missing/);
  });

  it("LD8: a decision with two approvers is listed for each until one decides (S11)", async () => {
    await role("forager", "kemar", "lead");
    const risk = await reportBraidEntry(as("jodian", 10), "forager", { kind: "risk", title: "Pilot buyers may not reply in time" });
    expect(titles((await ask("alicia", "What needs a decision from me?")).answer)).toContain("Jodian raised a risk: Pilot buyers may not reply in time");
    expect(titles((await ask("kemar", "What needs a decision from me?")).answer)).toEqual(["Jodian raised a risk: Pilot buyers may not reply in time"]);
    await decideBraidEntry(as("alicia", 40), risk.entry.id, { type: "approve" });
    expect((await ask("kemar", "What needs a decision from me?", 41)).answer.text).toBe("Nothing waits for your decision right now.");
  });

  it("an Ask to the owner (M37) waits on the owner: Kemar says Jodian finished #160", async () => {
    const { captureId } = await createCapture(as("kemar", 0), { channel: "atlas", messageId: "atl-n-1", kind: "text", text: "Jodian finished the feature store backfill.", messageAt: at(0), receivedAt: at(0) });
    const { items } = await proposeItems(as("kemar", 0), captureId, [
      {
        kind: "update",
        projectId: "forager",
        routingReason: { basis: "target", evidence: "feature store backfill", label: "#160 is on Forager" },
        targetId: "wi-160",
        field: "state",
        newValue: "done",
        quote: "Jodian finished the feature store backfill",
        confidence: "high",
        rationale: "You say Jodian finished it.",
      },
    ]);
    await openReview(as("kemar", 0), captureId);
    for (const i of items) if (i.state === "needs_ok") await decideExtraction(as("kemar", 0), i.id, { type: "accept" });
    expect((await saveCapture(as("kemar", 0), captureId)).outcome).toBe("saved");
    const { answer } = await ask("jodian", "What needs a decision from me?");
    expect(answer.cards).toMatchObject([{ title: "Kemar says: #160 Feature store backfill, In progress to Done", tag: "Asks you" }]);
  });

  it("whether a blocker is resolved, whether a dependency was delivered, and leave she decides as its admin", async () => {
    await db.insert(t.leave).values({ id: "lv-jodian", personId: "jodian", startDate: "2026-10-26", endDate: "2026-10-27", state: "requested" });
    await db.insert(t.inboxItems).values([
      { id: "ib-clear", ownerId: "alicia", causeKey: "confirm_clear:br-feed-blocker", episode: 1, state: "open", createdAt: at(10) },
      { id: "ib-dep", ownerId: "alicia", causeKey: "dependency_due:br-feed-dependency", episode: 1, state: "open", createdAt: at(11) },
      { id: "ib-leave", ownerId: "alicia", causeKey: "leave_impact:lv-jodian@forager", episode: 1, state: "open", createdAt: at(12) },
    ]);
    const { answer } = await ask("alicia", "What needs a decision from me?");
    expect(answer.cards.map((c) => c.tag)).toEqual(["Status you set", "Blocker resolved?", "Dependency due", "Leave"]);
    expect(answer.cards[1].actions?.map((a) => a.act)).toEqual(["resolve"]);
    // D6: with someone else the admin who decides it, the same leave only asks her to plan cover
    await db.update(t.groups).set({ ownerId: "andre" }).where(eq(t.groups.id, "g-forager"));
    expect((await ask("alicia", "What needs a decision from me?", 31)).answer.cards.map((c) => c.tag)).toEqual(["Status you set", "Blocker resolved?", "Dependency due"]);
  });

  it("P10: only their own, on projects they read; a named project narrows it", async () => {
    await reportBraidEntry(as("jodian", 10), "forager", { kind: "risk", title: "Pilot buyers may not reply in time" });
    expect((await ask("andre", "What needs a decision from me?")).answer.text).toBe("Nothing waits for your decision right now.");
    expect((await ask("alicia", "What needs a decision from me on GQ?")).answer.text).toBe("Nothing waits for your decision right now.");
  });
});

describe("at_risk_week: what is at risk this week on their projects", () => {
  it("the live blocker on Forager; nothing of it for Andre", async () => {
    const { row, answer } = await ask("alicia", "What's at risk this week?");
    expect(row.question).toMatchObject({ topic: "at_risk_week" });
    expect(answer.text).toBe("At risk this week on your projects: 1 live blocker.");
    expect(answer.cards).toMatchObject([{ title: "Store sales feed access", detail: "Forager 2.0: 1 report, since 14 Oct", tag: "Blocker" }]);
    const andre = await ask("andre", "What's at risk this week?");
    expect(andre.answer.text).toBe("Nothing on your projects is at risk this week: no milestone is forecast past its target or held up by blocked work, and no blocker is live.");
    expect(everything(andre.answer)).not.toMatch(/Forager|feed/);
  });

  it("a milestone forecast past its target, and one due this week with blocked work in it", async () => {
    await db.update(t.milestones).set({ forecastDate: "2026-11-03" }).where(eq(t.milestones.id, "ms-release-1"));
    await db.update(t.workItems).set({ state: "blocked" }).where(eq(t.workItems.id, "wi-147"));
    const { answer } = await ask("alicia", "What's at risk this week on Forager?");
    expect(answer.text).toBe("At risk this week on Forager 2.0: 2 milestones and 1 live blocker.");
    expect(answer.cards.map((c) => [c.title, c.detail])).toEqual([
      ["Trend model", "Forager 2.0: forecast Fri 23 Oct, 1 work item in it blocked"],
      ["Buyer pilot · Release 1", "Forager 2.0: forecast Tue 3 Nov, later than its target Fri 30 Oct"],
      ["Store sales feed access", "Forager 2.0: 1 report, since 14 Oct"],
    ]);
  });

  it("someone in no projects is told so, as portfolio tells them", async () => {
    expect((await ask("kyle", "What's at risk this week?")).answer.text).toBe("You are not in any projects yet.");
    expect((await ask("kyle", "Which projects are off track?")).answer.text).toBe("You are not in any projects yet.");
  });

  it("phase K: once its per-viewer query is built, openSignals reads it", () => {
    // The hook returns none until phase K lands. At integration, wire signalsFor in, and add a test where
    // an open signal raised to the asker is listed and one they cannot see is not
    const built = existsSync(fileURLToPath(new URL("./signals.ts", import.meta.url)));
    const hook = readFileSync(fileURLToPath(new URL("./answers/at-risk-week.ts", import.meta.url)), "utf8");
    expect(!built || /signalsFor\(/.test(hook)).toBe(true);
  });

  it("a named project with nothing at risk says so", async () => {
    expect((await ask("alicia", "What's at risk this week on GQ?")).answer.text).toBe(
      "Nothing on GQ & Academy is at risk this week: no milestone is forecast past its target or held up by blocked work, and no blocker is live.",
    );
  });
});

describe("portfolio: which projects are off track, worst first", () => {
  it("Alicia's two projects, with Forager first once her Off track has its reason", async () => {
    const before = await ask("alicia", "Which projects are off track?");
    expect(before.row.question).toMatchObject({ topic: "portfolio" });
    // A set status shows only once its reason is given (A4.3)
    expect(before.answer.text).toBe("None of your 2 projects is Off track or At risk.");
    await saveReason(as("alicia", 31), "forager", { text: "The store feed is still blocked", entryIds: ["br-feed-blocker"], draftedByAtlas: false, edited: false });
    const { answer } = await ask("alicia", "Which projects are off track?", 32);
    expect(answer.text).toBe("Of your 2 projects, 1 is Off track. They are listed worst first.");
    expect(answer.cards.map((c) => [c.title, c.tag, c.detail])).toEqual([
      ["Forager 2.0", "Off track", "Set by Alicia: The store feed is still blocked; the plan says On track"],
      ["GQ & Academy", "No target yet", "Worked out from the plan"],
    ]);
  });

  it("LD7: an employee gets their own projects only; Andre his one", async () => {
    expect(titles((await ask("kemar", "Which projects are off track?")).answer)).toEqual(["Forager 2.0", "Store Insights", "GQ & Academy"]);
    const andre = await ask("andre", "Any projects at risk?");
    expect(andre.answer).toMatchObject({ text: "Store Insights is On track.", cards: [{ title: "Store Insights" }] });
  });

  it("LD4: an executive with no lens tags gets their own projects only", async () => {
    await db.insert(t.people).values({ id: "exec", name: "Marcia Grant", initials: "MG", title: "Director", orgRole: "executive" });
    await db.insert(t.groupMembers).values({ groupId: "g-gq", personId: "exec" });
    await db.insert(t.projectMemberships).values({ projectId: "gq", personId: "exec", state: "member", role: "member" });
    const { answer } = await ask("exec", "Which projects are off track?");
    expect(answer).toMatchObject({ text: "GQ & Academy has no target yet.", cards: [{ title: "GQ & Academy", tag: "No target yet" }] });
  });
});

describe("who_free: who can pick up a piece of work (phase H's rule, CD9)", () => {
  it("Alicia: the others on #151's project, with their open and past due work; not its owner, not her, not Kyle", async () => {
    const { row, answer } = await ask("alicia", "Who can pick up #151?");
    expect(row.question).toMatchObject({ topic: "who_free" });
    expect(answer.text).toBe(
      "#151 Store sales feed access on Forager 2.0 is Kemar Brown's. 1 other person is on Forager 2.0 besides Kemar Brown and you; each line shows the open work they own on projects you share.",
    );
    expect(answer.cards).toMatchObject([{ title: "Jodian Taylor", detail: "1 open work item, none past due", tag: "On Forager 2.0", href: "/projects/forager" }]);
    expect(everything(answer)).not.toMatch(/Kyle/);
  });

  it("past due and leave, as the project shows them; facts only, in DPM's words even with a model (PP6, PP7)", async () => {
    const said: Drafter = { name: "fake", draft: async () => ({ text: "Kemar is the best pick.", model: "fake", usage: null }) };
    const { answer } = await ask("alicia", "Who can pick up #160?", 7 * DAY, null, said);
    expect(answer).toMatchObject({ wording: "rules" });
    expect(answer.cards).toMatchObject([{ title: "Kemar Brown", detail: "4 open work items, 3 past due, on leave until Fri 30 Oct" }]);
    expect(answer.text).not.toMatch(/best|should|free|available/i);
  });

  it("what Kemar sees of Alicia is what they share, and nobody else is on Store Insights for Andre", async () => {
    expect((await ask("kemar", "Who can pick up #160?")).answer.cards).toMatchObject([{ title: "Alicia Campbell", detail: "0 open work items, none past due" }]);
    expect((await ask("andre", "Who can pick up #208?")).answer.text).toBe("#208 Weekly sales export on Store Insights is Kemar Brown's. Nobody else is on Store Insights besides Kemar Brown and you.");
  });

  it("P10: work on a project the asker cannot read is never found nor named", async () => {
    const { answer } = await ask("andre", "Who can pick up #160?");
    expect(answer.text).toBe('Nothing open on your projects matches "#160". Try its number, for example: Who can pick up #151?');
    expect(everything(answer)).not.toMatch(/Forager|Jodian|backfill/);
  });

  it("no work said: which work; a project named: its people", async () => {
    expect((await ask("alicia", "Who's free?")).answer.text).toBe(FREE_FOR_WHAT);
    const forager = await ask("alicia", "Who's free on Forager?");
    expect(titles(forager.answer)).toEqual(["Jodian Taylor", "Kemar Brown"]);
  });

  it("CV8: a follow-up names its own work", async () => {
    const first = await ask("alicia", "Who can pick up #151?");
    const next = await ask("alicia", "and #160?", 31, first.conversationId);
    expect(next.row.question).toMatchObject({ topic: "who_free" });
    expect(titles(next.answer)).toEqual(["Kemar Brown"]);
  });

  it("every teammate is read in one go, exactly as one at a time (CD9, PP1)", async () => {
    const now = at(7 * DAY);
    const all = await peopleSeenBy(db, "andre", ["kemar", "jodian", "nobody"], now);
    // Andre shares no project with Jodian, so she is not there, as a name nobody has is not
    expect([...all.keys()]).toEqual(["kemar"]);
    expect(all.get("kemar")).toEqual(await personSeenBy(db, "andre", "kemar", now));
    expect(await personSeenBy(db, "andre", "jodian", now)).toBeNull();
  });
});
