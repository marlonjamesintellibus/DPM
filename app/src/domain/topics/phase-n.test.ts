// Phase N topics, questions for leads and executives: who hasn't updated, what needs my decision, what's at
// risk this week, which projects are off track, and who can pick up some work, as the rule reads them
// without a model, and which day a not_updated question asks about (LD10).
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { ruleQuestion, topicOf } from "../question";
import { suggestionsAfter, topicById } from ".";
import { asksAnotherDay } from "./not-updated";
import { freePhrase } from "./who-free";

const ctx = (text: string) => ({ ...KEMAR_CONTEXT, text });

describe("the rule knows each phase N topic", () => {
  it.each([
    ["Who hasn't updated today?", "not_updated"],
    ["Who hasn’t sent an update?", "not_updated"],
    ["who has not sent their update today", "not_updated"],
    ["Has everyone updated?", "not_updated"],
    ["Who's missing an update?", "not_updated"],
    ["A who nuh update yet?", "not_updated"],
    ["Who hasn't updated so far today?", "not_updated"],
    ["Who hasn't updated on Forager?", "not_updated"],
    ["Who hasn't updated this week?", "not_updated"],
    ["Who's not updated yet?", "not_updated"],
    ["What needs a decision from me?", "my_decisions"],
    ["What decisions are waiting on me?", "my_decisions"],
    ["What's waiting on my approval?", "my_decisions"],
    ["What do I need to decide?", "my_decisions"],
    ["Wah mi haffi decide?", "my_decisions"],
    ["Any of my sign-offs waiting?", "my_decisions"],
    ["What's at risk this week?", "at_risk_week"],
    ["Anything at risk?", "at_risk_week"],
    ["What's slipping?", "at_risk_week"],
    ["Risks this week?", "at_risk_week"],
    ["Wah a risk dis week?", "at_risk_week"],
    ["What's at risk this week on Forager?", "at_risk_week"],
    ["What's slipping on Forager?", "at_risk_week"],
    ["Which projects are off track?", "portfolio"],
    ["Any projects at risk?", "portfolio"],
    ["How are all the projects doing?", "portfolio"],
    ["How's every project doing?", "portfolio"],
    ["Status of every project?", "portfolio"],
    ["How's the portfolio?", "portfolio"],
    ["Who can pick up #151?", "who_free"],
    ["Who could take the store feed?", "who_free"],
    ["Who's free?", "who_free"],
    ["Who has time to cover #152?", "who_free"],
    ["A who can tek #151?", "who_free"],
  ] as const)("%s is %s", (text, topic) => {
    expect(topicOf(text)).toBe(topic);
    expect(ruleQuestion(ctx(text))?.topic).toBe(topic);
  });

  it.each([
    // Each earlier topic keeps its words
    ["What needs me today?", "needs_me"],
    ["What do I need to approve?", "needs_me"],
    ["What updates need my review?", "needs_me"],
    ["Any updates?", "updates"],
    ["Is Forager at risk?", "project_status"],
    ["Is Forager on track?", "project_status"],
    ["How are my projects doing?", "project_status"],
    ["Why is Forager at risk?", "why"],
    ["Why hasn't Jodian updated?", "why"],
    ["When did we decide to drop the TikTok scrape?", "why"],
    ["Who owns the store feed?", "people"],
    ["What is Jodian working on?", "people"],
    ["Who has #152?", "people"],
    ["What's blocked?", "blocked"],
    ["Who has mentioned me?", "mentions"],
    // "All my projects" says where, not what: each topic keeps its words
    ["What's due on all my projects?", "due"],
    ["What's due this week on all our projects?", "due"],
    ["How many things are due on all my projects?", "due"],
    ["What's blocked across all my projects?", "blocked"],
    ["What's blocked on every project?", "blocked"],
    ["Any updates on all my projects?", "updates"],
    // needs_me covers what they need to approve, with updates in review and new blockers
    ["What needs my approval?", "needs_me"],
    ["What needs my sign-off?", "needs_me"],
    // One project's risk is how it stands; a question about the word is no topic
    ["Anything at risk on Forager?", "project_status"],
    ["Is anything at risk?", "project_status"],
    ["What is a risk?", "other"],
    // About a record, not about people missing their update
    ["Who hasn't updated #151?", "other"],
    ["Is #151 not updated?", "other"],
    ["Who didn't update the forecast?", "other"],
    // Whose it is (PP5), not who could take it
    ["Who will work on #151?", "people"],
  ] as const)("not phase N: %s stays %s", (text, topic) => {
    expect(topicOf(text)).toBe(topic);
  });

  it("who_free is DPM's words alone, so Atlas never words a choice of person (PP6)", () => {
    expect(topicById("who_free").worded).toBe(false);
    expect(topicById("not_updated").worded).toBeUndefined();
  });

  it("suggests what to ask next", () => {
    expect(suggestionsAfter("not_updated")).toEqual(["What needs a decision from me?", "What's at risk this week?"]);
    expect(suggestionsAfter("my_decisions")).toEqual(["What's at risk this week?", "What needs me today?"]);
    expect(suggestionsAfter("at_risk_week")).toEqual(["What's blocked?", "What needs a decision from me?"]);
    expect(suggestionsAfter("portfolio")).toEqual(["What's at risk this week?", "What's blocked?"]);
    expect(suggestionsAfter("who_free")).toEqual(["What's due this week?", "What's blocked?"]);
  });
});

describe("who_free: the work asked about", () => {
  it.each([
    ["Who can pick up #151?", "#151"],
    ["Who could take the store feed?", "store feed"],
    ["Who has time to cover #152 on Forager?", "#152 on forager"],
    ["Who can pick it up?", null],
    ["Who's free?", null],
    ["A who can tek di store feed?", "store feed"],
  ] as const)("%s asks about %s", (text, phrase) => {
    expect(freePhrase(text)).toBe(phrase);
  });
});

describe("LD10, CD16: not_updated is today only", () => {
  it.each([
    [["Who hasn't updated today?"], false],
    [["Who hasn't updated?"], false],
    [["Who hasn't updated this Tuesday?"], false],
    [["And last week?", "Who hasn't updated today?"], true],
    [["Who missed yesterday?"], true],
    [["Who hasn't updated on Monday?"], true],
    [["Who hasn't updated this week?"], true],
    // "So far" and "yet" say no day of their own; "lately" and "ever" ask for a history unless today is said
    [["Who hasn't updated so far today?"], false],
    [["Who hasn't updated so far?"], false],
    [["Who hasn't updated yet?"], false],
    [["Who hasn't updated so far this week?"], true],
    [["Who hasn't updated lately?"], true],
    [["Has everyone ever updated?"], true],
    // A follow-up that says no day reads the question it follows (CV8)
    [["and on GQ?", "Who hasn't updated today?"], false],
    [["and on GQ?", "Who hasn't updated yesterday?"], true],
  ] as const)("%j asks about another day: %s", (words, another) => {
    expect(asksAnotherDay(words, "Tuesday")).toBe(another);
  });
});
