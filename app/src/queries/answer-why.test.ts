// Phase C against PGlite: each why answer from the seeded db, read through the per-viewer queries (P10),
// with edge cases WY1 to WY8. A question goes through the same read as an update, with the recorded
// fixture, whose rule spots it and finds its subject in the words.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { decideBraidEntry, reportBraidEntry } from "../commands/braid";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "../commands/capture";
import { evaluateProject } from "../commands/evaluate";
import { runMilestoneTimers } from "../commands/milestones";
import { saveReason } from "../commands/status";
import { loadItems } from "../db/records";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { at, seededDb } from "../test/seeded-db";
import { answerFor } from "./answer";
import { NOT_FOUND, NOT_PEOPLE } from "./answers/why";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });

/** Someone asks in the chat at `minutes` after 9:10am (9:40am by default), in a conversation when given. */
async function ask(who: string, text: string, minutes = 30, conversationId: string | null = null) {
  const ctx = as(who, minutes);
  const created = await createCapture(ctx, { channel: "app", messageId: `w-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, conversationId });
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

/** Someone says something in Atlas; Atlas proposes these; they accept every item and save. */
async function says(who: string, text: string, proposals: RawProposal[], minutes: number) {
  const { captureId } = await createCapture(as(who, minutes), { channel: "atlas", messageId: `atl-w-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes) });
  const { items } = await proposeItems(as(who, minutes), captureId, proposals);
  await openReview(as(who, minutes), captureId);
  for (const i of items) if (i.state === "needs_ok") await decideExtraction(as(who, minutes), i.id, { type: "accept" });
  expect((await saveCapture(as(who, minutes), captureId)).outcome).toBe("saved");
}

const decision = (projectId: string, title: string, quote: string): RawProposal => ({
  kind: "braid_new",
  projectId,
  routingReason: { basis: "reference", evidence: "Store Insights", label: projectId },
  braidKind: "decision",
  braidTitle: title,
  quote,
  confidence: "high",
  rationale: "A decision",
});

const DAY = 24 * 60;
const shown = (a: { cards: { title: string; detail: string | null; tag: string | null }[] }) => a.cards.map((c) => [c.title, c.detail, c.tag]);

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("the rule finds the subject in the asker's own projects", () => {
  it("a work item by number, a milestone by its name, a project by its name", async () => {
    expect((await ask("kemar", "What's holding up #151?")).row.question).toMatchObject({ topic: "why", subject: { type: "work_item", id: "wi-151", projectId: "forager" } });
    expect((await ask("kemar", "Why is the trend model at risk?")).row.question).toMatchObject({ topic: "why", subject: { type: "milestone", id: "ms-trend" } });
    expect((await ask("alicia", "Why is Forager off track?")).row.question).toMatchObject({ topic: "why", projectId: "forager", subject: { type: "project", id: "forager" } });
  });
});

