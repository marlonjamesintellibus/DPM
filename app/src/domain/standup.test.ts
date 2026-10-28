// Phase J (conversational plan, section 12): what a standup asks, in which order and how many; what typed
// words say; the capture its answers become; and what the taps propose, with their questions as the quotes.
import { describe, expect, it } from "vitest";
import { locateQuoteIn } from "./atlas-checks/checks";
import type { CandidateProject, CheckContext, RawProposal } from "./atlas-checks/types";
import type { StandupStep } from "./machines/standup";
import { answerLabel, atlasProposals, composeText, followUp, isOwnMessage, nextQuestion, questionText, readableLines, readComposed, readTypedReply, shownText, type OpenWork } from "./standup";

const TODAY = "2026-10-20";
const work = (id: string, state: OpenWork["state"], due: string | null, fields: Partial<OpenWork> = {}): OpenWork => ({
  type: state === "milestone" ? "milestone" : "work_item",
  id,
  projectId: "forager",
  label: `#${id.slice(3)} Item ${id.slice(3)}`,
  number: `#${id.slice(3)}`,
  saw: state === "milestone" ? { forecast: due } : { state, forecast: due },
  state,
  due,
  blockedNote: null,
  ...fields,
});
const OPEN = [
  work("wi-152", "to_do", "2026-10-21"),
  work("wi-147", "in_progress", "2026-10-23"),
  work("wi-151", "blocked", "2026-10-22", { blockedNote: "waiting on Kyle (Sprouts IT)" }),
  work("wi-145", "in_progress", "2026-10-21"),
  work("ms-trend", "milestone", "2026-10-20", { label: "Trend model", number: null }),
  work("wi-300", "to_do", "2026-10-30"),
];
/** Two of Kemar's projects as the checks see them, for the corrections the rules read. */
const project = (id: string, name: string, aliases: string[], people: CandidateProject["people"] = []): CandidateProject => ({ id, name, aliases, role: "member", records: [], people, braid: [] });
const PROJECTS = [
  project("forager", "Forager 2.0", ["Forager"], [{ personId: "kyle", name: "Kyle Reid", role: null, tie: "contact" }]),
  project("insights", "Store Insights", ["Sprouts Store Insights"]),
  project("guild", "GQ & Academy", ["GQ"]),
];
const step = (s: ReturnType<typeof nextQuestion>, n: number, answer: StandupStep["answer"] = { tap: "still_going", words: null, by: null }): StandupStep => ({ ...s!, n, askedIn: "cap-1", answer });

