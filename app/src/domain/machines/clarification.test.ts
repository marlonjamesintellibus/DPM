// M21 (conversational plan, section 6): every arrow, its guards, and the model check's three fixes: asked
// only in the author's own chat, only with 2 or 3 options, and a question about a command closes on its timer.
// Wave 4 (CD50): a question whose words fit 2 or 3 projects or people is asked the same way, and closes as a
// command's does.
import { describe, expect, it } from "vitest";
import {
  applyClarificationEvent,
  CLARIFICATION_STATES,
  clarificationExpired,
  clarificationMachine,
  clarifyOutcomeText,
  clarifyQuestion,
  draftClarification,
  isOwnChat,
  optionGoneText,
  readTypedAnswer,
  type ClarificationEvent,
  type ClarificationRecord,
  type ClarificationState,
} from "./clarification";

const ASKED = new Date("2026-10-20T14:10:00Z");
const later = (minutes: number) => new Date(ASKED.getTime() + minutes * 60_000);

const FEED = [
  { id: "wi-151", label: "#151 Store sales feed access", projectId: "forager" },
  { id: "wi-152", label: "#152 Store feed connector", projectId: "forager" },
];

const at = (state: ClarificationState, fields: Partial<ClarificationRecord> = {}): ClarificationRecord => ({
  ...draftClarification({
    id: "clr-1",
    captureId: "cap-1",
    authorId: "kemar",
    about: "record",
    extractionId: "cap-1-1",
    command: null,
    quote: "Worked on the store feed today",
    options: FEED,
    createdAt: ASKED,
  }),
  state,
  ...fields,
});

const base = { actorId: "kemar", now: later(5), ownChat: true, allowed: true };

/** CD50, PP2: "What is Kemar working on?" when Alicia shares a project with two Kemars. */
const QUESTION: Partial<ClarificationRecord> = {
  about: "question",
  authorId: "alicia",
  extractionId: null,
  question: { asked: { asked: "What is Kemar working on?", topic: "people", projectId: null }, fits: "person" },
  quote: "What is Kemar working on?",
  options: [
    { id: "kemar", label: "Kemar Brown", projectId: null },
    { id: "kemar-s", label: "Kemar Smith", projectId: null },
  ],
};

describe("clarification arrows", () => {
  const rows: [ClarificationState, ClarificationEvent, Partial<ClarificationRecord>, Partial<typeof base>, ClarificationState][] = [
    ["none", { type: "ASK" }, {}, {}, "asked"],
    ["asked", { type: "ANSWER", option: "wi-152" }, {}, {}, "resolved"],
    ["asked", { type: "REVIEW_OPENED" }, {}, {}, "handed_to_review"],
    ["asked", { type: "EXPIRE" }, {}, { now: later(120) }, "handed_to_review"],
    ["asked", { type: "EXPIRE" }, { about: "line", extractionId: null, command: { answerCaptureId: "cap-0", act: "approve", reason: null } }, { now: later(120) }, "closed"],
    // CD50: a question has no review card either
    ["asked", { type: "EXPIRE" }, QUESTION, { now: later(120) }, "closed"],
    ["asked", { type: "CLOSE" }, {}, {}, "closed"],
  ];
  it.each(rows)("%s --%o--> (%o, %o) %s", (from, event, fields, ctx, to) => {
    expect(applyClarificationEvent(at(from, fields), event, { ...base, ...ctx }).record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(clarificationMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([f, e, , , t]) => `${f} ${e.type} ${t}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });

  it("only drawn arrows: every other event from every state is refused and changes nothing (rule 6: once answered, a tap changes nothing)", () => {
    const drawn = new Set(clarificationMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on}`)));
    const events: ClarificationEvent[] = [{ type: "ASK" }, { type: "ANSWER", option: "wi-151" }, { type: "REVIEW_OPENED" }, { type: "EXPIRE" }, { type: "CLOSE" }];
    for (const state of CLARIFICATION_STATES) {
      for (const event of events.filter((e) => !drawn.has(`${state} ${e.type}`))) {
        const r = applyClarificationEvent(at(state), event, { ...base, now: later(600) });
        expect(r.outcome.ok || r.outcome.reason).toBe(`no arrow from ${state} on ${event.type}`);
        expect(r.record).toEqual(at(state));
      }
    }
    // Planted bugs reanswer and tapAfterReview: nothing leaves resolved, handed_to_review or closed
    expect(CLARIFICATION_STATES.filter((s) => [...drawn].some((a) => a.startsWith(`${s} `)))).toEqual(["none", "asked"]);
  });
});

