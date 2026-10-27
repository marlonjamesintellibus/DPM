// M4. Apply planning for a capture's Save. Port of the Save step of
// research/state-machines/js/models/captureSave.mjs (model checked 26 Oct): compare and set
// against the value each item saw, all or nothing (S3), once per item ID (rule 6).
// Pure: the command layer reads the current values, runs the plan in one transaction, and
// moves the items and the capture with settleItems() and saveOutcome().
import { config, type Config } from "./config";
import type { CaptureEvent, CaptureState } from "./machines/capture";
import { applyItemEvent, isReady, UNDECIDED_STATES, type ExtractedItem, type ItemState } from "./machines/extracted-item";
import type { BraidKind } from "./rights";
import type { TargetType } from "./shared";
import type { ResolveOutcome } from "./machines/braid-entry";

/**
 * The record and field an item compares against: an update's target field, or the matched entry's
 * state for a braid_same item (E83). A braid_new item creates an entry, so it has nothing to compare.
 */
export function targetKey(item: ExtractedItem): string | null {
  const { target, braid, kind } = item.draft;
  if (kind === "update" && target) return `${target.type}:${target.id}:${target.field}`;
  if ((kind === "braid_same" || kind === "braid_resolve") && braid?.matchEntryId) return `braid_entry:${braid.matchEntryId}:state`;
  return null;
}

/** Write `value` only while the field still holds `expected` (compare and set in the transaction). */
export type PlannedWrite = {
  itemId: string;
  target: { type: TargetType; id: string; field: string };
  key: string;
  expected: string | null;
  value: string;
};

/** A BRAID event for the M15 machine to run for the speaker. */
export type BraidIntent = {
  itemId: string;
  /** RESOLVE (D7): resolves the entry if the speaker may, otherwise proposes it to those who may. */
  event: "REPORT" | "ADD_SOURCE" | "RESOLVE";
  kind: BraidKind;
  projectId: string;
  title: string;
  matchEntryId: string | null;
  /** Section 20, U2: a new dependency's promised date. */
  expectedOn?: string | null;
  /** Section 20, U3: how a risk, assumption or dependency ended (RESOLVE). */
  outcome?: ResolveOutcome;
  /** Section 20, U4: the decision a new one reverses; linked as conflicting, so approving it supersedes that one. */
  supersedes?: string;
};

export type SaveConflict = { itemId: string; key: string; saw: string | null; current: string | null };

export type SavePlan =
  | { outcome: "refused"; reason: string }
  /** All or nothing: nothing is applied; these items go to conflict with both values. */
  | { outcome: "conflict"; conflicts: SaveConflict[] }
  | {
      outcome: "apply";
      writes: PlannedWrite[];
      braid: BraidIntent[];
      /** The target already has the new value (E2, E25): skipped, shown as no change. */
      noChange: string[];
      /** Applied before (another session, a retry): never applied again. */
      alreadyApplied: string[];
      /** Not filed into any project (S16): saved with the capture, private to its author; nothing is applied. */
      keptPrivate: string[];
      /** Only when applying what can (S3 alternative): items left in conflict. */
      conflicts: SaveConflict[];
    };

export type CurrentValues = Readonly<Record<string, string | null>>;

/**
 * Plans one Save. `current` holds today's value for every key an item compares against, read in
 * the same transaction. `alreadyApplied` is the apply log's item IDs for this capture.
 */
