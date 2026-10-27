// Phase L, M31 Vocabulary change against PGlite (conversational plan, section 14; research model
// undoAndVocabulary.mjs, VocabularyChange "with the fixes"): corrections said in the chat, read here by the
// rule as without a model, go to a PM or Lead of the project; once applied, the check context reads them.
// UN8 to UN10, the clash at the ask and again at APPROVE (P10), and the S18 rhythm before expiry.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureExtractor } from "../atlas/fixture";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import { loadCheckContext } from "../queries/check-context";
import { getInbox } from "../queries/inbox";
import { at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { createCapture, openReview, proposeItems, routeExtraction } from "./capture";
import { CommandRefused } from "./core";
import { decideVocabularyChange, runVocabularyTimers } from "./vocabulary";

let db: Db;
const DAY = 24 * 60;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const live = async (who: string) => (await db.select().from(t.inboxItems).where(eq(t.inboxItems.ownerId, who))).filter((i) => i.state === "open").map((i) => i.causeKey).sort();
const changes = () => db.select().from(t.vocabularyChanges);
const aliases = async (id: string) => (await db.select({ aliases: t.projects.aliases }).from(t.projects).where(eq(t.projects.id, id)))[0].aliases;
const contacts = async (id: string) => (await db.select().from(t.projectContacts).where(eq(t.projectContacts.projectId, id))).map((c) => c.personId);

/** Said in the chat and read as without a model (QA8): the correction is proposed while the message is read. */
async function says(who: string, text: string, minutes = 0) {
  const { captureId } = await createCapture(as(who, minutes), { channel: "app", kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), messageId: `say-${who}-${minutes}-${text}` });
  const r = await readCapture(as(who, minutes), captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
  if (r.outcome !== "proposed") throw new Error(`read: ${JSON.stringify(r)}`);
  return r.answer!;
}

describe("corrections teach Atlas (M31)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it('"GQ also means the Guild" goes to Alicia; once she approves, Atlas reads it that way', async () => {
    const answer = await says("kemar", "GQ also means the Guild");
    expect(answer).toMatchObject({ topic: "correction", text: 'I asked Alicia to approve "Guild" as a name for GQ & Academy. Until then I read it as before.' });
    const [change] = await changes();
    expect(change).toMatchObject({ projectId: "gq", kind: "alias", word: "Guild", state: "proposed", proposedBy: "kemar" });
    expect(await live("alicia")).toEqual([`vocab_change:${change.id}`]);
    expect((await getInbox(db, "alicia", at(1))).items[0]).toMatchObject({ title: 'Kemar asked Atlas to read "Guild" as GQ & Academy', action: "Decide" });
    // Nothing changes until she approves (rule 1)
    expect(await aliases("gq")).toEqual(["GQ", "Academy"]);

    await decideVocabularyChange(as("alicia", 5), change.id, "approve");
    expect(await aliases("gq")).toEqual(["GQ", "Academy", "Guild"]);
    expect(await live("alicia")).toEqual([]);
    const ctx = await loadCheckContext(db, { authorId: "kemar", text: "Guild sync done", messageAt: at(6), transcriptConfidence: null });
    expect(ctx.projects.find((p) => p.id === "gq")!.aliases).toContain("Guild");
    expect((await db.select().from(t.notices).where(eq(t.notices.personId, "kemar"))).map((n) => n.text)).toEqual(['Alicia approved "Guild" as a name for GQ & Academy. I\'ll read it that way from now on.']);
  });

  it("rule 6: said again, nothing new is proposed; the answer says how the first one stands", async () => {
    await says("kemar", "GQ also means the Guild");
    const again = await says("kemar", "GQ also means the guild", 2);
    expect(await changes()).toHaveLength(1);
    expect(again.text).toBe('I asked Alicia to approve "Guild" as a name for GQ & Academy. Until then I read it as before.');
    const [change] = await changes();
    await decideVocabularyChange(as("alicia", 5), change.id, "decline");
    expect((await says("kemar", "GQ also means the Guild", 10)).text).toBe('Alicia declined "Guild" as a name for GQ & Academy on 20 Oct.');
    expect((await changes())[0].state).toBe("declined");
  });

  it("UN8: a wrong correction is only a proposal; the PM declines it and nothing changes", async () => {
    const answer = await says("kemar", "Kyle is on GQ");
    expect(answer.text).toBe("I asked Alicia to approve Kyle as a contact on GQ & Academy. Until then I read it as before.");
    const [change] = await changes();
    await decideVocabularyChange(as("alicia", 5), change.id, "decline");
    expect(await contacts("gq")).toEqual([]);
    expect((await db.select().from(t.notices).where(eq(t.notices.personId, "kemar"))).map((n) => n.text)).toEqual(["Alicia declined Kyle as a contact on GQ & Academy, so I'll read it as before."]);
  });

  it('"Kyle is Store Insights, not Forager": each project\'s own PM decides its part', async () => {
    const answer = await says("kemar", "Kyle is Store Insights, not Forager");
    expect(answer.text).toBe(
      "I asked Andre to approve Kyle as a contact on Store Insights. Until then I read it as before. I asked Alicia to approve Kyle off Forager 2.0's contacts. Until then I read it as before.",
    );
    const add = (await changes()).find((c) => !c.remove)!;
    const remove = (await changes()).find((c) => c.remove)!;
    expect(await live("andre")).toEqual([`vocab_change:${add.id}`]);
    expect(await live("alicia")).toEqual([`vocab_change:${remove.id}`]);
    // Alicia is not on Store Insights: she cannot decide its part (rule 4, P10)
    await expect(decideVocabularyChange(as("alicia", 3), add.id, "approve")).rejects.toThrow(CommandRefused);
    await decideVocabularyChange(as("andre", 5), add.id, "approve");
    await decideVocabularyChange(as("alicia", 5), remove.id, "approve");
    expect(await contacts("insights")).toEqual(["kyle"]);
    expect(await contacts("forager")).toEqual([]);
    const ctx = await loadCheckContext(db, { authorId: "kemar", text: "Kyle sent it", messageAt: at(6), transcriptConfidence: null });
    expect(ctx.projects.find((p) => p.id === "insights")!.people.map((p) => p.name)).toContain("Kyle");
    expect(ctx.projects.find((p) => p.id === "forager")!.people.map((p) => p.name)).not.toContain("Kyle");
  });

  it("only a PM or Lead of the project approves, checked when they do", async () => {
    await says("kemar", "GQ also means the Guild");
    const [change] = await changes();
    await expect(decideVocabularyChange(as("kemar", 3), change.id, "approve")).rejects.toThrow("only a PM or Lead of the project decides a change to its vocabulary");
    await db.update(t.projectMemberships).set({ role: "member" }).where(and(eq(t.projectMemberships.projectId, "gq"), eq(t.projectMemberships.personId, "alicia")));
    await expect(decideVocabularyChange(as("alicia", 4), change.id, "approve")).rejects.toThrow(CommandRefused);
    expect(await aliases("gq")).toEqual(["GQ", "Academy"]);
  });
});