describe("guards", () => {
  it("AskIn own: never asked outside the author's own chat (rules 3 and 8)", () => {
    expect(applyClarificationEvent(at("none"), { type: "ASK" }, { ...base, ownChat: false }).outcome).toMatchObject({ ok: false, reason: "asked only in the author's own chat" });
    expect(applyClarificationEvent(at("none"), { type: "ASK" }, { ...base, ownChat: undefined }).outcome.ok).toBe(false);
    // The Atlas app's direct chat is the conversation's atlasChatId "dm"; any other Atlas chat (phase I's groups) is not
    expect([isOwnChat("app", null), isOwnChat("atlas", "dm"), isOwnChat("atlas", "grp-forager"), isOwnChat("atlas", null), isOwnChat("group", "dm")]).toEqual([true, true, false, false, false]);
  });

  it("ProjectCap: asked in the chat only with 2 or 3 options; one, or four, stay with the review card", () => {
    const four = [...FEED, { id: "wi-145", label: "#145 Google Trends connector", projectId: "forager" }, { id: "wi-147", label: "#147 Trend scoring model", projectId: "forager" }];
    expect(applyClarificationEvent(at("none", { options: four.slice(0, 3) }), { type: "ASK" }, base).record.state).toBe("asked");
    for (const options of [four, FEED.slice(0, 1), []]) {
      expect(applyClarificationEvent(at("none", { options }), { type: "ASK" }, base).outcome).toMatchObject({ ok: false, reason: "asked in the chat only with 2 or 3 options" });
    }
  });

  it("ANSWER takes only one of its options, from the author, while it is still allowed (CL5, rule 4)", () => {
    expect(applyClarificationEvent(at("asked"), { type: "ANSWER", option: "wi-160" }, base).outcome).toMatchObject({ ok: false, reason: "that is not one of the options" });
    expect(applyClarificationEvent(at("asked"), { type: "ANSWER", option: "wi-152" }, { ...base, actorId: "alicia" }).outcome).toMatchObject({ ok: false, reason: "only the person who sent the message can answer" });
    const gone = applyClarificationEvent(at("asked"), { type: "ANSWER", option: "wi-152" }, { ...base, allowed: false });
    expect(gone.outcome).toMatchObject({ ok: false, reason: "you can't choose that one any more" });
    expect(gone.record.state).toBe("asked"); // the others still work
    const r = applyClarificationEvent(at("asked"), { type: "ANSWER", option: "wi-152", answeredBy: "cap-2" }, base).record;
    expect(r).toMatchObject({ state: "resolved", chosen: "wi-152", answeredBy: "cap-2", decidedAt: later(5) });
  });

  it("the timer waits 2 hours (CD2); a line has no review card, so it closes (the model check's fix)", () => {
    expect(applyClarificationEvent(at("asked"), { type: "EXPIRE" }, { ...base, now: later(119) }).outcome).toMatchObject({ ok: false, reason: "a question stays open 2 hours" });
    expect(clarificationExpired(at("asked"), later(120))).toBe(true);
    expect(clarificationExpired(at("resolved"), later(600))).toBe(false);
    const line = at("asked", { about: "line", command: { answerCaptureId: "cap-0", act: "approve", reason: null } });
    expect(applyClarificationEvent(line, { type: "EXPIRE" }, { ...base, now: later(120) }).record).toMatchObject({ state: "closed", endedBy: "timer" });
    expect(applyClarificationEvent(at("asked"), { type: "EXPIRE" }, { ...base, now: later(120) }).record).toMatchObject({ state: "handed_to_review", endedBy: "timer" });
  });

  it("CL3: opening the review hands an item's question to it; a line's stays, as no review holds it", () => {
    expect(applyClarificationEvent(at("asked"), { type: "REVIEW_OPENED" }, base).record).toMatchObject({ state: "handed_to_review", endedBy: "review" });
    const line = at("asked", { about: "line" });
    expect(applyClarificationEvent(line, { type: "REVIEW_OPENED" }, base).outcome).toMatchObject({ ok: false, reason: "a reply that decides a line has no review card" });
  });

  it("CD50: a question is answered only by its asker, with an option still theirs to ask about; no review takes it, and its timer closes it", () => {
    const q = at("asked", QUESTION);
    expect(applyClarificationEvent(q, { type: "ANSWER", option: "kemar" }, { ...base, actorId: "alicia" }).record).toMatchObject({ state: "resolved", chosen: "kemar" });
    expect(applyClarificationEvent(q, { type: "ANSWER", option: "kemar" }, base).outcome).toMatchObject({ ok: false, reason: "only the person who sent the message can answer" });
    expect(applyClarificationEvent(q, { type: "ANSWER", option: "kemar-s" }, { ...base, actorId: "alicia", allowed: false }).record.state).toBe("asked");
    expect(applyClarificationEvent(q, { type: "REVIEW_OPENED" }, { ...base, actorId: "alicia" }).outcome).toMatchObject({ ok: false, reason: "a question has no review card" });
    expect(applyClarificationEvent(q, { type: "EXPIRE" }, { ...base, now: later(119) }).outcome.ok).toBe(false);
    expect(applyClarificationEvent(q, { type: "EXPIRE" }, { ...base, now: later(120) }).record).toMatchObject({ state: "closed", endedBy: "timer" });
    // Rules 3 and 8 and ProjectCap hold for a question as for an item
    expect(applyClarificationEvent(at("none", QUESTION), { type: "ASK" }, { ...base, ownChat: false }).outcome.ok).toBe(false);
    expect(applyClarificationEvent(at("none", { ...QUESTION, options: QUESTION.options!.slice(0, 1) }), { type: "ASK" }, base).outcome.ok).toBe(false);
  });

  it("CL6: the capture discarded or expired closes it; so does a correction withdrawing its item (CV10)", () => {
    expect(applyClarificationEvent(at("asked"), { type: "CLOSE" }, base).record).toMatchObject({ state: "closed", endedBy: "capture" });
    expect(applyClarificationEvent(at("asked"), { type: "CLOSE", because: "corrected" }, base).record).toMatchObject({ state: "closed", endedBy: "corrected" });
  });
});

