// Section 13: switching a BRAID entry's kind (M15 SWITCH_KIND) and members asking for it (M17).
// Edge cases BK1 to BK19 by ID where the domain decides them; the invariants of
// research/state-machines/js/models/braidKindSwitch.mjs as property tests.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BRAID_KINDS, type BraidKind } from "../rights";
import {
  applyBraidEvent,
  applyToLog,
  draftEntry,
  isOnLog,
  isSwitchable,
  SWITCHABLE_STATES,
  switchedTo,
  switchEnd,
  type BraidActor,
  type BraidEntryRecord,
  type BraidEntryState,
  type BraidLog,
  type BraidSource,
} from "./braid-entry";
import { applyKindRequestEvent, draftKindRequest, kindRequestCauses, kindRequestReminderDue, type KindRequestRecord } from "./kind-request";
import { liveEntryOf, switchKind } from "./kind-switch";
import { mergeEntries, redirectReport, unmergeEntry } from "./match";

const TODAY = "2026-10-21";
const P = "forager";
const kemar: BraidActor = { id: "kemar", role: "member" };
const alicia: BraidActor = { id: "alicia", role: "pm" };
const andre: BraidActor = { id: "andre", role: "lead" };
const outsider: BraidActor = { id: "sam", role: null };
const ctx = (actor: BraidActor | null) => ({ actor, today: TODAY });
const src = (id: string, personId = "kemar"): BraidSource => ({ id, personId, captureId: null, span: null, at: `${TODAY}T09:00:00-05:00` });

function at(id: string, kind: BraidKind, state: BraidEntryState, patch: Partial<BraidEntryRecord> = {}): BraidEntryRecord {
  return { ...draftEntry({ id, projectId: P, kind, title: `the ${kind} ${id}` }), state, reportedBy: "kemar", ownerId: "alicia", sources: [src(`${id}-s1`)], round: 1, ...patch };
}
const logOf = (...entries: BraidEntryRecord[]): BraidLog => Object.fromEntries(entries.map((e) => [e.id, e]));
const sw = (log: BraidLog, id: string, to: BraidKind, actor = alicia, why = "the slip happened", newId = "n1") => switchKind(log, id, to, why, ctx(actor), newId);

describe("where the old entry ends (switchEnd)", () => {
  it.each([
    ["risk", "issue", "realised"],
    ["risk", "blocker", "realised"],
    ["assumption", "issue", "broken"],
    ["assumption", "blocker", "broken"],
    ["dependency", "blocker", "late"],
    ["dependency", "issue", "late"],
    ["assumption", "risk", "switched"], // D33: it might fail, it has not
    ["dependency", "risk", "switched"],
    ["issue", "blocker", "switched"],
    ["blocker", "issue", "switched"],
    ["issue", "risk", "switched"],
    ["risk", "decision", "switched"],
  ] as const)("a %s that becomes a %s ends as %s", (from, to, end) => {
    expect(switchEnd(from, to)).toBe(end);
    const r = sw(logOf(at("e1", from, from === "risk" || from === "dependency" ? "open" : from === "assumption" ? "holding" : "reported")), "e1", to);
    expect(r.outcome.ok && r.outcome.to).toBe(end);
  });

  it("an entry still waiting for approval ends as switched, never realised (BK7)", () => {
    expect(switchEnd("risk", "issue", "proposed")).toBe("switched");
    const r = sw(logOf(at("e1", "risk", "proposed")), "e1", "issue");
    expect(r.outcome.ok && r.outcome.to).toBe("switched");
    expect(r.log.n1.state).toBe("reported");
  });
});

