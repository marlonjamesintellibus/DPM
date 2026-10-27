import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planSave, saveOutcome, settleItems, targetKey } from "../capture-save";
import { config } from "../config";
import { eventsFrom } from "../machine";
import type { Confidence, ExtractedItemDraft } from "../shared";
import {
  applyCaptureEvent,
  CAPTURE_STATES,
  captureDedupKey,
  captureMachine,
  capProposals,
  confidenceCap,
  FINAL_CAPTURE_STATES,
  receiveCapture,
  saveBlockers,
  withdrawForLostProjects,
  type CaptureContext,
  type CaptureEvent,
  type CaptureRecord,
  type CaptureState,
} from "./capture";
import { applyItemEvent, READY_STATES, startItem, withdrawOpen, type ExtractedItem } from "./extracted-item";

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
    rationale: "",
    target: { type: "work_item", id: "145", field: "state", oldValue: "in_progress", newValue: "done" },
    ...over,
  };
}

function fresh(kind: "text" | "voice" = "text", key = "whatsapp:m1"): CaptureRecord {
  const r = receiveCapture({ dedupKey: key, kind }, new Set());
  if (!r.ok) throw new Error(r.reason);
  return r.record;
}

const at = (state: CaptureState, over: Partial<CaptureRecord> = {}): CaptureRecord => ({ ...fresh(), state, ...over });
const ACTIVE: CaptureContext = { authorActive: true, isMember: () => true };
const ev = (record: CaptureRecord, event: CaptureEvent, ctx: CaptureContext = {}) => applyCaptureEvent(record, event, ctx);

/** Runs a capture through to reviewing with these items. */
function reviewing(count = 1): CaptureRecord {
  let r = fresh();
  for (const [e, ctx] of [
    [{ type: "START" }, {}],
    [{ type: "PROPOSALS_READY", count }, {}],
    [{ type: "OPEN_REVIEW" }, ACTIVE],
  ] as [CaptureEvent, CaptureContext][]) {
    const next = ev(r, e, ctx);
    if (!next.outcome.ok) throw new Error(next.outcome.reason);
    r = next.record;
  }
  return r;
}