describe("what the chat says", () => {
  it("asks in plain words, with only its options", () => {
    expect(clarifyQuestion(at("asked"))).toBe('For "Worked on the store feed today", do you mean #151 Store sales feed access or #152 Store feed connector?');
    expect(clarifyQuestion(at("asked", { about: "project", quote: "Waiting on the sign-off.", options: [{ id: "forager", label: "Forager 2.0", projectId: "forager" }, { id: "gq", label: "GQ & Academy", projectId: "gq" }, { id: "insights", label: "Store Insights", projectId: "insights" }] }))).toBe(
      'Which project is "Waiting on the sign-off" for: Forager 2.0, GQ & Academy or Store Insights?',
    );
    expect(clarifyQuestion(at("asked", { about: "line", options: [{ id: "1", label: "Kemar raised a risk: A", projectId: "forager" }, { id: "2", label: "Kemar raised a risk: B", projectId: "forager" }] }))).toBe('Did you mean "Kemar raised a risk: A" or "Kemar raised a risk: B"?');
    // CD50: the question is on screen above it, so only which one is asked
    expect(clarifyQuestion(at("asked", QUESTION))).toBe("Who do you mean: Kemar Brown or Kemar Smith?");
    const ex5 = { ...QUESTION, question: { asked: { asked: "Explain Insights", topic: "explain_project" as const, projectId: null }, fits: "project" as const }, options: [{ id: "forager", label: "Forager 2.0", projectId: null }, { id: "insights", label: "Store Insights", projectId: null }] };
    expect(clarifyQuestion(at("asked", ex5))).toBe("Which project do you mean: Forager 2.0 or Store Insights?");
  });

  it("says how it ended", () => {
    expect(clarifyOutcomeText(at("resolved"), "#152 Store feed connector")).toBe("Got it: #152 Store feed connector. It's in your review, waiting for your OK.");
    expect(clarifyOutcomeText(at("resolved", { about: "line" }), "Kemar raised a risk: A")).toBe('Got it: "Kemar raised a risk: A".');
    expect(clarifyOutcomeText(at("resolved"), null)).toBe("Got it. It's in your review, waiting for your OK.");
    expect(clarifyOutcomeText(at("handed_to_review", { endedBy: "review" }), null)).toBe("Chosen in review.");
    expect(clarifyOutcomeText(at("handed_to_review", { endedBy: "timer" }), null)).toBe("I left this for your review: choose it there.");
    expect(clarifyOutcomeText(at("closed", { about: "line", endedBy: "timer" }), null)).toBe("Nothing was done; ask again.");
    expect(clarifyOutcomeText(at("closed", { endedBy: "capture" }), null)).toBe("Closed with the update.");
    expect(clarifyOutcomeText(at("closed", { endedBy: "corrected" }), null)).toBe("You corrected this in a later message.");
    expect(clarifyOutcomeText(at("asked"), null)).toBeNull();
    // CD50: a question's answer follows its "Got it"; its timer closes it quietly
    expect(clarifyOutcomeText(at("resolved", QUESTION), "Kemar Smith")).toBe("Got it: Kemar Smith.");
    expect(clarifyOutcomeText(at("resolved", QUESTION), null)).toBe("Got it.");
    expect(clarifyOutcomeText(at("closed", { ...QUESTION, endedBy: "timer" }), null)).toBe("Nothing was chosen; ask me again.");
  });

  it("CL5: a refused option points to the review only when there is one; a line's question has none", () => {
    expect(optionGoneText("record")).toBe("You can't choose that one any more. Pick another, or choose it in the review.");
    expect(optionGoneText("project")).toBe("You can't choose that one any more. Pick another, or choose it in the review.");
    expect(optionGoneText("line")).toBe("You can't choose that one any more. Pick another, or ask me again.");
    expect(optionGoneText("question")).toBe("You can't choose that one any more. Pick another, or ask me again.");
  });
});

