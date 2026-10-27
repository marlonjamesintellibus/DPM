import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { config } from "../config";
import { landsAs, type BraidKind } from "../rights";
import type { Confidence, ExtractedItemDraft } from "../shared";
import { runChecks } from "./checks";
import { KEMAR_CONTEXT, KEMAR_NOTE, KEMAR_PROPOSALS } from "./kemar-note.fixture";
import type { CheckContext, RawProposal } from "./types";

const ctxWith = (text: string, extra: Partial<CheckContext> = {}): CheckContext => ({ ...KEMAR_CONTEXT, text, ...extra });

const update = (p: Partial<RawProposal> & Pick<RawProposal, "quote">): RawProposal => ({
  kind: "update",
  projectId: "forager",
  routingReason: { basis: "target", evidence: "", label: "target" },
  confidence: "high",
  rationale: "",
  ...p,
});

const braid = (p: Partial<RawProposal> & Pick<RawProposal, "quote">): RawProposal => ({
  kind: "braid_new",
  projectId: "forager",
  routingReason: { basis: "reference", evidence: "Forager", label: "Forager" },
  braidKind: "risk",
  braidTitle: "A risk",
  confidence: "high",
  rationale: "",
  ...p,
});

const one = (proposal: RawProposal, ctx: CheckContext) => {
  const r = runChecks([proposal], ctx);
  return { item: r.items[0] as ExtractedItemDraft | undefined, dropped: r.dropped[0] };
};

const quoted = (item: ExtractedItemDraft, text = KEMAR_NOTE) => item.spans.map((s) => text.slice(s.start, s.end));

describe("use case 1 story, step 2: Kemar's note becomes the 11 items in the table", () => {
  const { items, dropped } = runChecks(KEMAR_PROPOSALS, KEMAR_CONTEXT);

  it("the fixture text is the note in the use case story", () => {
    const story = readFileSync(new URL("../../../../use-cases/01-update-to-plan.md", import.meta.url), "utf8");
    expect(story).toContain(`"${KEMAR_NOTE}"`);
  });

  it("drops nothing a good model returns", () => {
    expect(dropped).toEqual([]);
  });

  it("matches the table: project, kind, target, change, why, confidence, mark", () => {
    const row = (i: ExtractedItemDraft) => [
      i.ordinal,
      i.scope === "personal" ? "You" : i.projectId,
      i.kind,
      i.target ? `${i.target.id} ${i.target.field}: ${i.target.oldValue} -> ${i.target.newValue}` : `${i.braid!.kind} "${i.braid!.title}" ${i.braid!.match} ${i.braid!.matchEntryId}`,
      i.routingReason,
      i.confidence,
      i.mark,
    ];
    expect(items.map(row)).toEqual([
      [1, "forager", "update", "wi-142 state: done -> done", "#142", "high", "no_change"],
      [2, "forager", "update", "wi-145 state: in_progress -> done", "#145", "high", "pre_accepted"],
      [3, "forager", "update", "wi-151 state: in_progress -> blocked", "Kyle is the contact on #151", "high", "pre_accepted"],
      [4, "forager", "update", "ms-trend forecast: 2026-10-23 -> 2026-10-24", "Kemar owns it", "medium", "needs_ok"],
      [5, "You", "update", "leave-kemar dates: 2026-10-26/2026-10-30 -> 2026-10-26/2026-10-30", "Personal", "high", "matches_leave"],
      [6, "forager", "update", "ho-runbook state: not_done -> handed_over", "His handover", "low", "needs_ok"],
      [7, "forager", "braid_same", 'blocker "Store sales feed access" same_as br-feed-blocker', "Same subject as #151", "high", "pre_accepted"],
      [8, "forager", "braid_new", 'risk "Trend model may slip to 24 Oct" new null', "Same quote as #4", "medium", "needs_ok"],
      [9, "forager", "braid_same", 'risk "Only Kemar can run the pipeline" same_as br-pipeline-risk', "Same subject as #5 and #6", "medium", "needs_ok"],
      [10, "insights", "update", "wi-208 state: in_progress -> done", '"On Store Insights"', "high", "pre_accepted"],
      [11, "insights", "braid_new", 'decision "Move the daily refresh to 6am" new null', '"On Store Insights"', "high", "pre_accepted"],
    ]);
    expect(items.every((i) => i.routing === "routed")).toBe(true);
  });

  it('gives Kemar\'s chat count: "9 updates for 2 projects; 4 need your OK"', () => {
    const changes = items.filter((i) => i.mark !== "no_change" && i.mark !== "matches_leave");
    const projects = new Set(changes.map((i) => i.projectId));
    const needOk = items.filter((i) => i.mark === "needs_ok" || i.routing === "choose_project");
    expect(`${changes.length} updates for ${projects.size} projects; ${needOk.length} need your OK`).toBe(
      "9 updates for 2 projects; 4 need your OK",
    );
    expect(needOk.map((i) => i.ordinal)).toEqual([4, 6, 8, 9]);
  });

  it("E73: one quote feeds several items (#3 and #7, #4 and #8, #6 and #9)", () => {
    expect(items[2].spans).toEqual(items[6].spans);
    expect(items[3].spans).toEqual(items[7].spans);
    expect(items[5].spans).toEqual(items[8].spans);
    expect(quoted(items[2])).toEqual(["Still waiting on Kyle for the store feed"]);
  });

  it("E79: no Forager item quotes the Store Insights sentence", () => {
    const insights = KEMAR_NOTE.indexOf("On Store Insights");
    for (const i of items.filter((x) => x.projectId === "forager")) for (const s of i.spans) expect(s.end).toBeLessThanOrEqual(insights);
  });

  it("the decision Kemar says was agreed is still a proposal for the decider (E96)", () => {
    expect(items[10].braid?.kind).toBe("decision");
    expect(landsAs("decision", "member")).toBe("proposed");
  });
});

