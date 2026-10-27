// Phase L, M30. Undo (conversational plan, section 14): "Undo that" or the Undo button on a saved message
// reverses the author's own save. A save keeps a receipt (what it wrote, each record as it was, the version
// it left it at, and who it told); the undo job reads it, checks the guard, and sends each record back
// through its own machine's UNDO arrow, all or nothing like S3. The model's fixes are here: the versions and
// the right are checked again in the transaction that runs the arrows (a savepoint), and a record that moves
// or an arrow that refuses there ends the job refused, never stuck. "Kemar undid this." goes only to people
// who can still open the record; a refusal names only what the asker can open now (queries/answers/undo.ts).
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../db/conn";
import { leaveRecordOf, loadBraidLog, loadWorld, orgTagsOf, persistBraidLog, persistSetStatus, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { applyBraidEvent, type BraidLog } from "../domain/machines/braid-entry";
import { applyHandover, applyStep } from "../domain/machines/handover";
import { applyLeaveEvent } from "../domain/machines/leave";
import { actorIn, isCandidate, type World } from "../domain/machines/membership";
import { applyMilestone } from "../domain/machines/milestone";
import { applySetStatus } from "../domain/machines/set-status";
import { applyUndo, keyOf, projectsOf, undoVerdict, type SavedRecord, type SavedRef, type Told, type UndoEvent, type UndoRecord, type UndoRefusal } from "../domain/machines/undo";
import { applyWorkItem } from "../domain/machines/work-item";
import { lastSave, readReceipt, RECEIPT_ACTION, type StoredReceipt } from "../queries/undo";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, StaleVersion, todayOf, type CommandCtx } from "./core";
import { evaluateProjects, type Evaluation } from "./evaluate";
import { syncLeaveImpact } from "./leave";
import { notice } from "./notices";

// ---- The receipt, kept by the save (commands/capture.ts) ----

/** What a save writes, as it goes: the first `before` of each record wins, the versions are read at the end. */
export type Receipt = { records: Map<string, SavedRecord>; told: Told[] };

export function noteBefore(receipt: Receipt, record: SavedRecord): void {
  if (!receipt.records.has(keyOf(record))) receipt.records.set(keyOf(record), record);
}

const TABLES = {
  work_item: t.workItems,
  milestone: t.milestones,
  handover_step: t.handoverSteps,
  handover: t.handovers,
  braid_entry: t.braidEntries,
  set_status: t.projects,
  leave: t.leave,
} as const;

/** Each record's version now; undefined when it is gone. */
export async function versionsOf(tx: Tx, refs: readonly SavedRef[]): Promise<Map<string, number | undefined>> {
  const out = new Map<string, number | undefined>();
  for (const type of Object.keys(TABLES) as SavedRef["type"][]) {
    const ids = refs.filter((r) => r.type === type).map((r) => r.id);
    if (!ids.length) continue;
    const table = TABLES[type];
    const rows = await tx.select({ id: table.id, version: table.version }).from(table).where(inArray(table.id, ids));
    for (const id of ids) out.set(keyOf({ type, id }), rows.find((r) => r.id === id)?.version);
  }
  return out;
}

/**
 * The people a save told: the owners of every inbox item it opened, besides its author. Each item's cause
 * names what it is about (M10 keys are "<cause>:<subject id>"): a BRAID entry, the project's set status
 * ("status_set_with_no_reason", "keep_set_status"), or a work item.
 */
export async function toldBy(tx: Tx, evaluations: ReadonlyMap<string, Evaluation>, authorId: string): Promise<Told[]> {
  const told: Told[] = [];
  for (const [projectId, e] of evaluations) {
    for (const { ownerId, causeKey } of e.opened) {
      if (ownerId === authorId) continue;
      const subjectId = causeKey.slice(causeKey.indexOf(":") + 1);
      const subjectType = subjectId === projectId ? "project" : (await isEntry(tx, subjectId)) ? "braid_entry" : (await isWork(tx, subjectId)) ? "work_item" : null;
      if (subjectType) told.push({ personId: ownerId, projectId, subjectType, subjectId });
    }
  }
  return told;
}

