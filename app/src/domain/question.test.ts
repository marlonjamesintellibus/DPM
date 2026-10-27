// Section 15: what a message asks, as the rule reads it without a model (QA4, QA8), and the checks on
// what Atlas says was asked (QA3, QA5, QA6). The capture's `answered` state is in capture.test.ts terms.
import { describe, expect, it } from "vitest";
import type { CandidateProject } from "./atlas-checks/types";
import { applyCaptureEvent, type CaptureRecord } from "./machines/capture";
import { checkQuestion, ruleQuestion, topicOf } from "./question";
import { suggestionsAfter } from "./topics";
import { namesPerson } from "./topics/mentions";

const project = (id: string, name: string, aliases: string[] = []): CandidateProject => ({ id, name, aliases, role: "member", records: [], people: [], braid: [] });
const PROJECTS = [project("forager", "Forager 2.0", ["Forager"]), project("gq", "GQ & Academy", ["GQ", "Academy"])];
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

  it("the first topic whose words match wins: blocked, then project status, then needs me", () => {
    expect(topicOf("anything blocked that needs me today?")).toBe("blocked");
    expect(topicOf("status of my reviews")).toBe("project_status");
  });
});

describe("follow-ups by the rule (CV8, CV9)", () => {
  const earlier = (asked: { topic: string; projectId: string | null } | null) => [{ captureId: "c0", at: new Date(), text: "What's blocked on Forager?", asked, openItems: [] }];
  it("CV8 'and on GQ?' takes its topic from the question before it", () => {
    expect(ruleQuestion({ ...ctx("and on GQ & Academy?"), earlier: earlier({ topic: "blocked", projectId: "forager" }) })).toEqual({ asked: "and on GQ & Academy?", topic: "blocked", projectId: "gq" });
  });
  it("a project the asker is not in is never named (QA3 holds)", () => {
    expect(ruleQuestion({ ...ctx("what about Store Insights?"), earlier: earlier({ topic: "blocked", projectId: "forager" }) })).toEqual({ asked: "what about Store Insights?", topic: "blocked", projectId: null });
  });
  it("CV9 with nothing before it, it is unclear", () => {
    expect(ruleQuestion(ctx("and on that one?"))).toEqual({ asked: "and on that one?", topic: "unclear", projectId: null });
  });
  it("an update that starts with 'and' is not a follow-up", () => {
    expect(ruleQuestion({ ...ctx("And #145 is done. The export too."), earlier: earlier({ topic: "blocked", projectId: null }) })).toBeNull();
  });
});