describe("check 1: target in scope", () => {
  it("E10: an invented target is dropped, not invented", () => {
    const r = one(update({ targetId: "wi-999", field: "state", newValue: "done", quote: "Finished the TikTok ingest" }), KEMAR_CONTEXT);
    expect(r.item).toBeUndefined();
    expect(r.dropped).toMatchObject({ check: 1 });
  });

  it("a same-as report needs a real entry in the author's projects", () => {
    const r = one(braid({ kind: "braid_same", matchEntryId: "br-sante-risk", quote: "Still waiting on Kyle" }), KEMAR_CONTEXT);
    expect(r.dropped).toMatchObject({ check: 1 });
    expect(one(braid({ kind: "braid_same", quote: "Still waiting on Kyle" }), KEMAR_CONTEXT).dropped).toMatchObject({ check: 1 });
  });
});

describe("check 2: the quote is real", () => {
  it("E11: words that are not in the message are dropped", () => {
    const r = one(update({ targetId: "wi-145", field: "state", newValue: "done", quote: "the connector shipped" }), KEMAR_CONTEXT);
    expect(r.dropped).toMatchObject({ check: 2 });
  });

  it("finds the quote ignoring case and records its position", () => {
    const { item } = one(update({ targetId: "wi-145", field: "state", newValue: "done", quote: "THE GOOGLE TRENDS connector is done" }), KEMAR_CONTEXT);
    expect(quoted(item!)).toEqual(["the Google Trends connector is done"]);
  });
});

describe("check 3: field allowed for the author's role and target type", () => {
  it("E16: an employee cannot set a project status; Atlas says who owns it", () => {
    const ctx = ctxWith("Set Forager to Off track.");
    const r = one(update({ targetId: "forager", field: "status", newValue: "off_track", quote: "Set Forager to Off track" }), ctx);
    expect(r.item).toBeUndefined();
    expect(r.dropped.check).toBe(3);
    expect(r.dropped.reason).toContain("Alicia Campbell");
  });

  it("S5: another person's milestone forecast is theirs to move", () => {
    const ctx = ctxWith("Release 1 slips a day.");
    const r = one(update({ targetId: "ms-release-1", field: "forecast", newValue: "2026-10-31", quote: "Release 1 slips a day" }), ctx);
    expect(r.dropped.check).toBe(3);
    expect(r.dropped.reason).toContain("Alicia Campbell");
  });

  it("M6: a milestone target never moves from a capture", () => {
    const ctx = ctxWith("Move the trend model target to the 30th.");
    const r = one(update({ targetId: "ms-trend", field: "target", newValue: "2026-10-30", quote: "Move the trend model target to the 30th" }), ctx);
    expect(r.dropped.check).toBe(3);
  });

  it("refuses a value that is not a state, and a teammate's work item, but a PM may update it", () => {
    expect(one(update({ targetId: "wi-145", field: "state", newValue: "shipped", quote: "done too" }), KEMAR_CONTEXT).dropped.check).toBe(3);
    const jodians = update({ targetId: "wi-160", field: "state", newValue: "done", quote: "done too" });
    expect(one(jodians, KEMAR_CONTEXT).dropped.check).toBe(3);
    const asPm = { ...KEMAR_CONTEXT, projects: KEMAR_CONTEXT.projects.map((p) => (p.id === "forager" ? { ...p, role: "pm" as const } : p)) };
    expect(one(jodians, asPm).item?.target?.newValue).toBe("done");
  });
});

