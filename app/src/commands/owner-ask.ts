// M37 commands (machines doc section 20, U5 and U7): Save makes the asks; the person asked accepts or
// declines; the author may withdraw; a daily rule makes them moot, withdraws them when their target
// goes, and expires them. Every move runs the machine (owner-ask.ts) as the person, checked now (rule 7).
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { loadCapture, loadItems, loadWorld, ownerAskOf, persistOwnerAsk } from "../db/records";
import * as t from "../db/schema";
import type { PlannedAsk } from "../domain/capture-save";
import { applyOwnerAskEvent, type OwnerAskEvent, type OwnerAskRecord, type OwnerAskState } from "../domain/machines/owner-ask";
import type { Moved } from "../domain/machine";
import { applyWrite, type SaveScope } from "./capture";
import { audit, CommandRefused, moved, runCommand, todayOf, type CommandCtx } from "./core";
import { evaluateProject } from "./evaluate";
import { notice } from "./notices";

const firstName = (name: string) => name.split(" ")[0];

async function nameOf(tx: Tx, personId: string | null): Promise<string> {
  if (!personId) return "Someone";
  const [p] = await tx.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, personId));
  return p ? firstName(p.name) : personId;
}

async function auditAsk(tx: Tx, now: Date, r: OwnerAskRecord, m: Moved<OwnerAskState> | { event: "CREATE"; from: null; to: OwnerAskState }, actorId: string | null, detail: Record<string, unknown> = {}) {
  await audit(tx, now, {
    actorType: actorId ? "person" : "rule",
    actorId,
    action: m.event,
    machine: "owner_ask",
    subjectType: "owner_ask",
    subjectId: r.id,
    fromState: m.from,
    toState: m.to,
    captureId: r.captureId,
    extractionId: r.extractionId,
    detail: { projectId: r.projectId, kind: r.kind, ...detail },
  });
}

/** Save (section 20): the asks a capture makes, in the save's own transaction. Nothing else is written. */
export async function createOwnerAsks(tx: Tx, now: Date, capture: { id: string; authorId: string }, asks: readonly PlannedAsk[]): Promise<void> {
  for (const a of asks) {
    const record: OwnerAskRecord = {
      id: `ask-${a.itemId}`,
      projectId: a.projectId,
      captureId: capture.id,
      extractionId: a.itemId,
      authorId: capture.authorId,
      kind: a.kind,
      target: a.target,
      ownerId: a.ownerId,
      saw: a.saw,
      value: a.value,
      title: a.title,
      state: "asked",
      askedOn: todayOf(now),
      decidedBy: null,
      decidedOn: null,
      reason: null,
      appliedValue: null,
    };
    await persistOwnerAsk(tx, record, null, now);
    await auditAsk(tx, now, record, { event: "CREATE", from: null, to: "asked" }, capture.authorId);
  }
}

/** The asked field as it is today; null for new work. */
async function currentValue(tx: Tx, r: OwnerAskRecord): Promise<string | null> {
  const target = r.target;
  if (!target) return null;
  switch (target.type) {
    case "work_item": {
      const [row] = await tx.select().from(t.workItems).where(eq(t.workItems.id, target.id));
      return row ? (target.field === "blocked_note" ? row.blockedNote : target.field === "forecast" ? (row.forecastDate ?? row.dueDate) : row.state) : null;
    }
    case "milestone": {
      const [row] = await tx.select().from(t.milestones).where(eq(t.milestones.id, target.id));
      return row ? (row.forecastDate ?? row.targetDate) : null;
    }
    case "handover": {
      const [row] = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, target.id));
      return row?.state ?? null;
    }
  }
}

async function loadAsk(tx: Tx, askId: string) {
  const [row] = await tx.select().from(t.ownerAsks).where(eq(t.ownerAsks.id, askId));
  if (!row) throw new CommandRefused(`no ask ${askId}`, "not_found");
  return { row, record: ownerAskOf(row) };
}

async function roleOf(tx: Tx, personId: string, projectId: string) {
  const [m] = await tx
    .select({ role: t.projectMemberships.role, state: t.projectMemberships.state })
    .from(t.projectMemberships)
    .where(and(eq(t.projectMemberships.projectId, projectId), eq(t.projectMemberships.personId, personId)));
  return m?.state === "member" ? m.role : null;
}

