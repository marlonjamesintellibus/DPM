// Phase E: the server checks on a commitment item (conversational plan, section 7, CM1 to CM5, CD3 to CD5). Kemar
// speaks at 8:58am on Tuesday 20 Oct; a promise is his alone, its day is read by the server, and a promise to
// finish his own record by a day is its forecast.
import { describe, expect, it } from "vitest";
import type { ExtractedItemDraft } from "../shared";
import { runChecks } from "./checks";
import { KEMAR_CONTEXT } from "./kemar-note.fixture";
import { readPromiseDate } from "./resolve-dates";
import type { CheckContext, RawProposal } from "./types";

const promise = (quote: string, p: Partial<RawProposal> = {}): RawProposal => ({
  kind: "commitment",
  projectId: null,
  routingReason: { basis: "personal", evidence: "I'll", label: "You" },
  newValue: "promised",
  promise: "Send Kyle the access request",
  quote,
  confidence: "high",
  rationale: "Your promise",
  ...p,
});

const LIVE = [{ id: "cm-1", what: "Send Kyle the access request", dueOn: "2026-10-21", state: "open", linkId: "wi-151" }];
const read = (p: RawProposal, extra: Partial<CheckContext> = {}) => {
  const r = runChecks([p], { ...KEMAR_CONTEXT, text: `${p.quote}.`, ...extra });
  return { item: r.items[0] as ExtractedItemDraft | undefined, dropped: r.dropped[0] };
};