describe("SWITCH_KIND refusals", () => {
  const risk = logOf(at("e1", "risk", "open"));
  it.each([
    ["BK1 the same kind", risk, "risk", alicia, "it is already a risk"],
    ["BK4 a member", risk, "issue", kemar, "only a PM or Lead changes an entry's kind; ask them instead"],
    ["someone outside the project", risk, "issue", outsider, "only a project member can do this"],
  ] as const)("%s", (_, log, to, actor, reason) => {
    const r = sw(log, "e1", to, actor);
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.reason).toBe(reason);
    expect(r.log).toBe(log);
  });

  it("needs a reason", () => {
    const r = sw(risk, "e1", "issue", alicia, "  ");
    expect(r.outcome.ok || r.outcome.reason).toBe("say why the kind changes");
  });

  it.each(["resolved", "declined", "withdrawn", "merged", "switched"] as const)("BK2 a %s entry keeps its kind", (state) => {
    const kind = state === "resolved" ? "issue" : "risk";
    const r = sw(logOf(at("e1", kind, state)), "e1", "blocker");
    expect(r.outcome.ok).toBe(false);
  });

  it.each(["closed", "realised", "confirmed", "broken", "met", "late", "superseded"] as const)("BK2 a %s entry keeps its kind", (state) => {
    const kind = (["closed", "realised"].includes(state) ? "risk" : ["confirmed", "broken"].includes(state) ? "assumption" : state === "superseded" ? "decision" : "dependency") as BraidKind;
    expect(sw(logOf(at("e1", kind, state)), "e1", "blocker").outcome.ok).toBe(false);
  });

  it("BK3 an approved decision is never switched", () => {
    const r = sw(logOf(at("e1", "decision", "approved")), "e1", "issue");
    expect(r.outcome.ok).toBe(false);
    expect(isSwitchable(at("e1", "decision", "approved"))).toBe(false);
  });

  it("applyToLog refuses the switch events: they make or reopen another entry", () => {
    const r = applyToLog(risk, "e1", { type: "SWITCH_KIND", to: "issue", why: "x" }, ctx(alicia));
    expect(r.outcome.ok || r.outcome.reason).toBe("a switch makes or reopens another entry; use switchKind");
  });

  it("every switchable state can switch", () => {
    for (const state of SWITCHABLE_STATES) {
      const kind = BRAID_KINDS.find((k) => k !== "decision" || state === "proposed" || state === "more_info")!;
      const real = state === "open" || state === "mitigating" ? "risk" : state === "holding" ? "assumption" : state === "waiting" ? "dependency" : kind;
      const to = real === "issue" ? "blocker" : "issue";
      expect(sw(logOf(at("e1", real, state)), "e1", to).outcome.ok, `${real} ${state}`).toBe(true);
    }
  });
});

describe("the new entry", () => {
  it("takes the reports, owner and reporter, and the two are linked", () => {
    const r = sw(logOf(at("e1", "risk", "mitigating", { sources: [src("a"), src("b", "jodian")], ownerId: "kemar" })), "e1", "issue");
    const [old, n] = [r.log.e1, r.log.n1];
    expect(r.targetId).toBe("n1");
    expect(old).toMatchObject({ state: "realised", sources: [], switchedBy: "alicia", switchedOn: TODAY, switchReason: "the slip happened", stateBeforeSwitch: "mitigating" });
    expect(n).toMatchObject({ kind: "issue", state: "reported", title: "the risk e1", ownerId: "kemar", reportedBy: "kemar" });
    expect(n.sources.map((s) => s.id)).toEqual(["a", "b"]);
    expect(switchedTo(old)).toBe("n1");
    expect(n.links).toContainEqual({ relation: "switched_from", entryId: "e1" });
  });

  it("lands where a report by the switcher lands: on the log, approved by them", () => {
    const r = sw(logOf(at("e1", "issue", "reported")), "e1", "risk");
    expect(r.log.n1).toMatchObject({ state: "open", decidedBy: "alicia", decidedOn: TODAY });
    expect(isOnLog(r.log.n1)).toBe(true);
  });

  it("BK8 a switch into a decision is proposed and waits for its approvers", () => {
    const r = sw(logOf(at("e1", "issue", "reported")), "e1", "decision", andre);
    expect(r.log.n1).toMatchObject({ state: "proposed", proposedOn: TODAY, decidedBy: null });
  });

  it("a blocker switched in by the PM raises no New blocker alert; by a Lead it does", () => {
    expect(sw(logOf(at("e1", "dependency", "open")), "e1", "blocker", alicia).log.n1.newAlert).toBe(false);
    expect(sw(logOf(at("e1", "dependency", "open")), "e1", "blocker", andre).log.n1.newAlert).toBe(true);
  });

  it("related links follow the entry; conflicts stay with the old one", () => {
    const e1 = at("e1", "risk", "open", { links: [{ relation: "related", entryId: "d1" }] });
    const d1 = at("d1", "dependency", "open", { links: [{ relation: "related", entryId: "e1" }] });
    const r = sw(logOf(e1, d1), "e1", "issue");
    expect(r.log.e1.links).toEqual([{ relation: "switched_to", entryId: "n1" }]);
    expect(r.log.n1.links).toContainEqual({ relation: "related", entryId: "d1" });
    expect(r.log.d1.links).toEqual([{ relation: "related", entryId: "n1" }]);
  });

  it("refuses a new id that is taken", () => {
    const r = sw(logOf(at("e1", "risk", "open"), at("n1", "issue", "reported")), "e1", "issue");
    expect(r.outcome.ok).toBe(false);
  });
});

