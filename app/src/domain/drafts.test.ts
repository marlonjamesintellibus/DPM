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
  const ok = (text: string, records: string[] = [], people: string[] = []) => draftProblem(STANDUP, text, { records, people });
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
    // Every word of "Trend model" is in the facts, but the milestone was not given
    expect(ok("I'm on #147 before the Trend model.", ["Trend model"])).toBe("names Trend model, which it was not given");
    // An ordinary word that starts a sentence or a line names nothing by itself
    expect(ok("Done: #145 Google Trends connector.\nToday: #147 Trend scoring model.")).toBeNull();
  });

  it("DR2: a name Atlas made up at the start of a sentence is refused too", () => {
    expect(ok("Marcus sent the feed. I'm on #147.")).toBe("names Marcus, which is not in the facts");
    expect(ok("- Marcus: #147 Trend scoring model")).toBe("names Marcus, which is not in the facts");
    // A person DPM knows, named at the start, by their first name or in lower case (CD30)
    expect(ok("Kyle sent the feed.", [], ["Kyle"])).toBe("names Kyle, which is not in the facts");
    expect(ok("I'm on #147, as kyle asked.", [], ["Kyle"])).toBe("names Kyle, which it was not given");
    // Ordinary starts and words in -ing are not names
    expect(ok("Working on #147 Trend scoring model. Nothing is blocked.")).toBeNull();
  });

  it("CD30, CD33: an everyday word counts as a name only with its capital", () => {
    // A person called Will, and the milestone Data sources, which this standup was not given
    expect(ok("I will keep going on #147.", ["Data sources"], ["Will Grant"])).toBeNull();
    expect(ok("I'm on #147 now that the data sources are in.", ["Data sources"], ["Will Grant"])).toBeNull();
    expect(ok("I'm on #147, with Will.", [], ["Will Grant"])).toBe("names Will, which is not in the facts");
    expect(ok("I'm on #147 before Data sources.", ["Data sources"])).toBe("names Data, which is not in the facts");
    // A name with a digit, a # or a capital past its first letter is a name in any case
    expect(ok("I'm on #147, then the google trends connector v2.", ["Google Trends connector v2"])).toBe("names Google Trends connector v2, which it was not given");
  });

  it("DR2: a time said without a date is a date too, and needs the facts to say it", () => {
    expect(ok("I'll have #147 Trend scoring model ready tomorrow.")).toBe("adds a time (tomorrow)");
    expect(ok("#147 should be ready next week.")).toBe("adds a time (next week)");
    expect(ok("#147 by end of day.")).toBe("adds a time (end of day)");
    expect(ok("#147 is due today.")).toBe("adds a time (today)");
    // The facts say "since yesterday"; today is the day the draft is as of
    expect(ok("Since yesterday I moved #145 to Done. Today I'm on #147.")).toBeNull();
  });

  it("DR2: a status said of a record must be what its facts say", () => {
    const FEED: DraftFacts = {
      kind: "standup",
      heading: "Kemar's standup, Tue 20 Oct",
      sections: [
        { title: "Since yesterday", facts: [{ key: "saved:x-1", text: "#145 Google Trends connector: In progress to Done" }], none: "No changes since yesterday." },
        { title: "In progress", facts: [{ key: "work:wi-151", name: "Store feed connector", text: "#151 Store feed connector, due Fri 30 Oct" }], none: "Nothing in progress." },
        { title: "Blocked", facts: [], none: "Nothing blocked." },
      ],
      asOf: "2026-10-20T14:10:00.000Z",
    };
    const feed = (text: string) => draftProblem(FEED, text);
    expect(feed("I'll have #151 Store feed connector done tomorrow")).toBe("adds a time (tomorrow)");
    expect(feed("#151 Store feed connector should land next week.")).toBe("adds a time (next week)");
    expect(feed("#151 Store feed connector is now done.")).toBe("says done where the facts do not");
    expect(feed("The Store feed connector is done.")).toBe("says done where the facts do not");
    expect(feed("#151 is on track for Fri 30 Oct.")).toBe("says on track where the facts do not");
    expect(feed("#151 slipped.")).toBe("says off track where the facts do not");
    expect(feed("#151 is blocked.")).toBe("says blocked where the facts do not");
    // What the facts say of each record passes, "and" between them included
    expect(feed("I finished #145 and #151 Store feed connector is in progress, due Fri 30 Oct. Nothing is blocked.")).toBeNull();
    expect(feed("#145 is done, and #151 is done.")).toBe("says done where the facts do not");
  });

  it("DR2, DR4: a client status says only the status the client view shows", () => {
    const unshared = { ...CLIENT, sections: [CLIENT.sections[0], { ...CLIENT.sections[1], facts: [] }] };
    const client = (text: string) => draftProblem(unshared, text);
    expect(client("The project is on track.")).toBe("says on track where the facts do not");
    expect(client("We are a little off track.")).toBe("says off track where the facts do not");
    expect(client("Buyer pilot · Release 1 is done.")).toBe("says done where the facts do not");
    expect(client("Release 1 is planned for Fri 30 Oct.")).toBeNull();
    // A note's own lines, and a count, start sentences without naming anyone (the drafting evals)
    expect(client("Subject: Forager 2.0 for Sprouts\n\nHi Sprouts team,\n\nTwo releases are planned: Release 1 on Fri 30 Oct and Release 2 on Fri 6 Nov.\n\nBest regards,")).toBeNull();
    expect(client("Release 1 is planned for Fri 30 Oct.\n\nThanks,\nAtlas")).toBe("names Atlas, which is not in the facts");
    // Shared, the status is the one the client view shows, and only that one
    expect(draftProblem(CLIENT, "We are off track: the store feed is late.")).toBeNull();
    expect(draftProblem(CLIENT, "We are on track.")).toBe("says on track where the facts do not");
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
    expect(ok("We may add more to #147.")).toBeNull();
    // "#147 may slip" is a status its facts do not give
    expect(ok("#147 may slip.")).toBe("says off track where the facts do not");
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

  it("CD30: everyday words in lower case are not the hidden milestone they share a name with", () => {
    expect(clientCopyProblem(CLIENT, CLIENT, `${text}\nThe trend model and the data sources come first.`, ["Trend model", "Data sources"])).toBeNull();
    expect(clientCopyProblem(CLIENT, CLIENT, `${text}\nData sources come first.`, ["Data sources"])).toBe("it names something the client view does not show");
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