export type OwnerAskResult = { record: OwnerAskRecord; outcome: Moved<OwnerAskState> };

/** One person's event on one ask; `then` writes what it causes in the same transaction. */
function act(ctx: CommandCtx, askId: string, event: OwnerAskEvent, then?: (tx: Tx, before: OwnerAskRecord, after: OwnerAskRecord) => Promise<void>): Promise<OwnerAskResult> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await loadAsk(tx, askId);
    const actor = { id: ctx.actorId, role: await roleOf(tx, ctx.actorId, record.projectId) };
    const current = await currentValue(tx, record);
    const r = applyOwnerAskEvent(record, event, { actor, current, today: todayOf(ctx.now) });
    const outcome = moved(r.outcome);
    if (then) await then(tx, record, r.record);
    await persistOwnerAsk(tx, r.record, row.version, ctx.now);
    await auditAsk(tx, ctx.now, r.record, outcome, ctx.actorId, event.type === "DECLINE" ? { reason: r.record.reason } : event.type === "ACCEPT" ? { value: r.record.appliedValue } : {});
    await evaluateProject(tx, record.projectId, ctx.now, { actorId: ctx.actorId });
    return { record: r.record, outcome };
  });
}

/**
 * The person asked accepts, as asked or with their own value. A change is written through its record's
 * machine as them (Save's applyWrite), with the author's words as its source; new work is created in the
 * plan, owned by the author. The author is told.
 */
export function acceptOwnerAsk(ctx: CommandCtx, askId: string, value?: string): Promise<OwnerAskResult> {
  return act(ctx, askId, { type: "ACCEPT", ...(value ? { value } : {}) }, async (tx, before, after) => {
    const by = await nameOf(tx, ctx.actorId);
    if (after.kind === "new_work") {
      const id = `wi-${after.id}`;
      await tx.insert(t.workItems).values({ id, projectId: after.projectId, title: after.title ?? "New work", ownerId: after.authorId, state: after.appliedValue as "to_do" | "in_progress", startDate: todayOf(ctx.now), createdAt: ctx.now, updatedAt: ctx.now });
      await audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action: "CREATED", machine: "work_item", subjectType: "work_item", subjectId: id, toState: after.appliedValue, captureId: after.captureId, extractionId: after.extractionId, detail: { title: after.title, askId: after.id } });
      await notice(tx, ctx.now, [after.authorId], `${by} added "${after.title}" to the plan.`, { type: "owner_ask", id: after.id, projectId: after.projectId, act: "applied" });
      return;
    }
    const capture = await loadCapture(tx, after.captureId);
    const { items } = await loadItems(tx, after.captureId);
    const item = items.find((i) => i.id === after.extractionId);
    if (!capture || !item || !after.target) throw new CommandRefused("the update this came from is gone");
    // Phase L, M30: an accepted ask is the owner's decision, not a save of theirs, so its receipt is not kept
    const receipt = { records: new Map(), told: [] };
    const scope: SaveScope = { tx, now: ctx.now, authorId: ctx.actorId, capture: capture.row, world: await loadWorld(tx), byId: new Map([[item.id, item]]), blockLinks: new Map(), receipt };
    await applyWrite(scope, { itemId: item.id, target: after.target, key: `${after.target.type}:${after.target.id}:${after.target.field}`, expected: before.saw, value: after.appliedValue! });
    await notice(tx, ctx.now, [after.authorId], `${by} accepted your update.`, { type: "owner_ask", id: after.id, projectId: after.projectId, act: "applied" });
  });
}

/** The person asked declines, saying why; the author is told (EndIsTold). */
export function declineOwnerAsk(ctx: CommandCtx, askId: string, reason: string): Promise<OwnerAskResult> {
  return act(ctx, askId, { type: "DECLINE", reason }, async (tx, _before, after) => {
    const by = await nameOf(tx, ctx.actorId);
    await notice(tx, ctx.now, [after.authorId], `${by} declined your update: "${after.reason}"`, { type: "owner_ask", id: after.id, projectId: after.projectId, act: "declined" });
  });
}