describe("check 4: confidence floor, never raised", () => {
  it('E12: hedge words lower High to Medium ("I think it slips a day")', () => {
    const { item } = one(update({ targetId: "ms-trend", field: "forecast", newValue: "2026-10-24", quote: "so I think the model slips a day" }), KEMAR_CONTEXT);
    expect(item).toMatchObject({ confidence: "medium", mark: "needs_ok" });
  });

  // Phase R: the same guess said in Patois is held for the author's OK as it is in English
  it.each(["I think #208 is done.", "Maybe #208 is done.", "Mi tink #208 done.", "Mi feel seh #208 done.", "Mussi #208 done.", "Mebbe #208 done."])(
    "E12 a hedge lowers High to Medium in English and Patois: %s",
    (text) => {
      const { item } = one(update({ projectId: "insights", targetId: "wi-208", field: "state", newValue: "done", quote: text.slice(0, -1) }), ctxWith(text));
      expect(item).toMatchObject({ confidence: "medium", mark: "needs_ok" });
    },
  );

  it("JA2 'soon done' is not done: a done value from it is held for an OK; 'Mi done wid #208' keeps High", () => {
    for (const text of ["#208 soon done.", "Mi almost done wid #208.", "Mi a go finish #208 likkle more."]) {
      const { item } = one(update({ projectId: "insights", targetId: "wi-208", field: "state", newValue: "done", quote: text.slice(0, -1) }), ctxWith(text));
      expect(item, text).toMatchObject({ confidence: "medium", mark: "needs_ok" });
    }
    const done = one(update({ projectId: "insights", targetId: "wi-208", field: "state", newValue: "done", quote: "Mi done wid #208" }), ctxWith("Mi done wid #208."));
    expect(done.item).toMatchObject({ confidence: "high", mark: "pre_accepted" });
  });

  it("never raises: Low stays Low, and an unknown level counts as Low", () => {
    const low = update({ targetId: "wi-145", field: "state", newValue: "done", quote: "the Google Trends connector is done too", confidence: "low" });
    expect(one(low, KEMAR_CONTEXT).item?.confidence).toBe("low");
    expect(one({ ...low, confidence: "certain" as Confidence }, KEMAR_CONTEXT).item?.confidence).toBe("low");
  });

  it("E5: a poor transcript lowers every item to at most Medium", () => {
    const ctx = { ...KEMAR_CONTEXT, transcriptConfidence: "low" as const };
    const { items } = runChecks(KEMAR_PROPOSALS, ctx);
    expect(items.some((i) => i.confidence === "high")).toBe(false);
    expect(items.some((i) => i.mark === "pre_accepted")).toBe(false);
  });

  it("a date read from relative words is Medium; a stated date keeps High", () => {
    const ctx = ctxWith("The trend model will land Monday. Actually the trend model lands Fri 23 Oct.");
    const rel = one(update({ targetId: "ms-trend", field: "forecast", newValue: "2026-10-26", quote: "The trend model will land Monday" }), ctx);
    expect(rel.item).toMatchObject({ confidence: "medium", target: { newValue: "2026-10-26" } });
    const stated = one(update({ targetId: "ms-trend", field: "forecast", newValue: "2026-10-23", quote: "the trend model lands Fri 23 Oct" }), ctx);
    expect(stated.item).toMatchObject({ confidence: "high", mark: "no_change" });
  });
});

describe("check 5: dates resolve against message time", () => {
  it("E13: a weekday and date that disagree resolve with Medium and Needs your OK", () => {
    const ctx = ctxWith("I'm out from Monday the 27th.");
    const { item } = one(update({ projectId: null, targetId: "leave-kemar", field: "dates", newValue: "2026-10-27/..", quote: "I'm out from Monday the 27th" }), ctx);
    // D6: the 27th falls inside his approved leave, so it is a change to it, which he confirms
    expect(item).toMatchObject({ confidence: "medium", mark: "needs_ok", target: { newValue: "2026-10-27/2026-10-30" }, leave: { fit: "change", leaveId: "lv-kemar-oct" } });
  });

  it("the server's date wins over the model's", () => {
    const { item } = one(update({ targetId: "ms-trend", field: "forecast", newValue: "2026-10-25", quote: "the model slips a day" }), KEMAR_CONTEXT);
    expect(item?.target?.newValue).toBe("2026-10-24");
  });

  it("a date that is not in the words is dropped", () => {
    const { dropped } = one(update({ targetId: "ms-trend", field: "forecast", newValue: "2026-10-25", quote: "Jodian has the runbook" }), KEMAR_CONTEXT);
    expect(dropped.check).toBe(5);
  });
});