describe("the questions (section 12, SU8)", () => {
  it("blocked work first, then In progress by due date, then what is due today or tomorrow, and \"Anything new blocking you?\" last, at most 4", () => {
    const asked: StandupStep[] = [];
    for (let n = 1; ; n++) {
      const next = nextQuestion(OPEN, asked, TODAY, 4);
      if (!next) break;
      asked.push(step(next, n));
    }
    expect(asked.map((s) => [s.kind, s.subject?.id ?? null])).toEqual([
      ["blocked", "wi-151"],
      ["in_progress", "wi-145"],
      ["in_progress", "wi-147"],
      ["new", null],
    ]);
    expect(asked[0].text).toBe("#151 Item 151 is Blocked (waiting on Kyle (Sprouts IT)). Still stuck?");
    expect(asked[1].text).toBe("#145 Item 145 is In progress. Done, still going, or stuck?");
    expect(asked[3].text).toBe("Anything new blocking you?");
  });

  it("with room, work due today or tomorrow is asked about, milestones too; not what is due later", () => {
    const asked: StandupStep[] = [];
    for (let n = 1; ; n++) {
      const next = nextQuestion(OPEN, asked, TODAY, 8);
      if (!next) break;
      asked.push(step(next, n));
    }
    expect(asked.map((s) => s.subject?.id ?? s.kind)).toEqual(["wi-151", "wi-145", "wi-147", "ms-trend", "wi-152", "new"]);
    expect(asked[3].text).toBe("Is Trend model still on for Tue 20 Oct?");
    expect(asked[4].text).toBe("Is #152 Item 152 still on for Wed 21 Oct?");
  });

  it("SU1: no open work asks only \"Anything blocking you?\"", () => {
    expect(nextQuestion([], [], TODAY, 4)).toEqual({ kind: "new", subject: null, text: "Anything blocking you?" });
  });

  it("SU8: the list is rebuilt from the work given now; work gone since is not asked, and nothing is asked twice", () => {
    const first = step(nextQuestion(OPEN, [], TODAY, 4), 1);
    const left = OPEN.filter((w) => w.id !== "wi-145");
    expect(nextQuestion(left, [first], TODAY, 4)?.subject?.id).toBe("wi-147");
    expect(nextQuestion(OPEN, [first], TODAY, 4)?.subject?.id).toBe("wi-145");
  });

  it("section 12: work due today or tomorrow is asked if it is still on; work already late is not", () => {
    // Mon 19 Oct is gone by Tue 20 Oct: "Is #160 still on for Mon 19 Oct?" would ask about a day past
    const late = [work("wi-160", "to_do", "2026-10-19"), work("ms-old", "milestone", "2026-10-16", { label: "Old milestone", number: null })];
    expect(nextQuestion(late, [], TODAY, 4)).toMatchObject({ kind: "new", text: "Anything blocking you?" });
    expect(nextQuestion([...late, work("wi-152", "to_do", "2026-10-21")], [], TODAY, 4)).toMatchObject({ kind: "due", subject: { id: "wi-152" } });
  });

  it("SU3: a question remembers what it showed of its record, for the save to compare with", () => {
    expect(nextQuestion(OPEN, [], TODAY, 4)?.subject?.saw).toEqual({ state: "blocked", forecast: "2026-10-22" });
  });

  it("follow-ups: Stuck asks what it waits on, and No, it moves asks when; neither counts in the 4", () => {
    const s = step(nextQuestion(OPEN.slice(1, 2), [], TODAY, 4), 1);
    expect(followUp(s, { tap: "stuck", words: null, by: null })).toEqual({ kind: "wait", subject: s.subject, text: "What's it waiting on?" });
    expect(followUp(s, { tap: "done", words: null, by: null })).toBeNull();
    const due = { kind: "due" as const, subject: s.subject };
    expect(followUp(due, { tap: "moves", words: null, by: null })).toEqual({ kind: "when", subject: s.subject, text: "When do you now expect it?" });
    const wait = { ...followUp(s, { tap: "stuck", words: null, by: null })!, n: 2, askedIn: null, answer: { tap: null, words: "Kyle", by: "cap-2" } };
    expect(nextQuestion(OPEN, [s, wait], TODAY, 2)?.kind).toBe("new");
    expect(nextQuestion(OPEN, [s, wait], TODAY, 3)?.kind).toBe("blocked");
  });

  it("every question is plain words from the data given", () => {
    expect(questionText("blocked", { label: "#151 Store sales feed access", due: null, blockedNote: null })).toBe("#151 Store sales feed access is Blocked. Still stuck?");
  });
});

