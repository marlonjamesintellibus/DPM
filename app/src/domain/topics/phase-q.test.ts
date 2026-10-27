// Phase Q: "What is Forager?" as the rule reads it without a model, which of the asker's projects a name
// can mean (EX5), and when the words name something that is none of theirs (EX1). The answers are in
// queries/answer-explain.test.ts.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT } from "../atlas-checks/kemar-note.fixture";
import { checkQuestion, ruleQuestion, topicOf } from "../question";
import { namesSomething, projectFits } from "./explain-project";

const ctx = (text: string) => ({ ...KEMAR_CONTEXT, text });
const PROJECTS = [
  { id: "forager", name: "Forager 2.0", aliases: ["Forager"] },
  { id: "insights", name: "Store Insights", aliases: ["Sprouts Store Insights"] },
  { id: "gq", name: "GQ & Academy", aliases: ["GQ", "Academy"] },
];
const fits = (text: string, projects = PROJECTS) => projectFits(text, projects).map((p) => p.id);

describe("explain_project, without a model", () => {
  it("knows what a new joiner asks", () => {
    for (const said of [
      "What is Forager?",
      "What's GQ?",
      "what is forager 2.0",
      "Explain Store Insights",
      "Can you explain Forager to me?",
      "I'm new on GQ, where do I start?",
      "Where should I start?",
      "What is Forager for?",
      "What does Store Insights do?",
      "Who is Store Insights for?",
      "How do I get started on Forager?",
      "Weh mi fi start pon Forager?",
    ]) {
      expect(topicOf(said), said).toBe("explain_project");
    }
  });

  it("leaves every other topic its words: section 18's 'Tell me about Forager' is still how it stands", () => {
    const stays: [string, string][] = [
      ["Tell me about Forager", "project_status"],
      ["What is due this week?", "due"],
      ["What's new?", "updates"],
      ["What is blocked?", "blocked"],
      ["What's on today?", "needs_me"],
      ["What is holding up #151?", "why"],
      ["Why is Forager at risk?", "why"],
      ["What am I working on?", "my_work"],
      ["Weh mi fi do today?", "needs_me"],
      ["What is #151?", "other"],
      ["What's next?", "other"],
    ];
    for (const [said, topic] of stays) expect(topicOf(said), said).toBe(topic);
  });

  it("leaves the questions it took before the fix as they were on main: needs me, other, a #number", () => {
    const stays: [string, string][] = [
      ["I'm new here, what needs me today?", "needs_me"],
      ["Where should I start today?", "needs_me"],
      ["I'm new to Patois, what does 'weh' mean?", "other"],
      ["Explain #151", "other"],
      ["Where do I start on #151?", "other"],
    ];
    for (const said of [
      "What's wrong?",
      "What's the risk?",
      "What's the latest?",
      "What's pending?",
      "What is overdue?",
      "What's the forecast?",
      "What is the plan?",
      "What's Kemar doing?",
      "What is Kemar waiting for?",
      "What is Kemar up to?",
      "What is the email about?",
      "Explain the forecast",
      "What is finished?",
    ])
      stays.push([said, "other"]);
    for (const [said, topic] of stays) expect(topicOf(said), said).toBe(topic);
    // A project still counts when the words go on to say so
    expect(topicOf("What's this project about?")).toBe("explain_project");
  });

  it("CV8, CQ14: a follow-up that was other still follows the question before it", () => {
    const earlier = [{ captureId: "c1", at: new Date(0), text: "What is Forager?", asked: { topic: "explain_project", projectId: "forager" }, openItems: [] }];
    for (const said of ["What's the forecast?", "What is the plan?"]) {
      expect(checkQuestion({ asked: said, topic: "explain_project", projectId: null }, { ...ctx(said), earlier }), said).toMatchObject({ follows: ["What is Forager?"] });
    }
    // One with a topic of its own follows nothing
    expect(checkQuestion({ asked: "What is GQ?", topic: "explain_project", projectId: "gq" }, { ...ctx("What is GQ?"), earlier })?.follows).toBeUndefined();
  });

  it("a one-sentence ask names the project when its name or alias is said; 'Explain' asks without a '?'", () => {
    expect(ruleQuestion(ctx("What is Forager?"))).toEqual({ asked: "What is Forager?", topic: "explain_project", projectId: "forager" });
    expect(ruleQuestion(ctx("Explain Store Insights"))).toEqual({ asked: "Explain Store Insights", topic: "explain_project", projectId: "insights" });
    expect(ruleQuestion(ctx("I'm new on GQ, where do I start?"))).toEqual({ asked: "I'm new on GQ, where do I start?", topic: "explain_project", projectId: "gq" });
  });

  it("EX1: Atlas naming a project the asker is not in is dropped (QA6)", () => {
    expect(checkQuestion({ asked: "What is Atlas Bank?", topic: "explain_project", projectId: "bank" }, ctx("What is Atlas Bank?"))).toEqual({ asked: "What is Atlas Bank?", topic: "explain_project", projectId: null });
  });
});

