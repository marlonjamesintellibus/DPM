// Phase L, M31. Vocabulary change (conversational plan, section 14): corrections teach Atlas. "GQ also
// means the Guild", "Kyle is Sprouts, not Forager", or the same word moved in review twice (CD14) proposes a
// change to one project's vocabulary for a PM or Lead of that project, through their inbox (M10). Nothing
// changes until one of them approves it, checked when they do (rule 4). Once applied, the check context
// reads it (queries/check-context.ts), so Atlas routes by it next time.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { loadWorld, orgTagsOf } from "../db/records";
import * as t from "../db/schema";
import { actorIn, isCandidate, type World } from "../domain/machines/membership";
import {
  aliasClashes,
  alreadyNamed,
  applyVocabularyChange,
  vocabularyExpiryDue,
  vocabularyKey,
  vocabularyReminderDue,
  type NamedProject,
  type VocabularyChangeRecord,
  type VocabularyEvent,
  type VocabularyKind,
} from "../domain/machines/vocabulary-change";
import { changeLabel } from "../queries/answers/correction";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, todayOf, type CommandCtx } from "./core";
import { evaluateProject } from "./evaluate";
import { notice } from "./notices";

export type VocabularyRow = typeof t.vocabularyChanges.$inferSelect;

export function vocabularyOf(row: VocabularyRow): VocabularyChangeRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    word: row.word,
    personId: row.personId,
    tie: row.tie,
    remove: row.remove,
    proposedBy: row.proposedBy,
    forId: row.forId,
    state: row.state,
    proposedOn: row.proposedOn,
    remindersSent: row.remindersSent,
    lastRemindedOn: row.lastRemindedOn,
    decidedBy: row.decidedBy,
    decidedOn: row.decidedOn,
    clashesWith: row.clashesWith,
  };
}

/** The projects a person can open, by their names (P10: nobody else's are ever looked at). */
async function readableNamed(tx: Tx, personId: string, world: World): Promise<NamedProject[]> {
  const orgTags = await orgTagsOf(tx, personId);
  const ids = world.projects.filter((p) => isCandidate(personId, orgTags, p.id, world)).map((p) => p.id);
  if (!ids.length) return [];
  return tx.select({ id: t.projects.id, name: t.projects.name, aliases: t.projects.aliases }).from(t.projects).where(inArray(t.projects.id, ids));
}

export type CorrectionInput = {
  projectId: string;
  kind: VocabularyKind;
  word?: string | null;
  personId?: string | null;
  remove?: boolean;
  /** The person who said it, or null when Atlas proposes it from their moves in review (CD14). */
  proposedBy: string | null;
  forId: string;
  captureId?: string | null;
};

/** already: the project already reads it that way (or has nothing to remove); nothing is proposed. */
export type Proposal = { kind: "already" } | { kind: "change"; change: VocabularyChangeRecord; fresh: boolean };

/**
 * Proposes one change, inside a command's transaction. Rule 6: the same change said again changes
 * nothing, whatever its proposal's state. UN9: an alias already naming another project the person told
 * can open is refused before it is proposed, and the refusal names only those projects.
 */
export async function proposeVocabularyChange(tx: Tx, now: Date, input: CorrectionInput): Promise<Proposal> {
  const world = await loadWorld(tx);
  const remove = input.remove ?? false;
  const word = input.kind === "alias" ? (input.word ?? "").trim().replace(/\s+/g, " ") : null;
  const personId = input.kind === "contact" ? (input.personId ?? null) : null;
  if (input.kind === "alias" && (word!.length < 2 || word!.length > 40)) throw new CommandRefused("a name for a project is 2 to 40 characters");
  if (input.kind === "contact" && !personId) throw new CommandRefused("say who the contact is");
  // Only a project the person can open; anything else reads as not found (P10)
  if (!isCandidate(input.forId, await orgTagsOf(tx, input.forId), input.projectId, world)) throw new CommandRefused("not one of your projects", "not_found");

  const [project] = await tx.select().from(t.projects).where(eq(t.projects.id, input.projectId));
  const contacts = await tx.select().from(t.projectContacts).where(eq(t.projectContacts.projectId, input.projectId));
  const has = input.kind === "alias" ? alreadyNamed(word!, project) : contacts.some((c) => c.personId === personId);
  const member = personId !== null && world.memberships.some((m) => m.projectId === input.projectId && m.personId === personId && m.state === "member");
  if (remove ? !has || (input.kind === "alias" && word!.toLowerCase() === project.name.toLowerCase()) : has || member) return { kind: "already" };

  const draft: VocabularyChangeRecord = {
    id: `voc-${randomUUID()}`,
    projectId: input.projectId,
    kind: input.kind,
    word,
    personId,
    tie: null,
    remove,
    proposedBy: input.proposedBy,
    forId: input.forId,
    state: "none",
    proposedOn: todayOf(now),
    remindersSent: 0,
    lastRemindedOn: null,
    decidedBy: null,
    decidedOn: null,
    clashesWith: [],
  };
  const key = vocabularyKey(draft);
  const [seen] = await tx.select().from(t.vocabularyChanges).where(eq(t.vocabularyChanges.dedupKey, key));
  if (seen) return { kind: "change", change: vocabularyOf(seen), fresh: false };

  if (personId) {
    const [person] = await tx.select({ title: t.people.title }).from(t.people).where(eq(t.people.id, personId));
    draft.tie = person?.title ? `contact (${person.title})` : "contact";
  }
  const clashes = input.kind === "alias" && !remove ? aliasClashes(word!, input.projectId, await readableNamed(tx, input.forId, world)) : [];
  const r = applyVocabularyChange(draft, { type: "PROPOSE", clashesWith: clashes }, null, todayOf(now));
  const m = moved(r.outcome);
  const c = r.record;
  await tx.insert(t.vocabularyChanges).values({ ...c, captureId: input.captureId ?? null, dedupKey: key, createdAt: now, updatedAt: now });
  await audit(tx, now, {
    actorType: input.proposedBy ? "person" : "atlas",
    actorId: input.proposedBy,
    action: m.event,
    machine: "vocabulary_change",
    subjectType: "vocabulary_change",
    subjectId: c.id,
    fromState: m.from,
    toState: m.to,
    captureId: input.captureId ?? null,
    detail: { projectId: c.projectId, kind: c.kind, word: c.word, personId: c.personId, remove: c.remove, forId: c.forId, clashesWith: c.clashesWith },
  });
  if (c.state === "proposed") await evaluateProject(tx, c.projectId, now);
  return { kind: "change", change: c, fresh: true };
}