/** The leads a save showed a leave request's impact to ("leave_impact:<leave>@<project>"), besides its author. */
export function toldOfLeave(opened: Evaluation["opened"], authorId: string, leaveId: string): Told[] {
  return opened.flatMap(({ ownerId, causeKey }) => {
    const projectId = causeKey.slice(causeKey.indexOf("@") + 1);
    return ownerId === authorId ? [] : [{ personId: ownerId, projectId, subjectType: "leave" as const, subjectId: leaveId }];
  });
}

const isEntry = async (tx: Tx, id: string) => (await tx.select({ id: t.braidEntries.id }).from(t.braidEntries).where(eq(t.braidEntries.id, id))).length > 0;
const isWork = async (tx: Tx, id: string) => (await tx.select({ id: t.workItems.id }).from(t.workItems).where(eq(t.workItems.id, id))).length > 0;

export async function writeReceipt(tx: Tx, now: Date, captureId: string, authorId: string, receipt: Receipt): Promise<void> {
  const records = [...receipt.records.values()];
  const versions = await versionsOf(tx, records);
  const told = [...new Map(receipt.told.map((x) => [`${x.personId}|${x.subjectId}`, x])).values()];
  await audit(tx, now, {
    actorType: "person",
    actorId: authorId,
    action: RECEIPT_ACTION,
    machine: "undo",
    subjectType: "capture",
    subjectId: captureId,
    captureId,
    detail: { records: records.map((r) => ({ ...r, version: versions.get(keyOf(r)) ?? 0 })), told },
  });
}

// ---- The undo job ----

export type UndoResult = { kind: "nothing" } | { kind: "job"; job: UndoRecord };

const jobOf = (row: typeof t.undos.$inferSelect): UndoRecord => ({ id: row.id, captureId: row.captureId, ownerId: row.ownerId, state: row.state, refusal: row.refusal });

/** The Undo button on a saved message, or "Undo that" (captureId omitted: their last save). */
export function undoSave(ctx: CommandCtx, input: { commandId: string; captureId?: string }): Promise<UndoResult> {
  return runCommand(ctx, (tx) => undoInTx(tx, ctx.now, ctx.actorId, input));
}

/** Rolls the arrows back to the savepoint when the recheck refuses; the job then records why. */
class Recheck extends Error {
  constructor(readonly refusal: UndoRefusal) {
    super(refusal.why);
  }
}

/** The undo job inside a command's transaction: "Undo that" runs it while its message is read (proposeItems). */
export async function undoInTx(tx: Tx, now: Date, actorId: string, input: { commandId: string; captureId?: string }): Promise<UndoResult> {
  // Rule 6: the same command again changes nothing
  const [same] = await tx.select().from(t.undos).where(eq(t.undos.id, input.commandId));
  if (same) {
    if (same.ownerId !== actorId) throw new CommandRefused("no such undo", "not_found");
    return { kind: "job", job: jobOf(same) };
  }
  const receipt = input.captureId ? await readReceipt(tx, input.captureId) : await lastSave(tx, actorId);
  // UN4: their own save only; anyone else's reads as nothing to undo (P10)
  if (!receipt || receipt.authorId !== actorId || !receipt.records.length) return { kind: "nothing" };
  // UN5: one undo per save, however often it is asked
  const [done] = await tx.select().from(t.undos).where(eq(t.undos.captureId, receipt.captureId));
  if (done) return { kind: "job", job: jobOf(done) };

  let job: UndoRecord = { id: input.commandId, captureId: receipt.captureId, ownerId: actorId, state: "requested", refusal: null };
  await tx.insert(t.undos).values({ id: job.id, captureId: job.captureId, ownerId: actorId, state: "requested", createdAt: now, updatedAt: now });
  await auditJob(tx, now, job, { event: "REQUESTED", from: null, to: "requested" });

  const step = async (event: UndoEvent, detail: Record<string, unknown> = {}) => {
    const r = applyUndo(job, event);
    const m = moved(r.outcome);
    const rows = await tx
      .update(t.undos)
      .set({ state: r.record.state, refusal: r.record.refusal, version: nextVersion(t.undos.version), updatedAt: now })
      .where(eq(t.undos.id, job.id))
      .returning({ id: t.undos.id });
    expectOne(rows, `undo ${job.id}`);
    job = r.record;
    await auditJob(tx, now, job, { event: m.event, from: m.from, to: m.to }, job.refusal ? { refusal: job.refusal } : detail);
  };

  await step({ type: "CHECK", refusal: await verdict(tx, receipt, actorId, now) });
  if (job.state === "refused") return { kind: "job", job };

  const refusal = await runUndoArrows(tx, now, actorId, receipt, job.id);
  let told: string[] = [];
  if (!refusal) {
    // UN3: the deciders' items close as cause gone, as the rules see it now; then the people the save told hear it
    await evaluateProjects(tx, projectsOf(receipt), now, { actorId });
    told = await tellUndone(tx, now, actorId, receipt);
  }
  // Kept with the move, so the answer says who was told and never more than happened (rule 2 of the plan)
  await step({ type: "RUN", refusal }, { told });
  return { kind: "job", job };
}

