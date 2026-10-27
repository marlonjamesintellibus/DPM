import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planSave, saveOutcome, settleItems, targetKey, type CurrentValues, type SavePlan } from "./capture-save";
import { applyCaptureEvent, receiveCapture, type CaptureRecord } from "./machines/capture";
import { applyItemEvent, startItem, withdrawOpen, type ExtractedItem, type ItemEvent } from "./machines/extracted-item";
import type { ExtractedItemDraft } from "./shared";

function update(target: string, oldValue: string | null, newValue: string, over: Partial<ExtractedItemDraft> = {}): ExtractedItemDraft {
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
    rationale: "",
    target: { type: "work_item", id: target, field: "state", oldValue, newValue },
    ...over,
  };
}

function braid(kind: "braid_new" | "braid_same", over: Partial<ExtractedItemDraft> = {}): ExtractedItemDraft {
  return {
    ...update("x", null, "x"),
    kind,
    target: undefined,
    braid: kind === "braid_new" ? { kind: "risk", title: "Trend model may slip to 24 Oct", match: "new", matchEntryId: null } : { kind: "blocker", title: "Store sales feed access", match: "same_as", matchEntryId: "b1" },
    ...over,
  };
}

const SAVING = { state: "saving" as const };
const key = (id: string) => `work_item:${id}:state`;
const move = (item: ExtractedItem, event: ItemEvent) => applyItemEvent(item, event).item;

function applyPlan(plan: SavePlan, db: Record<string, string | null>) {
  if (plan.outcome !== "apply") return;
  for (const w of plan.writes) {
    if (db[w.key] !== w.expected) throw new Error("compare and set failed");
    db[w.key] = w.value;
  }
}

describe("planSave", () => {
  it("writes each ready item over the value it saw", () => {
    const items = [startItem("a", update("145", "in_progress", "done")), move(startItem("b", update("151", "in_progress", "blocked", { mark: "needs_ok", confidence: "medium" })), { type: "ACCEPT" })];
    const plan = planSave(SAVING, items, { [key("145")]: "in_progress", [key("151")]: "in_progress" });
    expect(plan).toMatchObject({
      outcome: "apply",
      writes: [
        { itemId: "a", key: key("145"), expected: "in_progress", value: "done", target: { type: "work_item", id: "145", field: "state" } },
        { itemId: "b", key: key("151"), expected: "in_progress", value: "blocked" },
      ],
      noChange: [],
      conflicts: [],
    });
    expect(settleItems(items, plan).map((i) => i.state)).toEqual(["applied", "applied"]);
    expect(saveOutcome(plan)).toEqual({ type: "SAVE_DONE" });
  });

  it("writes the author's edit, not the draft's value", () => {
    const item = move(startItem("a", update("151", "in_progress", "blocked")), { type: "EDIT", value: "done" });
    const plan = planSave(SAVING, [item], { [key("151")]: "in_progress" });
    expect(plan).toMatchObject({ writes: [{ value: "done" }] });
  });

  it("only plans while the capture is saving, with every item decided", () => {
    const ready = startItem("a", update("145", "in_progress", "done"));
    for (const state of ["reviewing", "saved", "expired"] as const) expect(planSave({ state }, [ready], { [key("145")]: "in_progress" }).outcome).toBe("refused");
    const needsOk = startItem("b", update("151", "in_progress", "blocked", { mark: "needs_ok" }));
    expect(planSave(SAVING, [ready, needsOk], {})).toEqual({ outcome: "refused", reason: "1 not decided" });
    expect(saveOutcome({ outcome: "refused", reason: "x" })).toBeNull();
  });

  it("ignores rejected, withdrawn and no change items", () => {
    const items = [
      move(startItem("a", update("145", "in_progress", "done")), { type: "REJECT" }),
      move(startItem("b", update("151", "in_progress", "blocked")), { type: "WITHDRAW", because: "target_cancelled" }),
      startItem("c", update("142", "done", "done", { mark: "no_change" })),
    ];
    expect(planSave(SAVING, items, {})).toMatchObject({ outcome: "apply", writes: [], braid: [], noChange: [] });
  });

  it("refuses to guess a value nobody read", () => {
    expect(() => planSave(SAVING, [startItem("a", update("145", "in_progress", "done"))], {})).toThrow(/no current value/);
  });

  it("turns BRAID items into REPORT and ADD_SOURCE intents", () => {
    const items = [startItem("n", braid("braid_new")), startItem("s", braid("braid_same"), { saw: "reported" })];
    const plan = planSave(SAVING, items, { "braid_entry:b1:state": "reported" });
    expect(plan).toMatchObject({
      outcome: "apply",
      writes: [],
      braid: [
        { itemId: "n", event: "REPORT", kind: "risk", projectId: "forager", title: "Trend model may slip to 24 Oct", matchEntryId: null },
        { itemId: "s", event: "ADD_SOURCE", kind: "blocker", projectId: "forager", title: "Store sales feed access", matchEntryId: "b1" },
      ],
    });
    expect(settleItems(items, plan).map((i) => i.state)).toEqual(["applied", "applied"]);
    expect(targetKey(items[0])).toBeNull();
  });

  it("S16 a not-filed item is saved with the capture, private, and nothing is applied", () => {
    const item = startItem("p", braid("braid_new", { routing: "not_filed", projectId: null }));
    const plan = planSave(SAVING, [item], {});
    expect(plan).toMatchObject({ outcome: "apply", writes: [], braid: [], keptPrivate: ["p"] });
    expect(saveOutcome(plan)).toEqual({ type: "SAVE_DONE" });
  });

  it("S3 alternative: applying what can leaves only the conflicts for review", () => {
    const items = [startItem("a", update("145", "in_progress", "done")), startItem("b", update("151", "in_progress", "blocked"))];
    const plan = planSave(SAVING, items, { [key("145")]: "in_progress", [key("151")]: "cancelled" }, { applyMode: "what_can" });
    expect(plan).toMatchObject({ outcome: "apply", writes: [{ itemId: "a" }], conflicts: [{ itemId: "b", saw: "in_progress", current: "cancelled" }] });
    expect(settleItems(items, plan).map((i) => i.state)).toEqual(["applied", "conflict"]);
    expect(saveOutcome(plan)).toEqual({ type: "SAVE_FAILED" });
  });
});