describe("section 18: the new topics by the rule", () => {
  it.each([
    ["What am I working on?", "my_work", null],
    ["What's on my plate?", "my_work", null],
    ["My tasks on Forager?", "my_work", "forager"],
    ["What's due this week?", "due", null],
    ["Anything due tomorrow?", "due", null],
    ["What's due today?", "due", null],
    ["When's the next milestone on Forager?", "due", "forager"],
    ["Any updates?", "updates", null],
    ["Any updates today?", "updates", null],
    ["What’s new?", "updates", null],
    ["What changed on GQ?", "updates", "gq"],
    ["Who has mentioned me?", "mentions", null],
    ["Did anyone mention me on Forager?", "mentions", "forager"],
    ["Tell me about Forager", "project_status", "forager"],
  ] as const)("%s is a question about %s", (text, topic, projectId) => {
    expect(ruleQuestion(ctx(text))).toEqual({ asked: text, topic, projectId });
  });

  it("CQ2 a project the asker is not in is never named: their own work, on all their projects", () => {
    expect(ruleQuestion(ctx("My tasks on Store Insights?"))).toEqual({ asked: "My tasks on Store Insights?", topic: "my_work", projectId: null });
  });

  it("CQ16 what is new with a person is updates on all their projects (no filter by person yet)", () => {
    expect(ruleQuestion(ctx("What's new with Kyle?"))).toEqual({ asked: "What's new with Kyle?", topic: "updates", projectId: null });
  });

  it.each(["Hi", "hello", "Thanks!", "ok", "Okay, thanks", "Good morning, Atlas!", "Thank you so much", "Morning", "wha gwaan"])("CQ12 %s is small talk, answered without a model", (text) => {
    expect(ruleQuestion(ctx(text))).toEqual({ asked: text, topic: "small_talk", projectId: null });
  });

  it.each([
    ["CQ13 a greeting with an update", "Morning! Finished #145."],
    ["thanks with an update", "Thanks, #145 is done."],
    ["a statement about their work", "I'm working on #145"],
  ])("not small talk, not a question: %s", (_, text) => {
    expect(ruleQuestion(ctx(text))).toBeNull();
  });

  it("a greeting before a question is the question", () => {
    expect(ruleQuestion(ctx("Hi Atlas, what needs me?"))).toEqual({ asked: "Hi Atlas, what needs me?", topic: "needs_me", projectId: null });
  });

  it.each(["What updates need my review?", "Which updates do I need to approve?", "Any updates waiting for me?", "What needs me today?", "What needs me to review it today?"])(
    "QA1 %s is still needs me: updates leaves what waits for their review or OK",
    (text) => {
      expect(ruleQuestion(ctx(text))?.topic).toBe("needs_me");
    },
  );

  it.each([
    ["Who has mentioned me?", "mentions"],
    ["Was I mentioned on Forager?", "mentions"],
    ["Any mentions?", "mentions"],
    ["Has anyone named me?", "mentions"],
    // A question about another person is not in this plan (section 18): never answered as the asker's mentions
    ["Did Kemar mention the vendor?", "other"],
  ] as const)("mentions only about the asker: %s is %s", (text, topic) => {
    expect(ruleQuestion(ctx(text))?.topic).toBe(topic);
  });

  it.each(["hithanks", "okthanks", "hi thanksatlas"])("CQ12 words run together are not small talk: %s", (text) => {
    expect(ruleQuestion(ctx(text))?.topic).not.toBe("small_talk");
  });

  it("the new topics go before needs me, whose 'today' would take them; mentions before blocked", () => {
    expect(topicOf("what's due today")).toBe("due");
    expect(topicOf("anything new today")).toBe("updates");
    expect(topicOf("what am i working on today")).toBe("my_work");
    expect(topicOf("did anyone mention me as blocked")).toBe("mentions");
    expect(topicOf("is my work blocked")).toBe("blocked");
  });
});

describe("section 18: the new topics take part in follow-ups (section 16)", () => {
  const turn = (text: string, asked: { topic: string; projectId: string | null } | null, minutesAgo = 5) => ({
    captureId: `c-${text}`,
    at: new Date(Date.now() - minutesAgo * 60_000),
    text,
    asked,
    openItems: [],
  });
  it("'and on GQ?' after 'What am I working on?' is my work on GQ", () => {
    expect(ruleQuestion({ ...ctx("and on GQ?"), earlier: [turn("What am I working on?", { topic: "my_work", projectId: null })] })).toEqual({ asked: "and on GQ?", topic: "my_work", projectId: "gq" });
  });
  it("small talk in between changes nothing: 'Thanks!' does not take the follow-up", () => {
    const earlier = [turn("What's due this week?", { topic: "due", projectId: null }), turn("Thanks!", { topic: "small_talk", projectId: null })];
    expect(ruleQuestion({ ...ctx("what about Forager?"), earlier })).toEqual({ asked: "what about Forager?", topic: "due", projectId: "forager" });
  });
  it("CQ14 'And GQ?' ten minutes after 'What's blocked?' is blocked on GQ", () => {
    expect(ruleQuestion({ ...ctx("And GQ?"), earlier: [turn("What's blocked?", { topic: "blocked", projectId: null }, 10)] })).toEqual({ asked: "And GQ?", topic: "blocked", projectId: "gq" });
  });
  it("CQ15 as section 16 built it: the conversation is the context, not the clock or an update in between", () => {
    const later = [turn("What's blocked?", { topic: "blocked", projectId: null }, 60)];
    expect(ruleQuestion({ ...ctx("And GQ?"), earlier: later })?.topic).toBe("blocked");
    const afterUpdate = [turn("What's blocked?", { topic: "blocked", projectId: null }, 20), turn("#145 is done.", null, 10)];
    expect(ruleQuestion({ ...ctx("And GQ?"), earlier: afterUpdate })?.topic).toBe("blocked");
    // In a conversation with no question before it, it is unclear (CV9), never a guess
    expect(ruleQuestion(ctx("And GQ?"))?.topic).toBe("unclear");
  });
});