describe("capture processing arrows", () => {
  it("text goes straight to reading; voice is transcribed first", () => {
    expect(ev(fresh("text"), { type: "START" }).record).toMatchObject({ state: "reading", tries: 1 });
    const voice = ev(fresh("voice"), { type: "START" }).record;
    expect(voice).toMatchObject({ state: "transcribing", tries: 0 });
    expect(ev(voice, { type: "TRANSCRIBED", confidence: "high" }).record).toMatchObject({ state: "reading", tries: 1, transcriptConfidence: "high" });
  });

  it("proposals go to review; none means nothing to update", () => {
    expect(ev(at("reading"), { type: "PROPOSALS_READY", count: 3 }).record).toMatchObject({ state: "proposed", proposals: 3, moreFound: false });
    expect(ev(at("reading"), { type: "PROPOSALS_READY", count: 0 }).record.state).toBe("nothing_to_update");
  });

  it("opening the review needs an author who can still act", () => {
    expect(ev(at("proposed"), { type: "OPEN_REVIEW" }, { authorActive: true }).record.state).toBe("reviewing");
    expect(ev(at("proposed"), { type: "OPEN_REVIEW" }, { authorActive: false }).outcome.ok).toBe(false);
    expect(ev(at("proposed"), { type: "OPEN_REVIEW" }).outcome.ok).toBe(false);
  });

  it("save starts the apply; it ends saved, or back in review", () => {
    const items = [startItem("a", draft())];
    const saving = ev(reviewing(), { type: "SAVE" }, { ...ACTIVE, items }).record;
    expect(saving.state).toBe("saving");
    expect(ev(saving, { type: "SAVE_DONE" }).record.state).toBe("saved");
    expect(ev(saving, { type: "SAVE_FAILED" }).record.state).toBe("reviewing");
  });

  it("save is refused without the context it checks (fails closed)", () => {
    expect(ev(reviewing(), { type: "SAVE" }, { authorActive: true }).outcome.ok).toBe(false);
    expect(ev(reviewing(), { type: "SAVE" }, { items: [], isMember: () => true }).outcome.ok).toBe(false);
  });

  it("discard ends a capture still waiting on its author", () => {
    expect(ev(at("proposed"), { type: "DISCARD" }).record.state).toBe("rejected");
    expect(ev(at("reviewing"), { type: "DISCARD" }).record.state).toBe("rejected");
    expect(ev(at("saving"), { type: "DISCARD" }).outcome.ok).toBe(false);
    expect(ev(at("saved"), { type: "DISCARD" }).outcome.ok).toBe(false);
  });

  it("reminds once after the working hours, in proposed or reviewing", () => {
    const hours = config.reviewReminderWorkingHours;
    for (const s of ["proposed", "reviewing"] as const) {
      expect(ev(at(s), { type: "REMIND" }, { elapsed: { workingHours: hours - 1, days: 0 } }).outcome.ok).toBe(false);
      const r = ev(at(s), { type: "REMIND" }, { elapsed: { workingHours: hours, days: 0 } });
      expect(r.record).toMatchObject({ state: s, reminded: true });
      expect(ev(r.record, { type: "REMIND" }, { elapsed: { workingHours: 99, days: 9 } }).outcome).toMatchObject({ ok: false, reason: "already reminded" });
    }
    expect(ev(at("saving"), { type: "REMIND" }, { elapsed: { workingHours: 99, days: 9 } }).outcome.ok).toBe(false);
  });

  it("expires after the days, and only once reminded (ReminderBeforeExpiry)", () => {
    const days = config.reviewExpiryDays;
    const elapsed = { workingHours: 99, days };
    expect(ev(at("reviewing"), { type: "EXPIRE" }, { elapsed }).outcome).toMatchObject({ ok: false, reason: "the author has not been reminded yet" });
    expect(ev(at("reviewing", { reminded: true }), { type: "EXPIRE" }, { elapsed: { workingHours: 99, days: days - 1 } }).outcome.ok).toBe(false);
    expect(ev(at("proposed", { reminded: true }), { type: "EXPIRE" }, { elapsed }).record.state).toBe("expired");
    expect(ev(at("reviewing", { reminded: true }), { type: "EXPIRE" }, { elapsed }).record.state).toBe("expired");
  });

  it("final states have no way out (ExpiryIsFinal)", () => {
    for (const s of FINAL_CAPTURE_STATES) expect(eventsFrom(captureMachine, s)).toEqual([]);
    // every other state has a named way out (rule 3)
    const stuck = CAPTURE_STATES.filter((s) => !FINAL_CAPTURE_STATES.includes(s) && eventsFrom(captureMachine, s).length === 0);
    expect(stuck).toEqual([]);
  });

  it("refuses arrows that are not drawn", () => {
    expect(ev(at("received"), { type: "SAVE" }, { ...ACTIVE, items: [] }).outcome).toMatchObject({ ok: false, reason: "no arrow from received on SAVE" });
    expect(ev(at("proposed"), { type: "SAVE" }, { ...ACTIVE, items: [] }).outcome.ok).toBe(false);
    expect(ev(at("reading"), { type: "TRANSCRIBED", confidence: "high" }).outcome.ok).toBe(false);
    const saved = at("saved");
    expect(ev(saved, { type: "SAVE_DONE" }).record).toBe(saved);
  });
});