describe("saving a capture: edge cases", () => {
  it("E2 the same news from another channel finds the record already changed: no change", () => {
    const item = startItem("app:a", update("145", "in_progress", "done"));
    const plan = planSave(SAVING, [item], { [key("145")]: "done" });
    expect(plan).toMatchObject({ outcome: "apply", writes: [], noChange: ["app:a"] });
    expect(settleItems([item], plan)[0].state).toBe("no_change");
  });

  it("E3 a second session's Save applies nothing twice (once per item ID)", () => {
    const db = { [key("145")]: "in_progress" };
    const stale = [startItem("a", update("145", "in_progress", "done"))];
    const first = planSave(SAVING, stale, db);
    applyPlan(first, db);
    // the other tab still shows the item as ready; the apply log knows it was applied
    const second = planSave(SAVING, stale, db, { alreadyApplied: new Set(["a"]) });
    expect(second).toMatchObject({ outcome: "apply", writes: [], alreadyApplied: ["a"] });
    expect(planSave(SAVING, settleItems(stale, first), db)).toMatchObject({ writes: [], alreadyApplied: ["a"] });
  });

  it("E24 target changed between proposal and save", () => {
    const items = [startItem("a", update("145", "in_progress", "done")), startItem("b", update("151", "in_progress", "blocked"))];
    const plan = planSave(SAVING, items, { [key("145")]: "in_progress", [key("151")]: "cancelled" });
    // all or nothing (S3): #145 is not saved alone while #151 is in conflict
    expect(plan).toEqual({ outcome: "conflict", conflicts: [{ itemId: "b", key: key("151"), saw: "in_progress", current: "cancelled" }] });
    const settled = settleItems(items, plan);
    expect(settled.map((i) => i.state)).toEqual(["pre_accepted", "conflict"]);
    expect(saveOutcome(plan)).toEqual({ type: "SAVE_FAILED" });
    // accepting again records the value Kemar was shown, so the next save writes over it
    const again = settled.map((i) => (i.id === "b" ? move(i, { type: "ACCEPT" }) : i));
    expect(planSave(SAVING, again, { [key("145")]: "in_progress", [key("151")]: "cancelled" })).toMatchObject({ outcome: "apply", writes: [{ itemId: "a" }, { itemId: "b", expected: "cancelled" }] });
  });

  it("E25 target already has the new value", () => {
    const plan = planSave(SAVING, [startItem("a", update("145", "in_progress", "done"))], { [key("145")]: "done" });
    expect(plan).toMatchObject({ outcome: "apply", writes: [], noChange: ["a"] });
  });

  it("E26 a cancelled target's item is withdrawn and not applied", () => {
    const item = move(startItem("a", update("145", "in_progress", "done")), { type: "WITHDRAW", because: "target_cancelled" });
    expect(planSave(SAVING, [item], { [key("145")]: "cancelled" })).toMatchObject({ outcome: "apply", writes: [] });
  });

  it("E27 an apply refused by the target goes back to review with a plain reason", () => {
    const item = startItem("a", update("145", "to_do", "done"));
    const refused = move(item, { type: "CONFLICT", current: "to_do", reason: "#145 cannot go from To do to Done" });
    expect(refused).toMatchObject({ state: "conflict", conflict: { reason: "#145 cannot go from To do to Done" } });
  });

  it("E28 an expired capture is never saved (expiry is final)", () => {
    const items = withdrawOpen([startItem("a", update("145", "in_progress", "done"))], "expired");
    expect(planSave({ state: "expired" }, items, { [key("145")]: "in_progress" }).outcome).toBe("refused");
    expect(planSave(SAVING, items, { [key("145")]: "in_progress" })).toMatchObject({ writes: [] });
  });

  it("E31 a database error mid-apply is retried with the same IDs and plans the same writes", () => {
    const items = [startItem("a", update("145", "in_progress", "done")), startItem("b", update("151", "in_progress", "blocked"))];
    const db = { [key("145")]: "in_progress", [key("151")]: "in_progress" };
    expect(planSave(SAVING, items, db)).toEqual(planSave(SAVING, items, db));
  });

  it("E83 the matched entry changed between review and save", () => {
    const item = startItem("s", braid("braid_same"), { saw: "reported" });
    const plan = planSave(SAVING, [item], { "braid_entry:b1:state": "resolved" });
    expect(plan).toEqual({ outcome: "conflict", conflicts: [{ itemId: "s", key: "braid_entry:b1:state", saw: "reported", current: "resolved" }] });
    // "Report it again (reopens it)": accepting again adds the source to the resolved entry (S14)
    const again = move(settleItems([item], plan)[0], { type: "ACCEPT" });
    expect(planSave(SAVING, [again], { "braid_entry:b1:state": "resolved" })).toMatchObject({ braid: [{ event: "ADD_SOURCE", matchEntryId: "b1" }] });
  });
});

