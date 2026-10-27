import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BraidKind, ProjectRole } from "../rights";
import {
  applyBraidEvent,
  applyToLog,
  braidEntryCauses,
  draftEntry,
  type BraidActor,
  type BraidCtx,
  type BraidEntryRecord,
  type BraidLog,
  type BraidSource,
  type ProjectMember,
} from "./braid-entry";
import {
  applyMatchEvent,
  linkConflict,
  matchCandidates,
  matchMachine,
  mergeEntries,
  relatedCandidates,
  saveMatch,
  suggestMatch,
  unmergeEntry,
  type MatchEvent,
  type MatchRecord,
} from "./match";

const TODAY = "2026-10-20";
const P = "forager";

const kemar: BraidActor = { id: "kemar", role: "member" };
const jodian: BraidActor = { id: "jodian", role: "member" };
const alicia: BraidActor = { id: "alicia", role: "pm" };
const andre: BraidActor = { id: "andre", role: "lead" };
const members: ProjectMember[] = [
  { id: "kemar", role: "member" },
  { id: "jodian", role: "member" },
  { id: "alicia", role: "pm" },
  { id: "andre", role: "lead" },
];

const src = (id: string, personId: string): BraidSource => ({ id, personId, captureId: `cap-${id}`, span: { start: 0, end: 12 }, at: `${TODAY}T08:58:00-05:00` });
const ctx = (actor: BraidActor | null): BraidCtx => ({ actor, today: TODAY });

function entry(id: string, kind: BraidKind, by: BraidActor, sourceId: string, projectId = P): BraidEntryRecord {
  const r = applyBraidEvent(draftEntry({ id, projectId, kind, title: id }), { type: "REPORT", source: src(sourceId, by.id) }, ctx(by));
  if (!r.outcome.ok) throw new Error(r.outcome.reason);
  // Entries from before this run: the PM saw their "New blocker" alert long ago
  return r.record.newAlert ? applyBraidEvent(r.record, { type: "ACKNOWLEDGE" }, ctx(alicia)).record : r.record;
}

/** The Match model's log: an open blocker, a resolved one, and a risk. */
function forager(): BraidLog {
  const b2 = entry("b2", "blocker", alicia, "a2");
  return {
    b1: entry("b1", "blocker", alicia, "a1"), // Store sales feed access (Alicia, 6 days ago)
    b2: applyBraidEvent(b2, { type: "RESOLVE" }, ctx(alicia)).record, // Store API outage, resolved last week
    r1: entry("r1", "risk", alicia, "a3"), // Only Kemar can run the pipeline
  };
}

const item = (itemId: string, speaker: BraidActor, kind: BraidKind = "blocker") => ({ itemId, projectId: P, kind, speakerId: speaker.id });
const report = (id: string, by: BraidActor) => ({ newEntryId: `n-${id}`, title: id, ownerId: by.id, source: src(id, by.id) });
const ids = (e: BraidEntryRecord) => e.sources.map((s) => s.id);
const causes = (log: BraidLog) => Object.values(log).flatMap((e) => braidEntryCauses(e, members)).sort();

function confirmed(m: MatchRecord, log: BraidLog, who: BraidActor): MatchRecord {
  const r = applyMatchEvent(m, { type: "CONFIRM", shown: m.entryId ? log[m.entryId].state : null }, log, who.id);
  if (!r.outcome.ok) throw new Error(r.outcome.reason);
  return r.match;
}