/** A PM or Lead of the project approves or declines. The right and, for an alias, the clash are checked now. */
export function decideVocabularyChange(ctx: CommandCtx, changeId: string, act: "approve" | "decline"): Promise<VocabularyChangeRecord> {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.vocabularyChanges).where(eq(t.vocabularyChanges.id, changeId));
    if (!row) throw new CommandRefused(`no change ${changeId}`, "not_found");
    const world = await loadWorld(tx);
    const actor = { id: ctx.actorId, role: actorIn(ctx.actorId, row.projectId, world.memberships).role };
    if (!actor.role) throw new CommandRefused(`no change ${changeId}`, "not_found");
    const before = vocabularyOf(row);
    let event: VocabularyEvent = { type: "DECLINE" };
    if (act === "approve") {
      // The model's fix: two waiting proposals for one word cannot both apply; only what the approver can open is checked (P10)
      const clashes = before.kind === "alias" && !before.remove ? aliasClashes(before.word!, before.projectId, await readableNamed(tx, ctx.actorId, world)) : [];
      event = { type: "APPROVE", clashesWith: clashes };
      if (clashes.length) {
        const names = (await readableNamed(tx, ctx.actorId, world)).filter((p) => clashes.includes(p.id)).map((p) => p.name);
        throw new CommandRefused(`"${before.word}" already names ${names.join(" and ")}. Decline it, or take it off that project first`);
      }
    }
    const r = applyVocabularyChange(before, event, actor, todayOf(ctx.now));
    const m = moved(r.outcome);
    const rows = await tx
      .update(t.vocabularyChanges)
      .set({ state: r.record.state, decidedBy: r.record.decidedBy, decidedOn: r.record.decidedOn, version: nextVersion(t.vocabularyChanges.version), updatedAt: ctx.now })
      .where(and(eq(t.vocabularyChanges.id, changeId), eq(t.vocabularyChanges.version, row.version)))
      .returning({ id: t.vocabularyChanges.id });
    expectOne(rows, `vocabulary change ${changeId}`);
    if (r.record.state === "applied") await applyToVocabulary(tx, r.record);
    await audit(tx, ctx.now, {
      actorType: "person",
      actorId: ctx.actorId,
      action: m.event,
      machine: "vocabulary_change",
      subjectType: "vocabulary_change",
      subjectId: changeId,
      fromState: m.from,
      toState: m.to,
      detail: { projectId: row.projectId, kind: row.kind, word: row.word, personId: row.personId, remove: row.remove },
    });
    await evaluateProject(tx, row.projectId, ctx.now, { actorId: ctx.actorId });
    await tellProposer(tx, ctx.now, r.record, ctx.actorId, world);
    return r.record;
  });
}