/** The author takes it back before it is answered. */
export function withdrawOwnerAsk(ctx: CommandCtx, askId: string): Promise<OwnerAskResult> {
  return act(ctx, askId, { type: "WITHDRAW" });
}

/**
 * Phase L, W2-D1: undoing a save takes back the Asks it made that are still waiting, through M37's own
 * WITHDRAW arrow as their author, so no owner is left deciding something taken back. An Ask already
 * answered stays as it is: accepting it was the owner's decision, not part of the save. Returns the
 * projects whose Asks moved, for the rules to run on.
 */
export async function withdrawAsksOfSave(tx: Tx, now: Date, authorId: string, captureId: string): Promise<string[]> {
  const rows = await tx.select().from(t.ownerAsks).where(and(eq(t.ownerAsks.captureId, captureId), eq(t.ownerAsks.state, "asked")));
  const projects = new Set<string>();
  for (const row of rows) {
    const record = ownerAskOf(row);
    const actor = { id: authorId, role: await roleOf(tx, authorId, record.projectId) };
    const r = applyOwnerAskEvent(record, { type: "WITHDRAW" }, { actor, current: await currentValue(tx, record), today: todayOf(now) });
    if (!r.outcome.ok) continue;
    await persistOwnerAsk(tx, r.record, row.version, now);
    await auditAsk(tx, now, r.record, moved(r.outcome), authorId, { undone: true });
    projects.add(record.projectId);
  }
  return [...projects].sort();
}

/**
 * The daily rule (run by the minute timer, cheap when nothing is asked): an ask whose record already
 * holds the value is moot; one whose record was cancelled, or whose author or owner left the project,
 * is withdrawn (OA9); one older than config.ownerAskExpiryDays expires, and its author is told.
 */
export function runOwnerAskTimers(ctx: { db: Db; now: Date }): Promise<{ askId: string; to: OwnerAskState }[]> {
  const today = todayOf(ctx.now);
  return ctx.db.transaction(async (tx) => {
    const rows = await tx.select().from(t.ownerAsks).where(eq(t.ownerAsks.state, "asked"));
    const moves: { askId: string; to: OwnerAskState }[] = [];
    const projects = new Set<string>();
    for (const row of rows) {
      const record = ownerAskOf(row);
      const current = await currentValue(tx, record);
      const cancelled = record.target?.type === "work_item" && current === "cancelled";
      const gone = (await roleOf(tx, record.authorId, record.projectId)) === null || (record.ownerId !== null && (await roleOf(tx, record.ownerId, record.projectId)) === null);
      const event: OwnerAskEvent | null =
        record.kind === "change" && current === record.value
          ? { type: "MOOT" }
          : cancelled || gone
            ? { type: "TARGET_GONE", why: cancelled ? "the record was cancelled" : "someone it involves left the project" }
            : { type: "EXPIRE" };
      const r = applyOwnerAskEvent(record, event, { actor: null, current, today });
      if (!r.outcome.ok) continue;
      await persistOwnerAsk(tx, r.record, row.version, ctx.now);
      await auditAsk(tx, ctx.now, r.record, r.outcome, null, r.record.reason ? { reason: r.record.reason } : {});
      if (r.outcome.to === "expired") {
        await notice(tx, ctx.now, [record.authorId], "Nobody answered your update in 7 days, so it was not applied.", { type: "owner_ask", id: record.id, projectId: record.projectId, act: "expired" });
      }
      moves.push({ askId: record.id, to: r.outcome.to });
      projects.add(record.projectId);
    }
    for (const projectId of [...projects].sort()) await evaluateProject(tx, projectId, ctx.now);
    return moves;
  });
}

/** Live asks for some projects, for evaluate (M10). */
export async function liveOwnerAsks(tx: Tx, projectIds: readonly string[]): Promise<OwnerAskRecord[]> {
  if (!projectIds.length) return [];
  return (await tx.select().from(t.ownerAsks).where(and(inArray(t.ownerAsks.projectId, [...projectIds]), eq(t.ownerAsks.state, "asked")))).map(ownerAskOf);
}
