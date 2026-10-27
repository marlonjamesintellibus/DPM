// M31. Vocabulary change (Ask), phase L of the conversational plan (section 14). Port of
// research/state-machines/js/models/undoAndVocabulary.mjs (VocabularyChange, "with the fixes"). A
// correction ("GQ also means the Guild", "Kyle is Sprouts, not Forager") or, after two moves of the same
// word in review (CD14), Atlas proposes a change to one project's vocabulary: an alias, or a contact tied
// to it. A PM or Lead of that project approves it, checked when they do (rule 4), or declines it; it is
// reminded on the S18 rhythm and expires after config.vocabExpiryDays. Nothing Atlas says applies it.
// The model's fixes: an alias clash is checked against the projects the person being told can open (P10),
// when it is proposed and again at APPROVE, so two waiting proposals for one word cannot both apply.
import { config } from "../config";
import { daysBetween, workingDaysBetween, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { ProjectRole } from "../rights";

// none: drafted, not stored yet (the model's none); PROPOSE stores it at proposed or refused
export const VOCABULARY_STATES = ["none", "proposed", "applied", "declined", "expired", "refused"] as const;
export type VocabularyState = (typeof VOCABULARY_STATES)[number];
export const VOCABULARY_FINAL: readonly VocabularyState[] = ["applied", "declined", "expired", "refused"];

/** The model's REMINDERS: S18 sends two inside the 14 days, and it never expires before them. */
export const VOCAB_REMINDERS = 2;

/**
 * What changes, on one project. alias: another name for it ("Guild" for GQ & Academy). contact: a person
 * tied to it who is not a member (Kyle at Sprouts IT), with the tie the card shows. remove: take it off
 * ("not Forager"), which goes to that project's own PM or Lead.
 * Section 14's third kind, a person tied to a record, is not built: DPM ties people to projects only
 * (memberships and project_contacts), and routing reads a tied person from those, so there is no record
 * tie for a correction to change. It waits for a per-record contact to exist.
 */
export type VocabularyKind = "alias" | "contact";

export type VocabularyChangeRecord = {
  id: string;
  projectId: string;
  kind: VocabularyKind;
  /** alias: the word. */
  word: string | null;
  /** contact: the person, and the tie ("contact (Sprouts IT)"). */
  personId: string | null;
  tie: string | null;
  remove: boolean;
  /** The person who said it, or null when Atlas proposed it from their moves in review (CD14); forId is who it speaks for. */
  proposedBy: string | null;
  forId: string;
  state: VocabularyState;
  proposedOn: IsoDate;
  remindersSent: number;
  lastRemindedOn: IsoDate | null;
  decidedBy: string | null;
  decidedOn: IsoDate | null;
  /** UN9: the project ids the word already names, among those the person told can open. */
  clashesWith: string[];
};

export type VocabularyEvent =
  /** none: the proposal is made, unless the alias clashes (UN9: refused before it is proposed). */
  | { type: "PROPOSE"; clashesWith: readonly string[] }
  /** clashesWith: checked again now, against the projects the approver can open (the model's fix). */
  | { type: "APPROVE"; clashesWith: readonly string[] }
  | { type: "DECLINE" }
  | { type: "REMIND" }
  | { type: "EXPIRE" };

/** The person acting, with their role in the change's project now (rule 4). */
export type VocabularyActor = { id: string; role: ProjectRole | null };

type Ctx = { record: VocabularyChangeRecord; actor: VocabularyActor | null; today: IsoDate };

const decider = ({ actor }: Ctx) => (actor?.role === "pm" || actor?.role === "lead" ? null : "only a PM or Lead of the project decides a change to its vocabulary");

/** S18: the first reminder after 2 working days, then weekly. */
export function vocabularyReminderDue(r: VocabularyChangeRecord, today: IsoDate): boolean {
  if (r.state !== "proposed" || r.remindersSent >= VOCAB_REMINDERS) return false;
  if (r.lastRemindedOn === null) return workingDaysBetween(r.proposedOn, today) >= config.braidReminderWorkingDays;
  return daysBetween(r.lastRemindedOn, today) >= 7;
}

/** Never before the reminders (ReminderBeforeExpiry), and never before vocabExpiryDays. */
export function vocabularyExpiryDue(r: VocabularyChangeRecord, today: IsoDate): boolean {
  return r.state === "proposed" && r.remindersSent >= VOCAB_REMINDERS && daysBetween(r.proposedOn, today) >= config.vocabExpiryDays;
}

export const vocabularyMachine = defineMachine<VocabularyState, VocabularyEvent, Ctx>({
  name: "vocabulary_change",
  states: VOCABULARY_STATES,
  arrows: [
    { from: ["none"], on: "PROPOSE", to: "proposed", guard: (_, e) => (e.clashesWith.length ? "the word already names another project" : null) },
    { from: ["none"], on: "PROPOSE", to: "refused", guard: (_, e) => (e.clashesWith.length ? null : "no clash") },
    // A clash found at APPROVE refuses the approval; the proposal waits, to be declined or to expire
    { from: ["proposed"], on: "APPROVE", to: "applied", guard: (c, e) => decider(c) ?? (e.clashesWith.length ? "that word already names another of your projects" : null) },
    { from: ["proposed"], on: "DECLINE", to: "declined", guard: decider },
    { from: ["proposed"], on: "REMIND", to: "proposed", guard: (c) => (vocabularyReminderDue(c.record, c.today) ? null : "no reminder due") },
    { from: ["proposed"], on: "EXPIRE", to: "expired", guard: (c) => (vocabularyExpiryDue(c.record, c.today) ? null : "not due to expire") },
  ],
});

export type VocabularyResult = { outcome: Outcome<VocabularyState>; record: VocabularyChangeRecord };

/** Applies one event. A refused event returns the record unchanged. Timers pass actor null. */
export function applyVocabularyChange(record: VocabularyChangeRecord, event: VocabularyEvent, actor: VocabularyActor | null, today: IsoDate): VocabularyResult {
  const outcome = transition(vocabularyMachine, record.state, event, { record, actor, today });
  if (!outcome.ok) return { outcome, record };
  const next = { ...record, state: outcome.to };
  switch (event.type) {
    case "PROPOSE":
      return { outcome, record: { ...next, clashesWith: [...event.clashesWith] } };
    case "APPROVE":
    case "DECLINE":
      return { outcome, record: { ...next, decidedBy: actor?.id ?? null, decidedOn: today } };
    case "REMIND":
      return { outcome, record: { ...next, remindersSent: record.remindersSent + 1, lastRemindedOn: today } };
    case "EXPIRE":
      return { outcome, record: next };
  }
}

/** One project's names as routing reads them: its name and aliases. */
export type NamedProject = { id: string; name: string; aliases: readonly string[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * UN9, and the model's fix: the projects among `readable` (those the person being told can open) whose
 * name or an alias is already this word, other than the project it is for. Projects they cannot open are
 * never looked at, so a refusal names, counts or hints at none of them (P10).
 */
export function aliasClashes(word: string, projectId: string, readable: readonly NamedProject[]): string[] {
  return readable.filter((p) => p.id !== projectId && [p.name, ...p.aliases].some((n) => norm(n) === norm(word))).map((p) => p.id);
}

/** The project already has this word as its name or an alias: nothing to propose. */
export function alreadyNamed(word: string, project: NamedProject): boolean {
  return [project.name, ...project.aliases].some((n) => norm(n) === norm(word));
}

/**
 * Rule 6: one proposal per change, whatever its state; the same correction said again changes nothing.
 * UN9, P10: a refusal is the asker's own, found among the projects they can open, so it is kept under
 * `refusedFor` and never answers or stops someone else saying the same thing (they may see no clash).
 */
export function vocabularyKey(c: Pick<VocabularyChangeRecord, "projectId" | "kind" | "word" | "personId" | "remove">, refusedFor: string | null = null): string {
  const key = `${c.projectId}|${c.kind}|${c.kind === "alias" ? norm(c.word ?? "") : c.personId}|${c.remove ? "remove" : "add"}`;
  return refusedFor ? `${key}|refused for ${refusedFor}` : key;
}

/** The inbox cause for the project's PM and Leads while it waits (M10). */
export function vocabularyCauses(r: Pick<VocabularyChangeRecord, "id" | "state">): string[] {
  return r.state === "proposed" ? [`vocab_change:${r.id}`] : [];
}
