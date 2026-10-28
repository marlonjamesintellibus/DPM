// Phase Q against PGlite: "What is Forager?" from the seeded db, read through the project view the asker
// reads (P10), with edge cases EX1 to EX5. A question goes through the same read as an update, with the
// recorded fixture, whose rule spots it. EX6 (asked in a group) waits for phase I.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { decideBraidEntry, reportBraidEntry } from "../commands/braid";
import { createCapture, decideExtraction, openReview, saveCapture } from "../commands/capture";
import { loadItems } from "../db/records";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { at, seededDb } from "../test/seeded-db";
import { answerFor } from "./answer";
import { NOT_FOUND } from "./answers/explain-project";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const DAY = 24 * 60;

/** Someone asks in the chat at `minutes` after 9:10am (9:40am by default), in a conversation when given. */
async function ask(who: string, text: string, minutes = 30, conversationId: string | null = null) {
  const ctx = as(who, minutes);
  const created = await createCapture(ctx, { channel: "app", messageId: `q-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, conversationId });
  await readCapture(ctx, created.captureId, createFixtureExtractor(), { ...noWait, drafter: null });
  const [row] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { row, answer: row.answer!, conversationId: created.conversationId };
}

/** Kemar saves his 8:58 note at 9:11am, accepting the four that need his OK (story step 4). */
async function kemarSaves() {
  await openReview(as("kemar", 1), "cap-kemar-0858");
  for (const i of (await loadItems(db, "cap-kemar-0858")).items) if (i.state === "needs_ok") await decideExtraction(as("kemar", 1), i.id, { type: "accept" });
  expect((await saveCapture(as("kemar", 1), "cap-kemar-0858")).outcome).toBe("saved");
}

/** Alicia logs a decision on Forager and approves it `minutes` after 9:10am. */
async function aliciaDecides(title: string, minutes: number) {
  const { entry } = await reportBraidEntry(as("alicia", minutes), "forager", { kind: "decision", title });
  if (entry.state === "proposed") await decideBraidEntry(as("alicia", minutes), entry.id, { type: "approve" });
  return entry.id;
}

const shown = (a: { cards: { title: string; detail: string | null; tag: string | null }[] }) => a.cards.map((c) => [c.title, c.detail, c.tag]);

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("what a project is", () => {
  it("who it is for and when, its owner and status, its threads, the next milestones and where Kemar starts", async () => {
    const { row, answer } = await ask("kemar", "What is Forager?");
    expect(row.state).toBe("answered");
    expect(row.question).toEqual({ asked: "What is Forager?", topic: "explain_project", projectId: "forager" });
    expect(answer.topic).toBe("explain_project");
    expect(answer.text).toBe(
      "Forager 2.0 is for Sprouts, from Mon 12 Oct to Fri 6 Nov, and Alicia Campbell owns it. It is On track, worked out from its plan. It has 3 threads: Trend to buyer email, Store sales signal and Production ready. The next milestone is Trend model, forecast Fri 23 Oct. No decisions are approved on it yet. Where to start: you have 4 open work items on it, first #145 Google Trends connector, due Wed 21 Oct.",
    );
    expect(shown(answer)).toEqual([
      ["Forager 2.0", "For Sprouts, from Mon 12 Oct to Fri 6 Nov; Alicia owns it", "On track"],
      ["#145 Google Trends connector", "Forager 2.0: In progress, due Wed 21 Oct", "Where to start"],
      ["Trend to buyer email", "TikTok to model to weekly buyer email. Kemar and Alicia own its milestones and work", "Thread · On track"],
      ["Store sales signal", "Store feed to model to dashboard tile. Kemar owns its milestones and work", "Thread · On track"],
      ["Production ready", "Checks, monitoring and rollout. Alicia and Jodian own its milestones and work", "Thread · On track"],
      ["Trend model", "Forager 2.0: forecast Fri 23 Oct; Kemar owns it", "Next milestone · On track"],
      ["Buyer pilot · Release 1", "Forager 2.0: forecast Fri 30 Oct; Alicia owns it", "Next milestone · On track"],
      ["Production checks", "Forager 2.0: forecast Tue 3 Nov; Alicia owns it", "Next milestone · On track"],
    ]);
    expect(answer.cards.every((c) => c.href.startsWith("/projects/forager"))).toBe(true);
    // Phase B: where to start is his own work, and carries what its screen offers him
    expect(answer.cards[1].actions?.map((a) => a.act)).toEqual(["mark_done"]);
  });

  it("each asker gets their own place to start: Jodian her backfill, Alicia her milestone, Andre the plan he owns", async () => {
    expect((await ask("jodian", "What is Forager for?")).answer.text).toContain("Where to start: you have 1 open work item on it, first #160 Feature store backfill, due Wed 28 Oct.");
    expect((await ask("alicia", "Explain Forager")).answer.text).toContain("Where to start: you own the milestone Buyer pilot · Release 1, forecast Fri 30 Oct.");
    expect((await ask("andre", "Explain Store Insights")).answer.text).toContain("Where to start: no work on it is yours yet; you own the project, so start with its plan.");
  });

  it("the status it shows is the set one once a reason is given, and says who set it", async () => {
    await kemarSaves();
    await db.update(t.projects).set({ setOverride: "explained", reasonGivenAt: "at_risk" }).where(eq(t.projects.id, "forager"));
    expect((await ask("kemar", "What is Forager?")).answer.text).toContain("It is Off track, as Alicia set it.");
    // With no one recorded as setting it, the owner set it, said in full
    await db.update(t.projects).set({ setBy: null }).where(eq(t.projects.id, "forager"));
    expect((await ask("kemar", "What is Forager?", 31)).answer.text).toContain("It is Off track, as its owner set it.");
  });

  it("a thread description that ends its own sentence gets no second full stop", async () => {
    await db.update(t.threads).set({ description: "Checks, monitoring and rollout." }).where(eq(t.threads.name, "Production ready"));
    const { answer } = await ask("kemar", "What is Forager?");
    expect(shown(answer).find(([title]) => title === "Production ready")?.[1]).toBe("Checks, monitoring and rollout. Alicia and Jodian own its milestones and work");
  });

  it("a follow-up names another project; one with no name follows the project before it", async () => {
    const first = await ask("kemar", "What is Forager?");
    const next = await ask("kemar", "and Store Insights?", 31, first.conversationId);
    expect(next.row.question).toMatchObject({ topic: "explain_project", projectId: "insights" });
    expect(next.answer.text).toMatch(/^Store Insights is for Sprouts, from Mon 5 Oct to Fri 18 Dec, and Andre Mitchell owns it\./);
    const start = await ask("kemar", "and where do I start?", 32, first.conversationId);
    expect(start.row.question).toMatchObject({ topic: "explain_project", projectId: null });
    expect(start.answer.text).toMatch(/^Store Insights is for Sprouts/);
  });

  it("asked with no project: their only one is explained; with several it asks which, naming only theirs", async () => {
    // CD50: with 2 or 3, M21 asks which in his own chat, a button each, and the answer waits for his choice
    const { row } = await ask("kemar", "Where do I start?");
    expect(row.answer).toBeNull();
    const [asked] = await db.select().from(t.clarifications).where(eq(t.clarifications.captureId, row.id));
    expect(asked).toMatchObject({ about: "question", question: { fits: "project" }, options: [{ id: "forager" }, { id: "gq" }, { id: "insights" }] });
    // Where it cannot ask, the answer names them
    const answer = await answerFor(db, "kemar", row.question!, at(30));
    expect(answer.text).toBe("Which project? You are on Forager 2.0, GQ & Academy and Store Insights. Ask about one by its name.");
    expect(shown(answer)).toEqual([
      ["Forager 2.0", null, "Project"],
      ["GQ & Academy", null, "Project"],
      ["Store Insights", null, "Project"],
    ]);
    // Jodian is on Forager only
    expect((await ask("jodian", "I'm new here, where do I start?")).answer.text).toMatch(/^Forager 2\.0 is for Sprouts/);
  });
});

describe("decisions", () => {
  it("the five most recent approved decisions, newest first, named in the answer; the cards past eight are counted (MF11)", async () => {
    const titles = ["Use the trends API", "Weekly email on Mondays", "Pilot with five buyers", "Keep the TikTok ingest", "Score daily", "Drop the CSV export"];
    for (const [i, title] of titles.entries()) await aliciaDecides(title, i * DAY);
    const { answer } = await ask("kemar", "What is Forager?", 6 * DAY);
    expect(answer.text).toContain(
      '6 decisions are approved on it; the latest are "Drop the CSV export", "Score daily", "Keep the TikTok ingest", "Pilot with five buyers" and "Weekly email on Mondays".',
    );
    expect(answer.cards).toHaveLength(7);
    expect(answer.more).toEqual({ label: "6 more on Forager 2.0", href: "/projects/forager" });
  });

  it("a decision waiting for approval, or declined, is not one of them", async () => {
    await reportBraidEntry(as("kemar", 1), "forager", { kind: "decision", title: "Move to hourly scoring" });
    expect((await ask("kemar", "What is Forager?")).answer.text).toContain("No decisions are approved on it yet.");
  });

  it("an approved decision on a short plan has its card, with who approved it and when, and its words when Kemar may read them", async () => {
    await kemarSaves();
    const [entry] = await db.select().from(t.braidEntries).where(and(eq(t.braidEntries.projectId, "insights"), eq(t.braidEntries.kind, "decision")));
    await decideBraidEntry(as("andre", 5), entry.id, { type: "approve" });
    const { answer } = await ask("kemar", "Explain Store Insights");
    expect(answer.text).toContain('1 decision is approved on it: "Move the daily refresh to 6am".');
    expect(shown(answer).at(-1)).toEqual([
      "Move the daily refresh to 6am",
      'Store Insights: approved by Andre on Tue 20 Oct. From: "Andre and I agreed to move the refresh to 6am"',
      "Decision · Approved",
    ]);
    expect(answer.cards.at(-1)!.href).toBe("/projects/insights?view=table&log=decision");
  });

  it("EX3: a decision from words routed to another project shows; its quote does not (rule 9)", async () => {
    await kemarSaves();
    const id = await aliciaDecides("Drop the TikTok scrape", 5);
    // Kemar's Store Insights sentence (item 11, filed there) behind a Forager decision, as WY5's test does
    await db.insert(t.braidSources).values({
      id: "src-routed-elsewhere",
      entryId: id,
      originEntryId: id,
      personId: "kemar",
      captureId: "cap-kemar-0858",
      extractionId: "cap-kemar-0858-11",
      spanStart: 281,
      spanEnd: 326,
      at: at(1),
    });
    for (const viewer of ["kemar", "jodian"]) {
      const { answer } = await ask(viewer, "What is Forager?", 10);
      expect(answer.text, viewer).toContain('1 decision is approved on it: "Drop the TikTok scrape".');
      expect(JSON.stringify(answer), viewer).not.toContain("6am");
    }
  });
});

describe("edge cases", () => {
  it("EX1: Alicia is not on Store Insights, so it is not found and nothing about it is said", async () => {
    const { row, answer } = await ask("alicia", "What is Store Insights?");
    expect(row.question).toMatchObject({ topic: "explain_project", projectId: null });
    expect(answer.text).toBe(`${NOT_FOUND} You can ask about Forager 2.0 or GQ & Academy.`);
    expect(answer.cards).toEqual([]);
    for (const word of ["Insights", "Sprouts", "Andre", "Weekly", "#208"]) expect(JSON.stringify(answer)).not.toContain(word);
    // A name nobody has gets the same words
    expect((await ask("alicia", "What is Atlas Bank?")).answer.text).toBe(answer.text);
  });

  it("EX1: a follow-up that names a project they are not in is not found, never the project asked about before", async () => {
    const first = await ask("alicia", "What is Forager?");
    const next = await ask("alicia", "and Store Insights?", 31, first.conversationId);
    expect(next.row.question).toMatchObject({ topic: "explain_project", projectId: null, follows: ["What is Forager?"] });
    expect(next.answer.text).toBe(`${NOT_FOUND} You can ask about Forager 2.0 or GQ & Academy.`);
    for (const word of ["Insights", "Sprouts", "Andre"]) expect(JSON.stringify(next.answer)).not.toContain(word);

    const kemar = await ask("kemar", "What is Forager?", 32);
    const bank = await ask("kemar", "and Atlas Bank?", 33, kemar.conversationId);
    expect(bank.answer.text).toBe(`${NOT_FOUND} You can ask about Forager 2.0, GQ & Academy or Store Insights.`);
    // What follows a name that is none of theirs is about that name, so it is not found either
    const start = await ask("kemar", "and where do I start?", 34, bank.conversationId);
    expect(start.answer.text).toBe(bank.answer.text);
  });

  it("EX1: a name in lowercase that is none of theirs is not found, even for someone on one project", async () => {
    for (const said of ["what is store insights?", "what is gq"]) {
      expect((await ask("jodian", said)).answer.text, said).toBe(`${NOT_FOUND} You can ask about Forager 2.0.`);
    }
    expect((await ask("andre", "explain forager")).answer.text).toBe(`${NOT_FOUND} You can ask about Store Insights.`);
    // With several projects, not "Which project?"
    expect((await ask("kemar", "what is atlas bank?")).answer.text).toBe(`${NOT_FOUND} You can ask about Forager 2.0, GQ & Academy or Store Insights.`);
  });

  it("EX1: a person named in the words is no project: a newcomer sent by Alicia gets their project", async () => {
    const answer = await answerFor(db, "jodian", { asked: "I'm new, Alicia said to ask you where to start", topic: "explain_project", projectId: null }, at(30));
    expect(answer.text).toMatch(/^Forager 2\.0 is for Sprouts/);
  });

  it("EX1: a project Kemar has left reads as one that never was, even when Atlas names it", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const answer = await answerFor(db, "kemar", { asked: "What is Store Insights?", topic: "explain_project", projectId: "insights" }, at(30));
    expect(answer.text).toBe(`${NOT_FOUND} You can ask about Forager 2.0 or GQ & Academy.`);
  });

  it("EX2: a project with no threads or milestones says so, and where they come from (P11)", async () => {
    const { answer } = await ask("kemar", "I'm new on GQ, where do I start?");
    expect(answer.text).toBe(
      "GQ & Academy is an internal project, with no dates set yet, and Alicia Campbell owns it. It has no status yet: nothing on it has a date. It has no threads or milestones yet. They come from GitHub and from updates people give Atlas. No decisions are approved on it yet. Where to start: nothing on it is yours yet, so ask Alicia where to begin.",
    );
    expect(shown(answer)).toEqual([["GQ & Academy", "Internal, with no dates set yet; Alicia owns it", "No target yet"]]);
  });

  it("EX4: Kyle, an outside contact on Forager, gets its client view only: releases and their dates", async () => {
    await kemarSaves();
    const answer = await answerFor(db, "kyle", { asked: "What is Forager?", topic: "explain_project", projectId: null }, at(30));
    expect(answer.text).toBe("Forager 2.0 is for Sprouts, from Mon 12 Oct to Fri 6 Nov. Its releases are Buyer pilot · Release 1 on Fri 30 Oct and Rollout · Release 2 on Fri 6 Nov.");
    expect(answer.cards).toEqual([]);
    // No status, people, threads, work, forecasts or BRAID log
    for (const word of ["track", "risk", "Alicia", "Kemar", "Trend model", "#1", "thread", "blocker", "forecast"]) expect(JSON.stringify(answer), word).not.toContain(word);
    // Asked with no name, his only project is the one; a done release says so
    await db.update(t.milestones).set({ state: "done" }).where(eq(t.milestones.id, "ms-release-1"));
    expect((await answerFor(db, "kyle", { asked: "What's this project about?", topic: "explain_project", projectId: null }, at(31))).text).toContain(
      "Its releases are Buyer pilot · Release 1 (done) and Rollout · Release 2 on Fri 6 Nov.",
    );
  });

  it("EX4: a project whose group is no longer connected to DPM is not found for Kyle, as for its members (P10, M13)", async () => {
    await db.update(t.groups).set({ connectedToDpm: false }).where(eq(t.groups.id, "g-forager"));
    for (const who of ["kemar", "kyle"]) {
      const answer = await answerFor(db, who, { asked: "What is Forager?", topic: "explain_project", projectId: null }, at(30));
      expect(answer.text, who).toMatch(new RegExp(`^${NOT_FOUND.replace(/[.?]/g, "\\$&")}`));
      expect(JSON.stringify(answer), who).not.toContain("Release");
    }
  });

  it("EX4: a contact tie reads the client view only when it is on for them (KB A7.3)", async () => {
    await db.update(t.projectContacts).set({ clientView: false }).where(eq(t.projectContacts.personId, "kyle"));
    expect((await answerFor(db, "kyle", { asked: "What is Forager?", topic: "explain_project", projectId: null }, at(30))).text).toBe(NOT_FOUND);
    // A tie routing made ("contact on Store Insights") is off, so it opens nothing either
    await db.update(t.projectContacts).set({ clientView: true }).where(eq(t.projectContacts.personId, "kyle"));
    await db.insert(t.projectContacts).values({ projectId: "insights", personId: "kyle", tie: "contact" });
    const answer = await answerFor(db, "kyle", { asked: "What is Store Insights?", topic: "explain_project", projectId: null }, at(31));
    expect(answer.text).toBe(`${NOT_FOUND} You can ask about Forager 2.0.`);
  });

  it("EX4: Kyle is tied to no other project, so Store Insights is not found, as for a member", async () => {
    const answer = await answerFor(db, "kyle", { asked: "What is Store Insights?", topic: "explain_project", projectId: null }, at(30));
    expect(answer.text).toBe(`${NOT_FOUND} You can ask about Forager 2.0.`);
    expect(JSON.stringify(answer)).not.toContain("Andre");
  });

  it("EX4: someone in the org with no project, and no contact tie, gets nothing at all", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(eq(t.projectMemberships.personId, "jodian"));
    expect((await answerFor(db, "jodian", { asked: "What is Forager?", topic: "explain_project", projectId: null }, at(30))).text).toBe(NOT_FOUND);
    // A contact tie is the client view for an outside contact only, never for someone in the org
    await db.insert(t.projectContacts).values({ projectId: "forager", personId: "jodian", tie: "test" });
    expect((await answerFor(db, "jodian", { asked: "What is Forager?", topic: "explain_project", projectId: null }, at(30))).text).toBe(NOT_FOUND);
  });

  it("EX5: a part of a name is matched by its name or alias; two of theirs fit, so it asks which", async () => {
    const { row, answer } = await ask("kemar", "Explain Insights");
    expect(row.question).toMatchObject({ topic: "explain_project", projectId: null });
    expect(answer.text).toMatch(/^Store Insights is for Sprouts/);

    await db.update(t.projects).set({ aliases: ["Forager", "Forager Insights"] }).where(eq(t.projects.id, "forager"));
    // CD50: asked in his own chat (commands/clarification.test.ts); where it cannot be, the answer says it
    const two = await ask("kemar", "Explain Insights", 31);
    expect(two.row.answer).toBeNull();
    const said = await answerFor(db, "kemar", two.row.question!, at(31));
    expect(said.text).toBe('Did you mean "Forager 2.0" or "Store Insights"? Say it again with its name.');
    expect(shown(said)).toEqual([
      ["Forager 2.0", null, "Project"],
      ["Store Insights", null, "Project"],
    ]);
    // Alicia reads only one of the two, so for her it is Forager, and Store Insights is never offered
    const hers = await ask("alicia", "Explain Insights", 32);
    expect(hers.answer.text).toMatch(/^Forager 2\.0 is for Sprouts/);
  });
});