/**
 * Undoing --> undone or refused: the guard again and every UNDO arrow, in a savepoint (the model's fix:
 * the versions and the right are checked in the transaction that runs the arrows). A refusal there, or
 * an arrow that refuses, rolls all of them back. Null when every record went back.
 */
export async function runUndoArrows(tx: Tx, now: Date, actorId: string, receipt: StoredReceipt, jobId: string): Promise<UndoRefusal | null> {
  try {
    await tx.transaction(async (sp) => {
      const again = await verdict(sp, receipt, actorId, now);
      if (again) throw new Recheck(again);
      await runArrows(sp, now, actorId, receipt, jobId);
    });
    return null;
  } catch (e) {
    if (e instanceof Recheck) return e.refusal;
    if (e instanceof CommandRefused || e instanceof StaleVersion) return { why: "failed", records: [], detail: e.message };
    throw e;
  }
}

function auditJob(tx: Tx, now: Date, job: UndoRecord, move: { event: string; from: string | null; to: string }, detail: Record<string, unknown> = {}) {
  return audit(tx, now, {
    actorType: "person",
    actorId: job.ownerId,
    action: move.event,
    machine: "undo",
    subjectType: "undo",
    subjectId: job.id,
    fromState: move.from,
    toState: move.to,
    captureId: job.captureId,
    detail,
  });
}

/** The guard as it holds now: the window, every version, and the right in every project the save touched. */
async function verdict(tx: Tx, receipt: StoredReceipt, actorId: string, now: Date): Promise<UndoRefusal | null> {
  const [current, world, orgTags] = await Promise.all([versionsOf(tx, receipt.records), loadWorld(tx), orgTagsOf(tx, actorId)]);
  const rightHeld = projectsOf(receipt).every((p) => isCandidate(actorId, orgTags, p, world));
  return undoVerdict({ savedAt: receipt.savedAt, now, records: receipt.records, current, rightHeld });
}