describe("a promise is the author's commitment, private to them (CD3)", () => {
  it("is personal, with the day it is due read from the words and shown to correct (CM2)", () => {
    const { item } = read(promise("I'll send Kyle the access request for #151 tomorrow", { targetId: "wi-151" }));
    expect(item).toMatchObject({ kind: "commitment", scope: "personal", routing: "routed", projectId: null, routingReason: "Only you see your promises", confidence: "medium", mark: "needs_ok" });
    expect(item?.commitment).toEqual({
      act: "promise",
      what: "Send Kyle the access request",
      dueOn: "2026-10-21",
      dueFrom: "said",
      dueWords: "tomorrow",
      link: { type: "work_item", id: "wi-151", projectId: "forager", label: "#151 Store sales feed access" },
      commitmentId: null,
      seenDue: null,
    });
  });

  it("CM1, CD4: no day said is due the next working day, and the author checks it", () => {
    const { item } = read(promise("I'll look into the export columns", { promise: "Look into the export columns" }));
    expect(item?.commitment).toMatchObject({ dueOn: "2026-10-21", dueFrom: "none", dueWords: null });
    expect(item).toMatchObject({ confidence: "medium", mark: "needs_ok" });
  });

  it("CM2: vague days read as the last day they allow", () => {
    expect(read(promise("I'll send Kyle the access request next week")).item?.commitment).toMatchObject({ dueOn: "2026-10-30", dueFrom: "vague", dueWords: "next week" });
    expect(read(promise("I'll send Kyle the access request by the end of the month")).item?.commitment).toMatchObject({ dueOn: "2026-10-30", dueFrom: "vague" });
    expect(read(promise("I'll send Kyle the access request this week")).item?.commitment).toMatchObject({ dueOn: "2026-10-23", dueFrom: "vague" });
    // A named day wins over a vague one
    expect(read(promise("I'll send Kyle the access request Thursday next week")).item?.commitment).toMatchObject({ dueOn: "2026-10-22", dueFrom: "said" });
  });

  it("a day already past is not a promise", () => {
    expect(read(promise("I'll send Kyle the access request yesterday")).dropped).toMatchObject({ check: 5, reason: "that day has passed; a promise is for a day still to come" });
  });

  it("CM3: finishing his own work item or milestone by a day is its forecast, never a commitment", () => {
    const work = read(promise("I'll finish #145 Monday", { targetId: "wi-145", promise: "Finish #145" }));
    expect(work.item).toMatchObject({ kind: "update", scope: "project", projectId: "forager", target: { type: "work_item", id: "wi-145", field: "forecast", newValue: "2026-10-26" } });
    expect(work.item?.commitment).toBeUndefined();
    const milestone = read(promise("I'll have the trend model done by Friday", { targetId: "ms-trend", promise: "Finish the trend model" }));
    expect(milestone.item).toMatchObject({ kind: "update", target: { type: "milestone", id: "ms-trend", field: "forecast", newValue: "2026-10-23" } });
    // With no day it stays a promise about the work, due the next working day
    expect(read(promise("I'll finish #145", { targetId: "wi-145", promise: "Finish #145" })).item).toMatchObject({ kind: "commitment", commitment: { link: { id: "wi-145" }, dueFrom: "none" } });
    // Someone else's record is not his to forecast: it stays his promise
    expect(read(promise("I'll finish #160 tomorrow", { targetId: "wi-160", promise: "Finish #160" })).item).toMatchObject({ kind: "commitment" });
  });

  it("CD5: a promise someone else made is not proposed for the author", () => {
    expect(read(promise("Kyle will send the access request tomorrow")).dropped).toMatchObject({ check: 11, reason: "that is someone else's promise; it is theirs to keep" });
    expect(read(promise("Jodian said she'd send it Friday")).dropped?.check).toBe(11);
    expect(read(promise("He'll send it tomorrow")).dropped?.check).toBe(11);
    // The author's own words keep it theirs, whoever else is named
    expect(read(promise("I'll ask Kyle, he will send it tomorrow")).item?.kind).toBe("commitment");
    expect(read(promise("Mi a go send Kyle di request tumaro")).item?.kind).toBe("commitment");
  });

  it("CD5, rule 10: anyone else, on Kemar's projects or not, and loose words of his never make their promise his", () => {
    // Omar is on none of Kemar's projects; a name-like word before "will" is still someone else
    expect(read(promise("Omar will send the access request tomorrow")).dropped?.check).toBe(11);
    expect(read(promise("Someone will send the access request tomorrow")).dropped?.check).toBe(11);
    // "we'll" and "I can" are not Kemar saying he will do it
    expect(read(promise("Kyle will send the access request tomorrow, we'll see")).dropped?.check).toBe(11);
    expect(read(promise("Kyle will send the access request tomorrow, I can chase him")).dropped?.check).toBe(11);
    // Kemar's own "I'll" about the promised words keeps it his, even with someone else's "will" beside it
    expect(read(promise("I'll send Kyle the access request tomorrow, Andre will review it")).item?.kind).toBe("commitment");
    // His "I'll" about something else does not take Kyle's promise from him
    expect(read(promise("Kyle will send the access request tomorrow, I'll check the dashboard")).dropped?.check).toBe(11);
    // Words that are not people: "It'll be quick, I'll send Kyle the access request tomorrow"
    expect(read(promise("It'll be quick, I'll send Kyle the access request tomorrow")).item?.kind).toBe("commitment");
  });

  it("P10, CM9: a link names only a record of a project the author files into; any other id is dropped, not echoed", () => {
    const { item } = read(promise("I'll send Kyle the access request tomorrow", { targetId: "wi-999" }));
    expect(item?.commitment?.link).toBeNull();
    expect(JSON.stringify(item)).not.toContain("wi-999");
    // A BRAID entry it names
    expect(read(promise("I'll chase Kyle about the feed blocker tomorrow", { targetId: "br-feed-blocker", promise: "Chase Kyle about the feed blocker" })).item?.commitment?.link).toEqual({
      type: "braid_entry",
      id: "br-feed-blocker",
      projectId: "forager",
      label: "Store sales feed access",
    });
  });

  it("recordAtSave, read at the check too: a promise about work already Done is No change", () => {
    expect(read(promise("I'll send Kyle the trends docs for #142 tomorrow", { targetId: "wi-142", promise: "Send Kyle the trends docs" })).item).toMatchObject({ mark: "no_change" });
  });

  it("CM5: the same promise matches a live one of his (Atlas's id, or the same words); the same day is No change", () => {
    const again = read(promise("I'll send Kyle the access request Friday"), { commitments: LIVE });
    expect(again.item?.commitment).toMatchObject({ commitmentId: "cm-1", seenDue: "2026-10-21", dueOn: "2026-10-23" });
    expect(read(promise("I'll send Kyle the access request tomorrow"), { commitments: LIVE }).item).toMatchObject({ mark: "no_change" });
    // Someone else's commitment id is never matched (CD3): only the author's live ones are in the context
    expect(read(promise("I'll send it Friday", { commitmentId: "cm-alicia", promise: "Send it" }), { commitments: LIVE }).item?.commitment?.commitmentId).toBeNull();
    // Two in one message are one card (check 6)
    const r = runChecks([promise("I'll send Kyle the access request Friday"), promise("send Kyle the access request on Friday", { commitmentId: "cm-1" })], { ...KEMAR_CONTEXT, text: "I'll send Kyle the access request Friday, yes I'll send Kyle the access request on Friday.", commitments: LIVE });
    expect(r.items).toHaveLength(1);
  });

  it("CM6: an update that says a live one is done proposes it done; one not his is refused", () => {
    const done = read(promise("Sent Kyle the access request", { newValue: "done", commitmentId: "cm-1", promise: null }), { commitments: LIVE });
    expect(done.item).toMatchObject({ kind: "commitment", scope: "personal", commitment: { act: "done", what: "Send Kyle the access request", commitmentId: "cm-1", dueOn: null } });
    expect(read(promise("Sent Kyle the access request", { newValue: "done", commitmentId: "cm-other" }), { commitments: LIVE }).dropped).toMatchObject({ check: 1, reason: "I couldn't find that among your promises" });
  });

  it("check 13: health words in a promise are kept out, as in any item", () => {
    expect(read(promise("I'll see the doctor tomorrow", { promise: "See the doctor" })).dropped?.check).toBe(13);
  });

  it("a promise needs what was promised", () => {
    expect(read(promise("I'll do it tomorrow", { promise: "  " })).dropped).toMatchObject({ check: 11, reason: "a promise needs what you promised" });
  });
});

describe("readPromiseDate (CM2), against Tuesday 20 Oct", () => {
  const at = new Date("2026-10-20T13:58:00Z");
  it.each([
    ["tomorrow", "2026-10-21", false],
    ["Friday", "2026-10-23", false],
    ["next week", "2026-10-30", true],
    ["early next week", "2026-10-27", true],
    ["by the end of next week", "2026-10-30", true],
    ["end of the week", "2026-10-23", true],
    ["by the weekend", "2026-10-23", true],
    ["end of the month", "2026-10-30", true],
    ["next month", "2026-11-30", true],
    ["this afternoon", "2026-10-20", true],
    ["nex week", "2026-10-30", true],
  ])("%s is %s", (words, day, vague) => {
    expect(readPromiseDate(`I'll do it ${words}`, at)).toMatchObject({ date: day, vague, relative: true });
  });

  it("said on a Saturday, this week is the next working week's Friday", () => {
    expect(readPromiseDate("I'll do it this week", new Date("2026-10-24T15:00:00Z"))?.date).toBe("2026-10-30");
  });

  it("no day at all is null (CD4 is the caller's)", () => {
    expect(readPromiseDate("I'll look into it", at)).toBeNull();
  });
});
