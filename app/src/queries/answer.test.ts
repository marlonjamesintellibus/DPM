// Section 15 against PGlite: a question asked in the chat is answered from the asker's own data (QA1 to
// QA12), through the same read as an update. Atlas is the recorded fixture, whose rule spots a one-sentence
// question, or a fake that says what was asked alongside its proposals.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Drafter, Extractor } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { createCapture, decideExtraction, openReview } from "../commands/capture";
import { CommandRefused } from "../commands/core";
import { loadItems } from "../db/records";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import type { RawProposal } from "../domain/atlas-checks/types";
import type { RawQuestion } from "../domain/question";
import { at, seededDb } from "../test/seeded-db";
import { getChatSummary } from "./chat";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };

async function ask(who: string, text: string, extractor: Extractor = createFixtureExtractor()) {
  const ctx = { db, now: at(30), actorId: who };
  const { captureId } = await createCapture(ctx, { channel: "app", messageId: `q-${++n}`, kind: "text", text, messageAt: at(30), receivedAt: at(30) });
  const read = await readCapture(ctx, captureId, extractor, noWait);
  const [row] = await db.select().from(t.captures).where(eq(t.captures.id, captureId));
  return { captureId, read, row };
}

/** Atlas that proposes these and says this was asked. */
const says = (proposals: RawProposal[], question: RawQuestion | null): Extractor => ({
  name: "fake",
  extract: async () => ({ proposals, question, malformed: [], model: "fake", usage: null }),
});

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("questions in the chat", () => {
  it("QA1 Kemar asks what needs him: his 8:58 update waits for review, linked; no \"Got it\"", async () => {
    const { captureId, row } = await ask("kemar", "What needs me to review it today?");
    expect(row.state).toBe("answered");
    expect(row.question).toEqual({ asked: "What needs me to review it today?", topic: "needs_me", projectId: null });
    expect(row.answer).toMatchObject({ topic: "needs_me", wording: "rules", text: "Your update from 8:58am has 4 items waiting for your OK before it can be saved.", more: null });
    // Section 17: the answer lists each item that needs his OK, with Accept
    expect(row.answer!.cards.map((c) => [c.title, c.detail, c.tag])).toEqual([
      ["Milestone Trend model", "Forager 2.0: Forecast 23 Oct to 24 Oct", "Needs your OK · Medium confidence"],
      ["Handover Runbook", "Forager 2.0: Not done to Handed to Jodian", "Needs your OK · Low confidence"],
      ["Trend model may slip to 24 Oct", "Forager 2.0: Propose to the PM", "Needs your OK · Medium confidence"],
      ["Only Kemar can run the pipeline", "Forager 2.0: Add as evidence (2 sources)", "Needs your OK · Medium confidence"],
    ]);
    expect(row.answer!.cards.every((c) => c.href === "/review/cap-kemar-0858" && c.accept?.captureId === "cap-kemar-0858")).toBe(true);
    const chat = await getChatSummary(db, "kemar", captureId);
    expect(chat.latest).toMatchObject({ state: "answered", line: "", answer: { topic: "needs_me" } });
  });

  it("Alicia asks what is blocked on Forager: the blocker, from her own log", async () => {
    const { row } = await ask("alicia", "What's blocked on Forager?");
    expect(row.answer).toMatchObject({
      text: "1 thing is blocked on Forager 2.0.",
      cards: [{ title: "Store sales feed access", detail: "Forager 2.0: 1 report, since 14 Oct", tag: "Blocker", href: "/projects/forager?view=table&log=blocker" }],
    });
  });

  it("QA3 Alicia asks about Store Insights, which she is not in: her own projects only, nothing about it", async () => {
    const { row } = await ask("alicia", "Is Store Insights on track?");
    expect(row.question).toMatchObject({ topic: "project_status", projectId: null });
    expect(row.answer!.cards.map((c) => c.title)).toEqual(["Forager 2.0", "GQ & Academy"]);
    expect(JSON.stringify(row.answer)).not.toContain("Insights");
  });

  it("QA2 an update that also asks: the update goes to review and the question is answered with it", async () => {
    const done: RawProposal = {
      kind: "update",
      projectId: "insights",
      routingReason: { basis: "target", evidence: "#208", label: "#208" },
      targetId: "wi-208",
      field: "state",
      newValue: "done",
      quote: "#208 is done",
      confidence: "high",
      rationale: "Done",
    };
    const { row } = await ask("kemar", "#208 is done. What's blocked on Forager?", says([done], { asked: "What's blocked on Forager?", topic: "blocked", projectId: "forager" }));
    expect(row.state).toBe("proposed");
    expect(row.answer?.text).toBe("1 thing is blocked on Forager 2.0.");
  });

  it("QA12 every item is dropped by the checks, and it asked: answered, not nothing to update", async () => {
    const made_up: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#999", label: "#999" }, targetId: "wi-999", field: "state", newValue: "done", quote: "#999 done", confidence: "high", rationale: "x" };
    const { row } = await ask("kemar", "#999 done. Anything stuck?", says([made_up], { asked: "Anything stuck?", topic: "blocked", projectId: null }));
    expect(row.state).toBe("answered");
  });

  it("QA6 Atlas names a project the asker is not in: dropped, the answer covers their projects", async () => {
    const { row } = await ask("alicia", "What is blocked over there?", says([], { asked: "What is blocked over there?", topic: "blocked", projectId: "insights" }));
    expect(row.question?.projectId).toBeNull();
    expect(row.answer?.text).toBe("1 thing is blocked on your projects.");
  });

  it("QA9 nothing needs Jodian: he is told so", async () => {
    const { row } = await ask("jodian", "What needs me today?");
    expect(row.answer).toMatchObject({ text: "Nothing needs you right now.", cards: [] });
  });

  it("other questions: said plainly, with what needs them today", async () => {
    const { row } = await ask("kemar", "What did Andre say about pricing?");
    expect(row.answer?.text).toBe("I can't answer that yet. I can tell you what needs you, what is blocked, and how a project stands. Here is what needs you today.");
    expect(row.answer?.cards).toHaveLength(4);
  });

  it("QA8 without a model, an update with no recording still fails as not connected", async () => {
    const { row } = await ask("kemar", "Finished #145 and the export is fixed.");
    expect(row.state).toBe("failed");
  });
});