/** Each record back through its own UNDO arrow, newest write first. Any refusal throws, and the savepoint rolls back. */
async function runArrows(tx: Tx, now: Date, actorId: string, receipt: StoredReceipt, jobId: string): Promise<void> {
  const world = await loadWorld(tx);
  const records = [...receipt.records].reverse();
  const undoAudit = (r: SavedRecord, machine: string, subjectType: string, from: string | null, to: string | null) =>
    audit(tx, now, { actorType: "person", actorId, action: "UNDO", machine, subjectType, subjectId: r.id, fromState: from, toState: to, captureId: receipt.captureId, detail: { undo: jobId } });

  const braid = new Map<string, SavedRecord[]>();
  for (const r of records) {
    switch (r.type) {
      case "work_item": {
        const [row] = await tx.select().from(t.workItems).where(eq(t.workItems.id, r.id));
        const rec = { id: row.id, projectId: row.projectId, ownerId: row.ownerId, state: row.state, dueDate: row.dueDate, forecastDate: row.forecastDate, blockedNote: row.blockedNote, blockedLinks: row.blockedLinks };
        // Section 20, U6: the forecast goes back too (a FINISH cleared it, a SET_FORECAST set it)
        const undo = { type: "UNDO" as const, to: r.before.state, note: r.before.blockedNote, links: r.before.blockedLinks, forecast: r.before.forecastDate ?? null };
        const u = applyWorkItem(rec, undo, actorIn(actorId, row.projectId, world.memberships));
        const m = moved(u.outcome);
        const rows = await tx
          .update(t.workItems)
          .set({ state: u.record.state, blockedNote: u.record.blockedNote, blockedLinks: [...u.record.blockedLinks], forecastDate: u.record.forecastDate, version: nextVersion(t.workItems.version), updatedAt: now })
          .where(and(eq(t.workItems.id, r.id), eq(t.workItems.version, r.version)))
          .returning({ id: t.workItems.id });
        expectOne(rows, `work item ${r.id}`);
        await undoAudit(r, "work_item", "work_item", m.from, m.to);
        break;
      }
      case "milestone": {
        const [row] = await tx.select().from(t.milestones).where(eq(t.milestones.id, r.id));
        const rec = { id: row.id, projectId: row.projectId, ownerId: row.ownerId, state: row.state, targetDate: row.targetDate, forecastDate: row.forecastDate };
        const u = applyMilestone(rec, { type: "UNDO", forecast: r.before.forecastDate }, actorIn(actorId, row.projectId, world.memberships));
        const m = moved(u.outcome);
        const rows = await tx
          .update(t.milestones)
          .set({ forecastDate: u.record.forecastDate, version: nextVersion(t.milestones.version), updatedAt: now })
          .where(and(eq(t.milestones.id, r.id), eq(t.milestones.version, r.version)))
          .returning({ id: t.milestones.id });
        expectOne(rows, `milestone ${r.id}`);
        await undoAudit(r, "milestone", "milestone", m.from, m.to);
        break;
      }
      case "handover": {
        const [row] = await tx.select().from(t.handovers).where(eq(t.handovers.id, r.id));
        const steps = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.handoverId, r.id));
        const rec = { ...row, stepsDone: steps.filter((s) => s.state === "handed_over").length, stepsTotal: steps.length };
        const u = applyHandover(rec, { type: "UNDO", done: r.before.stepsDone });
        const m = moved(u.outcome);
        const rows = await tx
          .update(t.handovers)
          .set({ state: u.record.state, version: nextVersion(t.handovers.version), updatedAt: now })
          .where(and(eq(t.handovers.id, r.id), eq(t.handovers.version, r.version)))
          .returning({ id: t.handovers.id });
        expectOne(rows, `handover ${r.id}`);
        await undoAudit(r, "handover", "handover", m.from, m.to);
        break;
      }
      case "handover_step": {
        // Rule 2: back along the step's own UNDO arrow (handoverStepMachine), the right read now
        const [row] = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, r.id));
        if (!actorIn(actorId, r.projectId, world.memberships).role) throw new CommandRefused("only a project member can undo this");
        const m = moved(applyStep(row.state, { type: "UNDO", to: r.before.state }));
        const rows = await tx
          .update(t.handoverSteps)
          .set({ state: m.to, version: nextVersion(t.handoverSteps.version), updatedAt: now })
          .where(and(eq(t.handoverSteps.id, r.id), eq(t.handoverSteps.version, r.version)))
          .returning({ id: t.handoverSteps.id });
        expectOne(rows, `handover step ${r.id}`);
        await undoAudit(r, "handover_step", "handover_step", m.from, m.to);
        break;
      }
      case "set_status": {
        const [row] = await tx.select().from(t.projects).where(eq(t.projects.id, r.id));
        const u = applySetStatus(setStatusRecordOf(row), null, { type: "UNDO", before: r.before });
        const m = moved(u.outcome);
        // Rule 2: what the machine's UNDO gives back, with who set it and when, as the owner's own set left it
        await persistSetStatus(tx, r.id, r.version, u.record, now, { by: r.before.setBy, at: r.before.setAt ? new Date(r.before.setAt) : null });
        // The reason went stale with this save; unless the arrow left it stale, it stands again as it was
        if (u.record.override !== "reason_stale") {
          await tx.update(t.statusReasons).set({ staleSince: null }).where(and(eq(t.statusReasons.projectId, r.id), eq(t.statusReasons.staleSince, receipt.savedAt)));
        }
        await undoAudit(r, "set_status", "project", m.from, m.to);
        break;
      }
      case "leave": {
        const [row] = await tx.select().from(t.leave).where(eq(t.leave.id, r.id));
        const actor = { id: actorId, isPerson: row.personId === actorId, isAdmin: false };
        // A request the save asked for is withdrawn; dates it moved go back
        const u = applyLeaveEvent(leaveRecordOf(row), r.before ? { type: "UNDO", before: r.before } : { type: "WITHDRAW" }, actor);
        const m = moved(u.outcome);
        const rows = await tx
          .update(t.leave)
          .set({ state: u.record.state, startDate: u.record.start, endDate: u.record.end, changeStart: u.record.change?.start ?? null, changeEnd: u.record.change?.end ?? null, version: nextVersion(t.leave.version), updatedAt: now })
          .where(and(eq(t.leave.id, r.id), eq(t.leave.version, r.version)))
          .returning({ id: t.leave.id });
        expectOne(rows, `leave ${r.id}`);
        await undoAudit(r, "leave", "leave", m.from, m.to);
        await syncLeaveImpact(tx, now, r.id, { actorId });
        break;
      }
      case "braid_entry":
        braid.set(r.projectId, [...(braid.get(r.projectId) ?? []), r]);
        break;
    }
  }

  // BRAID: each project's log at once, as the save wrote it (D11: only the save's own sources leave)
  for (const [projectId, rs] of braid) {
    const { log: before, versions } = await loadBraidLog(tx, projectId);
    const role = actorIn(actorId, projectId, world.memberships).role;
    let log: BraidLog = before;
    const moves: [SavedRecord, string, string][] = [];
    for (const r of rs) {
      if (r.type !== "braid_entry") continue;
      const entry = log[r.id];
      if (!entry || versions.get(r.id) !== r.version) throw new StaleVersion(`BRAID entry ${r.id}`);
      const u = applyBraidEvent(entry, { type: "UNDO", before: r.before }, { actor: { id: actorId, role }, today: todayOf(now) });
      const m = moved(u.outcome);
      log = { ...log, [r.id]: u.record };
      moves.push([r, m.from, m.to]);
    }
    await persistBraidLog(tx, before, log, versions, now);
    for (const [r, from, to] of moves) await undoAudit(r, "braid_entry", "braid_entry", from, to);
  }
}