describe("match candidates", () => {
  it("same project and same kind, not merged or withdrawn; resolved and declined count", () => {
    let log = forager();
    log = { ...log, x: entry("x", "blocker", alicia, "ax", "insights") };
    const declined = applyBraidEvent(entry("r2", "risk", kemar, "a4"), { type: "DECLINE", reason: "no" }, ctx(alicia)).record;
    log = { ...log, r2: declined, w: applyBraidEvent(entry("w", "blocker", kemar, "aw"), { type: "WITHDRAW" }, ctx(kemar)).record };
    log = mergeEntries({ ...log, m: entry("m", "blocker", kemar, "am") }, "m", "b1", ctx(alicia)).log;
    expect(matchCandidates(log, { projectId: P, kind: "blocker" }).map((e) => e.id)).toEqual(["b1", "b2"]);
    expect(matchCandidates(log, { projectId: P, kind: "risk" }).map((e) => e.id)).toEqual(["r1", "r2"]);
    expect(relatedCandidates(log, { projectId: P, kind: "blocker" }).map((e) => e.id)).toEqual(["r1", "r2"]);
  });

  it("the server keeps only a suggestion it can verify; kinds never merge", () => {
    const log = forager();
    expect(suggestMatch(item("i1", kemar), { state: "same_as", entryId: "b1" }, log)).toMatchObject({ state: "same_as", entryId: "b1", confirmed: false });
    expect(suggestMatch(item("i1", kemar), { state: "same_as", entryId: "r1" }, log)).toMatchObject({ state: "new", entryId: null });
    expect(suggestMatch(item("i1", kemar), { state: "same_as", entryId: "nope" }, log).state).toBe("new");
    expect(suggestMatch(item("i1", kemar), { state: "related_to", entryId: "r1" }, log)).toMatchObject({ state: "related_to", entryId: "r1" });
    expect(suggestMatch(item("i1", kemar), { state: "related_to", entryId: "b1" }, log).state).toBe("new");
  });
});

describe("match arrows", () => {
  const log = forager();
  const sameAs = suggestMatch(item("i1", kemar), { state: "same_as", entryId: "b2" }, log);

  it("the speaker confirms, picks another entry, or says it is different", () => {
    expect(applyMatchEvent(sameAs, { type: "CONFIRM", shown: "resolved" }, log, "kemar").match).toMatchObject({ state: "same_as", confirmed: true, seen: "resolved" });
    expect(applyMatchEvent(sameAs, { type: "PICK", entryId: "b1", shown: "reported" }, log, "kemar").match).toMatchObject({ state: "same_as", entryId: "b1", seen: "reported" });
    expect(applyMatchEvent(sameAs, { type: "DIFFERENT" }, log, "kemar").match).toMatchObject({ state: "new", entryId: null, confirmed: true });
    const isNew = suggestMatch(item("i1", kemar), { state: "new", entryId: null }, log);
    expect(applyMatchEvent(isNew, { type: "CONFIRM", shown: null }, log, "kemar").match).toMatchObject({ state: "new", confirmed: true });
    expect(applyMatchEvent(isNew, { type: "PICK", entryId: "b1", shown: "reported" }, log, "kemar").outcome).toMatchObject({ ok: true, to: "same_as" });
    const related = suggestMatch(item("i1", kemar), { state: "related_to", entryId: "r1" }, log);
    expect(applyMatchEvent(related, { type: "CONFIRM", shown: "open" }, log, "kemar").outcome).toMatchObject({ ok: true, to: "related_to" });
    expect(applyMatchEvent(related, { type: "PICK", entryId: "b1", shown: "reported" }, log, "kemar").outcome).toMatchObject({ ok: true, to: "same_as" });
    expect(applyMatchEvent(related, { type: "DIFFERENT" }, log, "kemar").outcome).toMatchObject({ ok: true, to: "new" });
  });

  it("covers every drawn arrow", () => {
    expect(matchMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)).sort()).toEqual([
      "new CONFIRM new",
      "new PICK same_as",
      "related_to CONFIRM related_to",
      "related_to DIFFERENT new",
      "related_to PICK same_as",
      "same_as CONFIRM same_as",
      "same_as DIFFERENT new",
      "same_as PICK same_as",
    ]);
  });

  it("refuses anyone but the speaker, entries of another kind, and changes after save", () => {
    const refusedWith = (m: MatchRecord, e: Parameters<typeof applyMatchEvent>[1], who: string) => {
      const r = applyMatchEvent(m, e, log, who);
      expect(r.outcome.ok).toBe(false);
      expect(r.match).toBe(m);
    };
    refusedWith(sameAs, { type: "CONFIRM", shown: "resolved" }, "alicia");
    refusedWith(sameAs, { type: "PICK", entryId: "r1", shown: "open" }, "kemar"); // NeverAcrossKinds
    refusedWith(sameAs, { type: "PICK", entryId: "zz", shown: "open" }, "kemar");
    refusedWith(suggestMatch(item("i1", kemar), { state: "new", entryId: null }, log), { type: "DIFFERENT" }, "kemar"); // not drawn
    refusedWith({ ...sameAs, savedTo: "b2" }, { type: "DIFFERENT" }, "kemar");
  });

  it("SourceOnlyAfterConfirm: Atlas's match alone is never saved", () => {
    const r = saveMatch(sameAs, log, report("rep1", kemar), ctx(kemar));
    expect(r).toMatchObject({ ok: false, outcome: "refused" });
    expect(r.log).toBe(log);
  });

  it("only the speaker's save applies, and only once", () => {
    const m = confirmed(sameAs, log, kemar);
    expect(saveMatch(m, log, report("rep1", kemar), ctx(alicia))).toMatchObject({ ok: false, outcome: "refused" });
    const once = saveMatch(m, log, report("rep1", kemar), ctx(kemar));
    expect(once.ok).toBe(true);
    expect(saveMatch(once.match, once.log, report("rep1", kemar), ctx(kemar))).toMatchObject({ ok: false, outcome: "refused", reason: "already saved" });
  });

  it("related_to creates a new entry and links it, never merges", () => {
    const m = confirmed(suggestMatch(item("i1", kemar), { state: "related_to", entryId: "r1" }, log), log, kemar);
    const r = saveMatch(m, log, report("rep1", kemar), ctx(kemar));
    expect(r).toMatchObject({ ok: true, outcome: "created", entryId: "n-rep1" });
    expect(r.log["n-rep1"]).toMatchObject({ kind: "blocker", state: "reported", links: [{ relation: "related", entryId: "r1" }] });
    expect(r.log.r1.links).toEqual([{ relation: "related", entryId: "n-rep1" }]);
    expect(ids(r.log.r1)).toEqual(["a3"]);
  });
});

