// Atlas may reword a reason draft, never add to it (M11, phase 4).
import { describe, expect, it } from "vitest";
import type { Drafter } from "./extractor";
import { plain, reasonProblem, wordReason } from "./reason";

const FACTS =
  "Store sales feed access has been blocked for 6 days (#151). Trend model is forecast for 24 Oct, 1 day after its target. Risk: Only Kemar can run the pipeline.";
const INPUT = { projectName: "Forager 2.0", status: "Off track", facts: FACTS };

const drafter = (text: string | Error): Drafter => ({
  name: "fake",
  async draft() {
    if (text instanceof Error) throw text;
    return { text, model: "fake", usage: null };
  },
});

describe("reasonProblem", () => {
  it("accepts a rewording that keeps the facts", () => {
    expect(reasonProblem(FACTS, "The store sales feed has been blocked for 6 days (#151), so the trend model is now forecast for 24 Oct, 1 day late.")).toBeNull();
  });

  it.each([
    ["a new work item", "Blocked on #152 for 6 days.", "names #152, which is not in the facts"],
    ["a new number", "Blocked for 9 days (#151).", "adds the number 9"],
    ["a new date", "Now forecast for 27 Oct (#151).", "adds the number 27"],
    ["a judgement", "Kemar is careless with the pipeline (#151).", "mentions health or judges a person"],
    ["health", "Kemar is sick, so the feed is blocked (#151).", "mentions health or judges a person"],
    ["too many sentences", "One. Two. Three. Four.", "more than 3 sentences"],
    ["nothing", "  ", "empty"],
  ])("refuses %s", (_, text, why) => {
    expect(reasonProblem(FACTS, text)).toBe(why);
  });
});

describe("wordReason", () => {
  it("uses Atlas's wording when it only rewords, with plain punctuation", async () => {
    const out = await wordReason(drafter("Forager 2.0 is Off track — the store feed has been blocked for 6 days (#151)."), INPUT);
    expect(out).toMatchObject({ by: "atlas", text: "Forager 2.0 is Off track, the store feed has been blocked for 6 days (#151)." });
  });

  it("falls back to the rules draft when the wording adds a fact", async () => {
    expect(await wordReason(drafter("Blocked for 10 days (#151)."), INPUT)).toEqual({ by: "rules", text: FACTS, fallback: "adds the number 10" });
  });

  it("falls back to the rules draft when the model fails", async () => {
    expect(await wordReason(drafter(new Error("OpenRouter 503: down")), INPUT)).toEqual({ by: "rules", text: FACTS, fallback: "OpenRouter 503: down" });
  });

  it("plain() turns em dashes into commas", () => {
    expect(plain("a — b—c")).toBe("a, b, c");
  });
});
