import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Confidence, ExtractedItemDraft, Mark } from "../shared";
import {
  applyItemEvent,
  displayMark,
  ITEM_STATES,
  lowerTo,
  READY_STATES,
  startItem,
  withdrawOpen,
  type ExtractedItem,
  type ItemEvent,
  type ItemState,
} from "./extracted-item";

function draft(over: Partial<ExtractedItemDraft> = {}): ExtractedItemDraft {
  return {
    ordinal: 1,
    kind: "update",
    scope: "project",
    projectId: "forager",
    routing: "routed",
    routingReason: "#145",
    spans: [{ start: 0, end: 10 }],
    confidence: "high",
    mark: "pre_accepted",
    rationale: "said done",
    target: { type: "work_item", id: "145", field: "state", oldValue: "in_progress", newValue: "done" },
    ...over,
  };
}

const at = (state: ItemState, over: Partial<ExtractedItem> = {}): ExtractedItem => ({ ...startItem("i1", draft()), state, ...over });
const ev = (item: ExtractedItem, event: ItemEvent, ctx = {}) => applyItemEvent(item, event, ctx);

describe("extracted item arrows", () => {
  it("starts from the draft's mark", () => {
    expect(startItem("a", draft({ mark: "no_change" })).state).toBe("no_change");
    expect(startItem("a", draft({ mark: "matches_leave", target: { type: "leave", id: "l1", field: "dates", oldValue: "26-30", newValue: "26-30" } })).state).toBe("no_change");
    expect(startItem("a", draft({ mark: "pre_accepted" })).state).toBe("pre_accepted");
    expect(startItem("a", draft({ mark: "needs_ok", confidence: "medium" })).state).toBe("needs_ok");
  });

  it("NoAutoAcceptBelowHigh: a Medium or Low draft marked pre-accepted starts needing an OK", () => {
    for (const confidence of ["medium", "low"] as const) {
      expect(startItem("a", draft({ mark: "pre_accepted", confidence })).state).toBe("needs_ok");
    }
  });

  it("keeps the matches-leave mark for display while counting as no change", () => {
    const leave = startItem("a", draft({ mark: "matches_leave", scope: "personal", projectId: null }));
    expect(displayMark(leave)).toBe("matches_leave");
    expect(displayMark(startItem("b", draft()))).toBe("ready");
  });

  it("the author accepts, edits or rejects a pre-accepted or needs-OK item", () => {
    for (const from of ["pre_accepted", "needs_ok"] as const) {
      expect(ev(at(from), { type: "ACCEPT" }).item).toMatchObject({ state: "accepted", touched: true });
      expect(ev(at(from), { type: "EDIT", value: "blocked" }).item).toMatchObject({ state: "edited", value: "blocked", touched: true });
      expect(ev(at(from), { type: "REJECT" }).item).toMatchObject({ state: "rejected", touched: true });
    }
  });

  it("undo goes back to needs OK and drops the edit", () => {
    for (const from of ["accepted", "edited", "rejected"] as const) {
      const r = ev(at(from, { value: "blocked" }), { type: "UNDO" });
      expect(r.item).toMatchObject({ state: "needs_ok", value: "done" });
    }
  });

  it("withdraws any open item, and never a settled one", () => {
    for (const s of ITEM_STATES) {
      const r = ev(at(s), { type: "WITHDRAW", because: "discarded" });
      expect(r.outcome.ok).toBe(!["no_change", "withdrawn", "applied"].includes(s));
    }
  });

  it("only a ready item can conflict, be found already true, or be applied", () => {
    for (const s of ITEM_STATES) {
      const ready = (READY_STATES as readonly string[]).includes(s);
      expect(ev(at(s), { type: "CONFLICT", current: "cancelled" }).outcome.ok).toBe(ready);
      expect(ev(at(s), { type: "ALREADY_TRUE" }).outcome.ok).toBe(ready);
      expect(ev(at(s), { type: "APPLIED" }).outcome.ok).toBe(ready);
    }
  });

  it("a BRAID item is never found already true", () => {
    const braid = startItem("b", draft({ kind: "braid_new", target: undefined, braid: { kind: "risk", title: "Trend model may slip", match: "new", matchEntryId: null } }));
    expect(ev(braid, { type: "ALREADY_TRUE" }).outcome).toMatchObject({ ok: false });
    expect(braid.value).toBe("Trend model may slip");
  });

  it("refuses arrows that are not drawn", () => {
    expect(ev(at("accepted"), { type: "EDIT", value: "x" }).outcome.ok).toBe(false);
    expect(ev(at("no_change"), { type: "ACCEPT" }).outcome.ok).toBe(false);
    expect(ev(at("applied"), { type: "UNDO" }).outcome.ok).toBe(false);
    expect(ev(at("pre_accepted"), { type: "MARK" }).outcome.ok).toBe(false);
    const item = at("withdrawn");
    expect(ev(item, { type: "ACCEPT" }).item).toBe(item);
  });

  it("withdrawOpen leaves settled items alone", () => {
    const items = [at("accepted"), at("applied"), at("no_change"), at("rejected")];
    expect(withdrawOpen(items, "expired").map((i) => i.state)).toEqual(["withdrawn", "applied", "no_change", "withdrawn"]);
  });

  it("lowerTo never raises", () => {
    expect(lowerTo("low", "high")).toBe("low");
    expect(lowerTo("high", "medium")).toBe("medium");
  });
});

