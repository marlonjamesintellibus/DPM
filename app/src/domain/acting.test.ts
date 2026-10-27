// Phase B: what of a reply that decides something is a command (AC6 to AC9), the words the chat says when
// none is, and the rule that reads a reply without a model.
import { describe, expect, it } from "vitest";
import { checkCommands, commandNoteText, ruleCommands } from "./acting";
import type { OpenAnswer } from "./atlas-checks/types";

const risk = { type: "braid_entry" as const, id: "br-risk", projectId: "forager" };
const OPEN: OpenAnswer = {
  captureId: "cap-q",
  asked: "What needs me today?",
  asOf: "2026-10-20T14:20:00.000Z",
  lines: [
    { line: 1, title: "Kemar raised a risk: Trend model may slip to 24 Oct", detail: "Why: risks go on the log only when a PM or Lead approves", subject: risk, acts: ["approve", "decline"] },
    { line: 2, title: "Kemar raised a dependency: Kyle to send the store feed history by 23 Oct", detail: "Why: dependencies go on the log only when a PM or Lead approves", subject: { ...risk, id: "br-dep" }, acts: ["approve", "decline"] },
    { line: 3, title: "Forager 2.0 is set Off track, but the plan says At risk", detail: "Why: a status and the data disagree", subject: { type: "project", id: "forager", projectId: "forager" }, acts: ["give_reason"] },
    { line: 4, title: "#152 Store feed connector", detail: "Forager 2.0: due Tue 27 Oct", subject: { type: "work_item", id: "wi-152", projectId: "forager" }, acts: ["mark_done"] },
  ],
};

describe("checkCommands", () => {
  it("keeps one act on one line that offers it", () => {
    expect(checkCommands([{ act: "approve", lines: [1], reason: null }], OPEN)).toEqual({ kept: [{ act: "approve", line: 1, reason: null }], note: null });
    expect(checkCommands([{ act: "decline", lines: [2], reason: " we track it already " }], OPEN).kept).toEqual([{ act: "decline", line: 2, reason: "we track it already" }]);
  });

  it("nothing said, nothing kept; a record change said in words is an item, never a command", () => {
    expect(checkCommands([], OPEN)).toEqual({ kept: [], note: null });
    expect(checkCommands(null, OPEN)).toEqual({ kept: [], note: null });
    expect(checkCommands([{ act: "mark_done", lines: [4] }], OPEN)).toEqual({ kept: [], note: null });
  });

  it("AC6: no open answer", () => {
    expect(checkCommands([{ act: "approve", lines: [1] }], null)).toEqual({ kept: [], note: { kind: "no_answer" } });
    expect(checkCommands([{ act: "approve", lines: [1] }], { ...OPEN, lines: [] })).toEqual({ kept: [], note: { kind: "no_answer" } });
  });

  it("AC6: the second one of an answer with one line, or no line at all, asks which", () => {
    expect(checkCommands([{ act: "approve", lines: [2] }], { ...OPEN, lines: OPEN.lines.slice(0, 1) })).toEqual({ kept: [], note: { kind: "which", lines: [] } });
    expect(checkCommands([{ act: "approve", lines: [] }], OPEN).note).toEqual({ kind: "which", lines: [] });
  });

  it("AC7: two lines it could mean are never guessed", () => {
    expect(checkCommands([{ act: "approve", lines: [1, 2] }], OPEN)).toEqual({ kept: [], note: { kind: "which", lines: [1, 2] } });
  });

  it("of the lines it could mean, only one offers the act: that one", () => {
    expect(checkCommands([{ act: "approve", lines: [1, 4] }], OPEN).kept).toEqual([{ act: "approve", line: 1, reason: null }]);
    expect(checkCommands([{ act: "give_reason", lines: [1, 2, 3], reason: "The feed is late" }], OPEN).kept).toEqual([{ act: "give_reason", line: 3, reason: "The feed is late" }]);
  });

  it("AC8, CD1: approve all of them is one card per line, once each", () => {
    const all = checkCommands(
      [
        { act: "approve", lines: [1] },
        { act: "approve", lines: [2] },
        { act: "approve", lines: [2] },
      ],
      OPEN,
    );
    expect(all.kept.map((k) => k.line)).toEqual([1, 2]);
  });

  it("rule 10, E96: words that report someone else's decision are never the asker's command", () => {
    expect(checkCommands([{ act: "approve", lines: [1], by: "other" }], OPEN)).toEqual({ kept: [], note: null });
    expect(checkCommands([{ act: "approve", lines: [1], by: "author" }], OPEN).kept).toEqual([{ act: "approve", line: 1, reason: null }]);
  });

  it("P10, lines_now: a line left out because the asker can no longer read it is out of date, and nothing is named", () => {
    const left = { ...OPEN, lines: OPEN.lines.filter((l) => l.line !== 2), gone: [2] };
    expect(checkCommands([{ act: "approve", lines: [2] }], left)).toEqual({ kept: [], note: { kind: "out_of_date" } });
    expect(checkCommands([{ act: "approve", lines: [2] }], { ...OPEN, lines: [], gone: [1, 2, 3, 4] })).toEqual({ kept: [], note: { kind: "out_of_date" } });
    // Words that fit no line still shown may mean one left out, whose words nobody read again
    expect(checkCommands([{ act: "approve", lines: [] }], left).note).toEqual({ kind: "out_of_date" });
    // A line still theirs is kept as before
    expect(checkCommands([{ act: "approve", lines: [1] }], left).kept).toEqual([{ act: "approve", line: 1, reason: null }]);
  });

  it("AC9: a line that does not exist, or a line that offers no such act, is no command", () => {
    expect(checkCommands([{ act: "approve", lines: [9] }], OPEN).kept).toEqual([]);
    expect(checkCommands([{ act: "approve", lines: [4] }], OPEN)).toEqual({ kept: [], note: { kind: "not_offered", act: "approve", line: 4 } });
    expect(checkCommands([{ act: "resolve", lines: [1] }], OPEN).note).toEqual({ kind: "not_offered", act: "resolve", line: 1 });
  });
});

