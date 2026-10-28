// Phase O against PGlite (conversational plan, section 17): "Prep me for the Sprouts call", a brief drafted as a
// phase G draft (M25), client-safe by default. Sprouts is the customer of Forager 2.0 and of Store Insights; Kyle
// (Sprouts IT) is Forager's contact. Kemar is on both projects, so DPM asks which (MT9, through M21); Alicia and
// Jodian are on Forager only, Andre on Store Insights only. Any member may ask (MT10), and the brief holds only
// what the client may see (rule 8), checked against the client view again when it is copied (DR4).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Drafter } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { prepWho } from "../domain/drafts";
import { getThread } from "../queries/chat";
import { prepFacts, prepProjects } from "../queries/drafts";
import { at, seededDb } from "../test/seeded-db";
import { readCapture } from "./atlas";
import { createCapture } from "./capture";
import { answerClarification } from "./clarification";
import { CommandRefused } from "./core";
import { CLIENT_VIEW_CHANGED, copyDraft, draftOfCapture, writeDraft } from "./draft";

let db: Db;
let n = 0;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });
const draftRow = async (captureId: string) => (await db.select().from(t.drafts).where(eq(t.drafts.captureId, captureId)))[0];
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommandRefused) return e.reason;
    throw e;
  }
  return null;
};
const writes = (text: string): Drafter => ({ name: "test", draft: async () => ({ text, model: "test-model", usage: null }) });