describe("check 6: one card per target and field", () => {
  it('E14: "slips a day, actually two" is one card with the later value, both quotes, Needs your OK', () => {
    const ctx = ctxWith("The trend model slips a day. Actually two days late, sorry.");
    const { items, dropped } = runChecks(
      [
        update({ targetId: "ms-trend", field: "forecast", newValue: "2026-10-24", quote: "The trend model slips a day" }),
        update({ targetId: "ms-trend", field: "forecast", newValue: "2026-10-25", quote: "two days late" }),
      ],
      ctx,
    );
    expect(dropped).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ mark: "needs_ok", target: { newValue: "2026-10-25" } });
    expect(quoted(items[0], ctx.text)).toEqual(["The trend model slips a day", "two days late"]);
  });
});

describe("check 7: old value from the database", () => {
  it("ignores the model's old value", () => {
    const { item } = one(
      update({ targetId: "wi-145", field: "state", oldValue: "done", newValue: "done", quote: "the Google Trends connector is done too" }),
      KEMAR_CONTEXT,
    );
    expect(item?.target).toMatchObject({ oldValue: "in_progress", newValue: "done" });
    expect(item?.mark).toBe("pre_accepted");
  });
});

describe("check 8: mark", () => {
  it("M8: leave that matches no approved leave needs an OK (it becomes a request)", () => {
    const ctx = ctxWith("I'm out from the 2nd of November.");
    const { item } = one(update({ projectId: null, targetId: "leave-kemar", field: "dates", quote: "I'm out from the 2nd of November" }), ctx);
    expect(item).toMatchObject({ scope: "personal", mark: "needs_ok", target: { newValue: "2026-11-02/.." } });
  });
});

describe("D20: handing a step over always needs the author's OK", () => {
  it("even at High confidence, the runbook handed to Jodian waits for Kemar", () => {
    const ctx = ctxWith("Handed the runbook over to Jodian this morning.");
    const { item } = one(update({ targetId: "ho-runbook", field: "state", newValue: "handed_over", quote: "Handed the runbook over to Jodian", confidence: "high" }), ctx);
    expect(item).toMatchObject({ confidence: "high", mark: "needs_ok" });
  });

  it("a step started, not handed over, follows confidence as usual", () => {
    const ctx = ctxWith("Started the runbook handover today.");
    const { item } = one(update({ targetId: "ho-runbook", field: "state", newValue: "in_progress", quote: "Started the runbook handover", confidence: "high" }), ctx);
    expect(item?.mark).toBe("pre_accepted");
  });
});

describe("check 9: project is a candidate", () => {
  it("E78: a project Kemar is not in is never routed to, and never named", () => {
    const ctx = ctxWith("Sante Group is late on the API.");
    const { item } = one(braid({ projectId: "sante", quote: "Sante Group is late on the API" }), ctx);
    expect(item).toMatchObject({ routing: "not_filed", projectId: null });
    expect(item?.routingReason).not.toContain("sante");
  });

  it("E75: a project not connected to DPM is not filed, and says why", () => {
    const ctx = {
      ...KEMAR_CONTEXT,
      projects: KEMAR_CONTEXT.projects.filter((p) => p.id !== "insights"),
      notConnected: [{ id: "insights", name: "Store Insights" }],
    };
    const { item } = one(braid({ projectId: "insights", braidKind: "decision", quote: "Andre and I agreed to move the refresh to 6am" }), ctx);
    expect(item).toMatchObject({ routing: "not_filed", projectId: null, routingReason: "Not filed: Store Insights isn't connected to DPM yet" });
  });

  it("E72: something with no record and no project stays private and savable", () => {
    const ctx = ctxWith("Need to renew my laptop.");
    const { item } = one(update({ projectId: null, quote: "Need to renew my laptop" }), ctx);
    expect(item).toMatchObject({ routing: "not_filed", projectId: null });
    expect(item?.target).toBeUndefined();
  });

  it("E73: one sentence about two projects makes two items from one quote", () => {
    const ctx = ctxWith("Still waiting on Kyle for both Forager and Store Insights.");
    const quote = "Still waiting on Kyle for both Forager and Store Insights";
    const { items } = runChecks(
      [
        braid({ braidKind: "blocker", quote, routingReason: { basis: "reference", evidence: "Forager", label: "Forager" } }),
        braid({ projectId: "insights", braidKind: "blocker", quote, routingReason: { basis: "reference", evidence: "Store Insights", label: "Store Insights" } }),
      ],
      ctx,
    );
    expect(items.map((i) => [i.projectId, i.routing])).toEqual([
      ["forager", "routed"],
      ["insights", "routed"],
    ]);
    expect(items[0].spans).toEqual(items[1].spans);
  });

  it("E80: leave goes to You even if the model named a project", () => {
    const p = { ...KEMAR_PROPOSALS[4], projectId: "forager" };
    expect(one(p, KEMAR_CONTEXT).item).toMatchObject({ scope: "personal", projectId: null, routing: "routed" });
  });

  it("E71: the model saying two projects fit makes choose_project", () => {
    const ctx = ctxWith("Fixed the pipeline.");
    const { item } = one(braid({ projectId: null, braidKind: "issue", quote: "Fixed the pipeline", routingReason: { basis: "ambiguous", evidence: "", label: "" } }), ctx);
    expect(item).toMatchObject({ routing: "choose_project", projectId: null });
  });
});

