// The scorer itself: the recorded good answer passes the story case, and misses, extras and
// forbidden items are each counted.
import { describe, expect, it } from "vitest";
import { KEMAR_CONTEXT, KEMAR_PROPOSALS } from "../../domain/atlas-checks/kemar-note.fixture";
import { EVAL_CASES } from "./cases";
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

  it("every case is well formed: unique ids, and no key both expected and forbidden", () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    for (const c of EVAL_CASES) for (const e of c.expect.flat()) expect(c.forbid ?? []).not.toContain(e);
  });
});
