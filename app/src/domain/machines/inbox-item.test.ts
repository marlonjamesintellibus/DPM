import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyInboxEvent, evaluateCause, LIVE, type InboxItemRef, type InboxPlan } from "./inbox-item";

const KEY = "status_no_reason:project:forager";

function applyPlan(items: InboxItemRef[], plan: InboxPlan): InboxItemRef[] {
  const next = items.map((i) => {
    const c = plan.close.find((x) => x.id === i.id);
    return c ? { ...i, state: c.to } : i;
  });
  if (plan.create) next.push({ id: `item-${plan.create.episode}`, causeKey: KEY, episode: plan.create.episode, state: "open" });
  return next;
}

describe("inbox item arrows", () => {
  it("snoozes and wakes", () => {
    expect(applyInboxEvent("open", { type: "SNOOZE" })).toMatchObject({ ok: true, to: "snoozed" });
    expect(applyInboxEvent("snoozed", { type: "WAKE" })).toMatchObject({ ok: true, to: "open" });
  });

  it("closes as acted only when the owner's action removed the cause", () => {
    expect(applyInboxEvent("open", { type: "CAUSE_GONE", byOwnerAction: true })).toMatchObject({ ok: true, to: "acted" });
    expect(applyInboxEvent("open", { type: "CAUSE_GONE", byOwnerAction: false })).toMatchObject({ ok: true, to: "auto_closed" });
  });

  it("refuses every move out of a closed item (closed means closed)", () => {
    for (const closed of ["acted", "auto_closed"] as const) {
      for (const event of [{ type: "SNOOZE" }, { type: "WAKE" }, { type: "CAUSE_GONE", byOwnerAction: false }] as const) {
        expect(applyInboxEvent(closed, event).ok).toBe(false);
      }
    }
  });
});

describe("evaluateCause", () => {
  it("E60: running the rule twice for the same cause makes one item", () => {
    let items: InboxItemRef[] = [];
    items = applyPlan(items, evaluateCause(KEY, items, true));
    items = applyPlan(items, evaluateCause(KEY, items, true));
    expect(items).toHaveLength(1);
  });

  it("E61: a cause that comes back after its item closed gets a new episode", () => {
    let items: InboxItemRef[] = [];
    items = applyPlan(items, evaluateCause(KEY, items, true));
    items = applyPlan(items, evaluateCause(KEY, items, false));
    items = applyPlan(items, evaluateCause(KEY, items, true));
    expect(items.map((i) => [i.episode, i.state])).toEqual([
      [1, "auto_closed"],
      [2, "open"],
    ]);
  });

  it("E62: a snoozed item closes when its cause goes, and does not wake", () => {
    const items: InboxItemRef[] = [{ id: "a", causeKey: KEY, episode: 1, state: "snoozed" }];
    expect(evaluateCause(KEY, items, false)).toEqual({ create: null, close: [{ id: "a", to: "auto_closed" }] });
  });

  it("ignores items of other causes", () => {
    const other: InboxItemRef[] = [{ id: "x", causeKey: "keep_set_status:project:forager", episode: 1, state: "open" }];
    expect(evaluateCause(KEY, other, true).create).toEqual({ causeKey: KEY, episode: 1 });
  });
});

// Property test: the InboxItem model's moves, holding OneLiveItemPerCause, InboxMatchesCause and ClosedNeverReopens.
describe("inbox items keep the model-checked properties", () => {
  const move = fc.constantFrom("appear", "clear", "evaluate", "act", "snooze", "wake");

  it("one live item per cause; the inbox matches the cause once evaluated; closed never reopens", () => {
    fc.assert(
      fc.property(fc.array(move, { maxLength: 40 }), (moves) => {
        let items: InboxItemRef[] = [];
        let cause = false;
        let dirty = false;
        for (const m of moves) {
          const before = items;
          if (m === "appear" && !cause) [cause, dirty] = [true, true];
          else if (m === "clear" && cause) [cause, dirty] = [false, true];
          else if (m === "evaluate" && dirty) [items, dirty] = [applyPlan(items, evaluateCause(KEY, items, cause)), false];
          else if (m === "act" && cause && items.some((i) => i.state === "open")) {
            cause = false;
            items = applyPlan(items, evaluateCause(KEY, items, false, { byOwnerAction: true }));
            dirty = false;
          } else if (m === "snooze" || m === "wake") {
            const target = items.find((i) => i.state === (m === "snooze" ? "open" : "snoozed"));
            if (target) {
              const o = applyInboxEvent(target.state, { type: m === "snooze" ? "SNOOZE" : "WAKE" });
              if (o.ok) items = items.map((i) => (i.id === target.id ? { ...i, state: o.to } : i));
            }
          }
          const live = items.filter((i) => LIVE.includes(i.state));
          expect(live.length).toBeLessThanOrEqual(1);
          if (!dirty) expect(live.length).toBe(cause ? 1 : 0);
          for (const old of before) {
            if (!LIVE.includes(old.state)) expect(items.find((i) => i.id === old.id)?.state).toBe(old.state);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });
});