describe("check 10: target belongs to the project", () => {
  it("E74: an update filed in a project that does not hold its target is dropped", () => {
    const r = one(update({ projectId: "insights", targetId: "wi-145", field: "state", newValue: "done", quote: "done too" }), KEMAR_CONTEXT);
    expect(r.dropped.check).toBe(10);
  });

  it("a same-as match must be in the same project", () => {
    const r = one(braid({ kind: "braid_same", projectId: "insights", braidKind: "blocker", matchEntryId: "br-feed-blocker", quote: "Still waiting on Kyle" }), KEMAR_CONTEXT);
    expect(r.dropped.check).toBe(10);
  });

  it("M16: kinds never merge; a same subject in another kind becomes a new, related entry", () => {
    const { item } = one(
      braid({ kind: "braid_same", braidKind: "blocker", matchEntryId: "br-feed-dependency", quote: "Still waiting on Kyle for the store feed", routingReason: { basis: "target", evidence: "", label: "Same subject as the dependency" } }),
      KEMAR_CONTEXT,
    );
    expect(item).toMatchObject({ kind: "braid_new", routing: "routed", braid: { kind: "blocker", match: "related_to", matchEntryId: "br-feed-dependency" } });
  });
});

describe("check 11: kind allowed for the role", () => {
  it("drops a kind that is not BRAID", () => {
    expect(one(braid({ braidKind: "complaint", quote: "Still waiting on Kyle" }), KEMAR_CONTEXT).dropped.check).toBe(11);
  });

  it("follows the rights table, and says who can", () => {
    const leadsOnly = (role: string, kind: BraidKind) => kind !== "decision" || role !== "member";
    const r = runChecks([braid({ braidKind: "decision", projectId: "insights", quote: "Andre and I agreed to move the refresh to 6am", routingReason: { basis: "reference", evidence: "Store Insights", label: "" } })], KEMAR_CONTEXT, { mayReport: leadsOnly });
    expect(r.dropped[0]).toMatchObject({ check: 11, reason: "on Store Insights, a decision is reported by: pm or lead" });
  });
});

describe("check 12: proposals stay proposals", () => {
  it('E96: "Andre approved moving the refresh" is still a proposed decision', () => {
    const ctx = ctxWith("On Store Insights, Andre approved moving the refresh to 6am.");
    const { item } = one(
      braid({ projectId: "insights", braidKind: "decision", braidState: "approved", braidTitle: "Move the refresh to 6am", quote: "Andre approved moving the refresh to 6am", routingReason: { basis: "reference", evidence: "Store Insights", label: "On Store Insights" } }),
      ctx,
    );
    expect(item).toMatchObject({ kind: "braid_new", braid: { kind: "decision", match: "new" } });
    expect(landsAs(item!.braid!.kind, "member")).toBe("proposed");
  });

  it("no proposal may set a BRAID entry's state", () => {
    for (const state of ["approved", "open", "holding", "declined"]) {
      const r = one(update({ targetId: "br-pipeline-risk", field: "state", newValue: state, quote: "Jodian has the runbook already" }), KEMAR_CONTEXT);
      expect(r.item).toBeUndefined();
      expect(r.dropped.check).toBe(12);
    }
  });
});

describe("check 13: no health, no judgements of a named person", () => {
  it("E94: health words never become a BRAID entry", () => {
    const ctx = ctxWith("I'm burnt out, the pipeline may slip.");
    expect(one(braid({ quote: "I'm burnt out, the pipeline may slip" }), ctx).dropped.check).toBe(13);
  });

  it("E95: a judgement of a named person is left out, and Atlas says so", () => {
    const ctx = ctxWith("Jodian keeps missing standups.");
    const r = one(braid({ braidKind: "issue", quote: "Jodian keeps missing standups" }), ctx);
    expect(r.dropped).toMatchObject({ check: 13, reason: "Atlas left out what you said about Jodian Taylor" });
  });

  it("E17: leave dates are kept without the health words", () => {
    const ctx = ctxWith("I'm out Monday, not feeling well.");
    const { item } = one(update({ projectId: null, targetId: "leave-kemar", field: "dates", quote: "I'm out Monday, not feeling well", rationale: "Kemar is unwell" }), ctx);
    expect(quoted(item!, ctx.text)).toEqual(["I'm out Monday"]);
    expect(item).toMatchObject({ mark: "matches_leave", rationale: "Leave dates you mentioned" });
  });
});

