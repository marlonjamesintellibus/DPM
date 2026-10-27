// M3. Extracted item (Ask), with the item half of M4 (conflict, no change found at save, applied).
// Port of the update side of research/state-machines/js/models/capture.mjs and captureSave.mjs
// (model checked 26 Oct). Built on the draft the server checks produce (shared.ts); routing (M14)
// and matching (M16) are read from the draft here, never changed.
import { defineMachine, transition, type Outcome } from "../machine";
import { lowerTo, type Confidence, type ExtractedItemDraft, type Mark } from "../shared";

export { lowerTo };

export const ITEM_STATES = [
  "proposed",
  "no_change",
  "pre_accepted",
  "needs_ok",
  "accepted",
  "edited",
  "rejected",
  "withdrawn",
  "conflict",
  "applied",
] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** Not settled yet: discard, expiry, a cancelled target or a lost project withdraws these. */
export const OPEN_ITEM_STATES = ["proposed", "pre_accepted", "needs_ok", "accepted", "edited", "rejected", "conflict"] as const;
/** What Save applies: confirmed by the author, or High and left pre-accepted (Save is the confirmation). */
export const READY_STATES = ["pre_accepted", "accepted", "edited"] as const;
/** Save waits while any item is here (E20); a conflict must be decided again (E24). */
export const UNDECIDED_STATES = ["proposed", "needs_ok", "conflict"] as const;

const DECIDABLE = ["pre_accepted", "needs_ok", "conflict"] as const;
const DECIDED = ["accepted", "edited", "rejected"] as const;

export type WithdrawReason = "target_cancelled" | "discarded" | "expired" | "left_project";

export type ExtractedItem = {
  /** The item ID that makes applying once only (rule 6). */
  id: string;
  draft: ExtractedItemDraft;
  state: ItemState;
  /** The draft's confidence after any floor (E5). Rules can only lower it. */
  confidence: Confidence;
  /** What Save writes: the draft's new value or the author's edit. For BRAID items, the entry title. */
  value: string | null;
  /** The target value this item last saw: the database value at proposal, then the value shown in a conflict once the author decides again. */
  saw: string | null;
  conflict: { current: string | null; reason: string | null } | null;
  withdrawn: WithdrawReason | null;
  /** The author acted on this item (NoAutoAcceptBelowHigh allows only them to accept below High). */
  touched: boolean;
};

export type ItemEvent =
  | { type: "MARK" } // the server checks are done; start from the draft's mark
  | { type: "ACCEPT" }
  | { type: "EDIT"; value: string }
  | { type: "REJECT" }
  | { type: "UNDO" }
  | { type: "WITHDRAW"; because: WithdrawReason }
  | { type: "CONFLICT"; current: string | null; reason?: string }
  | { type: "ALREADY_TRUE" } // found at save: the target already has the new value
  | { type: "APPLIED" };

export type ItemContext = {
  /** The target's own rules for an edited value (E22): why it is invalid, or null. */
  checkEdit?: (value: string) => string | null;
};

type Ctx = ItemContext & { item: ExtractedItem };

const LEAVES_NOTHING_TO_DO: readonly Mark[] = ["no_change", "matches_leave"];

export const extractedItemMachine = defineMachine<ItemState, ItemEvent, Ctx>({
  name: "extracted_item",
  states: ITEM_STATES,
  arrows: [
    // Matching approved leave changes nothing, so it is never applied (M8)
    {
      from: ["proposed"],
      on: "MARK",
      to: "no_change",
      guard: ({ item }) => (LEAVES_NOTHING_TO_DO.includes(item.draft.mark) ? null : "there is something to change"),
    },
    // NoAutoAcceptBelowHigh: only High may start ready, whatever the mark says
    {
      from: ["proposed"],
      on: "MARK",
      to: "pre_accepted",
      guard: ({ item }) => {
        if (item.draft.mark !== "pre_accepted") return "not marked pre-accepted";
        return item.confidence === "high" ? null : "below High confidence; needs the author's OK";
      },
    },
    { from: ["proposed"], on: "MARK", to: "needs_ok" },
    { from: DECIDABLE, on: "ACCEPT", to: "accepted" },
    {
      from: DECIDABLE,
      on: "EDIT",
      to: "edited",
      guard: ({ checkEdit }, { value }) => (value.trim() === "" ? "an edit needs a value" : (checkEdit?.(value) ?? null)),
    },
    { from: DECIDABLE, on: "REJECT", to: "rejected" },
    // E23: the author may change their mind until save
    { from: DECIDED, on: "UNDO", to: "needs_ok" },
    { from: OPEN_ITEM_STATES, on: "WITHDRAW", to: "withdrawn" },
    { from: READY_STATES, on: "CONFLICT", to: "conflict" },
    {
      from: READY_STATES,
      on: "ALREADY_TRUE",
      to: "no_change",
      guard: ({ item }) => (item.draft.kind === "update" ? null : "only a record update can already be true"),
    },
    { from: READY_STATES, on: "APPLIED", to: "applied" },
  ],
});


