// A person marks their work done or unblocks it (M5), from an answer line in the chat (conversational
// plan, phase B). Until now a work item moved only through a saved update (Apply, M4); no screen had a
// button for it, so this is the command the chat's Mark done and Unblock run. The work item's machine
// decides the move, the owner or a PM or Lead of the project acts (S2, S5: owner_or_lead), checked when
// it runs (rule 7), with the version seen, and evaluate keeps the inbox in step (D18: done with no link).
import { and, eq } from "drizzle-orm";
import type { Tx } from "../db/conn";
import { membersOf } from "../db/records";
import * as t from "../db/schema";
import { applyWorkItem, type WorkItemEvent, type WorkItemRecord } from "../domain/machines/work-item";
import type { WorkItemState } from "../domain/status/rules";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, StaleVersion, type CommandCtx } from "./core";
import { evaluateProject, type Evaluation } from "./evaluate";

export type WorkMove = "mark_done" | "unblock";

const EVENT: Record<WorkMove, WorkItemEvent> = { mark_done: { type: "FINISH" }, unblock: { type: "UNBLOCK" } };

export type WorkCommandResult = { from: WorkItemState; to: WorkItemState; evaluation: Evaluation };

export type WorkCommandOpts = {
  /** The work item's version when the person saw it; a newer one is StaleVersion. */
  seenVersion?: number;
  /** Phase B, M20: the chat message it came from, on the audit entry. */
  captureId?: string;
};

export function moveWorkItem(ctx: CommandCtx, workItemId: string, move: WorkMove, opts: WorkCommandOpts = {}): Promise<WorkCommandResult> {
  return runCommand(ctx, (tx) => moveWorkItemIn(tx, ctx, workItemId, move, opts));
}

/** moveWorkItem inside a transaction already open (phase B, M20). */
export async function moveWorkItemIn(tx: Tx, ctx: CommandCtx, workItemId: string, move: WorkMove, opts: WorkCommandOpts = {}): Promise<WorkCommandResult> {
  const [row] = await tx.select().from(t.workItems).where(eq(t.workItems.id, workItemId));
  if (!row) throw new CommandRefused(`no work item ${workItemId}`, "not_found");
  if (opts.seenVersion !== undefined && row.version !== opts.seenVersion) throw new StaleVersion(`work item ${workItemId}`);
  const role = (await membersOf(tx, row.projectId)).find((m) => m.id === ctx.actorId)?.role ?? null;
  if (role === null || (row.ownerId !== ctx.actorId && role !== "pm" && role !== "lead")) {
    throw new CommandRefused("only its owner, or a PM or Lead of the project, changes this work", "not_allowed");
  }
  const record: WorkItemRecord = { id: row.id, projectId: row.projectId, ownerId: row.ownerId, state: row.state, dueDate: row.dueDate, forecastDate: row.forecastDate, blockedNote: row.blockedNote, blockedLinks: row.blockedLinks };
  const event = EVENT[move];
  const r = applyWorkItem(record, event, { personId: ctx.actorId, role });
  const outcome = moved(r.outcome);
  // Done clears the forecast (section 20, U6)
  const rows = await tx
    .update(t.workItems)
    .set({ state: r.record.state, blockedNote: r.record.blockedNote, blockedLinks: [...r.record.blockedLinks], forecastDate: r.record.forecastDate, version: nextVersion(t.workItems.version), updatedAt: ctx.now })
    .where(and(eq(t.workItems.id, row.id), eq(t.workItems.version, row.version)))
    .returning({ id: t.workItems.id });
  expectOne(rows, `work item ${row.id}`);
  await audit(tx, ctx.now, {
    actorType: "person",
    actorId: ctx.actorId,
    action: event.type,
    machine: "work_item",
    subjectType: "work_item",
    subjectId: row.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId: opts.captureId ?? null,
    detail: { projectId: row.projectId, role },
  });
  const evaluation = await evaluateProject(tx, row.projectId, ctx.now, { actorId: ctx.actorId });
  return { from: outcome.from, to: outcome.to, evaluation };
}
