// Leave decisions and what an absence touches (M8, D6). A capture asks for leave or a change to it;
// an admin of one of the person's projects approves or declines; the person may withdraw. While a
// request or change waits, each project's PMs, Leads and admin have an inbox item showing what the
// absence touches in their project only (leave_impact).
import { eq, like } from "drizzle-orm";
import type { Tx } from "../db/conn";
import { leaveRecordOf, loadWorld } from "../db/records";
import * as t from "../db/schema";
import { applyLeaveEvent, leaveAdmins, leaveImpactOwners, leaveWaiting } from "../domain/machines/leave";
import { impactIn } from "../queries/leave";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, type CommandCtx } from "./core";
import { syncInbox } from "./evaluate";

/** One inbox cause per leave and project: "leave_impact:<leave id>@<project id>". */
export const leaveImpactCause = (leaveId: string, projectId: string) => `leave_impact:${leaveId}@${projectId}`;

/** Opens or closes the leads' impact items for one leave, after anything changed it. */
export async function syncLeaveImpact(tx: Tx, now: Date, leaveId: string, opts: { actorId?: string } = {}) {
  const [row] = await tx.select().from(t.leave).where(eq(t.leave.id, leaveId));
  if (!row) throw new CommandRefused(`no leave ${leaveId}`, "not_found");
  const desired = new Map<string, string[]>();
  if (leaveWaiting(leaveRecordOf(row))) {
    const world = await loadWorld(tx);
    const admins = leaveAdmins(row.personId, world);
    const owners = leaveImpactOwners(row.personId, world);
    const counts = new Map<string, number>();
    for (const projectId of new Set(owners.map((o) => o.projectId))) counts.set(projectId, (await impactIn(tx, row, projectId)).count);
    // A lead hears only when their project has something to cover; an admin always hears, so someone decides
    const shown = owners.filter((o) => counts.get(o.projectId)! > 0);
    for (const admin of admins) {
      if (shown.some((o) => o.ownerId === admin)) continue;
      const first = owners.find((o) => o.ownerId === admin);
      if (first) shown.push(first);
    }
    for (const { ownerId, projectId } of shown) {
      const key = leaveImpactCause(leaveId, projectId);
      desired.set(key, [...(desired.get(key) ?? []), ownerId]);
    }
  }
  const items = await tx.select().from(t.inboxItems).where(like(t.inboxItems.causeKey, `leave_impact:${leaveId}@%`));
  return syncInbox(tx, now, items, desired, opts);
}

async function decide(ctx: CommandCtx, leaveId: string, type: "APPROVE" | "DECLINE" | "WITHDRAW") {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.leave).where(eq(t.leave.id, leaveId));
    if (!row) throw new CommandRefused(`no leave ${leaveId}`, "not_found");
    const before = leaveRecordOf(row);
    const admins = leaveAdmins(row.personId, await loadWorld(tx));
    const r = applyLeaveEvent(before, { type }, { id: ctx.actorId, isPerson: ctx.actorId === row.personId, isAdmin: admins.includes(ctx.actorId) });
    const outcome = moved(r.outcome);
    const updated = await tx
      .update(t.leave)
      .set({
        state: r.record.state,
        startDate: r.record.start,
        endDate: r.record.end,
        changeStart: r.record.change?.start ?? null,
        changeEnd: r.record.change?.end ?? null,
        decidedBy: type === "WITHDRAW" ? row.decidedBy : ctx.actorId,
        version: nextVersion(t.leave.version),
        updatedAt: ctx.now,
      })
      .where(eq(t.leave.id, leaveId))
      .returning({ id: t.leave.id });
    expectOne(updated, `leave ${leaveId}`);
    await audit(tx, ctx.now, {
      actorType: "person",
      actorId: ctx.actorId,
      action: type,
      machine: "leave",
      subjectType: "leave",
      subjectId: leaveId,
      fromState: outcome.from,
      toState: outcome.to,
      // Dates only: a leave reason never reaches the audit either (A5.2)
      detail: { start: r.record.start, end: r.record.end, ...(before.change ? { change: before.change } : {}) },
    });
    await syncLeaveImpact(tx, ctx.now, leaveId, { actorId: ctx.actorId });
    return r.record;
  });
}

/** An admin of one of the person's projects approves the request, or the change waiting on approved leave. */
export const approveLeave = (ctx: CommandCtx, leaveId: string) => decide(ctx, leaveId, "APPROVE");
export const declineLeave = (ctx: CommandCtx, leaveId: string) => decide(ctx, leaveId, "DECLINE");
/** The person takes back their request, or the change they asked for. */
export const withdrawLeave = (ctx: CommandCtx, leaveId: string) => decide(ctx, leaveId, "WITHDRAW");
