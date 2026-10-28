// Phase G (conversational plan, section 9): the template, the facts check (DR2, DR7), the copy check of a client
// status (DR4, rule 8) and the words that ask for a draft.
import { describe, expect, it } from "vitest";
import { clientCopyProblem, draftKindOf, draftProblem, draftTemplate, plainDraft, type DraftFacts } from "./drafts";

const STANDUP: DraftFacts = {
  kind: "standup",
  heading: "Kemar's standup, Tue 20 Oct",
  sections: [
    { title: "Since yesterday", facts: [{ key: "saved:x-1", text: "#145 Google Trends connector (Forager 2.0): In progress to Done" }], none: "No changes since yesterday." },
    { title: "In progress", facts: [{ key: "work:wi-147", text: "#147 Trend scoring model (Forager 2.0), due Fri 23 Oct" }], none: "Nothing in progress." },
    { title: "Blocked", facts: [], none: "Nothing blocked." },
  ],
  asOf: "2026-10-20T14:10:00.000Z",
};

const CLIENT: DraftFacts = {
  kind: "client",
  heading: "Forager 2.0 for Sprouts: client status, Tue 20 Oct",
  sections: [
    {
      title: "Releases",
      facts: [
        { key: "release:ms-release-1", text: "Buyer pilot · Release 1: planned Fri 30 Oct", name: "Buyer pilot · Release 1" },
        { key: "release:ms-release-2", text: "Rollout · Release 2: planned Fri 6 Nov", name: "Rollout · Release 2" },
      ],
      none: "No releases are shared with the client yet.",
    },
    { title: "Status", facts: [{ key: "status:forager", text: "Off track: the store feed is late", name: "Off track" }], none: null },
  ],
  asOf: "2026-10-20T14:10:00.000Z",
};

describe("the template", () => {
  it("lists each section's facts, says none where a section has nothing, and leaves out a section with no none", () => {
    expect(draftTemplate(STANDUP)).toBe(
      "Kemar's standup, Tue 20 Oct\n\nSince yesterday:\n- #145 Google Trends connector (Forager 2.0): In progress to Done\n\nIn progress:\n- #147 Trend scoring model (Forager 2.0), due Fri 23 Oct\n\nBlocked: Nothing blocked.",
    );
    const noStatus = { ...CLIENT, sections: [CLIENT.sections[0], { ...CLIENT.sections[1], facts: [] }] };
    expect(draftTemplate(noStatus)).not.toContain("Status");
  });

  it("the template always passes its own facts check (DR6's fallback is always usable)", () => {
    for (const f of [STANDUP, CLIENT]) expect(draftProblem(f, draftTemplate(f))).toBeNull();
  });
});

describe("the facts check (rule 2, DR2)", () => {
  const ok = (text: string, known: string[] = []) => draftProblem(STANDUP, text, known);
  it("passes a rewording that keeps every record, date and name", () => {
    expect(ok("Since yesterday I moved #145 Google Trends connector to Done on Forager 2.0. I'm on #147 Trend scoring model, due Friday 23 Oct. Nothing is blocked.")).toBeNull();
  });

  it("DR2: refuses an invented record, number, date, day or month", () => {
    expect(ok("I finished #152.")).toBe("names #152, which is not in the facts");
    expect(ok("#147 is 80 percent done.")).toBe("adds the number 80");
    expect(ok("#147 is due Monday.")).toBe("adds a day (mon)");
    expect(ok("#147 is due in November.")).toBe("adds a month (nov)");
    expect(ok("Three things are in progress.")).toBe("adds the number 3");
  });

  it("refuses a name the facts do not have, mid-sentence, and one DPM knows that it was not given", () => {
    expect(ok("I'm waiting on Kyle for #147.")).toBe("names Kyle, which is not in the facts");
    expect(ok("Next up is the trend model and data sources.", ["Data sources"])).toBe("names Data sources, which it was not given");
    // A capital that starts a sentence or a line names nothing by itself
    expect(ok("Done: #145 Google Trends connector.\nToday: #147 Trend scoring model.")).toBeNull();
  });

  it("DR7, CD8: a quote is refused unless its words are DPM's facts", () => {
    expect(ok('Kemar said "the feed is a mess" about #145.')).toBe("quotes words that are not in the facts");
    expect(ok('I finished "Google Trends connector".')).toBeNull();
  });

  it("refuses a judgement or health, and an empty or overlong draft", () => {
    expect(ok("I was sick but finished #145.")).toBe("mentions health or judges a person");
    expect(ok("  ")).toBe("empty");
    expect(ok("#145 ".repeat(500))).toBe("too long");
  });

  it("May is a month only next to a day number", () => {
    expect(ok("#147 may slip.")).toBeNull();
    expect(ok("#147 is due 3 May.")).toBe("adds the number 3");
  });
});