describe("why a status", () => {
  it("WY2: Forager is On track by its plan, and Alicia's Off track has no reason yet, so it does not show", async () => {
    const { row, answer } = await ask("alicia", "Why is Forager at risk?");
    expect(row.state).toBe("answered");
    expect(answer.topic).toBe("why");
    expect(answer.text).toBe(
      "Alicia set it Off track on Tue 20 Oct at 9:02am with no reason yet, so it shows the plan's status. Forager 2.0 is On track, not At risk: every open milestone is forecast on or before its target, and no work is late or blocked.",
    );
    expect(answer.cards).toEqual([]);
  });

  it("a calculated status: the facts the rules read (the trend model's forecast and the blocked feed work)", async () => {
    await kemarSaves();
    const { answer } = await ask("kemar", "Why is Forager at risk?");
    expect(answer.text).toBe(
      "Alicia set it Off track on Tue 20 Oct at 9:02am with no reason yet, so it shows the plan's status. Forager 2.0 is At risk, worked out from its plan: 2 things on it are At risk.",
    );
    expect(shown(answer)).toEqual([
      ["Trend model", "Forager 2.0: is forecast Mon 26 Oct, 3 days after its target Fri 23 Oct", "At risk"],
      ["#151 Store sales feed access", "Forager 2.0: is blocked (waiting on Kyle (Sprouts IT))", "At risk"],
    ]);
  });

  it("a set status: who set it, when, the reason and the entries it links; WY3 says when the plan has moved since", async () => {
    await kemarSaves();
    await saveReason(as("alicia", 10), "forager", { text: "The store feed is still blocked", entryIds: ["br-feed-blocker"], draftedByAtlas: false, edited: false });
    const set = await ask("kemar", "Why is Forager off track?", 20);
    expect(set.answer.text).toBe('Forager 2.0 is Off track: Alicia set it on Tue 20 Oct at 9:02am, with the reason "The store feed is still blocked". The plan says At risk.');
    expect(shown(set.answer)).toEqual([["Store sales feed access", "Forager 2.0: linked to the reason, Reported", "Blocker"]]);

    // The plan moves: the trend model is back on its target and #151 is moving again
    await db.update(t.milestones).set({ forecastDate: "2026-10-23" }).where(eq(t.milestones.id, "ms-trend"));
    await db.update(t.workItems).set({ state: "in_progress" }).where(eq(t.workItems.id, "wi-151"));
    await db.transaction((tx) => evaluateProject(tx, "forager", at(25)));
    const stale = await ask("kemar", "Why is Forager off track?", 30);
    expect(stale.answer.text).toBe(
      'Forager 2.0 is Off track: Alicia set it on Tue 20 Oct at 9:02am, with the reason "The store feed is still blocked". That reason was given when the plan said At risk; the plan says On track now.',
    );
  });

  it("a work item and a milestone say what their own rule read", async () => {
    await kemarSaves();
    expect((await ask("kemar", "Why is #151 at risk?")).answer.text).toBe("#151 Store sales feed access is At risk: it is blocked (waiting on Kyle (Sprouts IT)).");
    expect((await ask("kemar", "Why is the trend model on track?")).answer.text).toBe(
      "Trend model is At risk, not On track: it is forecast Mon 26 Oct, 3 days after its target Fri 23 Oct.",
    );
    expect((await ask("kemar", "Why is #145 off track?", 2 * DAY)).answer.text).toBe(
      "#145 Google Trends connector is Done, not Off track: it is done.",
    );
  });

  it("WY2: Not started with part of the plan done says what is done, never that nothing has started", async () => {
    await db.update(t.milestones).set({ state: "done" }).where(eq(t.milestones.projectId, "forager"));
    await db.update(t.workItems).set({ state: "to_do" }).where(and(eq(t.workItems.projectId, "forager"), ne(t.workItems.id, "wi-142")));
    const { answer } = await ask("kemar", "Why is Forager not started?");
    expect(answer.text).toBe(
      "Alicia set it Off track on Tue 20 Oct at 9:02am with no reason yet, so it shows the plan's status. Forager 2.0 is Not started: 6 things on its plan are done, and nothing else with a date has started.",
    );
    expect(answer.text).not.toContain("nothing on its plan with a date has started");
  });
});

describe("what holds something up", () => {
  it("#151: its blocked note, the open blocker linked to it and the dependency linked to that, each with its owner", async () => {
    await kemarSaves();
    const { answer } = await ask("kemar", "What's holding up #151?");
    expect(answer.text).toBe("#151 Store sales feed access is blocked (waiting on Kyle (Sprouts IT)), and 1 open blocker and 1 open dependency are linked.");
    expect(shown(answer)).toEqual([
      ["#151 Store sales feed access", "Forager 2.0: Blocked, waiting on Kyle (Sprouts IT); owner Kemar", "Blocked work"],
      ["Store sales feed access", "Forager 2.0: Reported; owner Kemar", "Blocker"],
      ["Store sales feed access from Sprouts IT", "Forager 2.0: Open; owner Alicia", "Dependency"],
    ]);
  });

  it("a project: its blocked work and its open blockers and dependencies", async () => {
    await kemarSaves();
    const { answer } = await ask("alicia", "What's holding up Forager?");
    expect(answer.text).toBe("1 work item is blocked, and 1 open blocker and 1 open dependency are linked on Forager 2.0.");
    expect(answer.cards.map((c) => c.tag)).toEqual(["Blocked work", "Blocker", "Dependency"]);
  });

  it("WY7: nothing linked is said plainly, not guessed", async () => {
    const { answer } = await ask("kemar", "What's holding up #145?");
    expect(answer.text).toBe("Nothing is recorded as holding up #145 Google Trends connector.");
    expect(answer.cards).toEqual([]);
  });

  it("CV8, CQ14: a follow-up that says none of the four asks what holds the new subject up", async () => {
    await kemarSaves();
    const first = await ask("alicia", "What's holding up Forager?");
    const gq = await ask("alicia", "and on GQ & Academy?", 31, first.conversationId);
    expect(gq.row.question).toMatchObject({ topic: "why", follows: ["What's holding up Forager?"], subject: { type: "project", id: "gq" } });
    expect(gq.answer.text).toBe("Nothing is recorded as holding up GQ & Academy.");

    const work = await ask("kemar", "What's holding up #151?", 32);
    expect((await ask("kemar", "and #152?", 33, work.conversationId)).answer.text).toBe("Nothing is recorded as holding up #152 Store feed connector.");
  });
});

