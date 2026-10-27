// Phase L, M31 Vocabulary change (research model undoAndVocabulary.mjs, VocabularyChange "with the fixes").
// Every arrow, the right checked when APPROVE runs, the clash at the ask and again at APPROVE, and the
// S18 rhythm before expiry.
import { describe, expect, it } from "vitest";
import {
  aliasClashes,
  alreadyNamed,
  applyVocabularyChange,
  VOCAB_REMINDERS,
  vocabularyCauses,
  vocabularyExpiryDue,
  vocabularyKey,
  vocabularyMachine,
  vocabularyReminderDue,
  type VocabularyChangeRecord,
} from "./vocabulary-change";

const TODAY = "2026-10-20"; // Tuesday
const change = (patch: Partial<VocabularyChangeRecord> = {}): VocabularyChangeRecord => ({
  id: "voc-1",
  projectId: "gq",
  kind: "alias",
  word: "Guild",
  personId: null,
  tie: null,
  remove: false,
  proposedBy: "kemar",
  forId: "kemar",
  state: "proposed",
  proposedOn: TODAY,
  remindersSent: 0,
  lastRemindedOn: null,
  decidedBy: null,
  decidedOn: null,
  clashesWith: [],
  ...patch,
});
const alicia = { id: "alicia", role: "pm" as const };
const lead = { id: "andre", role: "lead" as const };
const kemar = { id: "kemar", role: "member" as const };

describe("M31 arrows", () => {
  it("draws only these", () => {
    expect(vocabularyMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)).sort()).toEqual([
      "none PROPOSE proposed",
      "none PROPOSE refused",
      "proposed APPROVE applied",
      "proposed DECLINE declined",
      "proposed EXPIRE expired",
      "proposed REMIND proposed",
    ]);
  });

  it("none --PROPOSE--> proposed; with a clash, refused before it is proposed (UN9)", () => {
    expect(applyVocabularyChange(change({ state: "none" }), { type: "PROPOSE", clashesWith: [] }, null, TODAY).record.state).toBe("proposed");
    expect(applyVocabularyChange(change({ state: "none" }), { type: "PROPOSE", clashesWith: ["insights"] }, null, TODAY).record).toMatchObject({ state: "refused", clashesWith: ["insights"] });
  });

  it("APPROVE by a PM or Lead of the project, as they are when it runs (rule 4); a member's is refused", () => {
    expect(applyVocabularyChange(change(), { type: "APPROVE", clashesWith: [] }, alicia, TODAY).record).toMatchObject({ state: "applied", decidedBy: "alicia", decidedOn: TODAY });
    expect(applyVocabularyChange(change(), { type: "APPROVE", clashesWith: [] }, lead, TODAY).record.state).toBe("applied");
    expect(applyVocabularyChange(change(), { type: "APPROVE", clashesWith: [] }, kemar, TODAY).outcome.ok).toBe(false);
    expect(applyVocabularyChange(change(), { type: "APPROVE", clashesWith: [] }, { id: "alicia", role: null }, TODAY).outcome.ok).toBe(false);
  });

  it("the model's fix: a clash found at APPROVE refuses it; it waits to be declined or to expire", () => {
    const r = applyVocabularyChange(change(), { type: "APPROVE", clashesWith: ["insights"] }, alicia, TODAY);
    expect(r.outcome).toMatchObject({ ok: false, reason: "that word already names another of your projects" });
    expect(r.record.state).toBe("proposed");
  });

  it("UN8: DECLINE by a PM or Lead", () => {
    expect(applyVocabularyChange(change({ kind: "contact", word: null, personId: "dwayne" }), { type: "DECLINE" }, alicia, TODAY).record).toMatchObject({ state: "declined", decidedBy: "alicia" });
    expect(applyVocabularyChange(change(), { type: "DECLINE" }, kemar, TODAY).outcome.ok).toBe(false);
  });

  it("final states take nothing (rule 6: said again, nothing reopens)", () => {
    for (const state of ["applied", "declined", "expired", "refused"] as const) {
      for (const e of [{ type: "APPROVE", clashesWith: [] }, { type: "DECLINE" }, { type: "REMIND" }, { type: "EXPIRE" }, { type: "PROPOSE", clashesWith: [] }] as const) {
        expect(applyVocabularyChange(change({ state }), e, alicia, "2026-12-01").outcome.ok).toBe(false);
      }
    }
  });
});