/**
 * "Kemar undid this." to each person the save told who can still open the record, never to the asker: one
 * more notice for every inbox item or notice the save sent. Returns who was told, for the answer.
 */
async function tellUndone(tx: Tx, now: Date, actorId: string, receipt: StoredReceipt): Promise<string[]> {
  if (!receipt.told.length) return [];
  const world: World = await loadWorld(tx);
  const [me] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, actorId));
  const who = me?.name.split(" ")[0] ?? "Someone";
  const told = new Set<string>();
  for (const x of receipt.told) {
    if (x.personId === actorId) continue;
    if (!isCandidate(x.personId, await orgTagsOf(tx, x.personId), x.projectId, world)) continue;
    const what = await toldAbout(tx, x, who);
    if (!what) continue;
    await notice(tx, now, [x.personId], `${who} undid this: ${what}.`, { type: x.subjectType, id: x.subjectId, projectId: x.projectId, act: "undone" });
    told.add(x.personId);
  }
  return [...told].sort();
}

/** What a notice was about, in the words its reader saw: the entry or item, the project's status, the leave. */
async function toldAbout(tx: Tx, x: Told, who: string): Promise<string | null> {
  switch (x.subjectType) {
    case "braid_entry":
      return (await tx.select({ title: t.braidEntries.title }).from(t.braidEntries).where(eq(t.braidEntries.id, x.subjectId)))[0]?.title ?? null;
    case "work_item": {
      const [w] = await tx.select({ number: t.workItems.number, title: t.workItems.title }).from(t.workItems).where(eq(t.workItems.id, x.subjectId));
      return w ? `${w.number ? `${w.number} ` : ""}${w.title}` : null;
    }
    case "project": {
      const [p] = await tx.select({ name: t.projects.name }).from(t.projects).where(eq(t.projects.id, x.subjectId));
      return p ? `the update that moved ${p.name}'s plan` : null;
    }
    case "leave":
      return `${who}'s leave request`;
  }
}