describe("when something was decided", () => {
  async function andreApproves() {
    const [entry] = await db.select().from(t.braidEntries).where(and(eq(t.braidEntries.projectId, "insights"), eq(t.braidEntries.kind, "decision")));
    await decideBraidEntry(as("andre", 5), entry.id, { type: "approve" });
    return entry.id;
  }

  it("the decision, who approved it and when, and the words it came from, which Kemar may read", async () => {
    await kemarSaves();
    await andreApproves();
    const { answer } = await ask("kemar", "When did we decide to move the refresh?");
    expect(answer.text).toBe('Andre approved "Move the daily refresh to 6am" on Store Insights on Tue 20 Oct.');
    expect(shown(answer)).toEqual([
      ["Move the daily refresh to 6am", 'Store Insights: approved by Andre on Tue 20 Oct. From: "Andre and I agreed to move the refresh to 6am"', "Decision · Approved"],
    ]);
  });

  it("not decided yet: it says who proposed it", async () => {
    await kemarSaves();
    expect((await ask("andre", "When did we decide to move the refresh?")).answer.text).toBe('"Move the daily refresh to 6am" on Store Insights is not decided yet: Kemar proposed it.');
  });

  it("WY4: several match: up to three, newest first, each linked", async () => {
    await kemarSaves();
    await andreApproves();
    await says("andre", "On Store Insights we decided to keep the refresh at 7am after all.", [decision("insights", "Keep the refresh at 7am", "On Store Insights we decided to keep the refresh at 7am after all.")], DAY);
    await says("andre", "On Store Insights we decided to run the refresh on weekends too.", [decision("insights", "Run the refresh on weekends", "On Store Insights we decided to run the refresh on weekends too.")], 2 * DAY);
    await says("andre", "On Store Insights we decided the refresh emails go to buyers only.", [decision("insights", "Refresh emails go to buyers only", "On Store Insights we decided the refresh emails go to buyers only.")], 3 * DAY);
    const { answer } = await ask("andre", "When did we decide on the refresh?", 3 * DAY + 10);
    expect(answer.text).toBe("3 decisions match, newest first.");
    expect(answer.cards.map((c) => c.title)).toEqual(["Refresh emails go to buyers only", "Run the refresh on weekends", "Keep the refresh at 7am"]);
    expect(answer.cards[0].href).toBe("/projects/insights?view=table&log=decision");
  });

  it("WY4: who approved it is a decision too", async () => {
    await kemarSaves();
    await andreApproves();
    expect((await ask("kemar", "Who approved moving the refresh to 6am?")).answer.text).toBe('Andre approved "Move the daily refresh to 6am" on Store Insights on Tue 20 Oct.');
  });

  it("WY4: a declined decision says who declined it and when", async () => {
    await kemarSaves();
    const [entry] = await db.select().from(t.braidEntries).where(and(eq(t.braidEntries.projectId, "insights"), eq(t.braidEntries.kind, "decision")));
    await decideBraidEntry(as("andre", 5), entry.id, { type: "decline", reason: "The buyers read it at 7am" });
    const { answer } = await ask("kemar", "When did we decide to move the refresh?");
    expect(answer.text).toBe('Andre declined "Move the daily refresh to 6am" on Store Insights on Tue 20 Oct.');
    expect(shown(answer)).toEqual([
      ["Move the daily refresh to 6am", 'Store Insights: declined by Andre on Tue 20 Oct. From: "Andre and I agreed to move the refresh to 6am"', "Decision · Declined"],
    ]);
  });

  it("WY5: a decision whose source is words routed to another project shows no quote, even to someone in both", async () => {
    await kemarSaves();
    const { entry } = await reportBraidEntry(as("alicia", 5), "forager", { kind: "decision", title: "Drop the TikTok scrape" });
    // Kemar's Store Insights sentence (item 11, filed there) behind a Forager decision
    await db.insert(t.braidSources).values({
      id: "src-routed-elsewhere",
      entryId: entry.id,
      originEntryId: entry.id,
      personId: "kemar",
      captureId: "cap-kemar-0858",
      extractionId: "cap-kemar-0858-11",
      spanStart: 281,
      spanEnd: 326,
      at: at(1),
    });
    for (const viewer of ["kemar", "jodian"]) {
      const { answer } = await ask(viewer, "When did we decide to drop the TikTok scrape?");
      expect(shown(answer), viewer).toEqual([["Drop the TikTok scrape", "Forager 2.0: proposed by Alicia, not decided yet", "Decision · Waiting for approval"]]);
      expect(JSON.stringify(answer), viewer).not.toContain("6am");
    }
  });

  it("WY1: Alicia is not on Store Insights, so its decision is never found for her, nor said to exist", async () => {
    await kemarSaves();
    await andreApproves();
    const { answer } = await ask("alicia", "When did we decide to move the refresh?");
    expect(answer.text).toBe("I can't find a decision about that in your projects.");
    expect(JSON.stringify(answer)).not.toContain("Store Insights");
  });
});