describe("CQ9, CQ10: whose name the words say (decision CD29)", () => {
  it("a full name always counts, in any case; a first name only where nobody else on the project has it", () => {
    expect(namesPerson("waiting on Kemar for the store feed", "Kemar Brown", false)).toBe(true);
    expect(namesPerson("waiting on Kemar for the store feed", "Kemar Brown", true)).toBe(false);
    expect(namesPerson("waiting on kemar brown for the feed", "Kemar Brown", true)).toBe(true);
    expect(namesPerson("Kemar's runbook is done", "Kemar Brown", false)).toBe(true);
  });
  it("a first name inside another word, or not written as a name, does not count", () => {
    expect(namesPerson("Kemarbrook is the vendor", "Kemar Brown", false)).toBe(false);
    expect(namesPerson("the andre feed", "Andre Mitchell", false)).toBe(false);
  });
});

describe("suggested follow-ups by topic (section 17)", () => {
  it("each topic suggests its own; one DPM no longer knows gets other's", () => {
    expect(suggestionsAfter("needs_me")).toEqual(["What's blocked?", "How are my projects doing?"]);
    expect(suggestionsAfter("blocked")).toEqual(["What needs me today?"]);
    expect(suggestionsAfter("retired_topic")).toEqual(["What am I working on?", "What needs me today?"]);
  });

  it("section 18: the new topics suggest the asks people try next", () => {
    expect(suggestionsAfter("my_work")).toEqual(["What's due this week?", "What needs me today?"]);
    expect(suggestionsAfter("due")).toEqual(["What am I working on?", "What's blocked?"]);
    expect(suggestionsAfter("updates")).toEqual(["Who has mentioned me?", "What needs me today?"]);
    expect(suggestionsAfter("mentions")).toEqual(["Any updates?", "What needs me today?"]);
    expect(suggestionsAfter("small_talk")).toEqual(["What am I working on?", "What needs me today?"]);
    expect(suggestionsAfter("project_status")).toEqual(["What's blocked?", "What's due this week?"]);
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
  it("CQ13 small talk only when the whole message is: a greeting with an update asks nothing", () => {
    const hello = { asked: "Morning!", topic: "small_talk", projectId: null };
    expect(checkQuestion(hello, ctx("Morning! Finished #145."))).toBeNull();
    expect(checkQuestion({ ...hello, asked: "Hi" }, ctx("Hi, what's blocked?"))).toBeNull();
    expect(checkQuestion(hello, ctx("Morning!"))).toEqual({ asked: "Morning!", topic: "small_talk", projectId: null });
  });
});

describe("CV8, CQ14: a follow-up keeps the words of the questions it follows", () => {
  const turn = (text: string, topic: string | null) => ({ captureId: `c-${text}`, at: new Date(), text, asked: topic ? { topic, projectId: null } : null, openItems: [] });
  const earlier = [turn("What's due tomorrow?", "due"), turn("Thanks!", "small_talk"), turn("#145 is done.", null), turn("and on Forager?", "due")];
  it("newest first, back while the topic holds; small talk and updates in between are skipped", () => {
    expect(checkQuestion({ asked: "and on GQ?", topic: "due", projectId: "gq" }, { ...ctx("and on GQ?"), earlier })).toEqual({
      asked: "and on GQ?",
      topic: "due",
      projectId: "gq",
      follows: ["and on Forager?", "What's due tomorrow?"],
    });
  });
  it("the run stops at a question on another topic", () => {
    const blockedFirst = [turn("When's the next milestone?", "due"), turn("What's blocked?", "blocked")];
    expect(checkQuestion({ asked: "and on GQ?", topic: "blocked", projectId: "gq" }, { ...ctx("and on GQ?"), earlier: blockedFirst })?.follows).toEqual(["What's blocked?"]);
    expect(checkQuestion({ asked: "and on GQ?", topic: "due", projectId: "gq" }, { ...ctx("and on GQ?"), earlier: blockedFirst })?.follows).toBeUndefined();
  });
  it("a whole question of its own follows nothing", () => {
    expect(checkQuestion({ asked: "What's due on GQ?", topic: "due", projectId: "gq" }, { ...ctx("What's due on GQ?"), earlier })?.follows).toBeUndefined();
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