describe("capture processing edge cases", () => {
  it("E1 the same voice note arriving twice is dropped by its dedup key", () => {
    const input = { channel: "whatsapp", author: "kemar", text: "Finished the TikTok ingest", sentAt: new Date("2026-10-20T13:58:00Z") };
    const key = captureDedupKey({ ...input, messageId: "wamid.1" });
    expect(key).toBe("whatsapp:wamid.1");
    const seen = new Set([key]);
    expect(receiveCapture({ dedupKey: key, kind: "voice" }, seen)).toEqual({ ok: false, reason: "already received" });
    // without a message id: same author, text and minute give the same key; other text does not
    const hashed = captureDedupKey(input);
    expect(captureDedupKey({ ...input, sentAt: new Date("2026-10-20T13:58:40Z") })).toBe(hashed);
    expect(captureDedupKey({ ...input, text: "something else" })).not.toBe(hashed);
  });

  it("E3 a second Save from another session is refused; nothing is applied twice", () => {
    const items = [startItem("a", draft())];
    const saving = ev(reviewing(), { type: "SAVE" }, { ...ACTIVE, items }).record;
    expect(ev(saving, { type: "SAVE" }, { ...ACTIVE, items }).outcome.ok).toBe(false);
    const saved = ev(saving, { type: "SAVE_DONE" }).record;
    expect(ev(saved, { type: "SAVE" }, { ...ACTIVE, items }).outcome.ok).toBe(false);
  });

  it("E4 an empty or chatty message has nothing to update", () => {
    expect(ev(at("reading"), { type: "PROPOSALS_READY", count: 0 }).record.state).toBe("nothing_to_update");
  });

  it("E5 a poor transcript caps every item at Medium", () => {
    const voice = ev(ev(fresh("voice"), { type: "START" }).record, { type: "TRANSCRIBED", confidence: "low" }).record;
    expect(confidenceCap(voice)).toBe("medium");
    expect(confidenceCap(fresh("text"))).toBe("high");
    expect(startItem("a", draft(), { maxConfidence: confidenceCap(voice) }).state).toBe("needs_ok");
  });

  it("E7 a very long message keeps the first proposals and says there are more", () => {
    const max = config.maxProposalsPerCapture;
    const drafts = Array.from({ length: max + 5 }, (_, n) => ({ ordinal: max + 5 - n }));
    const { kept, more } = capProposals(drafts);
    expect(kept.map((d) => d.ordinal)).toEqual(Array.from({ length: max }, (_, n) => n + 1));
    expect(more).toBe(5);
    expect(ev(at("reading"), { type: "PROPOSALS_READY", count: max + 5 }).record).toMatchObject({ proposals: max, moreFound: true });
  });

  it("E18 a model that keeps failing is retried, then the capture fails and is kept", () => {
    let r = ev(fresh(), { type: "START" }).record;
    for (let n = 1; n < config.captureMaxTries; n++) {
      r = ev(r, { type: "READ_FAILED", why: "timeout" }).record;
      expect(r.state).toBe("retry_wait");
      r = ev(r, { type: "RETRY" }).record;
      expect(r).toMatchObject({ state: "reading", tries: n + 1 });
    }
    r = ev(r, { type: "READ_FAILED", why: "bad_output" }).record;
    r = ev(r, { type: "RETRY" }).record;
    expect(r).toMatchObject({ state: "failed", tries: config.captureMaxTries, dedupKey: "whatsapp:m1" });
  });

  it("E19 no key or provider down fails the job the same way", () => {
    let r = ev(fresh(), { type: "START" }).record;
    for (let n = 0; n < config.captureMaxTries; n++) r = ev(ev(r, { type: "READ_FAILED", why: "model_error" }).record, { type: "RETRY" }).record;
    expect(r.state).toBe("failed");
  });

  it("E20 Save pressed while 1 needs an OK is refused with the footer's words", () => {
    const items = [startItem("a", draft()), startItem("b", draft({ mark: "needs_ok", confidence: "medium" }))];
    expect(saveBlockers(items)).toEqual({ needsOk: 1, needsProject: 0 });
    expect(ev(reviewing(2), { type: "SAVE" }, { ...ACTIVE, items }).outcome).toMatchObject({ ok: false, reason: "1 needs your OK before this is saved" });
  });

  it("E24 a conflict found at save also blocks the next Save until decided", () => {
    const items = [applyItemEvent(startItem("a", draft()), { type: "CONFLICT", current: "cancelled" }).item];
    expect(ev(reviewing(), { type: "SAVE" }, { ...ACTIVE, items }).outcome.ok).toBe(false);
  });

  it("E28 Kemar never reviews: reminded, then expired, and nothing applied", () => {
    let r = reviewing();
    let items = [startItem("a", draft())];
    r = ev(r, { type: "REMIND" }, { elapsed: { workingHours: 4, days: 0 } }).record;
    r = ev(r, { type: "EXPIRE" }, { elapsed: { workingHours: 40, days: 7 } }).record;
    items = withdrawOpen(items, "expired");
    expect(r.state).toBe("expired");
    expect(items.map((i) => [i.state, i.withdrawn])).toEqual([["withdrawn", "expired"]]);
    expect(planSave(r, items, {}).outcome).toBe("refused");
  });

  it("E29 an author who lost access cannot save; the check runs at Save", () => {
    const items = [startItem("a", draft())];
    expect(ev(reviewing(), { type: "SAVE" }, { ...ACTIVE, authorActive: false, items }).outcome).toMatchObject({ ok: false, reason: "the author can no longer save this capture" });
    expect(ev(reviewing(), { type: "SAVE" }, { authorActive: true, isMember: () => false, items }).outcome).toMatchObject({
      ok: false,
      reason: "no longer a member of forager; withdraw those items first",
    });
  });

  it("E30 an author on leave can still save (permission is role, not presence)", () => {
    expect(ev(reviewing(), { type: "SAVE" }, { ...ACTIVE, items: [startItem("a", draft())] }).record.state).toBe("saving");
  });

  it("E71 an item that needs a project blocks Save, unless the author rejected it", () => {
    const choose = startItem("a", draft({ routing: "choose_project", projectId: null }));
    expect(ev(reviewing(), { type: "SAVE" }, { ...ACTIVE, items: [choose] }).outcome).toMatchObject({ ok: false, reason: "1 needs a project before this is saved" });
    const rejected = applyItemEvent(choose, { type: "REJECT" }).item;
    expect(ev(reviewing(), { type: "SAVE" }, { ...ACTIVE, items: [rejected] }).outcome.ok).toBe(true);
  });

  it("E77 items filed in a project Kemar left are withdrawn at save; the rest save normally", () => {
    const isMember = (p: string) => p === "forager";
    const items = [startItem("a", draft()), startItem("b", draft({ projectId: "store_insights" })), startItem("c", draft({ scope: "personal", projectId: null }))];
    expect(ev(reviewing(3), { type: "SAVE" }, { authorActive: true, isMember, items }).outcome.ok).toBe(false);
    const kept = withdrawForLostProjects(items, isMember);
    expect(kept.map((i) => [i.id, i.state, i.withdrawn])).toEqual([
      ["a", "pre_accepted", null],
      ["b", "withdrawn", "left_project"],
      ["c", "pre_accepted", null],
    ]);
    expect(ev(reviewing(3), { type: "SAVE" }, { authorActive: true, isMember, items: kept }).record.state).toBe("saving");
  });
});

