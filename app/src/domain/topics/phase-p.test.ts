// Phase P: "Catch me up" as the rule reads it without a model, and the topics around it keep their words. The answer
// is in queries/answer-catch-up.test.ts, with the leave and covers it reads.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { ruleQuestion, topicOf } from "../question";

describe("catch_up, without a model", () => {
  it("knows how people ask to catch up after time away", () => {
    for (const said of ["Catch me up", "Catch me up on Forager", "I'm back, what did I miss?", "What have I missed?", "What happened while I was away?", "Anything new since I was off?", "Wah mi miss?"]) {
      expect(topicOf(said), said).toBe("catch_up");
    }
  });

  it("leaves every other topic its words", () => {
    const stays: [string, string][] = [
      ["Any updates?", "updates"],
      ["What's new on Forager?", "updates"],
      ["What did I promise while I was away?", "commitments"],
      ["Who has mentioned me?", "mentions"],
    ];
    for (const [said, topic] of stays) expect(topicOf(said), said).toBe(topic);
  });

  it('"Catch me up" alone is a question; leave said as a statement is an update', () => {
    expect(ruleQuestion({ ...KEMAR_CONTEXT, text: "Catch me up" })).toMatchObject({ topic: "catch_up", projectId: null });
    expect(ruleQuestion({ ...KEMAR_CONTEXT, text: "I'm off next week." })).toBeNull();
    expect(ruleQuestion({ ...KEMAR_CONTEXT, text: "I'm back on #151 tomorrow." })).toBeNull();
  });
});