describe("why a field changed", () => {
  it("who moved the forecast, when, and the words it came from (rule 9: a Forager member reads them)", async () => {
    await kemarSaves();
    const { answer } = await ask("jodian", "Why was the trend model moved?");
    expect(answer.text).toBe("Kemar moved the forecast for Trend model from Fri 23 Oct to Mon 26 Oct on Tue 20 Oct at 9:11am.");
    expect(answer.text).not.toContain("Store Insights");
    expect(answer.cards[0].detail).toBe('Forager 2.0: Kemar moved the forecast from Fri 23 Oct to Mon 26 Oct, Tue 20 Oct at 9:11am. From an update: "so I think the model slips a day"');
    expect(answer.cards[0].tag).toBe("From an update");
  });

  it("WY5: a change whose update was routed to another project shows no quote, even to someone in both", async () => {
    await kemarSaves();
    // The forecast move pointing at Kemar's Store Insights sentence (item 11), not the words filed into Forager
    await db.update(t.auditEntries).set({ extractionId: "cap-kemar-0858-11" }).where(and(eq(t.auditEntries.subjectId, "ms-trend"), eq(t.auditEntries.action, "FORECAST_CHANGED")));
    for (const viewer of ["kemar", "jodian"]) {
      const { answer } = await ask(viewer, "Why was the trend model moved?");
      expect(answer.cards[0].detail, viewer).toBe("Forager 2.0: Kemar moved the forecast from Fri 23 Oct to Mon 26 Oct, Tue 20 Oct at 9:11am");
      expect(JSON.stringify(answer), viewer).not.toContain("6am");
    }
  });

  it("WY6: the field asked about: #145's date never moved, though its state did", async () => {
    await kemarSaves();
    const date = await ask("kemar", "Why was #145 moved to Friday?");
    expect(date.answer.text).toBe("No change to the due date of #145 Google Trends connector is recorded; it is due Wed 21 Oct.");
    expect(date.answer.cards).toEqual([]);
    expect((await ask("kemar", "Why was #145 marked done?")).answer.text).toBe("Kemar moved #145 Google Trends connector from In progress to Done on Tue 20 Oct at 9:11am.");
    expect((await ask("kemar", "Why did the trend model slip?")).answer.text).toBe("Kemar moved the forecast for Trend model from Fri 23 Oct to Mon 26 Oct on Tue 20 Oct at 9:11am.");
  });

  it("section 20, U6: a work item's forecast set from its owner's words is the change to its date", async () => {
    await says(
      "kemar",
      "The trend scoring model will take until Monday.",
      [
        {
          kind: "update",
          projectId: "forager",
          routingReason: { basis: "target", evidence: "trend scoring model", label: "Kemar owns it" },
          targetId: "wi-147",
          field: "forecast",
          newValue: "2026-10-26",
          quote: "The trend scoring model will take until Monday",
          confidence: "high",
          rationale: "You expect it done then.",
        },
      ],
      5,
    );
    const { answer } = await ask("kemar", "Why did #147 move to Monday?");
    expect(answer.text).toMatch(/^Kemar set the forecast for #147 [^.]+ to Mon 26 Oct on Tue 20 Oct at 9:15am\.$/);
    expect((await ask("kemar", "Why is #147 at risk?")).answer.text).toMatch(/is At risk: it is forecast Mon 26 Oct, 3 days after its due date Fri 23 Oct\.$/);
  });

  it("an entry's history in plain words", async () => {
    await reportBraidEntry(as("alicia", 5), "forager", { kind: "risk", title: "Pipeline load risk" });
    expect((await ask("kemar", "Why is the pipeline load risk open?")).answer.text).toBe("Alicia put Pipeline load risk on the log as Open on Tue 20 Oct at 9:15am.");
  });

  it("WY1: cancelled work is left out of Atlas's lists (D2) but Kemar can still read it, so it is found", async () => {
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-152"));
    await db.insert(t.auditEntries).values({ at: at(5), actorType: "person", actorId: "kemar", action: "CANCEL", machine: "work_item", subjectType: "work_item", subjectId: "wi-152", fromState: "to_do", toState: "cancelled" });
    const cancelled = await ask("kemar", "Why was #152 cancelled?");
    expect(cancelled.row.question).not.toHaveProperty("subject");
    expect(cancelled.answer.text).toBe("Kemar moved #152 Store feed connector from To do to Cancelled on Tue 20 Oct at 9:15am.");
    expect((await ask("kemar", "Why is #152 not started?")).answer.text).toBe("#152 Store feed connector: it is cancelled, so it has no status.");
    // Still only their own projects: a cancelled item elsewhere is not found
    await db.update(t.workItems).set({ state: "cancelled" }).where(eq(t.workItems.id, "wi-208"));
    expect((await ask("alicia", "Why was #208 cancelled?")).answer.text).toBe(NOT_FOUND);
  });

  it("WY6: a rule, not a person: the target passed and the timer marked it missed", async () => {
    await runMilestoneTimers({ db, now: new Date("2026-10-24T05:01:00Z") });
    const { answer } = await ask("kemar", "Why was the trend model missed?", 4 * DAY);
    expect(answer.text).toBe("A rule marked Trend model Missed when its target date of Fri 23 Oct passed on Sat 24 Oct at 12:01am, not a person.");
    expect(answer.cards[0].tag).toBe("By a rule");
  });

  it("nothing changed: said plainly", async () => {
    expect((await ask("kemar", "Why was #152 changed?")).answer.text).toBe("No change to #152 Store feed connector is recorded.");
  });
});

describe("WY1 and WY8: what a why answer never says", () => {
  it("WY1: a record in a project Alicia is not in is no subject, answered as one that does not exist", async () => {
    const asked = await ask("alicia", "Why is #208 blocked?");
    expect(asked.row.question).not.toHaveProperty("subject");
    expect(asked.answer.text).toBe(NOT_FOUND);
    const none = await ask("alicia", "Why is #999 blocked?");
    expect(none.answer.text).toBe(asked.answer.text);
  });

  it("WY1: a subject kept when asked is read again now, so one in a project she cannot read is not found", async () => {
    const crafted = { asked: "Why is #208 blocked?", topic: "why" as const, projectId: null, subject: { type: "work_item" as const, id: "wi-208", projectId: "insights" } };
    const answer = await answerFor(db, "alicia", crafted, at(30));
    expect(answer.text).toBe(NOT_FOUND);
    expect(answer.cards).toEqual([]);
  });

  it("WY8: why about a person is not a why about a record", async () => {
    expect((await ask("alicia", "Why is Kemar late?")).answer.text).toBe(NOT_PEOPLE);
    expect((await ask("kemar", "Why is Kyle so slow?")).answer.text).toBe(NOT_PEOPLE);
  });
});
