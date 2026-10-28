// Phase H against PGlite: questions about people from the seeded db, read through the per-viewer queries
// (P10), with edge cases PP1 to PP8 and the rule of decision CD9 (queries/people.ts). A question goes
// through the same read as an update, with the recorded fixture, whose rule spots it. In the seed Alicia
// shares Forager and GQ with Kemar, Andre shares only Store Insights with him, Jodian is on Forager only,
// Kyle is Forager's outside contact on #151, and Kemar is on approved leave 26 to 30 Oct.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { createCapture } from "../commands/capture";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { at, seededDb } from "../test/seeded-db";
import { NOBODY, NOT_SAID } from "./answers/people";
import { NOT_WHY } from "./answers/why";
import { leaveShownTo, personSeenBy, sharedPeople } from "./people";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };
const DAY = 24 * 60;

/** Someone asks in the chat at `minutes` after 9:10am (9:40am by default), in a conversation when given. */
async function ask(who: string, text: string, minutes = 30, conversationId: string | null = null) {
  const ctx = { db, now: at(minutes), actorId: who };
  const created = await createCapture(ctx, { channel: "app", messageId: `h-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, conversationId });
  await readCapture(ctx, created.captureId, createFixtureExtractor(), { ...noWait, drafter: null });
  const [row] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { row, answer: row.answer!, conversationId: created.conversationId };
}

const titles = (a: { cards: { title: string }[] }) => a.cards.map((c) => c.title);
const everything = (a: { text: string; cards: { title: string; detail: string | null; tag: string | null }[] }) => JSON.stringify([a.text, a.cards]);

/** Someone joins a project as a member (or an outside contact), for the cases the seed does not have. */
async function addPerson(id: string, name: string, projectId: string, as: "member" | "contact" = "member") {
  await db.insert(t.people).values({ id, name, initials: name.slice(0, 2).toUpperCase(), title: null, orgRole: as === "member" ? "employee" : null });
  if (as === "member") await db.insert(t.projectMemberships).values({ projectId, personId: id, state: "member", role: "member" });
  else await db.insert(t.projectContacts).values({ projectId, personId: id, tie: "contact on the buyers' report" });
}

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("what someone has, on projects the two share (CD9)", () => {
  it("Alicia asks what Kemar is working on: his open work, milestone and entry on Forager and GQ, never Store Insights", async () => {
    const { row, answer } = await ask("alicia", "What is Kemar working on?");
    expect(row.state).toBe("answered");
    expect(row.question).toMatchObject({ topic: "people" });
    expect(answer.text).toBe("Kemar Brown has 4 open work items, 1 milestone and 1 entry on the BRAID log on projects you share; none is past due. Kemar Brown is away Mon 26 Oct to Fri 30 Oct.");
    // In my_work's order: In progress by due date, then To do
    expect(titles(answer)).toEqual(["#145 Google Trends connector", "#151 Store sales feed access", "#147 Trend scoring model", "#152 Store feed connector", "Trend model", "Store sales feed access"]);
    expect(answer.cards[0]).toMatchObject({ detail: "Forager 2.0: due Wed 21 Oct", tag: "In progress", href: "/projects/forager" });
    // P10: Kemar's Store Insights work is not hers to see, not named and not counted
    expect(everything(answer)).not.toMatch(/Weekly sales export|#208|Store Insights/);
    // Someone else's work offers her nothing to do on it
    expect(answer.cards.every((c) => !c.actions?.length)).toBe(true);
  });

  it("Andre shares only Store Insights with Kemar: only that, and nothing of Forager", async () => {
    const { answer } = await ask("andre", "What's on Kemar's plate?");
    expect(answer.text).toBe("Kemar Brown has 1 open work item on Store Insights; none is past due. Kemar Brown is away Mon 26 Oct to Fri 30 Oct.");
    expect(titles(answer)).toEqual(["#208 Weekly sales export"]);
  });

  it("never their captures, inbox or settings: Kemar's 8:58 note waiting for his review is not part of it", async () => {
    const { answer } = await ask("alicia", "What's Kemar Brown working on?");
    expect(everything(answer)).not.toMatch(/review|inbox|8:58|needs your OK/i);
  });

  it("a named project the two share narrows it; one the person is not on says so", async () => {
    expect((await ask("alicia", "What is Kemar working on in GQ?")).answer.text).toBe("Kemar Brown has nothing open on GQ & Academy. Kemar Brown is away Mon 26 Oct to Fri 30 Oct.");
    expect((await ask("alicia", "What is Jodian working on in GQ?")).answer.text).toBe("Jodian Taylor is not on GQ & Academy.");
  });

  it("CV8: a follow-up names its own person, in the same conversation", async () => {
    const first = await ask("alicia", "What is Kemar working on?");
    const next = await ask("alicia", "and Jodian?", 31, first.conversationId);
    expect(next.row.question).toMatchObject({ topic: "people" });
    expect(next.answer.text).toBe("Jodian Taylor has 1 open work item on Forager 2.0; none is past due.");
    expect(titles(next.answer)).toEqual(["#160 Feature store backfill"]);
  });
});

describe("PP1: someone the asker shares no project with reads as a name nobody has", () => {
  it("Andre about Jodian, Jodian about Andre, and a name nobody has: the same words", async () => {
    const jodian = await ask("andre", "What is Jodian working on?");
    expect(jodian.answer.text).toBe(NOBODY);
    expect(jodian.answer.cards).toEqual([]);
    expect((await ask("jodian", "What is Andre working on?")).answer.text).toBe(NOBODY);
    expect((await ask("andre", "What is Zed working on?")).answer.text).toBe(NOBODY);
  });

  it("someone who left the project is no longer shared", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "jodian")));
    expect((await ask("alicia", "What is Jodian working on?")).answer.text).toBe(NOBODY);
    expect(await personSeenBy(db, "alicia", "jodian", at(30))).toBeNull();
  });

  it("the shared people are the members and contacts of the asker's projects, the asker too", async () => {
    expect((await sharedPeople(db, "alicia")).map((p) => [p.id, p.projectIds])).toEqual([
      ["alicia", ["forager", "gq"]],
      ["jodian", ["forager"]],
      ["kemar", ["forager", "gq"]],
      ["kyle", ["forager"]],
    ]);
    expect((await sharedPeople(db, "andre")).map((p) => p.id)).toEqual(["andre", "kemar"]);
  });

  it("CV8: a follow-up that names someone she shares no project with, or nobody, never gets the person before", async () => {
    const first = await ask("alicia", "What is Kemar working on?");
    // Andre shares no project with her; Zed is nobody
    const andre = await ask("alicia", "and Andre?", 31, first.conversationId);
    expect(andre.row.question).toMatchObject({ topic: "people", follows: ["What is Kemar working on?"] });
    expect(andre.answer.text).toBe(NOBODY);
    expect(andre.answer.cards).toEqual([]);
    expect((await ask("alicia", "and Zed?", 32, first.conversationId)).answer.text).toBe(NOBODY);
  });

  it("CV8: a follow-up that only says where keeps the person asked about before", async () => {
    const first = await ask("alicia", "What is Kemar working on?");
    expect((await ask("alicia", "and on GQ?", 31, first.conversationId)).answer.text).toBe("Kemar Brown has nothing open on GQ & Academy. Kemar Brown is away Mon 26 Oct to Fri 30 Oct.");
    expect((await ask("alicia", "what about Forager?", 32, first.conversationId)).answer.text).toBe(
      "Kemar Brown has 4 open work items, 1 milestone and 1 entry on the BRAID log on Forager 2.0; none is past due. Kemar Brown is away Mon 26 Oct to Fri 30 Oct.",
    );
  });
});

describe("PP2: a first name two shared people have", () => {
  it("asks which, listing only people the asker shares a project with; a full name settles it", async () => {
    await addPerson("kemar-s", "Kemar Smith", "forager");
    // Another Jodian, on a project Alicia is not in, makes no difference to her
    await addPerson("jodian-g", "Jodian Grant", "insights");
    expect((await ask("alicia", "What is Kemar working on?")).answer.text).toBe('Did you mean Kemar Brown or Kemar Smith? Ask again with their full name, for example "and Kemar Smith?"');
    expect((await ask("alicia", "What is Kemar Smith working on?")).answer.text).toBe("Kemar Smith has nothing open on Forager 2.0.");
    expect((await ask("alicia", "What is Jodian working on?")).answer.text).toBe("Jodian Taylor has 1 open work item on Forager 2.0; none is past due.");
    // Andre shares a project with Kemar Brown and Jodian Grant only
    expect((await ask("andre", "What is Kemar working on?")).answer.text).toBe("Kemar Brown has 1 open work item on Store Insights; none is past due. Kemar Brown is away Mon 26 Oct to Fri 30 Oct.");
  });

  it("the reply the answer suggests, a follow-up by full name, settles it", async () => {
    await addPerson("kemar-s", "Kemar Smith", "forager");
    const which = await ask("alicia", "What is Kemar working on?");
    const reply = await ask("alicia", "and Kemar Smith?", 31, which.conversationId);
    expect(reply.row.question).toMatchObject({ topic: "people" });
    expect(reply.answer.text).toBe("Kemar Smith has nothing open on Forager 2.0.");
    const other = await ask("alicia", "and Kemar Brown?", 32, which.conversationId);
    expect(other.answer.text).toMatch(/^Kemar Brown has 4 open work items/);
  });
});

describe("PP3: an outside contact", () => {
  it("Kyle: what he is tied to on the projects Alicia shares with him", async () => {
    const { answer } = await ask("alicia", "What is Kyle working on?");
    expect(answer.text).toBe("Kyle is an outside contact on Forager 2.0, tied to 1 thing there.");
    expect(answer.cards).toMatchObject([{ title: "#151 Store sales feed access", detail: "Forager 2.0: contact on #151 (Sprouts IT)", tag: "In progress" }]);
  });

  it("an entry on the log that names the contact is part of it", async () => {
    await db.update(t.braidEntries).set({ title: "Kyle to send the store feed access" }).where(eq(t.braidEntries.id, "br-feed-dependency"));
    const { answer } = await ask("kemar", "What is Kyle doing?");
    expect(answer.text).toBe("Kyle is an outside contact on Forager 2.0, tied to 2 things there.");
    expect(answer.cards[1]).toMatchObject({ title: "Kyle to send the store feed access", detail: "Forager 2.0: names Kyle", tag: "Dependency" });
  });

  it("Andre is on no project with Kyle", async () => {
    expect((await ask("andre", "What is Kyle working on?")).answer.text).toBe(NOBODY);
  });
});

describe("PP4: asking about yourself by name is my_work", () => {
  it("Kemar asks what Kemar is working on", async () => {
    const { row, answer } = await ask("kemar", "What is Kemar working on?");
    expect(row.question).toMatchObject({ topic: "my_work" });
    expect(answer.topic).toBe("my_work");
    expect(answer.text).toMatch(/^You have /);
  });

  it("and a follow-up that comes back to the asker", async () => {
    const first = await ask("kemar", "What is Jodian working on?");
    const back = await ask("kemar", "and Kemar?", 31, first.conversationId);
    expect(back.answer.text).toMatch(/^You have /);
  });
});

describe("PP5: who owns something", () => {
  it("the owner of the best match, on the asker's projects", async () => {
    const { row, answer } = await ask("alicia", "Who owns the store feed?");
    expect(row.question).toMatchObject({ topic: "people" });
    expect(answer.text).toBe("Kemar Brown owns #152 Store feed connector on Forager 2.0.");
    expect(answer.cards).toMatchObject([{ title: "#152 Store feed connector", detail: "Forager 2.0: Kemar Brown", tag: "To do", href: "/projects/forager" }]);
    expect((await ask("kemar", "Who owns the store feed?")).answer.text).toBe("You own #152 Store feed connector on Forager 2.0.");
  });

  it("by number, a project by its name, an entry, and several matches", async () => {
    expect((await ask("kemar", "Who is working on #160?")).answer.text).toBe("Jodian Taylor owns #160 Feature store backfill on Forager 2.0.");
    expect((await ask("kemar", "Who owns Forager?")).answer.text).toBe("Alicia Campbell owns Forager 2.0.");
    expect((await ask("kemar", "Who owns the pipeline risk?")).answer.text).toBe("Alicia Campbell owns Only Kemar can run the pipeline on Forager 2.0.");
    const feed = await ask("jodian", "Who owns the feed?");
    expect(feed.answer.text).toBe('4 things on your projects match "feed". Each says who owns it.');
    expect(feed.answer.cards.map((c) => c.detail)).toEqual([
      "Forager 2.0: Kemar Brown",
      "Forager 2.0: Kemar Brown",
      "Forager 2.0: Kemar Brown",
      "Forager 2.0: Alicia Campbell",
    ]);
  });

  it("P10: a record on a project the asker is not in matches nothing, as one that does not exist", async () => {
    const theirs = await ask("alicia", "Who owns #208?");
    expect(theirs.answer.text).toBe('Nothing open on your projects matches "#208". Try its number, or its name as the project shows it.');
    expect((await ask("alicia", "Who owns the weekly sales export?")).answer.text).toBe(
      'Nothing open on your projects matches "weekly sales export". Try its number, or its name as the project shows it.',
    );
    expect((await ask("andre", "Who owns the store feed?")).answer.text).toBe('Nothing open on your projects matches "store feed". Try its number, or its name as the project shows it.');
  });

  it("who's, who has, who's got and who is handling ask the same", async () => {
    const owns = "Kemar Brown owns #151 Store sales feed access on Forager 2.0.";
    for (const text of ["Who's working on #151?", "Who’s responsible for #151?", "Who has #151?", "Who's got #151?", "Who is handling #151?"]) {
      const { row, answer } = await ask("alicia", text);
      expect(row.question).toMatchObject({ topic: "people" });
      expect(answer.text).toBe(owns);
    }
    expect((await ask("alicia", "Who has the store feed?")).answer.text).toBe("Kemar Brown owns #152 Store feed connector on Forager 2.0.");
  });

  it("CV8: a follow-up asks the owner of what it names; one that only says where keeps the thing", async () => {
    const first = await ask("alicia", "Who owns the store feed?");
    const trend = await ask("alicia", "and the trend model?", 31, first.conversationId);
    expect(trend.row.question).toMatchObject({ topic: "people" });
    expect(trend.answer.text).toBe("Kemar Brown owns Trend model on Forager 2.0.");
    expect((await ask("alicia", "and #160?", 32, first.conversationId)).answer.text).toBe("Jodian Taylor owns #160 Feature store backfill on Forager 2.0.");
    expect((await ask("alicia", "and on GQ?", 33, first.conversationId)).answer.text).toBe(
      'Nothing open on your projects matches "#160". Try its number, or its name as the project shows it.',
    );
  });

  it("CD9: the same things as what someone has; never Done work, a done milestone, or an entry off the log", async () => {
    // #142 is Done and Data sources is done, both Kemar's
    expect((await ask("alicia", "Who owns #142?")).answer.text).toBe('Nothing open on your projects matches "#142". Try its number, or its name as the project shows it.');
    expect((await ask("alicia", "Who owns data sources?")).answer.text).toBe('Nothing open on your projects matches "data sources". Try its number, or its name as the project shows it.');
    // The pipeline risk closed, and then proposed again but not yet on the log
    for (const state of ["closed", "proposed"] as const) {
      await db.update(t.braidEntries).set({ state }).where(eq(t.braidEntries.id, "br-pipeline-risk"));
      expect((await ask("kemar", "Who owns the pipeline risk?")).answer.text).toBe(
        'Nothing open on your projects matches "pipeline risk". Try its number, or its name as the project shows it.',
      );
      expect((await personSeenBy(db, "kemar", "alicia", at(30)))!.entries.map(({ e }) => e.title)).not.toContain("Only Kemar can run the pipeline");
    }
  });
});

describe("PP6: facts only, never a judgement", () => {
  it("two people named: the first, and the answer says who was left out", async () => {
    const both = await ask("alicia", "What are Kemar and Jodian working on?");
    expect(both.answer.text).toBe(
      "Kemar Brown has 4 open work items, 1 milestone and 1 entry on the BRAID log on projects you share; none is past due. Kemar Brown is away Mon 26 Oct to Fri 30 Oct. Ask about Jodian Taylor on their own.",
    );
    // The asker named with someone: the other, and how to ask about their own
    const kemar = await ask("kemar", "What are Kemar and Jodian working on?");
    expect(kemar.row.question).toMatchObject({ topic: "people" });
    expect(kemar.answer.text).toBe('Jodian Taylor has 1 open work item on Forager 2.0; none is past due. Ask "What am I working on?" for your own.');
    // P10: someone she shares no project with is not named as left out
    expect((await ask("alicia", "What are Kemar and Andre working on?")).answer.text).not.toMatch(/Andre|Ask about/);
  });

  it("Is Kemar overloaded? Four days on: the counts and how many are past due", async () => {
    const { answer } = await ask("alicia", "Is Kemar overloaded?", 4 * DAY);
    expect(answer.text).toBe("Kemar Brown has 4 open work items, 1 milestone and 1 entry on the BRAID log on projects you share; 4 are past due. Kemar Brown is away Mon 26 Oct to Fri 30 Oct.");
    expect(answer.text).not.toMatch(/overloaded|busy|too much|a lot/i);
    expect(answer.cards[0]).toMatchObject({ title: "#145 Google Trends connector", detail: "Forager 2.0: due Wed 21 Oct, past due" });
  });
});

describe("PP7: leave, only where the project already shows its impact", () => {
  it("Alicia (PM of Forager) and Andre (PM of Store Insights) see Kemar is on leave; Jodian does not", async () => {
    const during = 7 * DAY; // Tue 27 Oct
    expect((await ask("alicia", "What is Kemar working on?", during)).answer.text).toMatch(/ Kemar Brown is on leave until Fri 30 Oct\.$/);
    expect((await ask("andre", "What is Kemar working on?", during)).answer.text).toMatch(/ Kemar Brown is on leave until Fri 30 Oct\.$/);
    const jodian = await ask("jodian", "What is Kemar working on?", during);
    expect(jodian.answer.text).not.toMatch(/leave/);
    expect(jodian.answer.text).toMatch(/^Kemar Brown has /);
  });

  it("W3-D5: before the leave starts, the PMs who see its impact see its dates; Jodian does not; once it is over, nothing is said", async () => {
    expect((await ask("alicia", "What is Kemar working on?")).answer.text).toMatch(/ Kemar Brown is away Mon 26 Oct to Fri 30 Oct\.$/);
    expect((await ask("andre", "What is Kemar working on?")).answer.text).toMatch(/ Kemar Brown is away Mon 26 Oct to Fri 30 Oct\.$/);
    expect((await ask("jodian", "What is Kemar working on?")).answer.text).not.toMatch(/away|leave/);
    expect((await ask("alicia", "What is Kemar working on?", 11 * DAY)).answer.text).not.toMatch(/away|leave/);
  });

  it("W3-D5: leave still waiting on the admin is not shown ahead either", async () => {
    await db.update(t.leave).set({ state: "requested" }).where(eq(t.leave.id, "lv-kemar-oct"));
    expect((await ask("alicia", "What is Kemar working on?")).answer.text).not.toMatch(/away|leave/);
  });

  it("a request not yet approved is not leave", async () => {
    await db.update(t.leave).set({ state: "requested" }).where(eq(t.leave.id, "lv-kemar-oct"));
    expect(await leaveShownTo(db, "alicia", "kemar", ["forager"], at(7 * DAY))).toBeNull();
  });

  it("who owns something: the owner's leave where the project shows it", async () => {
    const during = 7 * DAY;
    const alicia = await ask("alicia", "Who owns #151?", during);
    expect(alicia.answer.text).toBe("Kemar Brown owns #151 Store sales feed access on Forager 2.0. Kemar Brown is on leave until Fri 30 Oct.");
    expect(alicia.answer.cards[0].detail).toBe("Forager 2.0: Kemar Brown, on leave until Fri 30 Oct");
    expect((await ask("jodian", "Who owns #151?", during)).answer.text).toBe("Kemar Brown owns #151 Store sales feed access on Forager 2.0.");
  });
});

describe("PP8: what someone said is never shared", () => {
  it("the same words whoever is named, shared or not, real or not", async () => {
    const said = await ask("alicia", "What did Kemar say about the feed?");
    expect(said.row.question).toMatchObject({ topic: "people" });
    expect(said.answer.text).toBe(NOT_SAID);
    expect(said.answer.cards).toEqual([]);
    expect((await ask("alicia", "Can I see Kemar's updates?")).answer.text).toBe(NOT_SAID);
    expect((await ask("alicia", "What did Andre say about pricing?")).answer.text).toBe(NOT_SAID);
    expect((await ask("alicia", "What did Zed say about pricing?")).answer.text).toBe(NOT_SAID);
  });

  it("CV8: a follow-up that names only someone asks the same, so still never", async () => {
    const said = await ask("alicia", "What did Kemar say about the feed?");
    expect((await ask("alicia", "and Jodian?", 31, said.conversationId)).answer.text).toBe(NOT_SAID);
  });

  it("CV8: the newest words decide: a follow-up asking what someone has is answered as that", async () => {
    const jodian = "Jodian Taylor has 1 open work item on Forager 2.0; none is past due.";
    const said = await ask("alicia", "What did Kemar say about the feed?");
    expect((await ask("alicia", "and what is Jodian working on?", 31, said.conversationId)).answer.text).toBe(jodian);
    const owner = await ask("alicia", "Who owns the store feed?");
    expect((await ask("alicia", "and what is Jodian working on?", 31, owner.conversationId)).answer.text).toBe(jodian);
  });
});

describe("a project by its name is not a person", () => {
  it("What is Forager doing? is how the project stands", async () => {
    for (const text of ["What is Forager doing?", "What's GQ up to?"]) {
      const { row, answer } = await ask("alicia", text);
      expect(row.question).toMatchObject({ topic: "project_status" });
      expect(answer.text).not.toBe(NOBODY);
    }
    // Store Insights is not hers: no project of hers, so read as a name nobody has (P10)
    expect((await ask("alicia", "What is Insights doing?")).answer.text).toBe(NOBODY);
  });
});

describe("WY8 hands over to phase H", () => {
  it("a why about a person is what they have, said as a fact, never a reason", async () => {
    const { row, answer } = await ask("alicia", "Why is Jodian behind?");
    expect(row.question).toMatchObject({ topic: "why" });
    expect(answer.text).toBe(`${NOT_WHY}Jodian Taylor has 1 open work item on Forager 2.0; none is past due.`);
  });

  it("a why about the asker by name is their own work, still with no reason given", async () => {
    const { answer } = await ask("kemar", "Why is Kemar late?");
    expect(answer.text).toMatch(new RegExp(`^${NOT_WHY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}You have `));
  });
});