function draftValue(draft: ExtractedItemDraft): string | null {
  return draft.target?.newValue ?? draft.braid?.title ?? null;
}

/**
 * Makes the item for a checked draft and marks it. `maxConfidence` is a floor from the capture
 * (E5: a poor transcript lowers every item to at most Medium). `saw` is the matched entry's state
 * for a braid_same item; an update's seen value is always the database value in the draft (check 7).
 */
export function startItem(
  id: string,
  draft: ExtractedItemDraft,
  opts: { maxConfidence?: Confidence; saw?: string | null } = {},
): ExtractedItem {
  const proposed: ExtractedItem = {
    id,
    draft,
    state: "proposed",
    confidence: lowerTo(draft.confidence, opts.maxConfidence ?? "high"),
    value: draftValue(draft),
    saw: draft.target ? draft.target.oldValue : (opts.saw ?? draft.braid?.seenState ?? null),
    conflict: null,
    withdrawn: null,
    touched: false,
  };
  const marked = applyItemEvent(proposed, { type: "MARK" });
  if (!marked.outcome.ok) throw new Error(`item ${id}: ${marked.outcome.reason}`);
  return marked.item;
}

export type ItemResult = { outcome: Outcome<ItemState>; item: ExtractedItem };

/** Applies an event to one item. A refused event returns the item unchanged. */
export function applyItemEvent(item: ExtractedItem, event: ItemEvent, ctx: ItemContext = {}): ItemResult {
  const outcome = transition(extractedItemMachine, item.state, event, { ...ctx, item });
  if (!outcome.ok) return { outcome, item };
  const next: ExtractedItem = { ...item, state: outcome.to };
  switch (event.type) {
    case "ACCEPT":
    case "EDIT":
      next.touched = true;
      if (event.type === "EDIT") next.value = event.value;
      // Deciding a conflict again means "I have seen the new value and still want mine", so
      // the next save compares against what the author was shown, not what Atlas first read
      if (item.state === "conflict") [next.saw, next.conflict] = [item.conflict?.current ?? null, null];
      break;
    case "REJECT":
      [next.touched, next.conflict] = [true, null];
      break;
    case "UNDO":
      [next.touched, next.value] = [true, draftValue(item.draft)];
      break;
    case "WITHDRAW":
      next.withdrawn = event.because;
      break;
    case "CONFLICT":
      next.conflict = { current: event.current, reason: event.reason ?? null };
      break;
  }
  return { outcome, item: next };
}

/** Withdraws every open item (discard, expiry); settled items stay as they are. */
export function withdrawOpen(items: readonly ExtractedItem[], because: WithdrawReason): ExtractedItem[] {
  return items.map((i) => applyItemEvent(i, { type: "WITHDRAW", because }).item);
}

export function isReady(item: ExtractedItem): boolean {
  return (READY_STATES as readonly ItemState[]).includes(item.state);
}

/** The mark on the card, derived from state and the draft (machines doc M3: not a separate column). */
export function displayMark(
  item: ExtractedItem,
): "no_change" | "matches_leave" | "ready" | "needs_ok" | "accepted" | "edited" | "rejected" | "withdrawn" | "conflict" | "applied" {
  switch (item.state) {
    case "no_change":
      return item.draft.mark === "matches_leave" ? "matches_leave" : "no_change";
    case "pre_accepted":
      return "ready";
    case "proposed":
      return "needs_ok";
    default:
      return item.state;
  }
}
