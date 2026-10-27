// M10. Inbox item (Ask). Port of research/state-machines/js/models/inboxItem.mjs (model checked 26 Oct).
// Items are derived from causes: evaluate() keeps one live item per cause key while the cause
// holds, and closes it when the cause goes. A closed item never reopens; a returning cause
// starts a new episode with a new item (and a new age).
import { defineMachine, transition, type Outcome } from "../machine";

export const INBOX_STATES = ["open", "snoozed", "acted", "auto_closed"] as const;
export type InboxItemState = (typeof INBOX_STATES)[number];
export const LIVE: readonly InboxItemState[] = ["open", "snoozed"];

export type InboxEvent =
  | { type: "SNOOZE" }
  | { type: "WAKE" } // the snooze time passed
  | { type: "CAUSE_GONE"; byOwnerAction: boolean };

export const inboxItemMachine = defineMachine<InboxItemState, InboxEvent, null>({
  name: "inbox_item",
  states: INBOX_STATES,
  arrows: [
    { from: ["open"], on: "SNOOZE", to: "snoozed" },
    { from: ["snoozed"], on: "WAKE", to: "open" },
    // "Acted is checked against the cause": the item closes as acted only because the owner's
    // primary action removed its cause (for example Save reason), never because a button was pressed.
    { from: ["open"], on: "CAUSE_GONE", to: "acted", guard: (_, { byOwnerAction }) => (byOwnerAction ? null : "not the owner's action") },
    { from: LIVE, on: "CAUSE_GONE", to: "auto_closed" },
  ],
});

export function applyInboxEvent(state: InboxItemState, event: InboxEvent): Outcome<InboxItemState> {
  return transition(inboxItemMachine, state, event, null);
}

/** One cause, for example "status_no_reason:project:forager". */
export type CauseKey = string;

export type InboxItemRef = { id: string; causeKey: CauseKey; episode: number; state: InboxItemState };

export type InboxPlan = {
  /** A new item to create, with the next episode number. */
  create: { causeKey: CauseKey; episode: number } | null;
  /** Live items to close because their cause is gone, and how. */
  close: { id: string; to: "acted" | "auto_closed" }[];
};

/**
 * The rule that keeps the inbox in step with one cause (run after every change and on a timer).
 * `items` are all items ever made for this cause key, open or closed.
 */
export function evaluateCause(
  causeKey: CauseKey,
  items: readonly InboxItemRef[],
  causeHolds: boolean,
  opts: { byOwnerAction?: boolean } = {},
): InboxPlan {
  const mine = items.filter((i) => i.causeKey === causeKey);
  const live = mine.filter((i) => LIVE.includes(i.state));
  if (causeHolds) {
    if (live.length) return { create: null, close: [] }; // E60: never a second live item
    const episode = Math.max(0, ...mine.map((i) => i.episode)) + 1; // E61: closed items stay closed
    return { create: { causeKey, episode }, close: [] };
  }
  // E62: a snoozed item whose cause is gone closes and never wakes
  const close = live.map((i) => {
    const outcome = applyInboxEvent(i.state, { type: "CAUSE_GONE", byOwnerAction: opts.byOwnerAction ?? false });
    if (!outcome.ok) throw new Error(`inbox item ${i.id}: ${outcome.reason}`);
    return { id: i.id, to: outcome.to as "acted" | "auto_closed" };
  });
  return { create: null, close };
}