describe("switching back (BK13, BK14)", () => {
  it("reopens the original as it was, with the reports back", () => {
    const first = sw(logOf(at("e1", "risk", "mitigating")), "e1", "issue");
    const back = sw(first.log, "n1", "risk", alicia, "it has not happened yet", "n2");
    expect(back.targetId).toBe("e1");
    expect(back.log.n2).toBeUndefined();
    expect(back.log.e1).toMatchObject({ state: "mitigating", stateBeforeSwitch: null, switchedBy: null, switchReason: null });
    expect(back.log.e1.sources.map((s) => s.id)).toEqual(["e1-s1"]);
    expect(switchedTo(back.log.e1)).toBeNull();
    expect(back.log.n1).toMatchObject({ state: "switched", sources: [] });
    expect(switchedTo(back.log.n1)).toBe("e1");
  });

  it("BK14 brings the new reports back too", () => {
    const first = sw(logOf(at("e1", "risk", "open")), "e1", "issue");
    const withMore = { ...first.log, n1: { ...first.log.n1, sources: [...first.log.n1.sources, src("later", "jodian")] } };
    const back = sw(withMore, "n1", "risk", alicia, "not yet", "n2");
    expect(back.log.e1.sources.map((s) => s.id)).toEqual(["e1-s1", "later"]);
  });

  it("switching to a third kind makes another entry, and the chain is followed", () => {
    const a = sw(logOf(at("e1", "risk", "open")), "e1", "issue");
    const b = sw(a.log, "n1", "blocker", alicia, "now it stops work", "n2");
    expect(b.log.n2.links).toContainEqual({ relation: "switched_from", entryId: "n1" });
    expect(liveEntryOf(b.log, "e1")).toBe("n2");
  });
});

describe("matching and merging after a switch", () => {
  const switched = sw(logOf(at("e1", "risk", "open"), at("d1", "risk", "open", { sources: [src("d1-s1", "jodian")] })), "e1", "issue").log;

  it("BK12 a report on the old entry goes to the entry it became", () => {
    expect(redirectReport(switched, "e1")).toEqual({ to: "entry", entryId: "n1" });
  });

  it("a report is never added to a switched entry", () => {
    const r = applyBraidEvent(switched.e1, { type: "ADD_SOURCE", projectId: P, kind: "risk", source: src("x") }, ctx(kemar));
    expect(r.outcome.ok).toBe(false);
  });

  it("nothing merges into a switched entry", () => {
    expect(mergeEntries(switched, "d1", "e1", ctx(alicia)).outcome.ok).toBe(false);
  });

  it("BK15 an entry merged into one that was switched later cannot be unmerged", () => {
    const merged = mergeEntries(logOf(at("e1", "risk", "open"), at("d1", "risk", "open", { sources: [src("d1-s1", "jodian")] })), "d1", "e1", ctx(alicia));
    expect(merged.outcome.ok).toBe(true);
    const later = sw(merged.log, "e1", "issue").log;
    expect(later.n1.sources.map((s) => s.id).sort()).toEqual(["d1-s1", "e1-s1"]);
    const r = unmergeEntry(later, "d1", ctx(alicia));
    expect(r.outcome.ok || r.outcome.reason).toBe("the entry it was merged into has changed kind since; it can no longer be unmerged");
  });
});

