// The scorer itself: the recorded good answer passes the story case, and misses, extras and
// forbidden items are each counted.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT, KEMAR_PROPOSALS } from "../../domain/atlas-checks/kemar-note.fixture";
import { EVAL_CASES } from "./cases";
import type { RawCorrection } from "../../domain/topics/correction";
import { scoreCase } from "./score";

const story = EVAL_CASES.find((c) => c.id === "kemar-note")!;
const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;

describe("scoreCase", () => {
  it("the recorded good answer passes the story case with nothing extra", () => {
    const s = scoreCase(story, KEMAR_PROPOSALS, KEMAR_CONTEXT);
    expect(s).toMatchObject({ pass: true, hit: 10, expected: 10, missing: [], forbidden: [], extra: [] });
  });

  it("counts a missing item", () => {
    const s = scoreCase(story, KEMAR_PROPOSALS.slice(1), KEMAR_CONTEXT);
    expect(s).toMatchObject({ pass: false, missing: ["upd:wi-142.state=done"] });
  });

  it("an empty answer passes a message with nothing to update, and anything at all fails it", () => {
    expect(scoreCase(byId("meetings"), [], KEMAR_CONTEXT).pass).toBe(true);
    const done = { ...KEMAR_PROPOSALS[1], quote: "Quiet day" };
    // The quote is real, so the item passes the checks; the case forbids every item
    expect(scoreCase(byId("meetings"), [done], KEMAR_CONTEXT)).toMatchObject({ pass: false, forbidden: ["upd:wi-145.state=done"] });
  });

  it("E12 an item the case holds fails at High; the checks hold a Patois hedge, so it passes", () => {
    const c = byId("ja-mussi-done");
    const done = { ...KEMAR_PROPOSALS[0], projectId: "insights", targetId: "wi-208", routingReason: { basis: "target" as const, evidence: "#208", label: "#208" }, quote: "Mussi #208 done" };
    expect(scoreCase(c, [done], KEMAR_CONTEXT)).toMatchObject({ pass: true, keys: ["upd:wi-208.state=done"] });
    expect(scoreCase({ ...c, text: "#208 done, mi check it." }, [{ ...done, quote: "#208 done" }], KEMAR_CONTEXT)).toMatchObject({ pass: false, forbidden: ["upd:wi-208.state=done at high"] });
  });

  it("phase D: the records a vague update is unsure between must be the ones expected; a sure case must not be unsure", async () => {
    const { seededDb } = await import("../../test/seeded-db");
    const { caseContext, evalContexts } = await import("./contexts");
    const ctx = caseContext(byId("d-vague-feed"), await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false })));
    const feed = { kind: "update" as const, projectId: "forager", routingReason: { basis: "target" as const, evidence: "store feed", label: "#151" }, targetId: "wi-151", field: "state", newValue: "in_progress", quote: "Worked on the store feed today", confidence: "medium" as const, rationale: "" };
    expect(scoreCase(byId("d-vague-feed"), [{ ...feed, targetOptions: ["wi-151", "wi-152"] }], ctx)).toMatchObject({ pass: true, unsure: "records:wi-151,wi-152", hit: 2, expected: 2 });
    expect(scoreCase(byId("d-vague-feed"), [feed], ctx)).toMatchObject({ pass: false, missing: ["unsure records:wi-151,wi-152"] });
    const named = byId("d-named-feed");
    const sure = { ...feed, targetId: "wi-152", quote: "#152 is in progress" };
    expect(scoreCase(named, [sure], ctx)).toMatchObject({ pass: true, unsure: null });
    expect(scoreCase(named, [{ ...sure, targetOptions: ["wi-152", "wi-151"] }], ctx)).toMatchObject({ pass: false, forbidden: ["unsure records:wi-151,wi-152"] });
  });

  it("phase B: exactly the commands expected count; one more, or one where none is expected, fails", () => {
    const c = byId("b-approve-all");
    const one = (line: number) => ({ act: "approve", lines: [line], reason: null });
    expect(scoreCase(c, [], KEMAR_CONTEXT, null, [one(1), one(2)])).toMatchObject({ pass: true, commands: ["approve@1", "approve@2"], hit: 2, expected: 2 });
    expect(scoreCase(c, [], KEMAR_CONTEXT, null, [one(1)])).toMatchObject({ pass: false, missing: ["approve@2"] });
    // AC7: a guess between two lines is a note, never a card
    expect(scoreCase(byId("b-two-lines-fit"), [], KEMAR_CONTEXT, null, [{ act: "approve", lines: [2, 1], reason: null }])).toMatchObject({ pass: true, commands: ["note:which@1,2"] });
    expect(scoreCase(byId("b-two-lines-fit"), [], KEMAR_CONTEXT, null, [one(1)])).toMatchObject({ pass: false, forbidden: ["decides approve@1"] });
    expect(scoreCase(byId("b-someone-else-approved"), [], KEMAR_CONTEXT, null, [one(1)])).toMatchObject({ pass: false, forbidden: ["decides approve@1"] });
  });

  it("phase L: a correction case passes on the checked correction, in any case, and fails on another or none", () => {
    const c = byId("correction-contact");
    const ctx = { ...KEMAR_CONTEXT, text: c.text };
    const said = (correction: RawCorrection | null) => ({ asked: c.text, topic: "correction", projectId: "insights", correction });
    expect(scoreCase(c, [], ctx, said({ kind: "contact", projectId: "insights", personId: "kyle", notProjectId: "forager" }))).toMatchObject({ pass: true, hit: 1, expected: 1 });
    expect(scoreCase(c, [], ctx, said({ kind: "contact", projectId: "forager", personId: "kyle", notProjectId: "insights" })).pass).toBe(false);
    expect(scoreCase(c, [], ctx, null).pass).toBe(false);
    const alias = byId("correction-alias");
    expect(scoreCase(alias, [], { ...KEMAR_CONTEXT, text: alias.text }, { asked: alias.text, topic: "correction", projectId: "gq", correction: { kind: "alias", projectId: "gq", word: "guild" } }).pass).toBe(true);
  });

  it("every case is well formed: unique ids, and no key both expected and forbidden", () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    for (const c of EVAL_CASES) for (const e of c.expect.flat()) expect(c.forbid ?? []).not.toContain(e);
  });
});
