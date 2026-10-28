// Phase L, M30: what a save wrote (its receipt, kept in the audit log as set-aside reasons are, UD6) and
// whether the author may still undo it. Only the author's own saves are read (M1).
import { and, desc, eq } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";
import { withinUndoWindow, type SaveReceipt, type UndoState } from "../domain/machines/undo";

export const RECEIPT_ACTION = "UNDO_RECEIPT";

export type StoredReceipt = SaveReceipt & { captureId: string; authorId: string; savedAt: Date };

function receiptOf(row: typeof t.auditEntries.$inferSelect): StoredReceipt {
  const detail = (row.detail ?? {}) as Partial<SaveReceipt>;
  return { records: detail.records ?? [], told: detail.told ?? [], captureId: row.captureId!, authorId: row.actorId!, savedAt: row.at };
}

/** The receipt a save wrote, or null for a save from before phase L. */
export async function readReceipt(conn: Conn, captureId: string): Promise<StoredReceipt | null> {
  const [row] = await conn
    .select()
    .from(t.auditEntries)
    .where(and(eq(t.auditEntries.captureId, captureId), eq(t.auditEntries.action, RECEIPT_ACTION)))
    .limit(1);
  return row ? receiptOf(row) : null;
}

/**
 * W2-D1: how many Asks to an owner a save made that are still waiting; undoing withdraws them. Phase E, as CD34:
 * and the commitments it opened that are still open and never moved; undoing drops them, as their owner.
 */
export async function liveAsksOfSave(conn: Conn, captureId: string): Promise<number> {
  const asks = await conn.select({ id: t.ownerAsks.id }).from(t.ownerAsks).where(and(eq(t.ownerAsks.captureId, captureId), eq(t.ownerAsks.state, "asked")));
  const promises = await conn.select({ id: t.commitments.id }).from(t.commitments).where(and(eq(t.commitments.captureId, captureId), eq(t.commitments.state, "open"), eq(t.commitments.moves, 0)));
  return asks.length + promises.length;
}

/** "Undo that": the author's last save, whatever came after it. */
export async function lastSave(conn: Conn, authorId: string): Promise<StoredReceipt | null> {
  const [row] = await conn
    .select()
    .from(t.auditEntries)
    .where(and(eq(t.auditEntries.actorId, authorId), eq(t.auditEntries.action, RECEIPT_ACTION)))
    .orderBy(desc(t.auditEntries.at), desc(t.auditEntries.id))
    .limit(1);
  return row ? receiptOf(row) : null;
}

/** Who heard "Kemar undid this." from an undo job, as the job recorded when it moved to undone. */
export async function toldUndone(conn: Conn, jobId: string): Promise<string[]> {
  const [row] = await conn
    .select({ detail: t.auditEntries.detail })
    .from(t.auditEntries)
    .where(and(eq(t.auditEntries.machine, "undo"), eq(t.auditEntries.subjectId, jobId), eq(t.auditEntries.toState, "undone")));
  return ((row?.detail ?? {}) as { told?: string[] }).told ?? [];
}

/**
 * What the chat shows under a saved message: the Undo button while it may work, or when it was undone, or
 * why it was not (note, filled by the chat from the undo answer).
 */
export type UndoView = { may: boolean; state: UndoState | null; at: Date | null; jobId: string | null; note?: string };

export async function undoViewOf(conn: Conn, viewerId: string, captureId: string, now: Date): Promise<UndoView> {
  const [job] = await conn.select().from(t.undos).where(and(eq(t.undos.captureId, captureId), eq(t.undos.ownerId, viewerId)));
  if (job) return { may: false, state: job.state, at: job.updatedAt, jobId: job.id };
  const receipt = await readReceipt(conn, captureId);
  const may =
    !!receipt && receipt.authorId === viewerId && (receipt.records.length > 0 || (await liveAsksOfSave(conn, captureId)) > 0) && withinUndoWindow(receipt.savedAt, now);
  return { may, state: null, at: null, jobId: null };
}