describe("M17 kind change request", () => {
  const entry = at("e1", "dependency", "open");
  const draft = draftKindRequest({ id: "k1", projectId: P, entryId: "e1", toKind: "blocker" });
  const ask = (e = entry, actor = kemar, why = "Kyle has no date", openRequest = false) => applyKindRequestEvent(draft, { type: "ASK", why }, { entry: e, actor, openRequest, today: TODAY });
  const asked = ask().record;

  it("a member asks and says why; PMs and Leads are asked in the inbox", () => {
    const r = ask();
    expect(r.record).toMatchObject({ state: "asked", askedBy: "kemar", why: "Kyle has no date", askedOn: TODAY });
    expect(kindRequestCauses(r.record)).toEqual(["kind_change:k1"]);
  });

  it.each([
    ["a PM changes it directly", entry, alicia, "x", false, "a PM or Lead changes the kind directly"],
    ["someone outside the project", entry, outsider, "x", false, "only a project member can do this"],
    ["BK3 an approved decision", at("e1", "decision", "approved"), kemar, "x", false, "an approved decision keeps its kind; add a new decision that replaces it"],
    ["BK2 a finished entry", at("e1", "dependency", "met"), kemar, "x", false, "a finished entry keeps its kind"],
    ["BK1 the same kind", at("e1", "blocker", "reported"), kemar, "x", false, "it is already a blocker"],
    ["no reason", entry, kemar, " ", false, "say why the kind should change"],
    ["BK16 a request already waits", entry, kemar, "x", true, "a change is already asked for this entry"],
  ] as const)("refused: %s", (_, e, actor, why, open, reason) => {
    const r = ask(e, actor, why, open);
    expect(r.outcome.ok || r.outcome.reason).toBe(reason);
  });

  it("a PM or Lead switches or keeps it; keeping needs a reason", () => {
    expect(applyKindRequestEvent(asked, { type: "SWITCH" }, { entry, actor: andre, today: TODAY }).record).toMatchObject({ state: "switched", answeredBy: "andre" });
    expect(applyKindRequestEvent(asked, { type: "SWITCH" }, { entry, actor: kemar, today: TODAY }).outcome.ok).toBe(false);
    expect(applyKindRequestEvent(asked, { type: "KEEP", reason: "" }, { entry, actor: alicia, today: TODAY }).outcome.ok).toBe(false);
    const kept = applyKindRequestEvent(asked, { type: "KEEP", reason: "Kyle gave a date" }, { entry, actor: alicia, today: TODAY }).record;
    expect(kept).toMatchObject({ state: "kept", keepReason: "Kyle gave a date" });
    expect(kindRequestCauses(kept)).toEqual([]);
  });

  it("only the person who asked withdraws it", () => {
    expect(applyKindRequestEvent(asked, { type: "WITHDRAW" }, { entry, actor: alicia, today: TODAY }).outcome.ok).toBe(false);
    expect(applyKindRequestEvent(asked, { type: "WITHDRAW" }, { entry, actor: kemar, today: TODAY }).record.state).toBe("withdrawn");
  });

  it("BK17, BK19 it lapses only when the entry can no longer be switched", () => {
    expect(applyKindRequestEvent(asked, { type: "LAPSE" }, { entry, actor: null, today: TODAY }).outcome.ok).toBe(false);
    for (const gone of [at("e1", "dependency", "met"), at("e1", "dependency", "withdrawn"), at("e1", "dependency", "merged")]) {
      expect(applyKindRequestEvent(asked, { type: "LAPSE" }, { entry: gone, actor: null, today: TODAY }).record.state).toBe("lapsed");
    }
  });

  it("reminds after 2 working days, then weekly, and never decides", () => {
    const r: KindRequestRecord = { ...asked, askedOn: "2026-10-16" }; // a Friday
    expect(kindRequestReminderDue(r, "2026-10-19")).toBe(false);
    expect(kindRequestReminderDue(r, "2026-10-20")).toBe(true);
    const reminded = applyKindRequestEvent(r, { type: "REMIND" }, { entry, actor: null, today: "2026-10-20" }).record;
    expect(reminded).toMatchObject({ state: "asked", remindersSent: 1 });
    expect(kindRequestReminderDue(reminded, "2026-10-26")).toBe(false);
    expect(kindRequestReminderDue(reminded, "2026-10-27")).toBe(true);
  });
});