describe("what the chat says when a reply made no card", () => {
  it.each([
    [{ kind: "no_answer" }, [], "There's no answer here to act on yet. Ask me first, for example What needs me today?"],
    [{ kind: "which", lines: [] }, [], "I'm not sure which one you mean. Say it again with its name."],
    [{ kind: "which", lines: [1, 2] }, ["Trend model may slip", "Kyle to send the history"], 'Did you mean "Trend model may slip" or "Kyle to send the history"? Say it again with its name.'],
    [{ kind: "which", lines: [1, 2, 3] }, ["A", "B", "C"], 'Did you mean "A", "B" or "C"? Say it again with its name.'],
    // P10: a line the asker can no longer read is not named; one name left is not a choice
    [{ kind: "which", lines: [1, 2] }, ["A"], "I'm not sure which one you mean. Say it again with its name."],
    [{ kind: "not_offered", act: "approve", line: 4 }, ["#152 Store feed connector"], 'You can\'t approve "#152 Store feed connector" here.'],
    [{ kind: "not_offered", act: "approve", line: 4 }, [], "That answer is out of date. Ask again."],
    [{ kind: "out_of_date" }, [], "That answer is out of date. Ask again."],
  ] as const)("%o", (note, names, text) => {
    expect(commandNoteText(note, names)).toBe(text);
  });
});

describe("the rule, without a model", () => {
  const read = (text: string, open: OpenAnswer | null = OPEN) => ruleCommands({ text, openAnswer: open });

  it("by name: every name word is in the line", () => {
    expect(read("Approve the trend model risk")).toEqual([{ act: "approve", lines: [1], reason: null }]);
    expect(read("Approve the Kyle dependency.")).toEqual([{ act: "approve", lines: [2], reason: null }]);
  });

  it("AC7: a name that fits two lines gives both", () => {
    expect(read("Approve Kemar's one")).toEqual([{ act: "approve", lines: [1, 2], reason: null }]);
    expect(read("Approve the one Kemar raised")).toEqual([{ act: "approve", lines: [1, 2], reason: null }]);
  });

  it("by place, and \"it\" when only one line offers the act", () => {
    expect(read("Decline the second one, we track that slip already")).toEqual([{ act: "decline", lines: [2], reason: "we track that slip already" }]);
    expect(read("Approve the last one")).toEqual([{ act: "approve", lines: [4], reason: null }]);
    expect(read("Approve it")).toEqual([{ act: "approve", lines: [], reason: null }]);
    expect(read("Approve it", { ...OPEN, lines: OPEN.lines.slice(0, 1) })).toEqual([{ act: "approve", lines: [1], reason: null }]);
    expect(read("Reject it because Kyle already sent it", { ...OPEN, lines: OPEN.lines.slice(1, 2) })).toEqual([{ act: "decline", lines: [2], reason: "Kyle already sent it" }]);
  });

  it("AC8: all of them, one per line that offers it", () => {
    expect(read("Approve all of them")).toEqual([
      { act: "approve", lines: [1], reason: null },
      { act: "approve", lines: [2], reason: null },
    ]);
    expect(read("Resolve all of them")).toEqual([{ act: "resolve", lines: [], reason: null }]);
    expect(read("Approve both")).toHaveLength(2);
    expect(read("Approve them all, we agreed this morning")).toEqual([
      { act: "approve", lines: [1], reason: "we agreed this morning" },
      { act: "approve", lines: [2], reason: "we agreed this morning" },
    ]);
  });

  it("AC8: \"all\" or \"both\" inside a name is one named line, never a card per line", () => {
    const allHands = { ...OPEN, lines: [...OPEN.lines, { line: 5, title: "Jodian raised a decision: Move the all-hands to Friday", detail: null, subject: { ...OPEN.lines[0].subject!, id: "br-hands" }, acts: ["approve", "decline"] as const }] };
    expect(read("Approve the all-hands decision", allHands)).toEqual([{ act: "approve", lines: [5], reason: null }]);
    expect(read("Approve both of the Kemar ones")).toEqual([{ act: "approve", lines: [1, 2], reason: null }]);
  });

  it("P10: places count the lines no longer readable too, so the last one is still the last one shown", () => {
    expect(read("Approve the last one", { ...OPEN, lines: OPEN.lines.slice(0, 3), gone: [4] })).toEqual([{ act: "approve", lines: [4], reason: null }]);
  });

  it("with no open answer, still a command, so the chat says there is none", () => {
    expect(read("Approve the trend model risk", null)).toEqual([{ act: "approve", lines: [], reason: null }]);
  });

  it("only a reply that starts with the act, in one sentence: updates stay updates", () => {
    expect(read("Resolved the rate limit issue yesterday.")).toEqual([]);
    expect(read("Alicia approved the trend model risk")).toEqual([]);
    expect(read("Approve the trend risk. Also #145 is done.")).toEqual([]);
    expect(read("What needs me today?")).toEqual([]);
  });
});