export function planSave(
  capture: { state: CaptureState },
  items: readonly ExtractedItem[],
  current: CurrentValues,
  opts: { alreadyApplied?: ReadonlySet<string>; applyMode?: Config["applyMode"] } = {},
): SavePlan {
  // Expiry is final, and a saved capture never runs again: only a Save in progress plans writes
  if (capture.state !== "saving") return { outcome: "refused", reason: `the capture is ${capture.state}` };
  const undecided = items.filter((i) => (UNDECIDED_STATES as readonly ItemState[]).includes(i.state));
  if (undecided.length) return { outcome: "refused", reason: `${undecided.length} not decided` };

  const applied = opts.alreadyApplied ?? new Set<string>();
  const alreadyApplied = items.filter((i) => i.state === "applied" || (isReady(i) && applied.has(i.id))).map((i) => i.id);
  const toApply = items.filter((i) => isReady(i) && !applied.has(i.id));
  const keptPrivate = toApply.filter((i) => i.draft.routing === "not_filed").map((i) => i.id);
  const filed = toApply.filter((i) => i.draft.routing !== "not_filed");

  // Values as this plan leaves them, so a second item on the same field compares against the first
  // one's write (check 6 should merge those into one card; this keeps the plan safe if it does not)
  const view = new Map<string, string | null>();
  const valueOf = (key: string): string | null => {
    if (view.has(key)) return view.get(key) ?? null;
    if (!(key in current)) throw new Error(`no current value read for ${key}`);
    return current[key];
  };

  const conflicts: SaveConflict[] = [];
  const writes: PlannedWrite[] = [];
  const braid: BraidIntent[] = [];
  const noChange: string[] = [];
  for (const item of filed) {
    const { target, braid: entry, projectId, kind } = item.draft;
    const key = targetKey(item);
    const now = key === null ? null : valueOf(key);
    // Compare and set: a field that moved to anything but the item's new value is a conflict
    const alreadyTrue = (kind === "update" && now === item.value) || (kind === "braid_resolve" && now === (entry?.outcome ?? "resolved"));
    if (key !== null && now !== item.saw && !alreadyTrue) {
      conflicts.push({ itemId: item.id, key, saw: item.saw, current: now });
    } else if (kind === "update" && target && key !== null && item.value !== null) {
      if (alreadyTrue) noChange.push(item.id); // someone got there first
      else {
        writes.push({ itemId: item.id, target: { type: target.type, id: target.id, field: target.field }, key, expected: item.saw, value: item.value });
        view.set(key, item.value);
      }
    } else if (entry && projectId !== null) {
      braid.push({
        itemId: item.id,
        event: kind === "braid_new" ? "REPORT" : kind === "braid_resolve" ? "RESOLVE" : "ADD_SOURCE",
        kind: entry.kind,
        projectId,
        title: item.value ?? entry.title,
        matchEntryId: kind === "braid_same" || kind === "braid_resolve" ? entry.matchEntryId : null,
        ...(kind === "braid_new" && entry.expectedOn ? { expectedOn: entry.expectedOn } : {}),
        ...(kind === "braid_resolve" && entry.outcome ? { outcome: entry.outcome } : {}),
        ...(kind === "braid_new" && entry.supersedes ? { supersedes: entry.supersedes } : {}),
      });
    } else {
      throw new Error(`item ${item.id}: nothing to apply`);
    }
  }
  // All or nothing (S3): one conflict and nothing is applied
  if (conflicts.length && (opts.applyMode ?? config.applyMode) === "all_or_nothing") return { outcome: "conflict", conflicts };
  return { outcome: "apply", writes, braid, noChange, alreadyApplied, keptPrivate, conflicts };
}

/** Moves the items through M3 to match a plan once it has run (or, for a conflict, instead of running). */
export function settleItems(items: readonly ExtractedItem[], plan: SavePlan): ExtractedItem[] {
  if (plan.outcome === "refused") return [...items];
  const conflicts = new Map(plan.conflicts.map((c) => [c.itemId, c]));
  const done =
    plan.outcome === "apply"
      ? new Set([...plan.writes.map((w) => w.itemId), ...plan.braid.map((b) => b.itemId), ...plan.alreadyApplied])
      : new Set<string>();
  const noChange = new Set(plan.outcome === "apply" ? plan.noChange : []);
  return items.map((item) => {
    const c = conflicts.get(item.id);
    if (c) return applyItemEvent(item, { type: "CONFLICT", current: c.current }).item;
    if (noChange.has(item.id)) return applyItemEvent(item, { type: "ALREADY_TRUE" }).item;
    if (done.has(item.id)) return applyItemEvent(item, { type: "APPLIED" }).item;
    return item;
  });
}

/** The capture event that follows a plan: back to review while anything is in conflict. */
export function saveOutcome(plan: SavePlan): CaptureEvent | null {
  if (plan.outcome === "refused") return null;
  return plan.conflicts.length ? { type: "SAVE_FAILED" } : { type: "SAVE_DONE" };
}
