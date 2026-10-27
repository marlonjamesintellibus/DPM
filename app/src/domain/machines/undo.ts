// M30. Undo (Job), phase L of the conversational plan (section 14). Port of
// research/state-machines/js/models/undoAndVocabulary.mjs (Undo, "with the fixes"): "Undo that" or the
// Undo button reverses the author's own save while every record it wrote is still at the version that
// save wrote, within config.undoMinutes, and while they hold the right now. Each record goes back through
// its own machine's UNDO arrow, all or nothing like S3. The model's fixes: the versions and the right are
// checked again in the transaction that runs the UNDO arrows, and undoing --> refused is drawn, so a record
// that moves mid-undo never leaves the job stuck.
import { config } from "../config";
import type { IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { BraidEntryRecord } from "./braid-entry";
import type { HandoverState } from "./handover";
import type { SetStatusRecord } from "./set-status";
import type { LeaveRange } from "./leave";
import type { WorkItemState } from "../status/rules";

export const UNDO_STATES = ["requested", "undoing", "undone", "refused"] as const;
export type UndoState = (typeof UNDO_STATES)[number];
export const UNDO_FINAL: readonly UndoState[] = ["undone", "refused"];

/**
 * Why an undo was refused. too_late: UN1. moved: UN2, someone changed a record since (named only when the
 * asker can open it now). no_right: they are no longer in a project the save touched. failed: a record's
 * own UNDO arrow refused, or a record moved while the arrows ran (undoing --> refused).
 */
export type UndoRefusal = { why: "too_late" | "moved" | "no_right" | "failed"; records: readonly SavedRef[]; detail?: string };

/** A record a save wrote, by kind and id. */
export type SavedRef = { type: SavedRecord["type"]; id: string };

/**
 * What a save wrote, kept with it so it can be undone: each record, the project it is on, the version the
 * save left it at, and the values it had before. `before` null means the save made it (a BRAID entry it
 * reported, a leave request it asked for); its UNDO goes back to none, or withdraws the request.
 */
export type SavedRecord =
  | { type: "work_item"; id: string; projectId: string; version: number; before: { state: WorkItemState; blockedNote: string | null; blockedLinks: string[]; forecastDate: IsoDate | null } }
  | { type: "milestone"; id: string; projectId: string; version: number; before: { forecastDate: IsoDate | null } }
  | { type: "handover_step"; id: string; projectId: string; version: number; before: { state: "not_done" | "in_progress" | "handed_over" } }
  | { type: "handover"; id: string; projectId: string; version: number; before: { state: HandoverState; stepsDone: number } }
  | { type: "braid_entry"; id: string; projectId: string; version: number; before: BraidEntryRecord | null }
  | { type: "set_status"; id: string; projectId: string; version: number; before: SetStatusRecord & { setBy: string | null; setAt: string | null } }
  | { type: "leave"; id: string; projectId: null; version: number; before: (LeaveRange & { change: LeaveRange | null }) | null };

/**
 * Someone the save told (an inbox item it opened, a notice it sent): "Kemar undid this." follows. The
 * subject is what it told them about: a BRAID entry, a project's status, a work item, or a leave request
 * (whose impact on projectId a lead was shown).
 */
export type Told = { personId: string; projectId: string; subjectType: "braid_entry" | "project" | "work_item" | "leave"; subjectId: string };

export type SaveReceipt = { records: SavedRecord[]; told: Told[] };

export type UndoRecord = {
  /** The command id: the Undo button's, or the "Undo that" message's (rule 6). */
  id: string;
  captureId: string;
  ownerId: string;
  state: UndoState;
  refusal: UndoRefusal | null;
};

export type UndoEvent =
  /** The guard, when the job starts. refusal is what undoVerdict found, or null. */
  | { type: "CHECK"; refusal: UndoRefusal | null }
  /** The UNDO arrows ran (refusal null), or the recheck in their transaction, or an arrow, refused. */
  | { type: "RUN"; refusal: UndoRefusal | null };

const passes = (_: unknown, e: UndoEvent) => (e.refusal === null ? null : `refused: ${e.refusal.why}`);
const fails = (_: unknown, e: UndoEvent) => (e.refusal !== null ? null : "nothing stops it");

export const undoMachine = defineMachine<UndoState, UndoEvent, null>({
  name: "undo",
  states: UNDO_STATES,
  arrows: [
    { from: ["requested"], on: "CHECK", to: "undoing", guard: passes },
    // UN1, UN2: refused with which record moved and who moved it
    { from: ["requested"], on: "CHECK", to: "refused", guard: fails },
    { from: ["undoing"], on: "RUN", to: "undone", guard: passes },
    // The model's fix: a record that moved, or a right lost, after the guard passed
    { from: ["undoing"], on: "RUN", to: "refused", guard: fails },
  ],
});

export function applyUndo(record: UndoRecord, event: UndoEvent): { outcome: Outcome<UndoState>; record: UndoRecord } {
  const outcome = transition(undoMachine, record.state, event, null);
  if (!outcome.ok) return { outcome, record };
  return { outcome, record: { ...record, state: outcome.to, refusal: outcome.to === "refused" ? event.refusal : null } };
}

/** UN1: the window runs from when the save landed. */
export function withinUndoWindow(savedAt: Date, now: Date): boolean {
  return now.getTime() - savedAt.getTime() <= config.undoMinutes * 60_000;
}

/**
 * The guard (M30), as checked when the job starts and again when the UNDO arrows run: within the window,
 * every record still at the version the save left it at, and the right held now. `current` is each
 * record's version now (undefined when it is gone); `rightHeld` is membership now in every project it touched.
 */
export function undoVerdict(input: {
  savedAt: Date;
  now: Date;
  records: readonly SavedRecord[];
  current: ReadonlyMap<string, number | undefined>;
  rightHeld: boolean;
}): UndoRefusal | null {
  if (!withinUndoWindow(input.savedAt, input.now)) return { why: "too_late", records: input.records.map(refOf) };
  const moved = input.records.filter((r) => input.current.get(keyOf(r)) !== r.version);
  if (moved.length) return { why: "moved", records: moved.map(refOf) };
  if (!input.rightHeld) return { why: "no_right", records: [] };
  return null;
}

export const keyOf = (r: SavedRef) => `${r.type}:${r.id}`;
export const refOf = (r: SavedRecord): SavedRef => ({ type: r.type, id: r.id });

/** The projects a save touched; the asker must still be in each to undo it (rule 4). */
export function projectsOf(receipt: Pick<SaveReceipt, "records">): string[] {
  return [...new Set(receipt.records.flatMap((r) => (r.projectId ? [r.projectId] : [])))].sort();
}
