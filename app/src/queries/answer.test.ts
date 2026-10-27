// Section 15 against PGlite: a question asked in the chat is answered from the asker's own data (QA1 to
// QA12), through the same read as an update. Atlas is the recorded fixture, whose rule spots a one-sentence
// question, or a fake that says what was asked alongside its proposals.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Extractor } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { createCapture } from "../commands/capture";
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
    expect(row.answer).toMatchObject({
      text: "1 thing needs you:",
      lines: [{ label: "Your update from 8:58am is waiting for review: 4 need your OK", href: "/review/cap-kemar-0858" }],
    });
    const chat = await getChatSummary(db, "kemar", captureId);
    expect(chat.latest).toMatchObject({ state: "answered", line: "", answer: { text: "1 thing needs you:" } });
  });

  it("Alicia asks what is blocked on Forager: the blocker, from her own log", async () => {
    const { row } = await ask("alicia", "What's blocked on Forager?");
    expect(row.answer).toMatchObject({ text: "1 thing is blocked on Forager 2.0:", lines: [{ label: "Forager 2.0: Store sales feed access (1 report)", href: "/projects/forager?view=table&log=blocker" }] });
  });

  it("QA3 Alicia asks about Store Insights, which she is not in: her own projects only, nothing about it", async () => {
    const { row } = await ask("alicia", "Is Store Insights on track?");
    expect(row.question).toMatchObject({ topic: "project_status", projectId: null });
    const labels = row.answer!.lines.map((l) => l.label).join(" ");
    expect(labels).toContain("Forager 2.0 is");
    expect(labels).toContain("GQ & Academy is");
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
    expect(row.answer?.text).toBe("1 thing is blocked on Forager 2.0:");
  });

  it("QA12 every item is dropped by the checks, and it asked: answered, not nothing to update", async () => {
    const made_up: RawProposal = { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#999", label: "#999" }, targetId: "wi-999", field: "state", newValue: "done", quote: "#999 done", confidence: "high", rationale: "x" };
    const { row } = await ask("kemar", "#999 done. Anything stuck?", says([made_up], { asked: "Anything stuck?", topic: "blocked", projectId: null }));
    expect(row.state).toBe("answered");
  });

  it("QA6 Atlas names a project the asker is not in: dropped, the answer covers their projects", async () => {
    const { row } = await ask("alicia", "What is blocked over there?", says([], { asked: "What is blocked over there?", topic: "blocked", projectId: "insights" }));
    expect(row.question?.projectId).toBeNull();
    expect(row.answer?.text).toBe("1 thing is blocked on your projects:");
  });

  it("QA9 nothing needs Jodian: he is told so", async () => {
    const { row } = await ask("jodian", "What needs me today?");
    expect(row.answer).toMatchObject({ text: "Nothing needs you right now.", lines: [] });
  });

  it("other questions: said plainly, with what needs them today", async () => {
    const { row } = await ask("kemar", "What did Andre say about pricing?");
    expect(row.answer?.text).toMatch(/^I can't answer that yet\. I can tell you what needs you, what is blocked, and how a project stands\. Here is what needs you today: 1 thing needs you\.$/);
  });

  it("QA8 without a model, an update with no recording still fails as not connected", async () => {
    const { row } = await ask("kemar", "Finished #145 and the export is fixed.");
    expect(row.state).toBe("failed");
  });
});