describe("the copy check of a client status (rule 8, DR4)", () => {
  const text = draftTemplate(CLIENT);
  it("passes when every fact it mentions is in the client view as it was", () => {
    expect(clientCopyProblem(CLIENT, CLIENT, text, ["Trend model"])).toBeNull();
  });

  it("refuses when a release it names was hidden or moved since", () => {
    const hidden = { sections: [{ ...CLIENT.sections[0], facts: [CLIENT.sections[0].facts[1]] }, CLIENT.sections[1]] };
    expect(clientCopyProblem(CLIENT, hidden, text, [])).toBe("it says something the client view no longer shows");
    const moved = { sections: [{ ...CLIENT.sections[0], facts: [{ ...CLIENT.sections[0].facts[0], text: "Buyer pilot · Release 1: planned Tue 3 Nov" }, CLIENT.sections[0].facts[1]] }, CLIENT.sections[1]] };
    expect(clientCopyProblem(CLIENT, moved, text, [])).not.toBeNull();
    // Taken out of the text by the person, a gone release refuses nothing
    expect(clientCopyProblem(CLIENT, hidden, "Rollout · Release 2 is planned for Fri 6 Nov.", [])).toBeNull();
    // Atlas rewords names: a part of the name, or the release's date, still mentions it
    expect(clientCopyProblem(CLIENT, hidden, "Buyer pilot (Release 1) is planned for later this month.", [])).not.toBeNull();
    expect(clientCopyProblem(CLIENT, hidden, "The first release is planned for Fri 30 Oct.", [])).not.toBeNull();
  });

  it("refuses when the status is no longer shared and the draft still speaks of it", () => {
    const unshared = { sections: [CLIENT.sections[0], { ...CLIENT.sections[1], facts: [] }] };
    expect(clientCopyProblem(CLIENT, unshared, text, [])).not.toBeNull();
    expect(clientCopyProblem(CLIENT, unshared, "Release 1 is planned for Fri 30 Oct.", [])).toBeNull();
  });

  it("DR4: refuses a name the client view does not show, even one the person typed in", () => {
    expect(clientCopyProblem(CLIENT, CLIENT, `${text}\nThe Trend model is late.`, ["Trend model", "#151"])).toBe("it names something the client view does not show");
    expect(clientCopyProblem(CLIENT, CLIENT, `${text}\n#151 is blocked.`, ["#151"])).toBe("it names something the client view does not show");
  });
});

describe("which draft the words ask for", () => {
  it.each([
    ["Draft my standup", "standup"],
    ["Write up my standup please", "standup"],
    ["Can you draft my standup?", "standup"],
    ["Draft a client status for Forager", "client"],
    ["Write a status update for the client on Forager 2.0", "client"],
    ["Draft the weekly summary for Forager", "weekly"],
    ["Prepare this week's summary for GQ", "weekly"],
    ["draft mi standup", "standup"],
  ])("%s is a %s draft", (text, kind) => {
    expect(draftKindOf(text)).toBe(kind);
  });

  it.each(["Start my standup", "Let's do my standup", "I drafted the client status for Forager yesterday", "Draft the release notes for #151", "Draft my standup. Also #145 is done."])(
    "%s is not a request for a draft",
    (text) => {
      expect(draftKindOf(text)).toBeNull();
    },
  );

  it("plain words: em dashes go, lines stay", () => {
    expect(plainDraft("Done — #145\n\n\n\nNext:  #147")).toBe("Done, #145\n\nNext: #147");
  });
});