describe("Atlas words the reply (section 17)", () => {
  const drafter = (text: string | Error): Drafter => ({
    name: "fake",
    draft: async () => {
      if (text instanceof Error) throw text;
      return { text, model: "fake-model", usage: null };
    },
  });
  const askWith = async (d: Drafter) => {
    const ctx = { db, now: at(30), actorId: "kemar" };
    const { captureId } = await createCapture(ctx, { channel: "app", messageId: `w-${++n}`, kind: "text", text: "Can you list the items?", messageAt: at(30), receivedAt: at(30) });
    await readCapture(ctx, captureId, says([], { asked: "Can you list the items?", topic: "needs_me", projectId: null }), { ...noWait, drafter: d });
    return (await db.select().from(t.captures).where(eq(t.captures.id, captureId)))[0];
  };

  it("Atlas's words go over DPM's cards; DPM's sentence is kept on record", async () => {
    const row = await askWith(drafter("Your 8:58am update has 4 items waiting for your OK. They are below."));
    expect(row.answer).toMatchObject({ wording: "atlas", text: "Your 8:58am update has 4 items waiting for your OK. They are below.", rulesText: "Your update from 8:58am has 4 items waiting for your OK before it can be saved." });
    expect(row.answer!.cards).toHaveLength(4);
  });

  it("MF3 words that add a number are thrown away", async () => {
    const row = await askWith(drafter("You have 6 items waiting."));
    expect(row.answer).toMatchObject({ wording: "rules", text: "Your update from 8:58am has 4 items waiting for your OK before it can be saved." });
  });

  it("MF4 a failed call leaves DPM's sentence, never a pending answer", async () => {
    const row = await askWith(drafter(new Error("timeout")));
    expect(row.answer).toMatchObject({ wording: "rules" });
  });

  it("MF5 without a model the answer is DPM's at once", async () => {
    const { row } = await ask("kemar", "What needs me today?");
    expect(row.answer?.wording).toBe("rules");
  });
});

describe("Accept from a chat card (MF6, MF7)", () => {
  it("opens the review if needed and accepts the item; a saved update refuses", async () => {
    const { row } = await ask("kemar", "What needs me to review it today?");
    const card = row.answer!.cards[0];
    await openReview({ db, now: at(31), actorId: "kemar" }, card.accept!.captureId).catch(() => undefined);
    await decideExtraction({ db, now: at(31), actorId: "kemar" }, card.accept!.itemId, { type: "accept" });
    const items = (await loadItems(db, "cap-kemar-0858")).items;
    expect(items.find((i) => i.id === card.accept!.itemId)?.state).toBe("accepted");
    // MF7: accepting it again changes nothing that was decided
    await expect(decideExtraction({ db, now: at(32), actorId: "kemar" }, card.accept!.itemId, { type: "accept" })).rejects.toBeInstanceOf(CommandRefused);
  });
});