describe("extracted item edge cases", () => {
  it("E5 a poor transcript caps confidence at Medium, so nothing starts ready", () => {
    const item = startItem("a", draft(), { maxConfidence: "medium" });
    expect(item).toMatchObject({ confidence: "medium", state: "needs_ok" });
  });

  it("E21 Kemar rejects a pre-accepted High update", () => {
    expect(ev(startItem("a", draft()), { type: "REJECT" }).item.state).toBe("rejected");
  });

  it("E22 an invalid edit is refused with the reason and the card stays needs OK", () => {
    const item = startItem("a", draft({ mark: "needs_ok", confidence: "medium" }));
    const checkEdit = (v: string) => (v < "2026-10-01" ? "the forecast is before the project starts" : null);
    const r = ev(item, { type: "EDIT", value: "2026-09-01" }, { checkEdit });
    expect(r.outcome).toMatchObject({ ok: false, reason: "the forecast is before the project starts" });
    expect(r.item).toBe(item);
    expect(ev(item, { type: "EDIT", value: "  " }).outcome.ok).toBe(false);
  });

  it("E23 Kemar changes his mind before saving", () => {
    const accepted = ev(startItem("a", draft({ mark: "needs_ok", confidence: "low" })), { type: "ACCEPT" }).item;
    expect(ev(accepted, { type: "UNDO" }).item.state).toBe("needs_ok");
  });

  it("E24 a conflict keeps both values; accepting again records the newly seen value", () => {
    const conflict = ev(startItem("a", draft()), { type: "CONFLICT", current: "cancelled" }).item;
    expect(conflict).toMatchObject({ state: "conflict", saw: "in_progress", conflict: { current: "cancelled" } });
    const again = ev(conflict, { type: "ACCEPT" }).item;
    expect(again).toMatchObject({ state: "accepted", saw: "cancelled", conflict: null });
    const edited = ev(conflict, { type: "EDIT", value: "blocked" }).item;
    expect(edited).toMatchObject({ state: "edited", saw: "cancelled", value: "blocked" });
    expect(ev(conflict, { type: "REJECT" }).item).toMatchObject({ state: "rejected", saw: "in_progress" });
  });

  it("E26 a cancelled target withdraws the item with the reason", () => {
    expect(ev(at("accepted"), { type: "WITHDRAW", because: "target_cancelled" }).item).toMatchObject({ state: "withdrawn", withdrawn: "target_cancelled" });
  });

  it("E27 an apply refused by the target's own table puts the item in conflict with a plain reason", () => {
    const r = ev(at("accepted"), { type: "CONFLICT", current: "to_do", reason: "#145 cannot go from To do to Done" });
    expect(r.item.conflict).toEqual({ current: "to_do", reason: "#145 cannot go from To do to Done" });
  });
});

// Property test: the Capture model's Propose and PersonMarks moves, holding NoAutoAcceptBelowHigh.
describe("extracted items keep the model-checked properties", () => {
  const conf = fc.constantFrom<Confidence>("high", "medium", "low");
  const mark = fc.constantFrom<Mark>("no_change", "matches_leave", "pre_accepted", "needs_ok");
  const step = fc.record({
    i: fc.nat({ max: 2 }),
    event: fc.constantFrom<ItemEvent>(
      { type: "ACCEPT" },
      { type: "EDIT", value: "blocked" },
      { type: "REJECT" },
      { type: "UNDO" },
      { type: "CONFLICT", current: "cancelled" },
      { type: "APPLIED" },
      { type: "WITHDRAW", because: "expired" },
    ),
  });

  it("NoAutoAcceptBelowHigh: below High, only the author makes an item ready", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ confidence: conf, mark, floor: conf }), { minLength: 3, maxLength: 3 }),
        fc.array(step, { maxLength: 30 }),
        (drafts, steps) => {
          let items = drafts.map((d, n) => startItem(`u${n}`, draft({ confidence: d.confidence, mark: d.mark }), { maxConfidence: d.floor }));
          const check = () => {
            for (const it of items) {
              expect(it.confidence).toBe(lowerTo(it.draft.confidence, drafts[Number(it.id.slice(1))].floor));
              if (it.state === "pre_accepted") expect(it.confidence).toBe("high");
              if (it.confidence !== "high" && (READY_STATES as readonly string[]).includes(it.state)) expect(it.touched).toBe(true);
            }
          };
          check();
          for (const s of steps) {
            items = items.map((it, n) => (n === s.i ? applyItemEvent(it, s.event).item : it));
            check();
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
