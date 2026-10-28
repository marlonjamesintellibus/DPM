// Phase O: "Prep me for the Sprouts call" is a draft request (M25's prep, a call brief), only as the whole message.
// Which project the call is about comes from the words and the asker's projects, never from Atlas (MT9, P10).
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { draftKindOf } from "../drafts";
import { checkQuestion, ruleQuestion } from "../question";

const ctx = (text: string) => ({ ...KEMAR_CONTEXT, text });

describe("a call brief (phase O)", () => {
  it("the rule reads it from a whole message; the words must say a call or meeting", () => {
    expect(ruleQuestion(ctx("Prep me for the Sprouts call"))).toEqual({ asked: "Prep me for the Sprouts call", topic: "draft", projectId: null, draft: "prep" });
    expect(ruleQuestion(ctx("Brief me before the Forager meeting"))).toMatchObject({ topic: "draft", projectId: "forager", draft: "prep" });
    expect(draftKindOf("Prep me for tomorrow")).toBeNull();
    expect(draftKindOf("Prep the client status for Forager")).toBe("client");
  });

  it("MT9: Atlas's guess between two projects is never taken; only a project the words name", () => {
    expect(checkQuestion({ asked: "x", topic: "draft", projectId: "insights" }, ctx("Prep me for the Sprouts call"))).toMatchObject({ draft: "prep", projectId: null });
    expect(checkQuestion({ asked: "x", topic: "draft", projectId: "insights" }, ctx("Prep me for the Forager call"))).toMatchObject({ draft: "prep", projectId: "forager" });
  });

  it("a longer message that mentions a call is read as usual", () => {
    expect(checkQuestion({ asked: "x", topic: "draft", projectId: null }, ctx("Prep me for the Sprouts call. Also #145 is done."))).toBeNull();
  });
});