describe("map story: changed-before-save (E24, E25, S3)", () => {
  it("replays the six steps", () => {
    const t1 = key("145");
    const t2 = "milestone:trend:forecast";
    const db: Record<string, string | null> = { [t1]: "in_progress", [t2]: "2026-10-23" };
    let cap: CaptureRecord = { ...(receiveCapture({ dedupKey: "atlas:m1", kind: "text" }, new Set()) as { ok: true; record: CaptureRecord }).record, state: "reviewing" };
    let items = [
      startItem("u1", update("145", "in_progress", "done", { mark: "needs_ok" })),
      startItem("u2", update("trend", "2026-10-23", "2026-10-24", { mark: "needs_ok", confidence: "medium", target: { type: "milestone", id: "trend", field: "forecast", oldValue: "2026-10-23", newValue: "2026-10-24" } })),
    ];
    const save = () => {
      const r = applyCaptureEvent(cap, { type: "SAVE" }, { authorActive: true, isMember: () => true, items });
      expect(r.outcome.ok).toBe(true);
      const plan = planSave(r.record, items, db);
      applyPlan(plan, db);
      items = settleItems(items, plan);
      cap = applyCaptureEvent(r.record, saveOutcome(plan)!).record;
    };
    items = items.map((i) => move(i, { type: "ACCEPT" })); // Kemar accepts both updates
    db[t1] = "done"; // 9:05am GitHub closes #145
    db[t2] = "2026-10-25"; // 9:06am Alicia moves the forecast to 25 Oct
    save(); // Kemar presses Save
    expect(cap.state).toBe("reviewing");
    expect(items.map((i) => i.state)).toEqual(["accepted", "conflict"]);
    expect(items[1].conflict).toEqual({ current: "2026-10-25", reason: null });
    expect(db).toEqual({ [t1]: "done", [t2]: "2026-10-25" }); // nothing changes
    items = items.map((i) => (i.id === "u2" ? move(i, { type: "ACCEPT" }) : i)); // Kemar keeps 24 Oct
    expect(items[1].state).toBe("accepted");
    save(); // Kemar saves
    expect(cap.state).toBe("saved");
    expect(items.map((i) => i.state)).toEqual(["no_change", "applied"]);
    expect(db[t2]).toBe("2026-10-24");
  });
});

