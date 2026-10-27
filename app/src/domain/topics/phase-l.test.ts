// Phase L topics: "Undo that" only as the whole message, "Why did you file that?", and corrections, checked
// like any question Atlas says was asked (P10: only the asker's projects and people, words in the message).
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { checkQuestion, ruleQuestion, topicOf } from "../question";
import { checkCorrection, ruleCorrection } from "./correction";
import { undo } from "./undo";

const ctx = (text: string) => ({ ...KEMAR_CONTEXT, text });

describe("undo (M30)", () => {
  it("is the whole message only", () => {
    for (const said of ["undo that", "Undo that.", "Undo", "take that back please", "Atlas, undo my last update", "Tek dat back", "Undo it!"]) {
      expect(undo.rule.test(said.toLowerCase()), said).toBe(true);
      expect(ruleQuestion(ctx(said))).toEqual({ asked: said, topic: "undo", projectId: null });
    }
    for (const said of ["Can you undo the #151 change and mark it done?", "I need to undo that migration on #145", "undo that and mark #145 done"]) {
      expect(undo.rule.test(said.toLowerCase()), said).toBe(false);
    }
  });

  it("Atlas saying undo for a longer message is dropped: it is read as an update (rule 1)", () => {
    expect(checkQuestion({ asked: "undo", topic: "undo", projectId: null }, ctx("Undo the #151 block, Kyle sent it"))).toBeNull();
    expect(checkQuestion({ asked: "Undo that", topic: "undo", projectId: null }, ctx("Undo that"))).toMatchObject({ topic: "undo" });
  });
});

describe("why_filed", () => {
  it("knows the words without a model", () => {
    for (const said of ["Why did you file that?", "Why did #151 go to Forager?", "why was that put in Store Insights", "Why did you log the blocker there?", "Why did my blocker end up in GQ?", "Why did you file Kemar's blocker?"]) {
      expect(topicOf(said), said).toBe("why_filed");
    }
  });

  it("leaves why questions about the work to phase C: only Atlas's filing, or what they said, is why_filed", () => {
    for (const said of ["Why is Forager at risk?", "Why did Forager go to at risk?", "Why hasn't Kyle sent the file?", "Why was the launch put on hold?", "Why did the feed go down?"]) {
      expect(topicOf(said), said).not.toBe("why_filed");
    }
  });
});

describe("corrections (M31)", () => {
  it("an alias for one of the asker's projects, with the word from the message", () => {
    expect(ruleCorrection(ctx("GQ also means the Guild"))).toEqual({ kind: "alias", projectId: "gq", word: "Guild", personId: null, notProjectId: null });
    expect(ruleCorrection(ctx("Guild also means GQ."))).toEqual({ kind: "alias", projectId: "gq", word: "Guild", personId: null, notProjectId: null });
    expect(ruleQuestion(ctx("GQ also means the Guild"))).toMatchObject({ topic: "correction", projectId: "gq", correction: { word: "Guild" } });
  });

  it("a person tied to one project and not another", () => {
    expect(ruleCorrection(ctx("Kyle is Store Insights, not Forager"))).toEqual({ kind: "contact", projectId: "insights", word: null, personId: "kyle", notProjectId: "forager" });
    expect(ruleCorrection(ctx("Kyle is on Store Insights"))).toMatchObject({ projectId: "insights", personId: "kyle", notProjectId: null });
  });

  it("a statement that is not a correction is left to the model", () => {
    for (const said of ["#151 is done", "Kyle is late with the feed", "The model is also slow"]) expect(ruleCorrection(ctx(said)), said).toBeNull();
  });

  it('QA8: an update said with "is also" stays an update; after a bare "is also" only a name is a new name', () => {
    for (const said of ["Forager is also waiting on Kyle", "GQ is also late", "Store Insights is also blocked on the export"]) {
      expect(ruleCorrection(ctx(said)), said).toBeNull();
      expect(ruleQuestion(ctx(said))?.topic, said).not.toBe("correction");
    }
    expect(ruleCorrection(ctx("GQ is also the Guild"))).toMatchObject({ kind: "alias", projectId: "gq", word: "Guild" });
    expect(ruleCorrection(ctx("GQ is also called the Guild"))).toMatchObject({ kind: "alias", projectId: "gq", word: "Guild" });
    // About a person, it is a tie, not a name for the project
    expect(ruleCorrection(ctx("Kyle is also on Store Insights"))).toMatchObject({ kind: "contact", projectId: "insights", personId: "kyle" });
  });

  it("P10: a project or person the asker does not have is dropped, and a word not in the message", () => {
    const text = "Kyle is Store Insights, not Forager";
    expect(checkCorrection({ kind: "contact", projectId: "hx", personId: "kyle" }, ctx(text))).toBeNull();
    expect(checkCorrection({ kind: "contact", projectId: "insights", personId: "dwayne" }, ctx(text))).toBeNull();
    expect(checkCorrection({ kind: "contact", projectId: "insights", personId: "kyle", notProjectId: "hx" }, ctx(text))).toMatchObject({ notProjectId: null });
    expect(checkCorrection({ kind: "alias", projectId: "gq", word: "Academy Two" }, ctx("GQ also means the Guild"))).toBeNull();
    expect(checkCorrection({ kind: "gossip", projectId: "gq", word: "Guild" }, ctx("GQ also means the Guild"))).toBeNull();
  });

  it("checkQuestion keeps a checked correction with the question, and none when it fails", () => {
    const text = "Kyle is Store Insights, not Forager";
    const raw = { asked: text, topic: "correction", projectId: "insights", correction: { kind: "contact", projectId: "insights", personId: "kyle", notProjectId: "forager" } };
    expect(checkQuestion(raw, ctx(text))).toMatchObject({ topic: "correction", correction: { personId: "kyle", projectId: "insights", notProjectId: "forager" } });
    expect(checkQuestion({ ...raw, correction: { kind: "contact", projectId: "hx", personId: "kyle" } }, ctx(text))).not.toHaveProperty("correction");
  });
});