describe("match edge cases (machines doc 3.8)", () => {
  it("E83 the matched blocker was resolved between review and save: a conflict, then the speaker's choice reopens it", () => {
    let log = forager();
    let m = confirmed(suggestMatch(item("i7", kemar), { state: "same_as", entryId: "b1" }, log), log, kemar);
    log = applyToLog(log, "b1", { type: "RESOLVE" }, ctx(alicia)).log; // Alicia resolved it at 9:05
    const r = saveMatch(m, log, report("rep1", kemar), ctx(kemar));
    expect(r).toMatchObject({ ok: false, outcome: "conflict", entryId: "b1", seen: "reported", now: "resolved" });
    expect(r.log).toBe(log);
    m = r.match;
    expect(m.confirmed).toBe(false);
    // "This blocker was resolved at 9:05. Report it again (reopens it) or drop it?" Kemar reports it again.
    m = applyMatchEvent(m, { type: "CONFIRM", shown: "resolved" }, log, "kemar").match;
    const again = saveMatch(m, log, report("rep1", kemar), ctx(kemar));
    expect(again).toMatchObject({ ok: true, outcome: "attached" });
    expect(again.log.b1).toMatchObject({ state: "reported", resolvedBy: null });
    expect(ids(again.log.b1)).toEqual(["a1", "rep1"]);
  });

  it("E83 the matched entry was merged meanwhile: a conflict; the speaker picks where it went", () => {
    let log: BraidLog = { ...forager(), b3: entry("b3", "blocker", jodian, "a5") };
    let m = confirmed(suggestMatch(item("i7", kemar), { state: "same_as", entryId: "b3" }, log), log, kemar);
    log = mergeEntries(log, "b3", "b1", ctx(alicia)).log;
    const r = saveMatch(m, log, report("rep1", kemar), ctx(kemar));
    expect(r).toMatchObject({ outcome: "conflict", now: "merged" });
    expect(applyMatchEvent(r.match, { type: "CONFIRM", shown: "merged" }, log, "kemar").outcome.ok).toBe(false);
    m = applyMatchEvent(r.match, { type: "PICK", entryId: "b1", shown: "reported" }, log, "kemar").match;
    expect(ids(saveMatch(m, log, report("rep1", kemar), ctx(kemar)).log.b1)).toEqual(["a1", "a5", "rep1"]);
  });

  it("E84 seven people report the same blocker: one entry, seven sources, one 'New blocker' item", () => {
    const people = ["alicia", "kemar", "jodian", "andre", "p5", "p6", "p7"].map((id): BraidActor => ({ id, role: id === "alicia" ? "pm" : id === "andre" ? "lead" : "member" }));
    let log: BraidLog = {};
    let raised = 0;
    for (const [i, who] of people.entries()) {
      const before = causes(log);
      let m = suggestMatch(item(`i${i}`, who), i === 0 ? { state: "new", entryId: null } : { state: "same_as", entryId: "n-r0" }, log);
      if (i > 0) m = confirmed(m, log, who);
      const r = saveMatch(m, log, { ...report(`r${i}`, who), newEntryId: "n-r0" }, ctx(who));
      expect(r.ok).toBe(true);
      log = r.log;
      raised += causes(log).filter((k) => k.startsWith("blocker_new:") && !before.includes(k)).length;
    }
    expect(Object.keys(log)).toEqual(["n-r0"]);
    expect(log["n-r0"].sources).toHaveLength(7);
    expect(raised).toBe(1);
  });

  it("E85 a declined risk reported again matches the declined entry, and the PM decides again", () => {
    let log: BraidLog = { r2: applyBraidEvent(entry("r2", "risk", kemar, "a4"), { type: "DECLINE", reason: "covered" }, ctx(alicia)).record };
    const m = confirmed(suggestMatch(item("i1", jodian, "risk"), { state: "same_as", entryId: "r2" }, log), log, jodian);
    log = saveMatch(m, log, report("rep9", jodian), ctx(jodian)).log;
    expect(log.r2).toMatchObject({ state: "proposed", round: 2 });
    expect(log.r2.answers[0]).toMatchObject({ by: "alicia", act: "decline" });
    expect(causes(log)).toEqual(["approve:r2"]);
  });

  it("E86 'this is different' makes a new entry; the PM merges it later, and unmerges if wrong", () => {
    let log = forager();
    let m = suggestMatch(item("i1", kemar), { state: "same_as", entryId: "b1" }, log);
    m = applyMatchEvent(m, { type: "DIFFERENT" }, log, "kemar").match;
    log = saveMatch(m, log, report("rep1", kemar), ctx(kemar)).log;
    expect(ids(log["n-rep1"])).toEqual(["rep1"]);
    const merged = mergeEntries(log, "n-rep1", "b1", ctx(alicia));
    expect(merged.outcome.ok).toBe(true);
    expect(ids(merged.log.b1)).toEqual(["a1", "rep1"]);
    expect(merged.log["n-rep1"]).toMatchObject({ state: "merged", sources: [], mergedInto: "b1" });
    const back = unmergeEntry(merged.log, "n-rep1", ctx(alicia)).log;
    expect(back["n-rep1"]).toMatchObject({ state: "reported", mergedInto: null });
    expect(ids(back["n-rep1"])).toEqual(["rep1"]);
    expect(ids(back.b1)).toEqual(["a1"]);
  });

  it("E87 a decision that may conflict is linked both ways and nothing is decided", () => {
    let log: BraidLog = { d5: applyBraidEvent(entry("d5", "decision", kemar, "a6"), { type: "APPROVE" }, ctx(andre)).record };
    const m = suggestMatch(item("i11", kemar, "decision"), { state: "new", entryId: null, conflictsWith: ["d5", "r1"] }, log);
    expect(m.conflictsWith).toEqual(["d5"]);
    log = saveMatch(m, log, report("rep11", kemar), ctx(kemar)).log;
    expect(log["n-rep11"]).toMatchObject({ state: "proposed", links: [{ relation: "conflicts_with", entryId: "d5" }] });
    expect(log.d5).toMatchObject({ state: "approved", links: [{ relation: "conflicts_with", entryId: "n-rep11" }] });
  });

  it("linkConflict only links two live decisions in one project", () => {
    const log = { ...forager(), d1: entry("d1", "decision", kemar, "x1"), d2: entry("d2", "decision", kemar, "x2", "insights") };
    expect(linkConflict(log, "d1", "d1").ok).toBe(false);
    expect(linkConflict(log, "d1", "r1").ok).toBe(false);
    expect(linkConflict(log, "d1", "d2").ok).toBe(false);
  });
});