describe("name clashes (UN9, and the model's fixes)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
    // HX: Dwayne's project, which Kemar and Alicia cannot open. It is called the Guild there
    await db.insert(t.people).values({ id: "dwayne", name: "Dwayne Reid", initials: "DR", title: "PM", orgRole: "delivery_lead" });
    await db.insert(t.groups).values({ id: "g-hx", orgId: "intellibus", name: "HX", kind: "project", ownerId: "dwayne", connectedToDpm: true });
    await db.insert(t.projects).values({ id: "hx", groupId: "g-hx", name: "HX", aliases: ["Guild"], ownerId: "dwayne" });
    await db.insert(t.projectMemberships).values({ projectId: "hx", personId: "dwayne", role: "pm", state: "member" });
  }, 30_000);

  it("UN9: a word already naming another of their projects is refused before it is proposed, naming only that one", async () => {
    const answer = await says("kemar", "Store Insights also means the Academy");
    expect(answer.text).toBe('"Academy" already names GQ & Academy, so I didn\'t ask: it would make it unclear where updates go.');
    expect(await changes()).toMatchObject([{ state: "refused", clashesWith: ["gq"] }]);
    expect(await live("andre")).toEqual([]);
  });

  it("UN9, P10: a refusal is the asker's own; someone who cannot open the clashing project is never told of it, and their correction is proposed", async () => {
    await says("kemar", "Store Insights also means the Academy");
    // Andre is on Store Insights only: from where he stands, nothing else is called the Academy
    const answer = await says("andre", "Store Insights also means the Academy", 1);
    expect(answer.text).toBe('"Academy" as a name for Store Insights is waiting in your inbox for you to approve. Until then I read it as before.');
    expect(JSON.stringify(answer)).not.toContain("already names");
    expect(JSON.stringify(answer)).not.toContain("GQ");
    const rows = await changes();
    expect(rows.map((c) => [c.forId, c.state]).sort()).toEqual([
      ["andre", "proposed"],
      ["kemar", "refused"],
    ]);
    expect(await live("andre")).toEqual([`vocab_change:${rows.find((c) => c.forId === "andre")!.id}`]);
    // Kemar saying it again still hears his own refusal (rule 6), naming only what he can open
    expect((await says("kemar", "Store Insights also means the Academy", 2)).text).toBe('"Academy" already names GQ & Academy, so I didn\'t ask: it would make it unclear where updates go.');
    expect(await changes()).toHaveLength(2);
  });

  it("model check item 4: where one person is in both projects that use a word, M14 sends their item to choose_project", async () => {
    const text = "The Academy launch may slip a week";
    const academy: RawProposal = {
      kind: "braid_new",
      projectId: "gq",
      routingReason: { basis: "reference", evidence: "Academy", label: "You said Academy" },
      braidKind: "risk",
      braidTitle: "Academy launch may slip a week",
      quote: text,
      confidence: "high",
      rationale: "The launch may slip.",
    };
    const routing = async (n: number) => {
      const { captureId } = await createCapture(as("kemar", n), { channel: "app", kind: "text", text, messageAt: at(n), receivedAt: at(n), messageId: `academy-${n}` });
      return (await proposeItems(as("kemar", n), captureId, [academy])).items[0].draft;
    };
    expect(await routing(1)).toMatchObject({ projectId: "gq", routing: "routed" });
    // Andre cannot open GQ, so for him "Academy" clashes with nothing: he proposes it, and approves it
    await says("andre", "Store Insights also means the Academy", 2);
    await decideVocabularyChange(as("andre", 3), (await changes())[0].id, "approve");
    expect(await aliases("insights")).toContain("Academy");
    // Kemar is in both: his "Academy" now names two of his projects, so he picks
    expect(await routing(4)).toMatchObject({ routing: "choose_project", options: expect.arrayContaining(["gq", "insights"]) });
  });

  it("P10: a project they cannot open is never looked at, so it is never named", async () => {
    const answer = await says("kemar", "GQ also means the Guild");
    expect(answer.text).not.toContain("HX");
    expect((await changes())[0]).toMatchObject({ state: "proposed", clashesWith: [] });
    await decideVocabularyChange(as("alicia", 5), (await changes())[0].id, "approve");
    expect(await aliases("gq")).toContain("Guild");
  });

  it("the model's fix: the clash is checked again at APPROVE, so two waiting proposals for one word cannot both apply", async () => {
    await says("kemar", "GQ also means the Pilot");
    await says("kemar", "Forager also means the Pilot", 1);
    const [gq, forager] = (await changes()).sort((a, b) => a.projectId.localeCompare(b.projectId)).reverse();
    expect([gq.projectId, forager.projectId]).toEqual(["gq", "forager"]);
    await decideVocabularyChange(as("alicia", 5), gq.id, "approve");
    await expect(decideVocabularyChange(as("alicia", 6), forager.id, "approve")).rejects.toThrow('"Pilot" already names GQ & Academy. Decline it, or take it off that project first');
    expect((await changes()).find((c) => c.id === forager.id)!.state).toBe("proposed");
    await decideVocabularyChange(as("alicia", 7), forager.id, "decline");
    expect(await aliases("forager")).toEqual(["Forager"]);
  });
});