// Property test: the CaptureSave model's moves (Accept, Reject, OtherWriter, Save, Remind, Expire) run
// against the real machines and planner, holding its invariants and action properties.
describe("saving a capture keeps the model-checked properties", () => {
  const move = fc.oneof(
    fc.record({ m: fc.constantFrom("accept", "reject", "undo"), u: fc.constantFrom(0, 1) }),
    fc.record({ m: fc.constant("other"), r: fc.constantFrom(0, 1), v: fc.constantFrom("b", "c") }),
    fc.record({ m: fc.constantFrom("save", "remind", "expire"), hours: fc.nat({ max: 8 }), days: fc.nat({ max: 10 }) }),
  );
  const setup = fc.record({ sameTarget: fc.boolean(), startReady: fc.tuple(fc.boolean(), fc.boolean()) });

  it("AllOrNothing, AppliedAtMostOnce, NothingAfterExpiry, ReminderBeforeExpiry, ExpiryIsFinal, NeverOverwriteUnseen, NothingAppliedWithoutConfirm", () => {
    fc.assert(
      fc.property(setup, fc.array(move, { maxLength: 30 }), ({ sameTarget, startReady }, moves) => {
        const targets = sameTarget ? ["t1", "t1"] : ["t1", "t2"];
        const db: Record<string, string | null> = Object.fromEntries(targets.map((t) => [key(t), "a"]));
        const externalDone = new Set<string>();
        const writes = [0, 0];
        let cap: CaptureRecord = { ...(receiveCapture({ dedupKey: "k", kind: "text" }, new Set()) as { ok: true; record: CaptureRecord }).record, state: "reviewing" };
        let items = targets.map((t, n) => startItem(`u${n}`, update(t, "a", "b", startReady[n] ? {} : { mark: "needs_ok", confidence: "medium" })));
        const idx = (id: string) => Number(id.slice(1));

        for (const mv of moves) {
          const before = { cap, items, db: { ...db }, writes: [...writes] };
          if (mv.m === "accept" || mv.m === "reject" || mv.m === "undo") {
            // the model rejects an accepted update in one move; here that is undo, then reject
            if (cap.state !== "reviewing") continue;
            const events: ItemEvent[] = mv.m === "accept" ? [{ type: "ACCEPT" }] : mv.m === "undo" ? [{ type: "UNDO" }] : [{ type: "UNDO" }, { type: "REJECT" }];
            const i = items[mv.u];
            let next = i;
            for (const e of events) {
              const r = applyItemEvent(next, e);
              if (r.outcome.ok || e.type === "UNDO") next = r.item;
            }
            items = items.map((x) => (x === i ? next : x));
          } else if (mv.m === "other") {
            // another writer changes a record once (E24, E25)
            const k = key(targets[mv.r]);
            if (externalDone.has(k) || db[k] === mv.v) continue;
            db[k] = mv.v;
            externalDone.add(k);
          } else if (mv.m === "save") {
            const r = applyCaptureEvent(cap, { type: "SAVE" }, { authorActive: true, isMember: () => true, items });
            if (!r.outcome.ok) continue;
            const plan = planSave(r.record, items, db as CurrentValues);
            if (plan.outcome === "apply") {
              for (const w of plan.writes) {
                // NothingAppliedWithoutConfirm: only a ready item, in a Save that passed its guard
                expect(["pre_accepted", "accepted", "edited"]).toContain(items[idx(w.itemId)].state);
                // NeverOverwriteUnseen: the write lands only over the value this update saw
                expect(db[w.key]).toBe(items[idx(w.itemId)].saw);
                db[w.key] = w.value;
                writes[idx(w.itemId)] += 1;
              }
            }
            items = settleItems(items, plan);
            cap = applyCaptureEvent(r.record, saveOutcome(plan)!).record;
          } else if ("hours" in mv) {
            const elapsed = { workingHours: mv.hours, days: mv.days };
            const r = applyCaptureEvent(cap, { type: mv.m === "remind" ? "REMIND" : "EXPIRE" }, { elapsed });
            if (r.outcome.ok && r.record.state === "expired") items = withdrawOpen(items, "expired");
            cap = r.record;
          }

          // AllOrNothing: nothing is applied while the capture is still in review
          if (cap.state === "reviewing") expect(items.every((i) => i.state !== "applied")).toBe(true);
          // AppliedAtMostOnce
          expect(writes.every((w) => w <= 1)).toBe(true);
          // NothingAfterExpiry and ReminderBeforeExpiry
          if (cap.state === "expired") {
            expect(writes).toEqual([0, 0]);
            expect(cap.reminded).toBe(true);
          }
          // ExpiryIsFinal: nothing about an expired capture changes again
          if (before.cap.state === "expired") {
            expect(cap).toBe(before.cap);
            expect(items).toEqual(before.items);
            expect(writes).toEqual(before.writes);
          }
          // NeverOverwriteUnseen as the model states it: a record changes only by its other writer,
          // or over a value one of its updates saw
          if (mv.m !== "other") {
            for (const k of Object.keys(db)) {
              if (db[k] !== before.db[k]) expect(before.items.some((i) => targetKey(i) === k && i.saw === before.db[k])).toBe(true);
            }
          }
          // an applied item was written once, or its record already had the value (no write needed)
          for (const i of items) if (i.state === "applied") expect(writes[idx(i.id)]).toBe(1);
        }
      }),
      { numRuns: 2000 },
    );
  });
});