/** A message in the DPM chat, read by the recorded Atlas (DPM's own rule reads a request for a draft). */
async function say(who: string, text: string, opts: { minutes?: number; conversationId?: string | null; drafter?: Drafter | null } = {}) {
  const ctx = as(who, opts.minutes ?? 0);
  const created = await createCapture(ctx, { channel: "app", messageId: `p-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, conversationId: opts.conversationId ?? null });
  await readCapture(ctx, created.captureId, createFixtureExtractor(), { retryDelayMs: () => 0, drafter: opts.drafter ?? null });
  const [capture] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { captureId: created.captureId, conversationId: created.conversationId!, answer: capture.answer, question: capture.question };
}

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("which project a call is about (MT9)", () => {
  it("prepWho reads who or what the call is with, only from a request for a brief", () => {
    expect(prepWho("Prep me for the Sprouts call")).toBe("Sprouts");
    expect(prepWho("Brief me before my meeting with Kyle")).toBe("Kyle");
    expect(prepWho("Prep me for tomorrow")).toBeNull();
    expect(prepWho("Prep me for the Sprouts call. Also #145 is done.")).toBeNull();
  });

  it("by the customer, a contact or the project's name, only among the asker's own projects (P10)", async () => {
    expect(await prepProjects(db, "kemar", "Sprouts")).toEqual([{ id: "forager", name: "Forager 2.0" }, { id: "insights", name: "Store Insights" }]);
    expect(await prepProjects(db, "alicia", "Sprouts")).toEqual([{ id: "forager", name: "Forager 2.0" }]);
    expect(await prepProjects(db, "andre", "Sprouts")).toEqual([{ id: "insights", name: "Store Insights" }]);
    expect(await prepProjects(db, "kemar", "Kyle")).toEqual([{ id: "forager", name: "Forager 2.0" }]);
    expect(await prepProjects(db, "kemar", "Forager")).toEqual([{ id: "forager", name: "Forager 2.0" }]);
    expect(await prepProjects(db, "andre", "Kyle")).toEqual([]);
  });

  it("Kemar's call could be about two of his projects: DPM asks which (M21), and drafts the brief once he taps one", async () => {
    const { captureId, conversationId, answer, question } = await say("kemar", "Prep me for the Sprouts call");
    expect(question).toMatchObject({ topic: "draft", draft: "prep", projectId: null, made: [`clr-${captureId}`] });
    expect(answer?.text).toBe("I'll write the brief once you say which project the call is about.");
    expect(await draftRow(captureId)).toBeUndefined();
    const thread = await getThread(db, "kemar", conversationId, at(1));
    if (!thread.found) throw new Error("no thread");
    expect(thread.turns[0].clarification).toMatchObject({ question: "Which project is the call about: Forager 2.0 or Store Insights?", options: [{ id: "forager" }, { id: "insights" }] });
    const r = await answerClarification(as("kemar", 2), `clr-${captureId}`, "forager");
    expect(r.message).toBe("Got it: Forager 2.0. Your brief follows.");
    await writeDraft(db, () => at(2), (await draftOfCapture(db, captureId))!, null);
    expect(await draftRow(captureId)).toMatchObject({ kind: "prep", projectId: "forager", state: "ready", by: "plain" });
  });

  it("a typed answer works too (CL2), and the brief is written in the same read", async () => {
    const { captureId, conversationId } = await say("kemar", "Prep me for the Sprouts call");
    await say("kemar", "Store Insights", { minutes: 1, conversationId });
    expect(await draftRow(captureId)).toMatchObject({ kind: "prep", projectId: "insights", state: "ready" });
  });

  it("one project fits: the brief at once. Andre's Sprouts call is Store Insights; Forager is never named to him (P10)", async () => {
    const { captureId, answer } = await say("andre", "Prep me for the Sprouts call", { drafter: writes("Store Insights has no releases shared with the client yet.") });
    expect(await draftRow(captureId)).toMatchObject({ kind: "prep", projectId: "insights", state: "ready" });
    expect(answer?.text).toContain("Here's a brief for your call about Store Insights.");
    expect(JSON.stringify(await draftRow(captureId))).not.toContain("Forager");
  });

  it("nobody that fits: DPM says so and how to ask, naming only their own projects", async () => {
    const { answer, captureId } = await say("andre", "Prep me for my call with Kyle");
    expect(answer?.text).toBe('I can\'t tell which of your projects the call is about. Say it again with its name, for example "Prep me for the Store Insights call".');
    expect(await draftRow(captureId)).toBeUndefined();
  });
});

describe("the brief is client-safe (rule 8, MT10)", () => {
  it("MT10: Jodian, a member, gets it from her own read: the releases, what waits on Sprouts; nothing internal", async () => {
    const facts = (await prepFacts(db, "jodian", "forager", at(0)))!;
    expect(facts.facts.heading).toBe("Forager 2.0: brief for your call with Sprouts, Tue 20 Oct");
    expect(facts.facts.sections.map((s) => [s.title, s.facts.map((f) => f.text)])).toEqual([
      ["Releases", ["Buyer pilot · Release 1: planned Fri 30 Oct", "Rollout · Release 2: planned Fri 6 Nov"]],
      // The status only once its reason is shared with the client (DR4); none is
      ["Status", []],
      ["Waiting on Sprouts", ["Store sales feed access from Sprouts IT"]],
      // Phase M's hook: no chases yet
      ["Chases", []],
    ]);
    expect(facts.hidden).toEqual(expect.arrayContaining(["Trend model", "Data sources", "#151", "Only Kemar can run the pipeline"]));
    // The dependency it gives may be said, and so may a name inside it (#151's title is part of it)
    expect(facts.hidden).not.toContain("Store sales feed access from Sprouts IT");
    expect(facts.hidden).not.toContain("Store sales feed access");
    // Andre cannot read Forager at all
    expect(await prepFacts(db, "andre", "forager", at(0))).toBeNull();
  });

  it("DR4: copying checks the brief against the client view now; something it does not show refuses the copy", async () => {
    const { captureId } = await say("alicia", "Prep me for the Sprouts call", { drafter: writes("Release 1 is planned for Fri 30 Oct. Sprouts IT still owes us the store sales feed access.") });
    const draft = await draftRow(captureId);
    expect(draft).toMatchObject({ projectId: "forager", state: "ready", by: "atlas" });
    expect(await refusal(copyDraft(as("alicia", 1), draft.id, "Release 1 is planned for Fri 30 Oct. The Trend model is late."))).toBe(CLIENT_VIEW_CHANGED);
    // A release hidden since it was drafted
    await db.update(t.milestones).set({ clientVisible: false }).where(eq(t.milestones.id, "ms-release-1"));
    expect(await refusal(copyDraft(as("alicia", 2), draft.id))).toBe(CLIENT_VIEW_CHANGED);
    await db.update(t.milestones).set({ clientVisible: true }).where(eq(t.milestones.id, "ms-release-1"));
    expect(await copyDraft(as("alicia", 3), draft.id)).toEqual({ text: "Release 1 is planned for Fri 30 Oct. Sprouts IT still owes us the store sales feed access." });
  });

  it("DR6: with no model, DPM's plain brief is copied as it is", async () => {
    const { captureId } = await say("alicia", "Prep me for the Sprouts call");
    const draft = await draftRow(captureId);
    expect(draft).toMatchObject({ by: "plain", state: "ready" });
    expect((await copyDraft(as("alicia", 1), draft.id)).text).toContain("Waiting on Sprouts:\n- Store sales feed access from Sprouts IT");
  });

  it("rule 4: the right to copy is read again: once she left the project, it is closed", async () => {
    const { captureId } = await say("jodian", "Prep me for the Sprouts call");
    const draft = await draftRow(captureId);
    await db.update(t.projectMemberships).set({ state: "left" }).where(eq(t.projectMemberships.personId, "jodian"));
    expect(await refusal(copyDraft(as("jodian", 1), draft.id))).toBe("you can no longer read this project");
  });
});
