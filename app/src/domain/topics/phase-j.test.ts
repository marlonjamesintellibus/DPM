// Phase J topic: "Start my standup" only as the whole message, as "Undo that" is, checked like any question
// Atlas says was asked; a longer message that mentions a standup is read as an update.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { checkQuestion, ruleQuestion } from "../question";
import { standup } from "./standup";

const ctx = (text: string) => ({ ...KEMAR_CONTEXT, text });

describe("standup (M28)", () => {
  it("is the whole message only, the team's words too", () => {
    for (const said of ["Start my standup", "start my stand-up.", "Let's do my standup", "Atlas, start the standup please", "Standup time!", "Mek wi do di standup", "Morning, start my standup"]) {
      expect(standup.rule.test(said.toLowerCase()), said).toBe(true);
      expect(ruleQuestion(ctx(said))).toEqual({ asked: said, topic: "standup", projectId: null });
    }
    for (const said of ["I missed the standup, #145 is done", "Start my standup after I finish #145", "The standup notes are in the doc", "Morning"]) {
      expect(standup.rule.test(said.toLowerCase()), said).toBe(false);
    }
  });

  it("Atlas saying standup for a longer message is dropped: it is read as an update (rule 1)", () => {
    expect(checkQuestion({ asked: "standup", topic: "standup", projectId: null }, ctx("Skipped the standup, #145 is done"))).toBeNull();
    expect(checkQuestion({ asked: "Start my standup", topic: "standup", projectId: null }, ctx("Start my standup"))).toMatchObject({ topic: "standup" });
  });
});