// The model's invariants (braidKindSwitch.mjs), over random runs of switches, reports, merges and unmerges
describe("invariants under random moves", () => {
  type Move = { t: "switch"; id: string; to: BraidKind; actor: BraidActor } | { t: "report"; on: string } | { t: "merge"; from: string; into: string } | { t: "unmerge"; id: string };
  const ids = ["e1", "d1", "n1", "n2", "n3", "n4"];
  const kinds: BraidKind[] = ["risk", "issue", "blocker"];
  const move: fc.Arbitrary<Move> = fc.oneof(
    fc.record({ t: fc.constant("switch" as const), id: fc.constantFrom(...ids), to: fc.constantFrom(...kinds), actor: fc.constantFrom(alicia, kemar) }),
    fc.record({ t: fc.constant("report" as const), on: fc.constantFrom("e1", "d1") }),
    fc.record({ t: fc.constant("merge" as const), from: fc.constantFrom(...ids), into: fc.constantFrom(...ids) }),
    fc.record({ t: fc.constant("unmerge" as const), id: fc.constantFrom(...ids) }),
  );

  it("every report sits on one entry, switched entries hold none, one live entry per chain, redirects end", () => {
    fc.assert(
      fc.property(fc.array(move, { maxLength: 14 }), (moves) => {
        let log = logOf(at("e1", "risk", "open"), at("d1", "risk", "open", { sources: [src("d1-s1", "jodian")] }));
        const issued = new Set(["e1-s1", "d1-s1"]);
        let n = 0;
        for (const m of moves) {
          if (m.t === "switch" && log[m.id]) {
            const r = switchKind(log, m.id, m.to, "why", ctx(m.actor), `n${n + 1}`);
            if (r.outcome.ok) {
              if (r.targetId === `n${n + 1}`) n++;
              expect(m.actor.role).toBe("pm");
              log = r.log;
            }
          } else if (m.t === "report") {
            const target = redirectReport(log, m.on);
            const id = target.to === "new_raised_again" ? null : target.entryId;
            if (!id || !log[id]) continue;
            const s = src(`r${issued.size}`);
            const r = applyBraidEvent(log[id], { type: "ADD_SOURCE", projectId: P, kind: log[id].kind, source: s }, ctx(kemar));
            if (r.outcome.ok) {
              log = { ...log, [id]: r.record };
              issued.add(s.id);
            }
          } else if (m.t === "merge" && log[m.from] && log[m.into]) {
            const r = mergeEntries(log, m.from, m.into, ctx(alicia), "reopen");
            if (r.outcome.ok) log = r.log;
          } else if (m.t === "unmerge" && log[m.id]) {
            const r = unmergeEntry(log, m.id, ctx(alicia));
            if (r.outcome.ok) log = r.log;
          }
          const placed = Object.values(log).flatMap((e) => e.sources.map((s) => s.id));
          expect(placed.sort()).toEqual([...issued].sort());
          for (const e of Object.values(log)) if (switchedTo(e)) expect(e.sources).toEqual([]);
          const roots = Object.values(log)
            .filter((e) => isOnLog(e) && !switchedTo(e))
            .map((e) => {
              let x = e;
              for (let i = 0; i < 20; i++) {
                const from = x.links.find((l) => l.relation === "switched_from")?.entryId;
                if (!from) break;
                x = log[from];
              }
              return x.id;
            });
          expect(new Set(roots).size).toBe(roots.length);
          for (const id of Object.keys(log)) expect(log[liveEntryOf(log, id)] && !switchedTo(log[liveEntryOf(log, id)])).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });
});