describe("check 14: the routing reason is real", () => {
  it("a reference that is not in the words makes choose_project", () => {
    const { item } = one(braid({ quote: "Still waiting on Kyle", routingReason: { basis: "reference", evidence: "Forager", label: "On Forager" } }), KEMAR_CONTEXT);
    expect(item).toMatchObject({ routing: "choose_project", projectId: null });
  });

  it("a person tied to two of the author's projects does not decide (Alicia: Forager and GQ)", () => {
    const ctx = ctxWith("Alicia wants the deck redone.");
    const { item } = one(braid({ braidKind: "issue", quote: "Alicia wants the deck redone", routingReason: { basis: "tied_person", evidence: "Alicia", label: "Alicia is the PM" } }), ctx);
    expect(item?.routing).toBe("choose_project");
  });

  it("JA7 a project name that is also a word counts only written as a name, or next to one of its records", () => {
    const room = (text: string, evidence: string, ctx = ctxWith(text)) =>
      one(braid({ projectId: "gq", braidKind: "issue", quote: text.slice(0, -1), routingReason: { basis: "reference", evidence, label: evidence } }), ctx).item;
    // A class at an academy is not GQ & Academy, whatever case Atlas gives the evidence in
    expect(room("Mi a teach a class at di academy tomorrow but di room nuh book yet.", "academy")?.routing).toBe("choose_project");
    expect(room("Mi a teach a class at di academy tomorrow but di room nuh book yet.", "Academy")?.routing).toBe("choose_project");
    expect(room("Mi a teach a class at di Academy tomorrow but di room nuh book yet.", "Academy")).toMatchObject({ routing: "routed", projectId: "gq" });
    const booking = { type: "work_item" as const, id: "wi-301", number: "#301", title: "Room booking", ownerId: "kemar", values: { state: "in_progress" } };
    const projects = KEMAR_CONTEXT.projects.map((p) => (p.id === "gq" ? { ...p, records: [booking] } : p));
    const text = "Di academy #301 room nuh book yet.";
    expect(room(text, "academy", ctxWith(text, { projects }))).toMatchObject({ routing: "routed", projectId: "gq" });
  });

  it("Kyle settles the store feed: he is tied only to Forager", () => {
    const { item } = one(braid({ braidKind: "blocker", quote: "Still waiting on Kyle for the store feed", routingReason: { basis: "tied_person", evidence: "Kyle", label: "Kyle is the contact on #151" } }), KEMAR_CONTEXT);
    expect(item).toMatchObject({ routing: "routed", projectId: "forager" });
  });

  it("W-D4: a lowercase name still ties an item to its project; a name that is also a word needs its capital", () => {
    const kyle = one(braid({ braidKind: "blocker", quote: "still waiting on kyle for the store feed", routingReason: { basis: "tied_person", evidence: "kyle", label: "Kyle is the contact on #151" } }), KEMAR_CONTEXT);
    expect(kyle.item).toMatchObject({ routing: "routed", projectId: "forager" });
    // A contact named Will on GQ: "mi will send it" is the word, so Atlas cannot file it by him
    const will = { personId: "will", name: "Will Grant", role: null, tie: "contact at the Academy" };
    const projects = KEMAR_CONTEXT.projects.map((p) => (p.id === "gq" ? { ...p, people: [...p.people, will] } : p));
    const said = (quote: string) =>
      one(braid({ braidKind: "risk", projectId: "gq", quote, routingReason: { basis: "tied_person", evidence: "Will", label: "Will is the contact at the Academy" } }), ctxWith(`${quote}.`, { projects })).item;
    expect(said("mi will send di slides late")?.routing).toBe("choose_project");
    expect(said("Will may send the slides late")).toMatchObject({ routing: "routed", projectId: "gq" });
  });

  it("E82: two projects with the same issue title; the number wins, the title alone does not", () => {
    const twin = { type: "work_item" as const, id: "wi-301", number: "#301", title: "Google Trends connector", ownerId: "kemar", values: { state: "in_progress" } };
    const projects = KEMAR_CONTEXT.projects.map((p) => (p.id === "insights" ? { ...p, records: [...p.records, twin] } : p));
    const byTitle = ctxWith("The Google Trends connector is done.", { projects });
    const p = update({ targetId: "wi-145", field: "state", newValue: "done", quote: "The Google Trends connector is done", routingReason: { basis: "target", evidence: "Google Trends connector", label: "#145" } });
    expect(one(p, byTitle).item?.routing).toBe("choose_project");
    const byNumber = ctxWith("#145, the Google Trends connector is done.", { projects });
    expect(one({ ...p, quote: "#145, the Google Trends connector is done" }, byNumber).item?.routing).toBe("routed");
  });

  it("G19: a new BRAID item that names a record by title is tied to that record's project", () => {
    const ctx = ctxWith("Issue: the TikTok ingest has been dropping rows since yesterday.");
    for (const basis of ["reference", "target", "owned_record"] as const) {
      const p = braid({ braidKind: "issue", quote: "the TikTok ingest has been dropping rows since yesterday", routingReason: { basis, evidence: "TikTok ingest", label: "TikTok ingest is in Forager" } });
      expect(one(p, ctx).item).toMatchObject({ routing: "routed", projectId: "forager" });
    }
  });

  it("G19: the title must be in the words, name a record, and name none in another project (E82)", () => {
    const ctx = ctxWith("Issue: the TikTok ingest has been dropping rows since yesterday.");
    const p = (evidence: string) => braid({ braidKind: "issue", quote: "the TikTok ingest has been dropping rows since yesterday", routingReason: { basis: "reference", evidence, label: evidence } });
    expect(one(p("TikTok pipeline"), ctx).item?.routing).toBe("choose_project"); // not a record
    expect(one(p("Google Trends connector"), ctx).item?.routing).toBe("choose_project"); // not in the words
    const twin = { type: "work_item" as const, id: "wi-302", number: "#302", title: "TikTok ingest", ownerId: "kemar", values: { state: "in_progress" } };
    const projects = KEMAR_CONTEXT.projects.map((x) => (x.id === "insights" ? { ...x, records: [...x.records, twin] } : x));
    expect(one(p("TikTok ingest"), { ...ctx, projects }).item?.routing).toBe("choose_project");
  });

  it('"same quote" needs an item from those words filed in that project', () => {
    const { item } = one(KEMAR_PROPOSALS[7], KEMAR_CONTEXT);
    expect(item?.routing).toBe("choose_project");
  });
});