describe("a typed answer is read against the options only (CL2)", () => {
  const projects = [
    { id: "forager", label: "Forager 2.0", projectId: "forager" },
    { id: "insights", label: "Store Insights", projectId: "insights" },
  ];
  it.each([
    ["the connector one", "wi-152"],
    ["#152", "wi-152"],
    ["I meant the sales feed access", "wi-151"],
    ["the second one", "wi-152"],
    ["first", "wi-151"],
    ["Last one", "wi-152"],
  ])("%s means %s", (text, id) => {
    expect(readTypedAnswer(text, FEED)).toBe(id);
  });

  it.each([
    ["the store feed", "fits both"],
    ["the monitoring one", "fits none"],
    ["Finished #152 and started on the trend model", "too long: an update"],
    ["#152. Also the trend model slips", "two sentences: an update"],
    ["", "nothing"],
    ["the fourth one", "no fourth option"],
  ])("%s is not an answer (%s)", (text) => {
    expect(readTypedAnswer(text, FEED)).toBeNull();
  });

  it("CD50: a person by their full name or surname; a first name both have is no answer", () => {
    const kemars = QUESTION.options!;
    expect(readTypedAnswer("Kemar Smith", kemars)).toBe("kemar-s");
    expect(readTypedAnswer("smith", kemars)).toBe("kemar-s");
    expect(readTypedAnswer("the first one", kemars)).toBe("kemar");
    expect(readTypedAnswer("Kemar", kemars)).toBeNull();
  });

  it("a project by its name or an alias", () => {
    expect(readTypedAnswer("Store Insights", projects)).toBe("insights");
    expect(readTypedAnswer("sprouts", projects, { insights: ["Sprouts Store Insights"] })).toBe("insights");
    expect(readTypedAnswer("forager", projects)).toBe("forager");
  });
});