/** The project's names and contacts as routing reads them. Aliases are data, not a machine's state, so no version moves. */
async function applyToVocabulary(tx: Tx, c: VocabularyChangeRecord): Promise<void> {
  if (c.kind === "alias") {
    const [p] = await tx.select({ aliases: t.projects.aliases }).from(t.projects).where(eq(t.projects.id, c.projectId));
    const rest = p.aliases.filter((a) => a.toLowerCase() !== c.word!.toLowerCase());
    await tx.update(t.projects).set({ aliases: c.remove ? rest : [...rest, c.word!] }).where(eq(t.projects.id, c.projectId));
  } else if (c.remove) {
    await tx.delete(t.projectContacts).where(and(eq(t.projectContacts.projectId, c.projectId), eq(t.projectContacts.personId, c.personId!)));
  } else {
    await tx.insert(t.projectContacts).values({ projectId: c.projectId, personId: c.personId!, tie: c.tie ?? "contact" }).onConflictDoNothing();
  }
}

/** D15: the person it speaks for hears how it was decided, while they can still open the project. */
async function tellProposer(tx: Tx, now: Date, c: VocabularyChangeRecord, deciderId: string, world: World): Promise<void> {
  if (c.forId === deciderId || !isCandidate(c.forId, await orgTagsOf(tx, c.forId), c.projectId, world)) return;
  const [decider] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, deciderId));
  const who = decider?.name.split(" ")[0] ?? "Someone";
  const what = await changeLabel(tx, c);
  const text = c.state === "applied" ? `${who} approved ${what}. I'll read it that way from now on.` : `${who} declined ${what}, so I'll read it as before.`;
  await notice(tx, now, [c.forId], text, { type: "vocabulary_change", id: c.id, projectId: c.projectId, act: c.state });
}

/**
 * CD14, UN10: after the author moves an item routed by the same word to the same project twice, Atlas proposes
 * the word for that project: a person tied to it, or another name for it. Said once only (rule 6); a clash
 * refuses it silently (the model: Atlas does not propose it, and says nothing).
 */
export async function proposeFromMoves(tx: Tx, now: Date, authorId: string, move: { word: string; basis: "reference" | "tied_person"; toProject: string; personId: string | null; captureId: string }): Promise<void> {
  const moves = await tx
    .select({ detail: t.auditEntries.detail })
    .from(t.auditEntries)
    .where(and(eq(t.auditEntries.actorId, authorId), eq(t.auditEntries.machine, "routing"), eq(t.auditEntries.action, "MOVE")));
  const same = moves.filter((m) => {
    const d = (m.detail ?? {}) as { word?: string; toProject?: string };
    return d.toProject === move.toProject && d.word?.toLowerCase() === move.word.toLowerCase();
  });
  if (same.length < 2) return;
  const kind: VocabularyKind = move.basis === "tied_person" && move.personId ? "contact" : "alias";
  await proposeVocabularyChange(tx, now, { projectId: move.toProject, kind, word: kind === "alias" ? move.word : null, personId: kind === "contact" ? move.personId : null, proposedBy: null, forId: authorId, captureId: move.captureId });
}

/**
 * The S18 rhythm for a waiting change (M31 TIMER): reminded after 2 working days, then weekly, and expired
 * after config.vocabExpiryDays once the reminders went out (ReminderBeforeExpiry). One move per change per run.
 */
export function runVocabularyTimers(ctx: { db: Db; now: Date }): Promise<{ reminded: string[]; expired: string[] }> {
  const today = todayOf(ctx.now);
  return runCommand({ ...ctx, actorId: "rule" }, async (tx) => {
    const reminded: string[] = [];
    const expired: string[] = [];
    const rows = await tx.select().from(t.vocabularyChanges).where(eq(t.vocabularyChanges.state, "proposed"));
    const touched = new Set<string>();
    for (const row of rows) {
      const c = vocabularyOf(row);
      const event: VocabularyEvent | null = vocabularyExpiryDue(c, today) ? { type: "EXPIRE" } : vocabularyReminderDue(c, today) ? { type: "REMIND" } : null;
      if (!event) continue;
      const r = applyVocabularyChange(c, event, null, today);
      if (!r.outcome.ok) continue;
      const updated = await tx
        .update(t.vocabularyChanges)
        .set({ state: r.record.state, remindersSent: r.record.remindersSent, lastRemindedOn: r.record.lastRemindedOn, version: nextVersion(t.vocabularyChanges.version), updatedAt: ctx.now })
        .where(and(eq(t.vocabularyChanges.id, row.id), eq(t.vocabularyChanges.version, row.version)))
        .returning({ id: t.vocabularyChanges.id });
      expectOne(updated, `vocabulary change ${row.id}`);
      await audit(tx, ctx.now, { actorType: "rule", action: r.outcome.event, machine: "vocabulary_change", subjectType: "vocabulary_change", subjectId: row.id, fromState: r.outcome.from, toState: r.outcome.to, detail: { projectId: row.projectId, remindersSent: r.record.remindersSent } });
      (event.type === "EXPIRE" ? expired : reminded).push(row.id);
      touched.add(row.projectId);
    }
    for (const projectId of [...touched].sort()) await evaluateProject(tx, projectId, ctx.now);
    return { reminded, expired };
  });
}
