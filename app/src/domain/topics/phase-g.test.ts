// Phase G topic: "Draft my standup" only as the whole message, as "Start my standup" is. Which draft it is,
// and for which project, comes from the words and the asker's projects, never from Atlas (M25, P10).
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { checkQuestion, ruleQuestion } from "../question";
import { isOwnMessage } from "../standup";
import { draft } from "./draft";

const ctx = (text: string) => ({ ...KEMAR_CONTEXT, text });

describe("draft (M25)", () => {
  it("the rule reads the kind and the project from a whole message", () => {
    expect(ruleQuestion(ctx("Draft my standup"))).toEqual({ asked: "Draft my standup", topic: "draft", projectId: null, draft: "standup" });
    expect(ruleQuestion(ctx("Draft a client status for Forager"))).toEqual({ asked: "Draft a client status for Forager", topic: "draft", projectId: "forager", draft: "client" });
    expect(ruleQuestion(ctx("Draft the weekly summary for Store Insights"))).toMatchObject({ topic: "draft", projectId: "insights", draft: "weekly" });
    // "Start my standup" stays phase J's standup
    expect(ruleQuestion(ctx("Start my standup"))).toMatchObject({ topic: "standup" });
    expect(draft.rule.test("draft my standup")).toBe(true);
  });

  it("a longer message that mentions a draft is not one: Atlas saying draft for it is dropped (rule 1)", () => {
    expect(checkQuestion({ asked: "draft", topic: "draft", projectId: null }, ctx("I drafted the client status for Forager, and #145 is done"))).toBeNull();
    expect(ruleQuestion(ctx("Draft my standup. Also #145 is done."))).toBeNull();
  });

  it("the words decide which draft, whatever topic Atlas read; a project Atlas names must be the asker's (QA6)", () => {
    expect(checkQuestion({ asked: "Draft my standup", topic: "standup", projectId: null }, ctx("Draft my standup"))).toEqual({ asked: "Draft my standup", topic: "draft", projectId: null, draft: "standup" });
    expect(checkQuestion({ asked: "x", topic: "draft", projectId: "not-mine" }, ctx("Draft a client status for Forager"))).toMatchObject({ projectId: "forager", draft: "client" });
    expect(checkQuestion({ asked: "x", topic: "draft", projectId: "not-mine" }, ctx("Draft a client status"))).toMatchObject({ projectId: null, draft: "client" });
  });

  it("SU4: during a standup, asking for a draft is the person's own message, not an answer", () => {
    expect(isOwnMessage(ctx("Draft my standup"))).toBe(true);
  });
});
