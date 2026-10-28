// Phase E, CM12: "What did I promise?" as the rule reads it without a model, and the other topics keep their
// words. The answer is in commands/commitment.test.ts, with the commitments it reads.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { ruleQuestion, topicOf } from "../question";

describe("commitments, without a model", () => {
  it("knows how people ask what they promised", () => {
    for (const said of ["What did I promise?", "what have I promised", "My promises?", "What are my commitments?", "Show me my commitments", "What did I say I'd do?", "Wah mi did promise?"]) {
      expect(topicOf(said), said).toBe("commitments");
    }
  });

  it("leaves every other topic its words", () => {
    const stays: [string, string][] = [
      ["What's due this week?", "due"],
      ["What am I working on?", "my_work"],
      ["What did Andre say about pricing?", "people"],
    ];
    for (const [said, topic] of stays) expect(topicOf(said), said).toBe(topic);
  });

  it("a promise said as a statement is not a question: it is read as an update", () => {
    expect(ruleQuestion({ ...KEMAR_CONTEXT, text: "I promised Kyle the access request tomorrow." })).toBeNull();
    expect(ruleQuestion({ ...KEMAR_CONTEXT, text: "What did I promise?" })).toMatchObject({ topic: "commitments", projectId: null });
  });
});
