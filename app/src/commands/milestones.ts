// The milestone timer (M6, D5): a planned or in progress milestone whose target date has passed in
// the org's time zone becomes missed, so it reads Off track, and its project's rules run again.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { applyMilestone } from "../domain/machines/milestone";
import { audit, expectOne, nextVersion, runCommand } from "./core";
import { evaluateProjects } from "./evaluate";

export function runMilestoneTimers(ctx: { db: Db; now: Date }): Promise<{ missed: string[] }> {
  return runCommand({ ...ctx, actorId: "rule" }, async (tx) => {
    const open = await tx.select().from(t.milestones).where(inArray(t.milestones.state, ["planned", "in_progress"]));
    const missed: string[] = [];
    const touched = new Set<string>();
    for (const row of open) {
      const record = { id: row.id, projectId: row.projectId, ownerId: row.ownerId, state: row.state, targetDate: row.targetDate, forecastDate: row.forecastDate };
      const r = applyMilestone(record, { type: "TARGET_PASSED", at: ctx.now }, null);
      if (!r.outcome.ok) continue; // its date has not passed
      const rows = await tx
        .update(t.milestones)
        .set({ state: r.record.state, version: nextVersion(t.milestones.version), updatedAt: ctx.now })
        .where(and(eq(t.milestones.id, row.id), eq(t.milestones.version, row.version)))
        .returning({ id: t.milestones.id });
      expectOne(rows, `milestone ${row.id}`);
      await audit(tx, ctx.now, { actorType: "rule", action: "TARGET_PASSED", machine: "milestone", subjectType: "milestone", subjectId: row.id, fromState: r.outcome.from, toState: r.outcome.to, detail: { target: row.targetDate } });
      missed.push(row.id);
      touched.add(row.projectId);
    }
    await evaluateProjects(tx, touched, ctx.now);
    return { missed };
  });
}
