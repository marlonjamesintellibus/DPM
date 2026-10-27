// What a person's absence touches in one project (D6), for that project's PMs, Leads and admin.
// Each sees only their own project's part, and never a reason: leave has no reason column (A5.2).
import { and, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { leaveRecordOf, loadBraidLog, loadWorld } from "../db/records";
import * as t from "../db/schema";
import { addDays, daysBetween, type IsoDate } from "../domain/dates";
import { isOnLog } from "../domain/machines/braid-entry";
import { leaveAdmins, leaveImpactOwners, leaveWaiting, type LeaveRange } from "../domain/machines/leave";
import { firstName, NOT_YOURS, shortDate, type NotYours, type PersonRef } from "./project";

/** Milestones due this many days after the leave ends still count: the work before them is affected. */
const SOON_AFTER_DAYS = 7;

export type LeaveImpact = {
  found: true;
  leaveId: string;
  person: PersonRef;
  project: { id: string; name: string };
  /** The dates asked for: the request, or the change waiting on approved leave. */
  asked: LeaveRange;
  /** "11 to 13 Nov" */
  askedLabel: string;
  change: boolean;
  /** The viewer may approve or decline (an admin of one of the person's projects). */
  mayDecide: boolean;
  workItems: { id: string; number: string | null; title: string; state: string; blockedNote: string | null }[];
  milestones: { id: string; name: string; due: IsoDate }[];
  handoverSteps: { id: string; title: string; to: PersonRef }[];
  /** BRAID entries on the log that name the person ("Only Kemar can run the pipeline"). */
  braid: { id: string; kind: string; title: string }[];
  /** How many things there are to cover. */
  count: number;
};

export function rangeLabel({ start, end }: LeaveRange): string {
  if (start === end) return shortDate(start);
  const [s, e] = [shortDate(start), shortDate(end)];
  return s.split(" ")[1] === e.split(" ")[1] ? `${s.split(" ")[0]} to ${e}` : `${s} to ${e}`;
}

type Impact = Omit<LeaveImpact, "found" | "mayDecide">;

export async function getLeaveImpact(conn: Conn, viewerId: string, leaveId: string, projectId: string): Promise<LeaveImpact | NotYours> {
  const [row] = await conn.select().from(t.leave).where(eq(t.leave.id, leaveId));
  if (!row) return NOT_YOURS;
  const world = await loadWorld(conn);
  // Only this project's PMs, Leads and admin
  if (!leaveImpactOwners(row.personId, world).some((o) => o.ownerId === viewerId && o.projectId === projectId)) return NOT_YOURS;
  const impact = await impactIn(conn, row, projectId);
  return { found: true, ...impact, mayDecide: leaveWaiting(leaveRecordOf(row)) && leaveAdmins(row.personId, world).includes(viewerId) };
}

/** What the absence touches in one project, with no check of who is asking: callers check that. */
export async function impactIn(conn: Conn, row: typeof t.leave.$inferSelect, projectId: string): Promise<Impact> {
  const record = leaveRecordOf(row);
  const asked = record.change ?? { start: record.start, end: record.end };
  const [[person], [project], workItems, milestones, handovers, { log }] = await Promise.all([
    conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(eq(t.people.id, row.personId)),
    conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(eq(t.projects.id, projectId)),
    conn.select().from(t.workItems).where(and(eq(t.workItems.projectId, projectId), eq(t.workItems.ownerId, row.personId))).orderBy(t.workItems.number),
    conn.select().from(t.milestones).where(and(eq(t.milestones.projectId, projectId), eq(t.milestones.ownerId, row.personId))),
    conn.select().from(t.handovers).where(and(eq(t.handovers.projectId, projectId), eq(t.handovers.fromPersonId, row.personId))),
    loadBraidLog(conn, projectId),
  ]);
  const steps = handovers.length ? await conn.select().from(t.handoverSteps).where(inArray(t.handoverSteps.handoverId, handovers.map((h) => h.id))).orderBy(t.handoverSteps.position) : [];
  const toIds = [...new Set(handovers.map((h) => h.toPersonId))];
  const to = toIds.length ? await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, toIds)) : [];

  const open = workItems.filter((w) => w.state !== "done" && w.state !== "cancelled");
  const lastDay = addDays(asked.end, SOON_AFTER_DAYS);
  const due = milestones
    .filter((m) => m.state !== "done")
    .map((m) => ({ id: m.id, name: m.name, due: m.forecastDate ?? m.targetDate }))
    .filter((m) => daysBetween(asked.start, m.due) >= 0 && daysBetween(m.due, lastDay) >= 0);
  const notHanded = steps
    .filter((s) => s.state !== "handed_over")
    .map((s) => {
      const h = handovers.find((x) => x.id === s.handoverId)!;
      return { id: s.id, title: s.title, to: to.find((p) => p.id === h.toPersonId)! };
    });
  const first = firstName(person.name).toLowerCase();
  const naming = Object.values(log)
    .filter((e) => isOnLog(e) && new RegExp(`\\b${first}\\b`, "i").test(e.title))
    .map((e) => ({ id: e.id, kind: e.kind, title: e.title }));

  return {
    leaveId: row.id,
    person,
    project,
    asked,
    askedLabel: rangeLabel(asked),
    change: !!record.change,
    workItems: open.map((w) => ({ id: w.id, number: w.number, title: w.title, state: w.state, blockedNote: w.blockedNote })),
    milestones: due,
    handoverSteps: notHanded,
    braid: naming,
    count: open.length + due.length + notHanded.length + naming.length,
  };
}