describe("merge and unmerge", () => {
  it("kinds never merge, and only a PM merges", () => {
    const log = forager();
    expect(mergeEntries(log, "b1", "r1", ctx(alicia))).toMatchObject({ outcome: { ok: false }, log });
    expect(mergeEntries(log, "b1", "b2", ctx(andre)).outcome.ok).toBe(false);
    expect(mergeEntries(log, "b1", "zz", ctx(alicia)).outcome.ok).toBe(false);
  });

  it("unmerge only in reverse order; every source ends where it started", () => {
    let log: BraidLog = { ...forager(), b3: entry("b3", "blocker", jodian, "a5") };
    log = mergeEntries(log, "b3", "b1", ctx(alicia)).log;
    log = mergeEntries(log, "b1", "b2", ctx(alicia)).log;
    expect(ids(log.b2)).toEqual(["a2", "a1", "a5"]);
    expect(unmergeEntry(log, "b3", ctx(alicia))).toMatchObject({ outcome: { ok: false, reason: expect.stringMatching(/reverse order/) }, log });
    expect(unmergeEntry(log, "b1", ctx(andre)).outcome.ok).toBe(false); // PM only
    log = unmergeEntry(log, "b1", ctx(alicia)).log;
    log = unmergeEntry(log, "b3", ctx(alicia)).log;
    expect([ids(log.b1), ids(log.b2), ids(log.b3)]).toEqual([["a1"], ["a2"], ["a5"]]);
    expect([log.b1.state, log.b2.state, log.b3.state]).toEqual(["reported", "resolved", "reported"]);
  });
});