describe("M31 timers (S18 rhythm, then vocabExpiryDays)", () => {
  it("reminds after 2 working days, then weekly, twice", () => {
    expect(vocabularyReminderDue(change(), "2026-10-21")).toBe(false);
    expect(vocabularyReminderDue(change(), "2026-10-22")).toBe(true);
    const once = applyVocabularyChange(change(), { type: "REMIND" }, null, "2026-10-22").record;
    expect(once).toMatchObject({ remindersSent: 1, lastRemindedOn: "2026-10-22" });
    expect(vocabularyReminderDue(once, "2026-10-28")).toBe(false);
    expect(vocabularyReminderDue(once, "2026-10-29")).toBe(true);
    expect(vocabularyReminderDue(change({ remindersSent: VOCAB_REMINDERS, lastRemindedOn: "2026-10-29" }), "2026-11-20")).toBe(false);
  });

  it("expires after 14 days, never before the reminders (ReminderBeforeExpiry)", () => {
    expect(vocabularyExpiryDue(change({ remindersSent: 2 }), "2026-11-02")).toBe(false);
    expect(vocabularyExpiryDue(change({ remindersSent: 2 }), "2026-11-03")).toBe(true);
    expect(vocabularyExpiryDue(change({ remindersSent: 1 }), "2026-11-20")).toBe(false);
    expect(applyVocabularyChange(change({ remindersSent: 2 }), { type: "EXPIRE" }, null, "2026-11-03").record.state).toBe("expired");
    expect(applyVocabularyChange(change({ remindersSent: 1 }), { type: "EXPIRE" }, null, "2026-11-20").outcome.ok).toBe(false);
  });
});

describe("clashes, keys and causes", () => {
  const projects = [
    { id: "gq", name: "GQ & Academy", aliases: ["GQ", "Academy"] },
    { id: "insights", name: "Store Insights", aliases: ["Sprouts Store Insights"] },
  ];

  it("UN9 and P10: only the projects the person told can open are looked at", () => {
    expect(aliasClashes("academy", "insights", projects)).toEqual(["gq"]);
    expect(aliasClashes("Academy", "gq", projects)).toEqual([]);
    // HX uses "Academy" too, but Kemar cannot open it, so it is never looked at, never named
    expect(aliasClashes("Guild", "gq", projects)).toEqual([]);
  });

  it("a word the project already has is no change", () => {
    expect(alreadyNamed("gq", projects[0])).toBe(true);
    expect(alreadyNamed("Guild", projects[0])).toBe(false);
  });

  it("rule 6: one key per change, whoever says it and however it is cased", () => {
    expect(vocabularyKey(change({ word: "  guild " }))).toBe(vocabularyKey(change({ word: "Guild", proposedBy: null })));
    expect(vocabularyKey(change())).not.toBe(vocabularyKey(change({ remove: true })));
    expect(vocabularyKey(change({ kind: "contact", word: null, personId: "kyle" }))).toBe("gq|contact|kyle|add");
  });

  it("UN9, P10: a refusal is kept under the person refused, so it never stands for anyone else", () => {
    expect(vocabularyKey(change(), "kemar")).not.toBe(vocabularyKey(change()));
    expect(vocabularyKey(change(), "kemar")).not.toBe(vocabularyKey(change(), "andre"));
  });

  it("M10: the PM's and Leads' item holds while it is proposed", () => {
    expect(vocabularyCauses(change())).toEqual(["vocab_change:voc-1"]);
    expect(vocabularyCauses(change({ state: "applied" }))).toEqual([]);
  });
});
