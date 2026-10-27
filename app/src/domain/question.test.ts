// Section 15: what a message asks, as the rule reads it without a model (QA4, QA8), and the checks on
// what Atlas says was asked (QA3, QA5, QA6). The capture's `answered` state is in capture.test.ts terms.
import { describe, expect, it } from "vitest";
import type { CandidateProject } from "./atlas-checks/types";
import { applyCaptureEvent, type CaptureRecord } from "./machines/capture";
import { checkQuestion, ruleQuestion, topicOf } from "./question";
import { suggestionsAfter } from "./topics";
import { namesPerson } from "./topics/mentions";
import { aboutAsker, ownedMatches, ownedPhrase, peopleAsks, whoIsMeant } from "./topics/people";
import { GREETING } from "./topics/small-talk";
import { whyAsks, whyField, whyWords } from "./topics/why";

const project = (id: string, name: string, aliases: string[] = []): CandidateProject => ({ id, name, aliases, role: "member", records: [], people: [], braid: [] });
const PROJECTS = [project("forager", "Forager 2.0", ["Forager"]), project("gq", "GQ & Academy", ["GQ", "Academy"])];
const ctx = (text: string) => ({ text, projects: PROJECTS });

describe("the rule, without a model (QA8)", () => {
  it.each([
    ["What needs me to review it today?", "needs_me", null],
    ["What's blocked on Forager?", "blocked", "forager"],
    ["Is GQ & Academy on track?", "project_status", "gq"],
    ["how is forager doing", "project_status", "forager"],
    ["What did Andre say about pricing?", "people", null],
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
    // Phase H, PP8: what another person said is never answered, and never as the asker's mentions
    ["Did Kemar mention the vendor?", "people"],
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

describe("phase R: Jamaican English and Patois by the rule", () => {
  it.each([
    ["JA6", "Weh mi fi do today?", "needs_me", null],
    ["JA6", "Weh mi fi do?", "needs_me", null],
    ["", "Wah mi haffi approve?", "needs_me", null],
    ["", "Wah a wait pon mi?", "needs_me", null],
    ["", "Wah mi a work pon?", "my_work", null],
    ["", "Wah deh pon mi plate?", "my_work", null],
    ["", "Wah due dis week?", "due", null],
    ["", "Wen di nex milestone pon Forager?", "due", "forager"],
    ["", "Anyting block pon Forager?", "blocked", "forager"],
    ["", "A wah a hold up di feed?", "blocked", null],
    ["", "Wha gwaan wid GQ?", "updates", "gq"],
    ["", "Anyting new?", "updates", null],
    ["", "Anybody mention mi?", "mentions", null],
    ["", "Who call mi name pon Forager?", "mentions", "forager"],
    ["", "How Forager a go?", "project_status", "forager"],
    ["", "Forager pon track?", "project_status", "forager"],
    ["", "Tell mi bout GQ", "project_status", "gq"],
  ] as const)("%s %s is a question about %s", (_, text, topic, projectId) => {
    expect(ruleQuestion(ctx(text))).toEqual({ asked: text, topic, projectId });
  });

  it.each(["Wha gwaan?", "Wha gwaan Atlas", "wah gwan", "Yow!", "Mawnin", "Good mawnin, Atlas", "Tank yuh", "Bless up", "Respect, Atlas", "Aright"])(
    "JA5 %s is small talk, answered without a model",
    (text) => {
      expect(ruleQuestion(ctx(text))).toEqual({ asked: text, topic: "small_talk", projectId: null });
    },
  );

  // JA1 to JA3: negation and tense are statements about work, never questions, so they go to the model as updates
  it.each([
    ["JA1 negation", "Di access nuh come yet"],
    ["JA1 negation", "Kyle neva send it yet, so #151 still block."],
    ["JA2 done", "Mi done wid #208"],
    ["JA2 soon done", "mi soon done wid #208"],
    ["JA3 future", "Him a go send it"],
    ["JA3 future", "Kyle seh him a go send it likkle more"],
    ["work now", "Mi a work pon #145"],
    ["CQ13 a greeting with an update", "Wha gwaan, mi done wid #208."],
    ["CQ13 a greeting with an update", "Mawnin! Mi done wid #208."],
    ["JA4 code-switching", "Finished the TikTok ingest, but di store feed still nuh come through."],
  ])("not a question: %s, %s", (_, text) => {
    expect(ruleQuestion(ctx(text))).toBeNull();
  });

  // CQ13: the "wha" of a greeting is no question word, with or without a comma after it
  it.each(["Wha gwaan mi done wid #208", "Wha gwaan everybody, mi done wid #208.", "Mawnin mi done wid #208", "Yow Atlas mi done wid #208"])(
    "CQ13 a greeting then an update is not a question: %s",
    (text) => {
      expect(ruleQuestion(ctx(text))).toBeNull();
    },
  );

  it("CQ13 a greeting before a question still lets it ask; 'Wha gwaan wid GQ' asks without a '?'", () => {
    expect(ruleQuestion(ctx("Mawnin wah due dis week"))).toEqual({ asked: "Mawnin wah due dis week", topic: "due", projectId: null });
    expect(ruleQuestion(ctx("Wha gwaan wid GQ"))).toEqual({ asked: "Wha gwaan wid GQ", topic: "updates", projectId: "gq" });
  });

  // "wen", "weh", "anybody" and "unu" start statements too, so they ask only with a "?"
  it.each([
    "Wen Kyle sen di access mi wi start #151",
    "Weh mi lef off yesterday, mi pick it back up today",
    "Anybody can take #152 if dem want",
    "Unu fi check #151",
    "Unu have anyting fi mi",
  ])("a statement that starts like a question is not one: %s", (text) => {
    expect(ruleQuestion(ctx(text))).toBeNull();
  });

  it("with a '?' they ask: 'Unu have anyting fi mi?' is needs me", () => {
    expect(ruleQuestion(ctx("Unu have anyting fi mi?"))).toEqual({ asked: "Unu have anyting fi mi?", topic: "needs_me", projectId: null });
    expect(ruleQuestion(ctx("Anybody mention mi?"))?.topic).toBe("mentions");
  });

  it("updates is 'gwaan wid', never 'happen with': a question about one thing is not the news feed", () => {
    expect(topicOf("what will happen with the budget?")).not.toBe("updates");
    expect(topicOf("wha happen wid #151?")).not.toBe("updates");
    expect(topicOf("wha gwaan wid #151?")).toBe("updates");
  });

  it("mentions is 'call mi name', not 'mi name' alone", () => {
    expect(topicOf("mi name deh pon #151 now")).not.toBe("mentions");
    expect(topicOf("a mi name deh pon #151?")).not.toBe("mentions");
    expect(topicOf("who call mi name?")).toBe("mentions");
  });

  it("JA7 a project name that is also a word names the project only written as a name", () => {
    expect(ruleQuestion(ctx("Wah due fi di academy class tomorrow?"))?.projectId).toBeNull();
    expect(ruleQuestion(ctx("Wah due fi Academy tomorrow?"))?.projectId).toBe("gq");
    // QA8: a question with no capitals at all has no shape to read
    expect(ruleQuestion(ctx("wah due fi academy tomorrow?"))?.projectId).toBe("gq");
    // Next to one of the project's records counts in any case
    const room = { type: "work_item" as const, id: "wi-301", number: "#301", title: "Room booking", ownerId: "kemar", values: {} };
    const withRecord = PROJECTS.map((p) => (p.id === "gq" ? { ...p, records: [room] } : p));
    expect(ruleQuestion({ text: "Wah due pon academy #301?", projects: withRecord })?.projectId).toBe("gq");
  });

  it("JA5 the hello goes to a Patois greeting; thanks gets 'Any time'", () => {
    expect(GREETING.test("wha gwaan?")).toBe(true);
    expect(GREETING.test("mawnin")).toBe(true);
    expect(GREETING.test("tank yuh")).toBe(false);
  });

  it("CQ13 holds for Patois: the checks drop small talk unless the whole message is", () => {
    const hello = { asked: "Wha gwaan", topic: "small_talk", projectId: null };
    expect(checkQuestion(hello, ctx("Wha gwaan, mi done wid #208."))).toBeNull();
    expect(checkQuestion(hello, ctx("Wha gwaan"))).toEqual({ asked: "Wha gwaan", topic: "small_talk", projectId: null });
  });

  it("'Wha gwaan wid ...' asks what is new; what waits on the asker stays needs me (QA1)", () => {
    expect(topicOf("wha gwaan wid di store feed?")).toBe("updates");
    expect(topicOf("wah a wait pon mi?")).toBe("needs_me");
    expect(topicOf("wah wi a wait pon?")).toBe("blocked");
  });

  it("CV8 'wah bout GQ?' follows up like 'what about GQ?'", () => {
    const earlier = [{ captureId: "c0", at: new Date(), text: "Wah mi a work pon?", asked: { topic: "my_work", projectId: null }, openItems: [] }];
    expect(ruleQuestion({ ...ctx("wah bout GQ?"), earlier })).toEqual({ asked: "wah bout GQ?", topic: "my_work", projectId: "gq" });
  });

  it("JA7 a word that is also a name counts only written as a name (CQ9)", () => {
    expect(namesPerson("mi will send it tomorrow", "Will Grant", false)).toBe(false);
    expect(namesPerson("mi a go ask Will bout #151", "Will Grant", false)).toBe(true);
  });
});

describe("CQ9, CQ10: whose name the words say (decision CD29)", () => {
  it("a full name always counts, in any case; a first name only where nobody else on the project has it", () => {
    expect(namesPerson("waiting on Kemar for the store feed", "Kemar Brown", false)).toBe(true);
    expect(namesPerson("waiting on Kemar for the store feed", "Kemar Brown", true)).toBe(false);
    expect(namesPerson("waiting on kemar brown for the feed", "Kemar Brown", true)).toBe(true);
    expect(namesPerson("Kemar's runbook is done", "Kemar Brown", false)).toBe(true);
  });
  it("a first name inside another word does not count", () => {
    expect(namesPerson("Kemarbrook is the vendor", "Kemar Brown", false)).toBe(false);
    expect(namesPerson("#kemar is the channel", "Kemar Brown", false)).toBe(false);
  });
  it("W-D1: a first name counts in lower case, unless it is also an everyday word", () => {
    expect(namesPerson("waiting on kemar for the slides", "Kemar Brown", false)).toBe(true);
    expect(namesPerson("the andre feed", "Andre Mitchell", false)).toBe(true);
    expect(namesPerson("waiting on kemar for the slides", "Kemar Brown", true)).toBe(false); // CQ9 still holds
    expect(namesPerson("mark #145 done", "Mark Reid", false)).toBe(false);
    expect(namesPerson("ask Mark about #145", "Mark Reid", false)).toBe(true);
    expect(namesPerson("mark reid has the slides", "Mark Reid", false)).toBe(true); // a full name, in any case
    expect(namesPerson("still waiting on kyle", "Kyle", false)).toBe(true); // one name: that name alone
    expect(namesPerson("we may slip", "May", false)).toBe(false);
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

describe("phase C: why, its rule and its subject (WY1, WY8)", () => {
  const forager: CandidateProject = {
    ...PROJECTS[0],
    records: [
      { type: "work_item", id: "wi-151", number: "#151", title: "Store sales feed access", ownerId: "kemar", values: {} },
      { type: "work_item", id: "wi-147", number: "#147", title: "Trend scoring model", ownerId: "kemar", values: {} },
      { type: "milestone", id: "ms-trend", title: "Trend model", ownerId: "kemar", values: {} },
      { type: "handover", id: "ho-runbook", title: "Runbook", ownerId: "kemar", values: {} },
    ],
    braid: [
      { id: "br-feed-blocker", kind: "blocker", title: "Store sales feed access", state: "reported" },
      { id: "br-tiktok", kind: "decision", title: "Drop the TikTok scrape", state: "approved" },
    ],
  };
  const projects = [forager, PROJECTS[1]];
  const rule = (text: string) => ruleQuestion({ text, projects });

  it.each([
    ["Why is Forager at risk?", { type: "project", id: "forager", projectId: "forager" }],
    ["What's holding up the trend model?", { type: "milestone", id: "ms-trend", projectId: "forager" }],
    ["Why is the trend scoring model late?", { type: "work_item", id: "wi-147", projectId: "forager" }],
    ["Why was #151 moved to blocked?", { type: "work_item", id: "wi-151", projectId: "forager" }],
    // A work item and its blocker share a title: the record wins
    ["What's holding up store sales feed access?", { type: "work_item", id: "wi-151", projectId: "forager" }],
    // WY1: unless the words say the entry's kind
    ["Why is the store sales feed access blocker still open?", { type: "braid_entry", id: "br-feed-blocker", projectId: "forager" }],
    ["When did we decide to drop the TikTok scrape?", { type: "braid_entry", id: "br-tiktok", projectId: "forager" }],
    ["Wha mek Forager off track?", { type: "project", id: "forager", projectId: "forager" }],
  ] as const)("%s is why, about %o", (text, subject) => {
    expect(rule(text)).toMatchObject({ asked: text, topic: "why", subject });
  });

  it("no subject the words name: none is kept, and a person is never one", () => {
    expect(rule("Why is Kemar late?")).toEqual({ asked: "Why is Kemar late?", topic: "why", projectId: null });
    expect(rule("When did we decide to move the refresh?")).toEqual({ asked: "When did we decide to move the refresh?", topic: "why", projectId: null });
  });

  it("a question that starts with why asks about a change, never for one (QA4 still holds for a request)", () => {
    expect(rule("Why did Alicia set Forager to off track?")?.topic).toBe("why");
    expect(rule("Can you mark #145 done?")).toBeNull();
  });

  it("the Patois hold up stays blocked; other topics keep their words", () => {
    expect(topicOf("A wah a hold up di feed?")).toBe("blocked");
    expect(topicOf("What's blocked on Forager?")).toBe("blocked");
    expect(topicOf("Is Forager on track?")).toBe("project_status");
  });

  it("a why that only ends another question leaves it its own topic", () => {
    expect(topicOf("Who mentioned me and why?")).toBe("mentions");
    expect(topicOf("What's due this week, and why?")).toBe("due");
    expect(topicOf("Why is #151 due this week?")).toBe("why");
    expect(topicOf("Who approved moving the refresh to 6am?")).toBe("why");
  });

  it("WY1: Atlas's subject is kept only when it is in the asker's lists, and only on topic why", () => {
    const check = (subjectId: string, topic = "why") => checkQuestion({ asked: "Why?", topic, projectId: null, subjectId }, { text: "Why?", projects });
    expect(check("wi-151")?.subject).toEqual({ type: "work_item", id: "wi-151", projectId: "forager" });
    expect(check("br-tiktok")?.subject).toEqual({ type: "braid_entry", id: "br-tiktok", projectId: "forager" });
    expect(check("gq")?.subject).toEqual({ type: "project", id: "gq", projectId: "gq" });
    // Another project's record, one that does not exist, a handover step, or another topic: no subject
    for (const id of ["wi-208", "nowhere", "ho-runbook"]) expect(check(id)).not.toHaveProperty("subject");
    expect(check("wi-151", "blocked")).not.toHaveProperty("subject");
  });

  it("suggests what to ask next", () => {
    expect(suggestionsAfter("why")).toEqual(["What's blocked?", "What needs me today?"]);
  });
});

describe("phase C: which of the four answers the words ask for", () => {
  it.each([
    ["Why is Forager at risk?", { type: "project" }, "status"],
    ["Why was Forager set off track?", { type: "project" }, "status"],
    ["What's holding up Forager?", { type: "project" }, "holdup"],
    ["Why is #151 blocked?", { type: "work_item" }, "holdup"],
    ["Why was #145 moved to Friday?", { type: "work_item" }, "changed"],
    ["Why did the trend model slip?", { type: "milestone" }, "changed"],
    ["Why is the trend model late?", { type: "milestone" }, "status"],
    ["Why is the pipeline risk open?", { type: "braid_entry", kind: "risk" }, "changed"],
    ["Why did we drop the scrape?", { type: "braid_entry", kind: "decision" }, "decided"],
    ["When did we decide to drop the TikTok scrape?", null, "decided"],
    ["When did we decide on Forager's pilot?", { type: "project" }, "decided"],
    // WY4: who approved, with no record, is a decision; on a record it is a change
    ["Who approved moving the refresh to 6am?", null, "decided"],
    ["Who approved #145 moving to done?", { type: "work_item" }, "changed"],
  ] as const)("%s: %s", (asked, subject, asks) => {
    expect(whyAsks(asked, subject)).toBe(asks);
  });

  it("CV8, CQ14: a follow-up that says none of the four reads the question it follows", () => {
    expect(whyWords("and on GQ & Academy?", ["What's holding up Forager?"])).toBe("What's holding up Forager?");
    expect(whyWords("and #152?", ["What's holding up #151?", "Why is Forager at risk?"])).toBe("What's holding up #151?");
    expect(whyWords("and why is #152 late?", ["What's holding up #151?"])).toBe("and why is #152 late?");
    expect(whyWords("and #152?")).toBe("and #152?");
  });

  it.each([
    ["Why was #145 moved to Friday?", "date"],
    ["Why did the trend model slip?", "date"],
    ["Why was its due date changed?", "date"],
    ["Why was #145 marked done on Friday?", "state"],
    ["Why was #151 moved to blocked?", "state"],
    ["Why was #152 cancelled?", "state"],
    ["Why did the blocked note on #151 change?", "note"],
    ["Why was the trend model moved?", null],
  ] as const)("WY6: %s is about its %s", (asked, field) => {
    expect(whyField(asked)).toBe(field);
  });
});

describe("phase H: questions about people, by the rule (PP1 to PP8)", () => {
  it.each([
    ["What is Kemar working on?", "people"],
    ["What's Kemar Brown working on?", "people"],
    ["What’s on Jodian’s plate?", "people"],
    ["What is Jodian doing?", "people"],
    ["What are Kemar and Jodian working on?", "people"],
    ["Is Kemar overloaded?", "people"],
    ["How busy is Jodian?", "people"],
    ["What's Kemar's workload?", "people"],
    ["Who owns the store feed?", "people"],
    ["Who is working on #151?", "people"],
    ["Who has #152?", "people"],
    ["Who owns the feed blocker?", "people"],
    ["Whose is the trend model?", "people"],
    ["What did Andre say about pricing?", "people"],
    ["Show me Kemar's updates", "people"],
    // Phase R
    ["Wah Kemar a work pon?", "people"],
    ["Wah deh pon Jodian plate?", "people"],
    ["A who own di store feed?", "people"],
    // The asker's own, and other topics, keep theirs
    ["What am I working on?", "my_work"],
    ["What should I be working on?", "my_work"],
    ["What's on my plate?", "my_work"],
    ["Wah mi a work pon?", "my_work"],
    ["Who has mentioned me?", "mentions"],
    ["What's new with Kyle?", "updates"],
    ["What are today's updates?", "updates"],
    ["Why is Kemar late?", "why"],
    ["What's blocked on Forager?", "blocked"],
    ["Has Kyle sent the feed?", "other"],
  ] as const)("%s is %s", (text, topic) => {
    expect(topicOf(text)).toBe(topic);
  });

  it("the three answers: whose a record is, what someone said (never), or what they have", () => {
    expect(peopleAsks("Who owns the store feed?")).toBe("owner");
    expect(peopleAsks("A who own di store feed?")).toBe("owner");
    expect(peopleAsks("What did Andre say about pricing?")).toBe("said");
    expect(peopleAsks("Did Kemar mention the vendor?")).toBe("said");
    expect(peopleAsks("What is Kemar working on?")).toBe("work");
    expect(peopleAsks("Is Kemar overloaded?")).toBe("work");
  });

  it("PP5: what an owner is asked of, without its article", () => {
    expect(ownedPhrase("Who owns the store feed?")).toBe("store feed");
    expect(ownedPhrase("A who own di store feed?")).toBe("store feed");
    expect(ownedPhrase("Who is working on #151?")).toBe("#151");
    expect(ownedPhrase("Who's the owner of the Trend model")).toBe("trend model");
    expect(ownedPhrase("What is Kemar working on?")).toBeNull();
  });

  it("PP5: a number or the whole title, then the phrase said, then every word of it", () => {
    const things = [
      { title: "Store sales feed access", number: "#151" },
      { title: "Store feed connector", number: "#152" },
      { title: "Trend model", number: null },
      { title: "Trend scoring model", number: "#147" },
    ];
    expect(ownedMatches("#151", things).map((x) => x.title)).toEqual(["Store sales feed access"]);
    expect(ownedMatches("store feed", things).map((x) => x.title)).toEqual(["Store feed connector"]);
    expect(ownedMatches("trend model", things).map((x) => x.title)).toEqual(["Trend model"]);
    expect(ownedMatches("sales feed", things).map((x) => x.title)).toEqual(["Store sales feed access"]);
    expect(ownedMatches("feed", things).map((x) => x.title)).toEqual(["Store sales feed access", "Store feed connector"]);
    expect(ownedMatches("store feed on forager", things).map((x) => x.title)).toEqual(["Store feed connector"]);
    expect(ownedMatches("#999", things)).toEqual([]);
    expect(ownedMatches("pricing", things)).toEqual([]);
  });

  const SHARED = [
    { id: "kemar", name: "Kemar Brown" },
    { id: "jodian", name: "Jodian Taylor" },
    { id: "kyle", name: "Kyle" },
    { id: "mark", name: "Mark Lee" },
  ];

  it("who is meant, by the one rule for names: a full name, a first name in any case, a contact's one name", () => {
    expect(whoIsMeant("What is Kemar working on?", SHARED)).toEqual({ kind: "one", id: "kemar" });
    expect(whoIsMeant("what is kemar brown working on", SHARED)).toEqual({ kind: "one", id: "kemar" });
    expect(whoIsMeant("What's on Jodian's plate?", SHARED)).toEqual({ kind: "one", id: "jodian" });
    expect(whoIsMeant("What is Kyle doing?", SHARED)).toEqual({ kind: "one", id: "kyle" });
    // W-D1: a name that is also a word needs its capital
    expect(whoIsMeant("what will mark be doing", SHARED)).toEqual({ kind: "nobody" });
    expect(whoIsMeant("What is Mark doing?", SHARED)).toEqual({ kind: "one", id: "mark" });
    // The first named, and a full name before a first name
    expect(whoIsMeant("What are Jodian and Kemar working on?", SHARED)).toEqual({ kind: "one", id: "jodian" });
    expect(whoIsMeant("What are Jodian and Kemar Brown working on?", SHARED)).toEqual({ kind: "one", id: "kemar" });
  });

  it("PP1: a name outside the people searched is nobody, the same as a name nobody has", () => {
    expect(whoIsMeant("What is Andre working on?", SHARED)).toEqual({ kind: "nobody" });
    expect(whoIsMeant("What is Zed working on?", SHARED)).toEqual({ kind: "nobody" });
    expect(whoIsMeant("What is she working on?", SHARED)).toEqual({ kind: "nobody" });
  });

  it("PP2: a first name two of them share is unsure, and only they are listed; a full name settles it", () => {
    const two = [...SHARED, { id: "kemar-s", name: "Kemar Smith" }];
    expect(whoIsMeant("What is Kemar working on?", two)).toEqual({ kind: "which", ids: ["kemar", "kemar-s"] });
    expect(whoIsMeant("What is Kemar Smith working on?", two)).toEqual({ kind: "one", id: "kemar-s" });
  });

  it("PP4: the asker by their own name is my_work, through checkQuestion", () => {
    const people = [
      { personId: "kemar", name: "Kemar Brown", role: "member" as const, tie: "Data engineer" },
      { personId: "jodian", name: "Jodian Taylor", role: "member" as const, tie: "Intern" },
    ];
    const projects = [{ ...PROJECTS[0], people }];
    const kemar = { id: "kemar", name: "Kemar Brown" };
    expect(aboutAsker("What is Kemar working on?", kemar, projects)).toBe(true);
    expect(aboutAsker("What is Jodian working on?", kemar, projects)).toBe(false);
    expect(aboutAsker("What did Kemar say?", kemar, projects)).toBe(false);
    const check = (asked: string) => checkQuestion({ asked, topic: "people", projectId: null }, { text: asked, projects, author: kemar })?.topic;
    expect(check("What is Kemar working on?")).toBe("my_work");
    expect(check("What's on Kemar Brown's plate?")).toBe("my_work");
    expect(check("What is Jodian working on?")).toBe("people");
    // Without the author (an older caller), the topic stands
    expect(checkQuestion({ asked: "What is Kemar working on?", topic: "people", projectId: null }, { text: "What is Kemar working on?", projects })?.topic).toBe("people");
  });

  it("suggests what to ask next", () => {
    expect(suggestionsAfter("people")).toEqual(["What's blocked?", "What's due this week?"]);
  });
});