// Property test: random events with random context, holding the job's own rules.
describe("capture processing keeps its rules under any events", () => {
  const event = fc.constantFrom<CaptureEvent>(
    { type: "START" },
    { type: "TRANSCRIBED", confidence: "low" },
    { type: "READ_FAILED", why: "timeout" },
    { type: "RETRY" },
    { type: "PROPOSALS_READY", count: 0 },
    { type: "PROPOSALS_READY", count: 3 },
    { type: "PROPOSALS_READY", count: 40 },
    { type: "OPEN_REVIEW" },
    { type: "SAVE" },
    { type: "SAVE_DONE" },
    { type: "SAVE_FAILED" },
    { type: "DISCARD" },
    { type: "REMIND" },
    { type: "EXPIRE" },
  );
  const step = fc.record({ event, hours: fc.nat({ max: 10 }), days: fc.nat({ max: 10 }), active: fc.boolean() });

  it("retries stop at the limit; the cap holds; expiry follows a reminder; final states stay final", () => {
    fc.assert(
      fc.property(fc.constantFrom<"text" | "voice">("text", "voice"), fc.array(step, { maxLength: 40 }), (kind, steps) => {
        let r = fresh(kind);
        const items = [startItem("a", draft())];
        for (const s of steps) {
          const before = r;
          r = ev(r, s.event, { authorActive: s.active, isMember: () => true, items, elapsed: { workingHours: s.hours, days: s.days } }).record;
          expect(r.tries).toBeLessThanOrEqual(config.captureMaxTries);
          expect(r.proposals).toBeLessThanOrEqual(config.maxProposalsPerCapture);
          if (r.state === "failed") expect(r.tries).toBe(config.captureMaxTries);
          if (r.state === "expired") expect(r.reminded).toBe(true);
          if (FINAL_CAPTURE_STATES.includes(before.state)) expect(r).toBe(before);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

// Property test: the Capture model (Dedup on) replayed on two channels against one plan. Each copy of
// the message is its own capture; the plan changes once because Save compares and sets.
describe("captures keep the Capture model's properties", () => {
  const CHANNELS = ["whatsapp", "app"] as const;
  const UPDATES = { u1: "work_item:145:state", u2: "milestone:trend:forecast" } as const;
  type U = keyof typeof UPDATES;
  const move = fc.oneof(
    fc.record({ m: fc.constantFrom("arrive", "parse", "propose", "save", "discard"), c: fc.constantFrom(...CHANNELS) }),
    fc.record({ m: fc.constant("mark"), c: fc.constantFrom(...CHANNELS), u: fc.constantFrom<U>("u1", "u2"), to: fc.constantFrom("ACCEPT", "EDIT", "REJECT", "UNDO") }),
  );

  it("NothingAppliedWithoutConfirm, AppliedAtMostOnce (with dedup), NoAutoAcceptBelowHigh", () => {
    // Atlas's mark is not trusted: it may say pre-accepted at any confidence, and M3 must hold the line
    const atlas = fc.record({ conf: fc.constantFrom<Confidence>("high", "medium", "low"), preAccept: fc.boolean() });
    fc.assert(
      fc.property(fc.record({ u1: atlas, u2: atlas }), fc.array(move, { maxLength: 40 }), (said, moves) => {
        const plan: Record<string, string | null> = { [UPDATES.u1]: "in_progress", [UPDATES.u2]: "2026-10-23" };
        const NEW: Record<U, string> = { u1: "done", u2: "2026-10-24" };
        const writes: Record<string, number> = {};
        const seen = new Set<string>();
        const cap: Partial<Record<(typeof CHANNELS)[number], { record: CaptureRecord; items: ExtractedItem[] }>> = {};
        for (const mv of moves) {
          const c = cap[mv.c];
          if (mv.m === "arrive") {
            // a WhatsApp retry has the same dedup key as the first copy (E1)
            const r = receiveCapture({ dedupKey: `${mv.c}:m1`, kind: "text" }, seen);
            if (r.ok) {
              cap[mv.c] = { record: r.record, items: [] };
              seen.add(r.record.dedupKey);
            } else expect(c).toBeDefined();
          } else if (!c) continue;
          else if (mv.m === "parse") c.record = ev(c.record, { type: "START" }).record;
          else if (mv.m === "propose" && c.record.state === "reading") {
            c.record = ev(c.record, { type: "PROPOSALS_READY", count: 2 }).record;
            // server checks: the old value comes from the plan now (check 7), then the mark (check 8)
            c.items = (Object.keys(UPDATES) as U[]).map((u) => {
              const [type, id, field] = UPDATES[u].split(":");
              const oldValue = plan[UPDATES[u]];
              const mark = oldValue === NEW[u] ? "no_change" : said[u].preAccept ? "pre_accepted" : "needs_ok";
              const d = draft({ confidence: said[u].conf, mark, target: { type: type as "work_item", id, field, oldValue, newValue: NEW[u] } });
              return startItem(`${mv.c}:${u}`, d);
            });
            c.record = ev(c.record, { type: "OPEN_REVIEW" }, { authorActive: true }).record;
          } else if (mv.m === "mark" && c.record.state === "reviewing") {
            const e = mv.to === "EDIT" ? { type: "EDIT" as const, value: NEW[mv.u] } : { type: mv.to as "ACCEPT" | "REJECT" | "UNDO" };
            c.items = c.items.map((i) => (i.id === `${mv.c}:${mv.u}` ? applyItemEvent(i, e).item : i));
          } else if (mv.m === "discard") {
            const r = ev(c.record, { type: "DISCARD" });
            if (r.outcome.ok) [c.record, c.items] = [r.record, withdrawOpen(c.items, "discarded")];
          } else if (mv.m === "save") {
            const before = c.items;
            const r = ev(c.record, { type: "SAVE" }, { authorActive: true, isMember: () => true, items: c.items });
            if (!r.outcome.ok) continue;
            const p = planSave(r.record, c.items, plan);
            if (p.outcome === "apply") {
              for (const w of p.writes) {
                // NothingAppliedWithoutConfirm: only a ready item, in a Save the author pressed
                expect(READY_STATES).toContain(before.find((i) => i.id === w.itemId)?.state);
                expect(plan[w.key]).toBe(w.expected);
                [plan[w.key], writes[w.key]] = [w.value, (writes[w.key] ?? 0) + 1];
              }
            }
            c.items = settleItems(c.items, p);
            const next = saveOutcome(p);
            if (next) c.record = ev(r.record, next).record;
          }
          for (const ch of Object.values(cap)) {
            for (const i of ch.items) {
              // NoAutoAcceptBelowHigh
              if (i.confidence !== "high" && (READY_STATES as readonly string[]).includes(i.state)) expect(i.touched).toBe(true);
              if (i.state === "applied") expect(ch.record.state).toBe("saved");
            }
          }
          // AppliedAtMostOnce: each record is written once, whichever copy saved it
          for (const key of Object.values(UPDATES)) expect(writes[key] ?? 0).toBeLessThanOrEqual(1);
          // NothingAppliedWithoutConfirm: a changed record was written by an applied item of a saved capture
          for (const key of Object.values(UPDATES)) {
            if (writes[key]) expect(Object.values(cap).some((ch) => ch.record.state === "saved" && ch.items.some((i) => i.state === "applied" && targetKey(i) === key))).toBe(true);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("map stories", () => {
  // Kemar's message from KB A9.1, cut to 2 of its updates
  const u1 = () => startItem("u1", draft({ confidence: "high", mark: "pre_accepted" }));
  const u2 = () =>
    startItem("u2", draft({ ordinal: 2, confidence: "medium", mark: "needs_ok", target: { type: "milestone", id: "trend", field: "forecast", oldValue: "2026-10-23", newValue: "2026-10-24" } }));

  function saveNow(record: CaptureRecord, items: ExtractedItem[], plan: Record<string, string | null>) {
    const r = ev(record, { type: "SAVE" }, { ...ACTIVE, items });
    if (!r.outcome.ok) return { record, items, refused: r.outcome.reason };
    const p = planSave(r.record, items, plan);
    if (p.outcome === "apply") for (const w of p.writes) plan[w.key] = w.value;
    return { record: ev(r.record, saveOutcome(p)!).record, items: settleItems(items, p), refused: null };
  }

  it("kemar-update: nothing reaches the plan until Kemar confirms", () => {
    const plan: Record<string, string | null> = { "work_item:145:state": "in_progress", "milestone:trend:forecast": "2026-10-23" };
    let r = fresh();
    r = ev(r, { type: "START" }).record; // Atlas reads it
    expect(r.state).toBe("reading");
    r = ev(r, { type: "PROPOSALS_READY", count: 2 }).record; // Atlas proposes 2 updates
    let items = [u1(), u2()];
    expect(r.state).toBe("proposed");
    expect(items.map((i) => i.state)).toEqual(["pre_accepted", "needs_ok"]);
    r = ev(r, { type: "OPEN_REVIEW" }, ACTIVE).record;
    expect(saveNow(r, items, plan).refused).toBe("1 needs your OK before this is saved");
    items = items.map((i) => (i.id === "u2" ? applyItemEvent(i, { type: "ACCEPT" }).item : i)); // Kemar confirms the slip
    const saved = saveNow(r, items, plan); // Kemar taps Save
    expect(saved.record.state).toBe("saved");
    expect(saved.items.map((i) => i.state)).toEqual(["applied", "applied"]);
    expect(plan).toEqual({ "work_item:145:state": "done", "milestone:trend:forecast": "2026-10-24" });
  });

  it("sent-twice: the same message from the app changes the plan once", () => {
    const plan: Record<string, string | null> = { "work_item:145:state": "in_progress", "milestone:trend:forecast": "2026-10-23" };
    const seen = new Set<string>();
    const arrive = (key: string) => {
      const got = receiveCapture({ dedupKey: key, kind: "text" }, seen);
      if (!got.ok) return null;
      seen.add(key);
      const read = ev(ev(got.record, { type: "START" }).record, { type: "PROPOSALS_READY", count: 2 }).record;
      return ev(read, { type: "OPEN_REVIEW" }, ACTIVE).record;
    };
    // the app copy is proposed before the WhatsApp copy is saved, so both saw the old values
    const whatsapp = arrive("whatsapp:m1")!;
    expect(arrive("whatsapp:m1")).toBeNull(); // E1: a WhatsApp retry is dropped
    const app = arrive("app:m1")!;
    const accept = (items: ExtractedItem[]) => items.map((i) => (i.state === "needs_ok" ? applyItemEvent(i, { type: "ACCEPT" }).item : i));
    const first = saveNow(whatsapp, accept([u1(), u2()]), plan);
    expect(first.items.map((i) => i.state)).toEqual(["applied", "applied"]);
    const second = saveNow(app, accept([u1(), u2()].map((i) => ({ ...i, id: `app:${i.id}` }))), plan);
    // E2: the second save finds the plan already has the new values
    expect(second.record.state).toBe("saved");
    expect(second.items.map((i) => i.state)).toEqual(["no_change", "no_change"]);
    expect(plan).toEqual({ "work_item:145:state": "done", "milestone:trend:forecast": "2026-10-24" });
    // a copy that arrives after the save is marked no change by the server checks, so it is never applied
    const late = startItem("late:u1", draft({ mark: "no_change", target: { type: "work_item", id: "145", field: "state", oldValue: "done", newValue: "done" } }));
    expect(late.state).toBe("no_change");
  });
});