describe("reminders, then expiry (S18, vocabExpiryDays)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  it("reminded after 2 working days and a week later, then expires at 14 days; the item closes", async () => {
    await says("kemar", "GQ also means the Guild");
    const run = (days: number) => runVocabularyTimers({ db, now: at(days * DAY) });
    expect(await run(1)).toEqual({ reminded: [], expired: [] });
    expect((await run(2)).reminded).toHaveLength(1);
    expect((await getInbox(db, "alicia", at(2 * DAY))).items[0].group).toBe("do_now");
    expect((await run(8)).reminded).toHaveLength(0);
    expect((await run(9)).reminded).toHaveLength(1);
    expect((await run(13)).expired).toHaveLength(0);
    expect((await run(14)).expired).toHaveLength(1);
    expect((await changes())[0]).toMatchObject({ state: "expired", remindersSent: 2 });
    expect(await live("alicia")).toEqual([]);
    expect(await aliases("gq")).toEqual(["GQ", "Academy"]);
  });
});

describe("moves in review propose a correction (UN10, CD14)", () => {
  beforeEach(async () => {
    db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
  }, 30_000);

  const TEXT = "Kyle will send the weekly sales file on Friday";
  const KYLE: RawProposal = {
    kind: "braid_new",
    projectId: "forager",
    routingReason: { basis: "tied_person", evidence: "Kyle", label: "Kyle is the contact on #151" },
    braidKind: "dependency",
    braidTitle: "Kyle to send the weekly sales file by 23 Oct",
    quote: TEXT,
    confidence: "high",
    rationale: "Kyle agreed to send the file.",
  };

  async function movesKyleToInsights(n: number) {
    const { captureId } = await createCapture(as("kemar", n), { channel: "app", kind: "text", text: TEXT, messageAt: at(n), receivedAt: at(n), messageId: `kyle-${n}` });
    const { items } = await proposeItems(as("kemar", n), captureId, [KYLE]);
    expect(items[0].draft.routedBy).toEqual({ basis: "tied_person", word: "Kyle", personId: "kyle" });
    await openReview(as("kemar", n), captureId);
    await routeExtraction(as("kemar", n), items[0].id, { projectId: "insights" });
  }

  it("the first move proposes nothing; the second of the same word to the same project proposes it, once", async () => {
    await movesKyleToInsights(1);
    expect(await changes()).toEqual([]);
    await movesKyleToInsights(2);
    expect(await changes()).toMatchObject([{ projectId: "insights", kind: "contact", personId: "kyle", proposedBy: null, forId: "kemar", state: "proposed" }]);
    expect((await getInbox(db, "andre", at(3))).items.map((i) => i.title)).toEqual(["Atlas suggests: Add Kyle as a contact on Store Insights"]);
    await movesKyleToInsights(3);
    expect(await changes()).toHaveLength(1);
    // Atlas only proposes: nothing changes until Andre approves (rule 1)
    expect(await contacts("insights")).toEqual([]);
  });
});