describe("use case 1: three reports, one blocker (machine map story one-blocker)", () => {
  it("replays the seven steps", () => {
    let log = forager();
    // Atlas reads Kemar's "still waiting on Kyle for the store feed" and suggests the resolved outage
    let rep1 = suggestMatch(item("rep1", kemar), { state: "same_as", entryId: "b2" }, log);
    expect(rep1.entryId).toBe("b2");
    // Kemar rejects that match and picks the right one
    rep1 = applyMatchEvent(rep1, { type: "PICK", entryId: "b1", shown: "reported" }, log, "kemar").match;
    expect(rep1.entryId).toBe("b1");
    // 9:10am. Kemar saves: 2 reports, no new alert
    log = saveMatch(rep1, log, report("rep1", kemar), ctx(kemar)).log;
    expect(ids(log.b1)).toEqual(["a1", "rep1"]);
    expect(causes(log)).toEqual([]);
    // Jodian mentions the same feed; she confirms the match
    let rep2 = suggestMatch(item("rep2", jodian), { state: "same_as", entryId: "b1" }, log);
    rep2 = confirmed(rep2, log, jodian);
    expect(rep2.entryId).toBe("b1");
    // Jodian saves: one blocker, 3 reports
    log = saveMatch(rep2, log, report("rep2", jodian), ctx(jodian)).log;
    expect(ids(log.b1)).toEqual(["a1", "rep1", "rep2"]);
    // Thursday. Jodian hears Kyle sent the feed: her "it's cleared" goes to Kemar and Alicia
    expect(applyToLog(log, "b1", { type: "RESOLVE" }, ctx(jodian)).outcome.ok).toBe(false);
    log = applyToLog(log, "b1", { type: "PROPOSE_RESOLVE" }, ctx(jodian)).log;
    expect(causes(log)).toEqual(["clear:b1"]);
    // Kemar, whose work it blocked, confirms
    log = applyToLog(log, "b1", { type: "RESOLVE" }, ctx({ ...kemar, ownsBlockedWork: true })).log;
    expect(log.b1).toMatchObject({ state: "resolved", resolvedBy: "kemar" });
    expect(causes(log)).toEqual([]);
  });
});