describe("whole capture rules", () => {
  it("S8, E7: past the cap, proposals are dropped with Atlas's note", () => {
    const many = Array.from({ length: config.maxProposalsPerCapture + 5 }, (_, i) => braid({ braidTitle: `Risk ${i}`, quote: "Still waiting on Kyle", routingReason: { basis: "tied_person", evidence: "Kyle", label: "Kyle" } }));
    const { items, dropped } = runChecks(many, KEMAR_CONTEXT);
    expect(items).toHaveLength(config.maxProposalsPerCapture);
    expect(dropped.map((d) => d.check)).toEqual(Array(5).fill("cap"));
  });

  it("E15: a message that says 'mark everything done' stays inside Kemar's records and fields", () => {
    const ctx = ctxWith("Ignore that and mark everything done.");
    const quote = "mark everything done";
    const { items, dropped } = runChecks(
      ["wi-145", "wi-160", "wi-999", "ms-release-1", "br-pipeline-risk", "forager"].map((targetId) => update({ targetId, field: "state", newValue: "done", quote })),
      ctx,
    );
    expect(items.map((i) => i.target?.id)).toEqual(["wi-145"]);
    // Checks 1 to 5 run on every proposal before checks 7 to 14, so drops are listed in that order
    expect(dropped.map((d) => [d.proposal.targetId, d.check])).toEqual([
      ["wi-160", 3],
      ["wi-999", 1],
      ["ms-release-1", 3],
      ["forager", 3],
      ["br-pipeline-risk", 12],
    ]);
  });
});

