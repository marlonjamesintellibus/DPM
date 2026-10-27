// Provenance (A11): who changed what, when, and where it came from, for one subject. A project's
// trail (its own rows and its plan and BRAID records) is for its members; a capture's trail (the
// capture, its items, and what Save wrote from it) is for its author only (M1). Inbox rows are
// a person's own and never part of a project's trail.
import { eq, inArray, or } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import { NOT_YOURS, peopleById, projectReader, readableEntryProject, type NotYours } from "./project";

export type AuditSubject = { type: "project"; id: string } | { type: "braid_entry"; id: string } | { type: "capture"; id: string };

export type AuditRow = {
  id: number;
  at: Date;
  actor: { type: "person" | "atlas" | "rule" | "system"; id: string | null; name: string | null };
  action: string;
  machine: string | null;
  subject: { type: string; id: string };
  from: string | null;
  to: string | null;
  captureId: string | null;
  extractionId: string | null;
  detail: Record<string, unknown> | null;
};

export type AuditTrail = { found: true; subject: AuditSubject; entries: AuditRow[] };

// Never part of a project's trail: the capture side is the author's, the inbox side is the owner's
const PRIVATE_SUBJECTS = ["capture", "extraction", "inbox_item"];

async function projectRecordIds(conn: Conn, projectId: string): Promise<string[]> {
  const [workItems, milestones, entries, handovers, reasons] = await Promise.all([
    conn.select({ id: t.workItems.id }).from(t.workItems).where(eq(t.workItems.projectId, projectId)),
    conn.select({ id: t.milestones.id }).from(t.milestones).where(eq(t.milestones.projectId, projectId)),
    conn.select({ id: t.braidEntries.id }).from(t.braidEntries).where(eq(t.braidEntries.projectId, projectId)),
    conn.select({ id: t.handovers.id }).from(t.handovers).where(eq(t.handovers.projectId, projectId)),
    conn.select({ id: t.statusReasons.id }).from(t.statusReasons).where(eq(t.statusReasons.projectId, projectId)),
  ]);
  const steps = handovers.length
    ? await conn.select({ id: t.handoverSteps.id }).from(t.handoverSteps).where(inArray(t.handoverSteps.handoverId, handovers.map((h) => h.id)))
    : [];
  return [projectId, ...[workItems, milestones, entries, handovers, steps, reasons].flat().map((r) => r.id)];
}

export async function getAuditTrail(conn: Conn, viewerId: string, subject: AuditSubject): Promise<AuditTrail | NotYours> {
  let rows: (typeof t.auditEntries.$inferSelect)[];
  switch (subject.type) {
    case "project": {
      const reader = await projectReader(conn, viewerId);
      if (!reader.mayRead(subject.id)) return NOT_YOURS;
      const ids = await projectRecordIds(conn, subject.id);
      rows = (await conn.select().from(t.auditEntries).where(inArray(t.auditEntries.subjectId, ids))).filter((r) => !PRIVATE_SUBJECTS.includes(r.subjectType));
      break;
    }
    case "braid_entry": {
      if (!(await readableEntryProject(conn, viewerId, subject.id))) return NOT_YOURS;
      rows = (await conn.select().from(t.auditEntries).where(eq(t.auditEntries.subjectId, subject.id))).filter((r) => !PRIVATE_SUBJECTS.includes(r.subjectType));
      break;
    }
    case "capture": {
      const [capture] = await conn.select({ authorId: t.captures.authorId }).from(t.captures).where(eq(t.captures.id, subject.id));
      if (!capture || capture.authorId !== viewerId) return NOT_YOURS;
      const items = await conn.select({ id: t.extractions.id }).from(t.extractions).where(eq(t.extractions.captureId, subject.id));
      const ids = [subject.id, ...items.map((i) => i.id)];
      rows = await conn
        .select()
        .from(t.auditEntries)
        .where(or(eq(t.auditEntries.captureId, subject.id), inArray(t.auditEntries.subjectId, ids)));
      // Rows about the capture or its items, and every record change Save made from it
      rows = rows.filter((r) => r.captureId === subject.id || (ids.includes(r.subjectId) && (r.subjectType === "capture" || r.subjectType === "extraction")));
      break;
    }
    default:
      return NOT_YOURS;
  }

  rows.sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id);
  const people = await peopleById(conn, rows.map((r) => (r.actorType === "person" ? r.actorId : null)));
  return {
    found: true,
    subject,
    entries: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: { type: r.actorType, id: r.actorId, name: r.actorId ? (people.get(r.actorId)?.name ?? null) : null },
      action: r.action,
      machine: r.machine,
      subject: { type: r.subjectType, id: r.subjectId },
      from: r.fromState,
      to: r.toState,
      captureId: r.captureId,
      extractionId: r.extractionId,
      detail: r.detail ?? null,
    })),
  };
}
