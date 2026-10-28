// M4. Apply planning for a capture's Save. Port of the Save step of
// research/state-machines/js/models/captureSave.mjs (model checked 26 Oct): compare and set
// against the value each item saw, all or nothing (S3), once per item ID (rule 6).
// Pure: the command layer reads the current values, runs the plan in one transaction, and
// moves the items and the capture with settleItems() and saveOutcome().
import { config, type Config } from "./config";
import type { CaptureEvent, CaptureState } from "./machines/capture";
import { applyItemEvent, isReady, UNDECIDED_STATES, type ExtractedItem, type ItemState } from "./machines/extracted-item";
import type { BraidKind } from "./rights";
import type { CommitmentDraft, TargetType } from "./shared";
import { deliversLinkedWork, linkEndAsks, LIVE_COMMITMENT, type CommitmentState } from "./machines/commitment";
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

/**
 * Phase D, E14: whether another item of the update, still in it, changes this field of `recordId`. Choosing
 * that record for an unsure update would put two items on one field, which never save together (S3).
 */
export function fieldTaken(items: readonly ExtractedItem[], item: ExtractedItem, recordId: string): boolean {
  const field = item.draft.target?.field;
  return items.some((o) => o.id !== item.id && o.state !== "withdrawn" && o.draft.kind === "update" && o.draft.target?.id === recordId && o.draft.target.field === field);
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

/** Section 20, U5 and U7: what Save asks of the person with the right (M37) instead of writing. */
export type PlannedAsk = {
  itemId: string;
  projectId: string;
  kind: "change" | "new_work";
  /** U5: the record, field and owner; null for new work. */
  target: { type: "work_item" | "milestone" | "handover"; id: string; field: string } | null;
  ownerId: string | null;
  saw: string | null;
  value: string;
  title: string | null;
};

/**
 * Phase E, M22: what Save does with the author's own promise, run as its owner. A promise opens a commitment, or
 * moves the live one it matches to its new day (CM5); standsAsked saves it with CM11's question asked (its linked
 * work was cancelled). A done item ends the live commitment it names (CM6).
 */
export type PlannedCommitment =
  | { itemId: string; act: "promise"; what: string; dueOn: string; link: CommitmentDraft["link"]; matchId: string | null; standsAsked: boolean }
  | { itemId: string; act: "done"; commitmentId: string };

/**
 * Phase E: the keys Save reads for a commitment item, as current values (the model's recordAtSave): the linked
 * work item's state, and the matched or named commitment's state and due day.
 */
export function commitmentKeys(item: ExtractedItem): string[] {
  const c = item.draft.commitment;
  if (item.draft.kind !== "commitment" || !c) return [];
  const keys = c.link?.type === "work_item" ? [`work_item:${c.link.id}:state`] : [];
  if (c.commitmentId) keys.push(`commitment:${c.commitmentId}:state`, `commitment:${c.commitmentId}:due`);
  return keys;
}

export type SaveConflict = { itemId: string; key: string; saw: string | null; current: string | null };

export type SavePlan =
  | { outcome: "refused"; reason: string }
  /** All or nothing: nothing is applied; these items go to conflict with both values. */
  | { outcome: "conflict"; conflicts: SaveConflict[] }
  | {
      outcome: "apply";
      writes: PlannedWrite[];
      braid: BraidIntent[];
      asks: PlannedAsk[];
      commitments: PlannedCommitment[];
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
  const asks: PlannedAsk[] = [];
  const commitments: PlannedCommitment[] = [];
  const noChange: string[] = [];
  const isLive = (state: string | null) => state !== null && LIVE_COMMITMENT.includes(state as CommitmentState);
  for (const item of filed) {
    // Phase E, M22: a promise or a done commitment is the author's own; it changes no project's record
    const promise = item.draft.kind === "commitment" ? item.draft.commitment : undefined;
    if (promise) {
      const stateOf = (id: string) => valueOf(`commitment:${id}:state`);
      if (promise.act === "done") {
        const id = promise.commitmentId!;
        const now = stateOf(id);
        if (now === "done") noChange.push(item.id);
        else if (isLive(now)) commitments.push({ itemId: item.id, act: "done", commitmentId: id });
        // Dropped or lapsed since Atlas read it: nothing to mark done (the model's conflict)
        else conflicts.push({ itemId: item.id, key: `commitment:${id}:state`, saw: item.saw, current: now });
        continue;
      }
      // recordAtSave: the linked work item as it is now. Done is No change for a promise to deliver it; cancelled, or
      // Done under a promise only about it (CD51), saves with CM11's question.
      // Membership comes first: work the author can no longer read reads as null (CM9), so neither applies
      const linked = promise.link?.type === "work_item" ? valueOf(`work_item:${promise.link.id}:state`) : null;
      // CM5: the match holds only while that commitment is live; otherwise this promise opens a new one
      const matchId = promise.commitmentId && isLive(stateOf(promise.commitmentId)) ? promise.commitmentId : null;
      const sameDay = matchId !== null && stateOf(matchId) === "open" && valueOf(`commitment:${matchId}:due`) === item.value;
      if ((linked === "done" && deliversLinkedWork(promise.what)) || sameDay) noChange.push(item.id);
      else commitments.push({ itemId: item.id, act: "promise", what: promise.what, dueOn: item.value!, link: promise.link, matchId, standsAsked: linkEndAsks(promise.what, linked) });
      continue;
    }
    // Section 20, U7: new work changes no record; it asks the PM and Leads
    if (item.draft.kind === "new_work" && item.draft.newWork && item.draft.projectId) {
      const w = item.draft.newWork;
      asks.push({ itemId: item.id, projectId: item.draft.projectId, kind: "new_work", target: null, ownerId: null, saw: null, value: w.state, title: item.value ?? w.title });
      continue;
    }
    const { target, braid: entry, projectId, kind } = item.draft;
    const key = targetKey(item);
    const now = key === null ? null : valueOf(key);
    // Compare and set: a field that moved to anything but the item's new value is a conflict
    const alreadyTrue = (kind === "update" && now === item.value) || (kind === "braid_resolve" && now === (entry?.outcome ?? "resolved"));
    if (key !== null && now !== item.saw && !alreadyTrue) {
      conflicts.push({ itemId: item.id, key, saw: item.saw, current: now });
    } else if (kind === "update" && target && key !== null && item.value !== null) {
      if (alreadyTrue) noChange.push(item.id); // someone got there first
      else if (item.draft.ask && projectId && target.type !== "leave") {
        // Section 20, U5: someone else's record is asked of its owner (M37), never written by the author
        asks.push({ itemId: item.id, projectId, kind: "change", target: { type: target.type, id: target.id, field: target.field }, ownerId: item.draft.ask.ownerId, saw: item.saw, value: item.value, title: null });
      } else {
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
  return { outcome: "apply", writes, braid, asks, commitments, noChange, alreadyApplied, keptPrivate, conflicts };
}

/** Moves the items through M3 to match a plan once it has run (or, for a conflict, instead of running). */
export function settleItems(items: readonly ExtractedItem[], plan: SavePlan): ExtractedItem[] {
  if (plan.outcome === "refused") return [...items];
  const conflicts = new Map(plan.conflicts.map((c) => [c.itemId, c]));
  const done =
    plan.outcome === "apply"
      ? new Set([...plan.writes.map((w) => w.itemId), ...plan.braid.map((b) => b.itemId), ...plan.asks.map((a) => a.itemId), ...plan.commitments.map((c) => c.itemId), ...plan.alreadyApplied])
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
