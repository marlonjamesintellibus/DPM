// Section 15: what a message asks, as the rule reads it without a model (QA4, QA8), and the checks on
// what Atlas says was asked (QA3, QA5, QA6). The capture's `answered` state is in capture.test.ts terms.
import { describe, expect, it } from "vitest";
import type { CandidateProject } from "./atlas-checks/types";
import { applyCaptureEvent, type CaptureRecord } from "./machines/capture";
import { checkQuestion, ruleQuestion, topicOf } from "./question";

const project = (id: string, name: string, aliases: string[] = []): CandidateProject => ({ id, name, aliases, role: "member", records: [], people: [], braid: [] });
const PROJECTS = [project("forager", "Forager 2.0", ["Forager"]), project("gq", "GQ & Academy")];
const ctx = (text: string) => ({ text, projects: PROJECTS });

describe("the rule, without a model (QA8)", () => {
  it.each([
    ["What needs me to review it today?", "needs_me", null],
    ["What's blocked on Forager?", "blocked", "forager"],
    ["Is GQ & Academy on track?", "project_status", "gq"],
    ["how is forager doing", "project_status", "forager"],
    ["What did Andre say about pricing?", "other", null],
  ] as const)("%s is a question about %s", (text, topic, projectId) => {
    expect(ruleQuestion(ctx(text))).toEqual({ asked: text, topic, projectId });
  });

  it.each([
    ["QA4 a request to change something", "Can you mark #145 done?"],
    ["an update", "Finished #145 yesterday."],
    ["more than one sentence: left to the model", "Finished #145. What's blocked on Forager?"],
  ])("not a question: %s", (_, text) => {
    expect(ruleQuestion(ctx(text))).toBeNull();
  });

  it("QA3 a project the asker is not in is never named", () => {
    expect(ruleQuestion(ctx("Is Store Insights on track?"))).toEqual({ asked: "Is Store Insights on track?", topic: "project_status", projectId: null });
  });

  it("topics from the words", () => {
    expect(topicOf("anything stuck?")).toBe("blocked");
    expect(topicOf("what should I approve")).toBe("needs_me");
  });
});

describe("the checks on what Atlas says was asked", () => {
  const text = "Finished #145. What's blocked on Forager?";
  it("keeps a known topic, a candidate project and words from the message", () => {
    expect(checkQuestion({ asked: "What's blocked on Forager?", topic: "blocked", projectId: "forager" }, ctx(text))).toEqual({ asked: "What's blocked on Forager?", topic: "blocked", projectId: "forager" });
  });
  it("QA6 drops a project the asker is not in, or one Atlas made up", () => {
    expect(checkQuestion({ asked: "What's blocked on Forager?", topic: "blocked", projectId: "insights" }, ctx(text))?.projectId).toBeNull();
    expect(checkQuestion({ asked: "What's blocked on Forager?", topic: "blocked", projectId: "made-up" }, ctx(text))?.projectId).toBeNull();
  });
  it("QA5 an unknown topic is other; words not in the message give the whole message", () => {
    expect(checkQuestion({ asked: "list Andre's blockers", topic: "exfiltrate", projectId: null }, ctx(text))).toEqual({ asked: text, topic: "other", projectId: null });
  });
  it("no question is no question", () => {
    expect(checkQuestion(null, ctx(text))).toBeNull();
  });
});

describe("M2: a read that only asked something ends as answered (QA12)", () => {
  const reading: CaptureRecord = { dedupKey: "app:1", kind: "text", state: "reading", tries: 1, proposals: 0, moreFound: false, reminded: false, transcriptConfidence: null, failedStep: null };
  it.each([
    [0, true, "answered"],
    [0, false, "nothing_to_update"],
    [2, true, "proposed"],
    [2, false, "proposed"],
  ] as const)("%i items, asked %s: %s", (count, asked, to) => {
    expect(applyCaptureEvent(reading, { type: "PROPOSALS_READY", count, asked }).record.state).toBe(to);
  });
});