describe("which of their projects the words mean (EX5)", () => {
  it("a name or alias in full, else one word of either", () => {
    expect(fits("What is Forager?")).toEqual(["forager"]);
    expect(fits("Explain Insights")).toEqual(["insights"]);
    expect(fits("what's the academy about")).toEqual(["gq"]);
    expect(fits("Tell me about Sprouts")).toEqual(["insights"]);
  });

  it("a word in a message with capitals needs its capital, as a name does (JA7)", () => {
    expect(fits("Where do I start on the store feed?")).toEqual([]);
    expect(fits("What is the academy for, Atlas?")).toEqual([]);
  });

  it("a short or common word is no name, and a version number is not a word", () => {
    expect(fits("What is 2.0?")).toEqual([]);
    expect(fits("Explain the project", [{ id: "x", name: "The Project", aliases: [] }])).toEqual([]);
  });

  it("two fit: both are given, for the asker to choose", () => {
    const shared = [...PROJECTS, { id: "foods", name: "Insights for Foods", aliases: [] }];
    expect(fits("Explain Insights", shared)).toEqual(["insights", "foods"]);
    // A name said in full wins over a word that fits another
    expect(fits("Explain Store Insights", shared)).toEqual(["insights"]);
  });

  it("only the projects given are searched, so another project's name is never matched", () => {
    expect(fits("What is Store Insights?", PROJECTS.filter((p) => p.id !== "insights"))).toEqual([]);
  });
});

describe("whether the words name something (EX1)", () => {
  it("a capitalised word after the first, not I or Atlas", () => {
    expect(namesSomething("What is Atlas Bank?")).toBe(true);
    expect(namesSomething("Explain Store Insights")).toBe(true);
    expect(namesSomething("Where do I start?")).toBe(false);
    expect(namesSomething("I'm new here, Atlas, where do I start?")).toBe(false);
    expect(namesSomething("what is that")).toBe(false);
  });

  it("in any case, where the question puts a project, so a lowercase name counts and a person named elsewhere does not", () => {
    for (const said of ["what is store insights?", "what is gq", "explain forager", "i'm new on gq, where do i start?", "how do i get started on forager", "what’s atlas bank for?"]) {
      expect(namesSomething(said), said).toBe(true);
    }
    for (const said of ["I'm new, Alicia said to ask you where to start", "What's this project about?", "Can you explain it to me?", "Where should I start on it?", "What is Atlas?"]) {
      expect(namesSomething(said), said).toBe(false);
    }
  });

  it("a follow-up names what follows its 'and', unless it asks again", () => {
    expect(namesSomething("and Store Insights?")).toBe(true);
    expect(namesSomething("what about atlas bank")).toBe(true);
    expect(namesSomething("and on GQ?")).toBe(true);
    expect(namesSomething("and where do I start?")).toBe(false);
    expect(namesSomething("and for me?")).toBe(false);
  });
});