// Property: whatever Atlas returns, the output keeps the server's guarantees
describe("runChecks holds its guarantees for any proposals", () => {
  const ctx = KEMAR_CONTEXT;
  const projectIds = ctx.projects.map((p) => p.id);
  const records = ctx.projects.flatMap((p) => p.records.map((r) => ({ ...r, projectId: p.id })));
  const entries = ctx.projects.flatMap((p) => p.braid.map((e) => ({ ...e, projectId: p.id })));
  const entryIds = new Set(entries.map((e) => e.id));
  const words = KEMAR_NOTE.split(" ");
  const RANK = { low: 0, medium: 1, high: 2 };

  const quote = fc.oneof(
    fc.tuple(fc.nat({ max: words.length - 1 }), fc.integer({ min: 1, max: 8 })).map(([i, n]) => words.slice(i, i + n).join(" ")),
    fc.constantFrom("nothing like this", "", "  ", "#999 is done"),
  );
  const proposal: fc.Arbitrary<RawProposal> = fc.record({
    kind: fc.constantFrom("update", "braid_new", "braid_same"),
    projectId: fc.option(fc.constantFrom(...projectIds, "sante", "uwi"), { nil: null }),
    routingReason: fc.record({
      basis: fc.constantFrom("target", "reference", "owned_record", "tied_person", "same_quote", "personal", "ambiguous"),
      evidence: fc.constantFrom("Kyle", "Store Insights", "Forager", "#151", "Alicia", "nobody"),
      label: fc.constantFrom("why", ""),
    }),
    targetId: fc.option(fc.constantFrom(...records.map((r) => r.id), ...entryIds, ...projectIds, "leave-kemar", "wi-999"), { nil: null }),
    field: fc.constantFrom("state", "forecast", "target", "dates", "blocked_note", "status"),
    newValue: fc.constantFrom("done", "blocked", "approved", "open", "2026-10-24", "handed_over", "x"),
    oldValue: fc.constantFrom("done", "in_progress", null),
    braidKind: fc.constantFrom("blocker", "risk", "decision", "issue", "complaint"),
    braidTitle: fc.constantFrom("A title", "Jodian keeps missing standups"),
    matchEntryId: fc.option(fc.constantFrom(...entryIds, "br-none"), { nil: null }),
    braidState: fc.constantFrom("approved", "open", "holding", "declined", null),
    quote,
    confidence: fc.constantFrom<Confidence>("high", "medium", "low"),
    rationale: fc.constant("because"),
  }) as fc.Arbitrary<RawProposal>;

  it("real spans, candidate projects only, confidence never raised, no BRAID entry decided", () => {
    fc.assert(
      fc.property(fc.array(proposal, { maxLength: 30 }), (proposals) => {
        const { items, dropped } = runChecks(proposals, ctx);
        expect(items.length).toBeLessThanOrEqual(config.maxProposalsPerCapture);
        expect(items.length + dropped.length).toBeLessThanOrEqual(proposals.length);
        for (const item of items) {
          // Every span is real text inside the capture, from a quote the model gave
          expect(item.spans.length).toBeGreaterThan(0);
          for (const s of item.spans) {
            expect(0 <= s.start && s.start < s.end && s.end <= KEMAR_NOTE.length).toBe(true);
          }
          const sources = proposals.filter((p) => item.spans.some((s) => KEMAR_NOTE.slice(s.start, s.end).toLowerCase() === p.quote.trim().toLowerCase()));
          expect(sources.length).toBeGreaterThan(0);
          // Confidence no higher than some proposal behind it
          expect(sources.some((p) => RANK[p.confidence] >= RANK[item.confidence])).toBe(true);
          // A project from the candidate list, or none; only routed items carry one
          if (item.projectId !== null) expect(projectIds).toContain(item.projectId);
          expect(item.projectId !== null).toBe(item.routing === "routed" && item.scope === "project");
          if (item.target) {
            // Never a BRAID entry or a project as an update target; old values from the database
            expect(entryIds.has(item.target.id)).toBe(false);
            if (item.target.type === "leave") expect(item.scope).toBe("personal");
            else {
              const record = records.find((r) => r.id === item.target!.id)!;
              // Filed in the record's own project; a choose_project card has none until the author picks
              if (item.routing === "routed") expect(record.projectId).toBe(item.projectId);
              else expect(item.routing).toBe("choose_project");
              expect(item.target.oldValue).toBe(record.values[item.target.field] ?? null);
            }
          }
          if (item.braid) {
            // Only REPORT (braid_new) and ADD_SOURCE (braid_same); a same-as match is in the same project and kind
            expect(item.kind).not.toBe("update");
            if (item.braid.match === "same_as") {
              const entry = entries.find((e) => e.id === item.braid!.matchEntryId)!;
              expect(item.kind).toBe("braid_same");
              expect(entry.kind).toBe(item.braid.kind);
              if (item.routing === "routed") expect(entry.projectId).toBe(item.projectId);
            }
            if (item.braid.kind === "decision") expect(landsAs("decision", "member")).toBe("proposed");
            expect(item.braid.title).not.toMatch(/keeps missing/);
          }
          if (item.confidence !== "high") expect(item.mark).not.toBe("pre_accepted");
        }
      }),
      { numRuns: 1000 },
    );
  });
});