describe("typed words (SU4)", () => {
  it("a tap's words, as the whole message, are that tap; the team's own words too", () => {
    expect(readTypedReply("Done!", "in_progress")).toEqual({ act: "answer", answer: { tap: "done", words: null, by: null } });
    expect(readTypedReply("mi done", "in_progress")).toMatchObject({ answer: { tap: "done" } });
    expect(readTypedReply("still working on it", "in_progress")).toMatchObject({ answer: { tap: "still_going" } });
    expect(readTypedReply("blocked", "in_progress")).toMatchObject({ answer: { tap: "stuck" } });
    expect(readTypedReply("no", "blocked")).toMatchObject({ answer: { tap: "moving" } });
    expect(readTypedReply("yes", "blocked")).toMatchObject({ answer: { tap: "still_stuck" } });
    expect(readTypedReply("No, it moves", "due")).toMatchObject({ answer: { tap: "moves" } });
    expect(readTypedReply("nutten", "new")).toMatchObject({ answer: { tap: "nothing" } });
  });

  it("skip and that's all", () => {
    expect(readTypedReply("Skip", "in_progress")).toEqual({ act: "skip" });
    expect(readTypedReply("That's all.", "in_progress")).toEqual({ act: "stop" });
    expect(readTypedReply("that’s it for today", "new")).toEqual({ act: "stop" });
  });

  it("anything else is their own words, read with the question later (SU4)", () => {
    expect(readTypedReply("Not that, but #212 is done", "in_progress")).toEqual({ act: "answer", answer: { tap: null, words: "Not that, but #212 is done", by: null } });
    // A tap word for another kind of question is words here
    expect(readTypedReply("done", "new")).toMatchObject({ answer: { tap: null, words: "done" } });
  });

  it("SU4: their own question or command is read as itself, never as the answer", () => {
    const own = (text: string, openAnswer: CheckContext["openAnswer"] = null) => isOwnMessage({ text, projects: PROJECTS, openAnswer });
    for (const text of ["What am I working on?", "what's due this week", "Undo that", "GQ also means the Guild", "Kyle is Store Insights, not Forager", "Start my standup"]) expect(own(text), text).toBe(true);
    // Phase B's word acts, only when an answer open in the chat offers them
    const offers: CheckContext["openAnswer"] = { captureId: "cap-0", asked: "What needs me?", asOf: "9:41am", lines: [{ line: 1, title: "Risk", detail: null, subject: null, acts: ["approve", "decline"] }] };
    expect(own("Approve the second one", offers)).toBe(true);
    expect(own("Yes, decline it", offers)).toBe(true);
    expect(own("Approve the second one")).toBe(false);
    // Their answers stay answers, about another record too
    for (const text of ["Not that, but #212 is done", "and #212 is done", "Kyle hasn't sent the access yet", "Monday", "Is fine, still going"]) expect(own(text), text).toBe(false);
  });
});

const W151 = { type: "work_item" as const, id: "wi-151", projectId: "forager", label: "#151 Store sales feed access", number: "#151", saw: { state: "in_progress", forecast: "2026-10-22" } };
const W145 = { type: "work_item" as const, id: "wi-145", projectId: "forager", label: "#145 Google Trends connector", number: "#145", saw: { state: "in_progress", forecast: "2026-10-21" } };
const MS = { type: "milestone" as const, id: "ms-trend", projectId: "forager", label: "Trend model", number: null, saw: { forecast: "2026-10-23" } };
const W208 = { type: "work_item" as const, id: "wi-208", projectId: "insights", label: "#208 Weekly sales export", number: "#208", saw: { state: "in_progress", forecast: "2026-10-23" } };
const s = (n: number, kind: StandupStep["kind"], subject: StandupStep["subject"], text: string, answer: StandupStep["answer"]): StandupStep => ({ n, kind, subject, text, askedIn: "cap-1", answer });
const tap = (t: NonNullable<StandupStep["answer"]>["tap"]) => ({ tap: t, words: null, by: null });
const typed = (words: string) => ({ tap: null, words, by: "cap-2" });