// Property test: the Match model's moves, holding SourceOnlyAfterConfirm, NeverAcrossKinds, EveryReportOnce,
// UnmergeRestores, ChangedMatchIsAConflict, OneAlertPerNewEntry, BlockerResolvedByOwnerOrLead and NoOrphanItems.
describe("matching keeps the model-checked properties", () => {
  const REPORTS = { rep1: { by: kemar, creates: "n1" }, rep2: { by: jodian, creates: "n2" } } as const;
  type Rep = keyof typeof REPORTS;
  const ROLES: Record<string, ProjectRole> = { alicia: "pm", kemar: "member", jodian: "member" };
  // Owner of the blocked work
  const OWNER: Record<string, string> = { b1: "kemar", b2: "kemar", r1: "alicia", n1: "kemar", n2: "jodian" };
  const SRC_KIND: Record<string, BraidKind> = { a1: "blocker", a2: "blocker", a3: "risk", rep1: "blocker", rep2: "blocker" };
  const ENTRIES = ["b1", "b2", "r1", "n1", "n2"];
  const rep = fc.constantFrom<Rep>("rep1", "rep2");
  const e = fc.constantFrom(...ENTRIES);
  const person = fc.constantFrom("alicia", "kemar", "jodian");
  // Weighted toward the speaker's moves, so confirm, change, save (the conflict path) comes up often
  const move = fc.oneof(
    { arbitrary: fc.record({ m: fc.constant("suggest" as const), r: rep, guess: fc.constantFrom(...ENTRIES, "new") }), weight: 2 },
    { arbitrary: fc.record({ m: fc.constantFrom("confirm" as const, "save" as const), r: rep }), weight: 4 },
    { arbitrary: fc.record({ m: fc.constant("different" as const), r: rep }), weight: 1 },
    { arbitrary: fc.record({ m: fc.constant("pick" as const), r: rep, e }), weight: 2 },
    { arbitrary: fc.record({ m: fc.constant("resolve" as const), p: person, e }), weight: 2 },
    { arbitrary: fc.record({ m: fc.constant("merge" as const), x: e, y: e }), weight: 2 },
    { arbitrary: fc.record({ m: fc.constantFrom("unmerge" as const, "ack" as const), e }), weight: 1 },
  );

  it("SourceOnlyAfterConfirm, NeverAcrossKinds, EveryReportOnce, UnmergeRestores, ChangedMatchIsAConflict, OneAlertPerNewEntry, BlockerResolvedByOwnerOrLead", () => {
    fc.assert(
      fc.property(fc.array(move, { maxLength: 30, size: "max" }), (moves) => {
        let log = forager();
        const matches: Partial<Record<Rep, MatchRecord>> = {};
        const saved: Record<string, boolean> = { rep1: false, rep2: false };
        const alerts: Record<string, number> = Object.fromEntries(ENTRIES.map((x) => [x, 0]));
        const actor = (p: string, x?: string): BraidActor => ({ id: p, role: ROLES[p], ownsBlockedWork: x !== undefined && OWNER[x] === p });
        for (const mv of moves) {
          const before = log;
          const causesBefore = causes(log);
          if (mv.m === "suggest") {
            if (!matches[mv.r]) {
              const by = REPORTS[mv.r].by;
              matches[mv.r] = suggestMatch(item(mv.r, by), mv.guess === "new" ? { state: "new", entryId: null } : { state: "same_as", entryId: mv.guess }, log);
            }
          } else if (mv.m === "confirm" || mv.m === "different" || mv.m === "pick") {
            const m = matches[mv.r];
            if (m) {
              const shownOf = (id: string | null) => (id && log[id] ? log[id].state : null);
              let event: MatchEvent = { type: "DIFFERENT" };
              if (mv.m === "confirm") event = { type: "CONFIRM", shown: shownOf(m.entryId) };
              if (mv.m === "pick") event = { type: "PICK", entryId: mv.e, shown: shownOf(mv.e) ?? "none" };
              matches[mv.r] = applyMatchEvent(m, event, log, REPORTS[mv.r].by.id).match;
            }
          } else if (mv.m === "save") {
            const m = matches[mv.r];
            if (m) {
              const { by, creates } = REPORTS[mv.r];
              const r = saveMatch(m, log, { newEntryId: creates, title: creates, ownerId: by.id, source: src(mv.r, by.id) }, ctx(by));
              if (r.ok && r.outcome === "attached") {
                // SourceOnlyAfterConfirm and ChangedMatchIsAConflict
                expect(m.confirmed).toBe(true);
                expect(before[r.entryId].state).toBe(m.seen);
              }
              if (r.ok) saved[mv.r] = true;
              else if (r.outcome === "conflict") expect(r.log).toBe(before);
              log = r.log;
              matches[mv.r] = r.match;
            }
          } else if (mv.m === "resolve") {
            if (log[mv.e]) {
              const r = applyToLog(log, mv.e, { type: "RESOLVE" }, ctx(actor(mv.p, mv.e)));
              log = r.outcome.ok ? r.log : applyToLog(log, mv.e, { type: "PROPOSE_RESOLVE" }, ctx(actor(mv.p, mv.e))).log;
            }
          } else if (mv.m === "merge") {
            log = mergeEntries(log, mv.x, mv.y, ctx(alicia)).log;
          } else if (mv.m === "unmerge") {
            const r = unmergeEntry(log, mv.e, ctx(alicia));
            if (r.outcome.ok) {
              // UnmergeRestores
              const target = before[mv.e].mergedInto!;
              expect(ids(r.log[mv.e])).toEqual(before[mv.e].mergedSources.map((s) => s.id));
              for (const id of ids(r.log[mv.e])) expect(ids(r.log[target])).not.toContain(id);
            }
            log = r.log;
          } else if (mv.m === "ack" && log[mv.e]) {
            log = applyToLog(log, mv.e, { type: "ACKNOWLEDGE" }, ctx(alicia)).log;
          }

          const now = causes(log);
          for (const k of now) if (k.startsWith("blocker_new:") && !causesBefore.includes(k)) alerts[k.split(":")[1]]++;
          for (const x of Object.values(log)) {
            // NeverAcrossKinds
            for (const s of x.sources) expect(SRC_KIND[s.id]).toBe(x.kind);
            if (x.mergedInto) expect(log[x.mergedInto].kind).toBe(x.kind);
            // BlockerResolvedByOwnerOrLead
            if (before[x.id]?.state === "reported" && x.state === "resolved") {
              expect(x.resolvedBy === OWNER[x.id] || ["pm", "lead"].includes(ROLES[x.resolvedBy!])).toBe(true);
            }
            // NoOrphanItems
          }
          for (const k of now) {
            const [kind, id] = k.split(":");
            expect(log[id].state).toBe(kind === "approve" || kind === "no_decider" ? "proposed" : kind === "more_info" ? "more_info" : "reported");
          }
          // EveryReportOnce: every earlier source and every saved report is held by exactly one entry
          for (const id of Object.keys(SRC_KIND)) {
            const held = Object.values(log).filter((x) => ids(x).includes(id)).length;
            expect(held).toBe(id in saved && !saved[id] ? 0 : 1);
          }
          // OneAlertPerNewEntry
          for (const x of ENTRIES) expect(alerts[x]).toBe(["n1", "n2"].includes(x) && log[x] ? 1 : 0);
        }
      }),
      { numRuns: 2000 },
    );
  });
});