describe("the composed capture (composed --> M1, M2)", () => {
  const steps = [
    s(1, "in_progress", W145, "#145 Google Trends connector is In progress. Done, still going, or stuck?", tap("done")),
    s(2, "in_progress", W151, "#151 Store sales feed access is In progress. Done, still going, or stuck?", tap("stuck")),
    s(3, "wait", W151, "What's it waiting on?", typed("Kyle hasn't sent the access yet")),
    s(4, "due", MS, "Is Trend model still on for Fri 23 Oct?", tap("moves")),
    s(5, "when", MS, "When do you now expect it?", typed("Monday")),
    s(6, "new", null, "Anything new blocking you?", null),
  ];
  const composed = composeText("Kemar", steps);

  it("each answered question, then the answer in their name; a skipped one is left out", () => {
    expect(composed.text).toBe(
      [
        "Atlas: #145 Google Trends connector is In progress. Done, still going, or stuck?",
        "Kemar: Done",
        "Atlas: #151 Store sales feed access is In progress. Done, still going, or stuck?",
        "Kemar: Stuck",
        "Atlas: What's it waiting on?",
        "Kemar: Kyle hasn't sent the access yet",
        "Atlas: Is Trend model still on for Fri 23 Oct?",
        "Kemar: No, it moves",
        "Atlas: When do you now expect it?",
        "Kemar: Monday",
      ].join("\n"),
    );
    const line = composed.lines[2];
    expect(composed.text.slice(line.answer.start, line.answer.end)).toBe("Kyle hasn't sent the access yet");
  });

  it("a tap is a proposal at high confidence with its question as the quote; Stuck is Blocked with what it waits on, quoting those words; No, it moves is a forecast from when", () => {
    const read = readComposed(composed);
    expect(read.tapped).toEqual([
      expect.objectContaining({ kind: "update", targetId: "wi-145", projectId: "forager", field: "state", newValue: "done", quote: "#145 Google Trends connector is In progress. Done, still going, or stuck?", confidence: "high", routingReason: { basis: "target", evidence: "#145", label: "#145 Google Trends connector" } }),
      expect.objectContaining({ targetId: "wi-151", field: "state", newValue: "blocked", note: "Kyle hasn't sent the access yet", quote: "Kyle hasn't sent the access yet", confidence: "high" }),
      expect.objectContaining({ targetId: "ms-trend", field: "forecast", newValue: null, quote: "Monday", confidence: "high" }),
    ]);
    // Atlas reads only what it waits on, after the question about it, for a blocker report
    expect(read.typed).toBe("Atlas: #151 Store sales feed access is In progress. Done, still going, or stuck?\nKemar: Stuck\nAtlas: What's it waiting on?\nKemar: Kyle hasn't sent the access yet");
  });

  it("a Stuck with nothing said about what it waits on is Blocked, \"Stuck\", quoting its question", () => {
    const read = readComposed(composeText("Kemar", [steps[1], { ...steps[2], answer: null }]));
    expect(read.tapped).toEqual([expect.objectContaining({ newValue: "blocked", note: "Stuck", quote: steps[1].text })]);
    expect(read.typed).toBeNull();
  });

  it("still going, still stuck, yes and no propose nothing; every answer a tap means Atlas reads nothing", () => {
    const quiet = composeText("Kemar", [s(1, "in_progress", W145, steps[0].text, tap("still_going")), s(2, "new", null, "Anything new blocking you?", tap("nothing"))]);
    expect(readComposed(quiet)).toEqual({ tapped: [], typed: null, quoteIn: [], ownWords: [], saw: {} });
  });

  it("SU3: each tap is compared at save with what its question showed, not with what is there when it is read", () => {
    const read = readComposed(composed);
    expect(read.tapped.map((p) => [p.targetId, p.field, p.shownValue])).toEqual([
      ["wi-145", "state", "in_progress"],
      ["wi-151", "state", "in_progress"],
      ["ms-trend", "forecast", "2026-10-23"],
    ]);
    // A typed answer about the record a question showed: Atlas's change to it is compared the same way
    expect(read.saw).toEqual({ "wi-151": W151.saw, "ms-trend": MS.saw });
    const atlas = atlasProposals(read, [{ kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#151", label: "#151" }, targetId: "wi-151", field: "forecast", newValue: "2026-10-26", quote: "Kyle", confidence: "high", rationale: "" }]);
    expect(atlas).toEqual([expect.objectContaining({ targetId: "wi-151", field: "forecast", shownValue: "2026-10-22" })]);
  });

  it("the Stuck follow-up: Atlas reading Blocked again, or the note DPM's Blocked carries, is dropped; a blocker report is kept (S3)", () => {
    const read = readComposed(composed);
    const update = (field: string, newValue: string): RawProposal => ({ kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#151", label: "#151" }, targetId: "wi-151", field, newValue, quote: "Kyle hasn't sent the access yet", confidence: "high", rationale: "" });
    const blocker: RawProposal = { kind: "braid_new", projectId: "forager", routingReason: { basis: "same_quote", evidence: "Kyle", label: "Same words as #151" }, braidKind: "blocker", braidTitle: "Access from Kyle", quote: "Kyle hasn't sent the access yet", confidence: "high", rationale: "" };
    expect(atlasProposals(read, [update("state", "blocked"), update("blocked_note", "waiting on Kyle"), blocker])).toEqual([blocker]);
  });

  it("P10: a question about a project they have since left is left out with its answer, from what is read and what is shown", () => {
    const left = composeText("Kemar", [steps[0], s(2, "in_progress", W208, "#208 Weekly sales export is In progress. Done, still going, or stuck?", typed("Waiting on the export fix")), s(3, "new", null, "Anything new blocking you?", typed("The GPU quota"))]);
    const readable = readableLines(left, (projectId) => projectId !== "insights");
    const read = readComposed(readable);
    expect(read.typed).toBe("Atlas: Anything new blocking you?\nKemar: The GPU quota");
    expect(read.typed).not.toContain("#208");
    expect(read.ownWords.map((sp) => left.text.slice(sp.start, sp.end))).toEqual(["The GPU quota"]);
    const shown = shownText(readable);
    expect(shown.text).toBe(`Atlas: ${steps[0].text}\nKemar: Done\nAtlas: Anything new blocking you?\nKemar: The GPU quota`);
    // Spans move with the text; one in the line left out has nowhere to show
    const quota = read.ownWords[0];
    expect(shown.text.slice(shown.at(quota)!.start, shown.at(quota)!.end)).toBe("The GPU quota");
    expect(shown.at(left.lines[1].question)).toBeNull();
    expect(shown.at(left.lines[0].question)).toEqual(left.lines[0].question);
    // With every line readable, it is the stored text
    expect(shownText(left).text).toBe(left.text);
  });

  it("SU4: their own words go to Atlas with their question; check 2 finds a quote only in the answers and the questions taps answered", () => {
    const words = composeText("Kemar", [s(1, "in_progress", W145, steps[0].text, typed("Not that, but #212 is done")), s(2, "new", null, "Anything new blocking you?", typed("The GPU quota for #145"))]);
    const read = readComposed(words);
    expect(read.tapped).toEqual([]);
    expect(read.typed).toBe(`Atlas: ${steps[0].text}\nKemar: Not that, but #212 is done\nAtlas: Anything new blocking you?\nKemar: The GPU quota for #145`);
    // The model check's questionAsQuote: the question about #145 is never the quote for an answer about #212
    expect(locateQuoteIn(words.text, "#145 Google Trends connector", read.quoteIn)).toBeNull();
    const at = locateQuoteIn(words.text, "#145", read.quoteIn)!;
    expect(words.text.slice(at.start, at.end)).toBe("#145");
    expect(at.start).toBeGreaterThan(words.text.indexOf("GPU"));
  });

  it("the chat shows a tap's answer, Skipped, or nothing when their words follow as a message", () => {
    expect(answerLabel(tap("moves"))).toBe("No, it moves");
    expect(answerLabel(null)).toBe("Skipped");
    expect(answerLabel(typed("Monday"))).toBeNull();
    expect(answerLabel({ tap: "done", words: null, by: "cap-2" })).toBeNull();
  });
});
