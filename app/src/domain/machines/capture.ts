// M2. Capture processing (Job). Port of the capture side of research/state-machines/js/models/capture.mjs
// and captureSave.mjs (model checked 26 Oct): dedup by key (E1), retries (S7), the proposal cap (S8),
// the Save guard, and the review timers (S4: remind, then expire; expiry is final).
import { config } from "../config";
import { defineMachine, transition, type Outcome } from "../machine";
import type { Confidence } from "../shared";
import { applyItemEvent, OPEN_ITEM_STATES, UNDECIDED_STATES, type ExtractedItem, type ItemState } from "./extracted-item";

export const CAPTURE_STATES = [
  "received",
  "transcribing",
  "reading",
  "retry_wait",
  "failed",
  "proposed",
  "nothing_to_update",
  "reviewing",
  "saving",
  "saved",
  "rejected",
  "expired",
] as const;
export type CaptureState = (typeof CAPTURE_STATES)[number];

/** Nothing about a capture in these states changes again (ExpiryIsFinal, and its siblings). */
export const FINAL_CAPTURE_STATES: readonly CaptureState[] = ["failed", "nothing_to_update", "saved", "rejected", "expired"];
/** Waiting on the author: the review timers run here. */
const WAITING = ["proposed", "reviewing"] as const;

export type CaptureRecord = {
  dedupKey: string;
  kind: "text" | "voice";
  state: CaptureState;
  /** Reading attempts started (S7). */
  tries: number;
  /** Proposals kept for review, at most config.maxProposalsPerCapture (S8). */
  proposals: number;
  /** E7: Atlas found more than the cap; it says "I found more; review these first". */
  moreFound: boolean;
  reminded: boolean;
  /** E5: a poor transcript caps every item's confidence; null for text. */
  transcriptConfidence: Confidence | null;
};

export type CaptureEvent =
  | { type: "START" }
  | { type: "TRANSCRIBED"; confidence: Confidence }
  | { type: "READ_FAILED"; why: "model_error" | "timeout" | "bad_output" } // E18, E19
  | { type: "RETRY" } // the retry timer fired
  | { type: "PROPOSALS_READY"; count: number } // count passed the server checks
  | { type: "OPEN_REVIEW" }
  | { type: "SAVE" }
  | { type: "SAVE_DONE" }
  | { type: "SAVE_FAILED" } // a conflict, or the apply was refused (E24, E27)
  | { type: "DISCARD" }
  | { type: "REMIND" } // timer review_reminder
  | { type: "EXPIRE" }; // timer review_expiry

/** What the guards need, read when the event runs (rule 7). Missing context refuses the move. */
export type CaptureContext = {
  /** The author's account is active and may still act on this capture. */
  authorActive?: boolean;
  items?: readonly ExtractedItem[];
  isMember?: (projectId: string) => boolean;
  /** Time since the capture started waiting for its author. */
  elapsed?: { workingHours: number; days: number };
};

type Ctx = CaptureContext & { record: CaptureRecord };

/** Items that would be filed into a project if saved: everything not rejected, withdrawn or settled as no change. */
const WOULD_FILE: readonly ItemState[] = ["proposed", "pre_accepted", "needs_ok", "accepted", "edited", "conflict"];

/** What stops Save, for the review footer ("1 needs your OK before this is saved"). */
export function saveBlockers(items: readonly ExtractedItem[]): { needsOk: number; needsProject: number } {
  return {
    needsOk: items.filter((i) => (UNDECIDED_STATES as readonly ItemState[]).includes(i.state)).length,
    needsProject: items.filter((i) => WOULD_FILE.includes(i.state) && i.draft.routing === "choose_project").length,
  };
}

/** Projects an item would be filed into where the author is no longer a member (E29, E77). */
export function lostProjects(items: readonly ExtractedItem[], isMember: (projectId: string) => boolean): string[] {
  const lost = items
    .filter((i) => WOULD_FILE.includes(i.state) && i.draft.routing === "routed" && i.draft.scope === "project")
    .map((i) => i.draft.projectId)
    .filter((p): p is string => p !== null && !isMember(p));
  return [...new Set(lost)];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function saveGuard({ authorActive, items, isMember }: Ctx): string | null {
  if (authorActive !== true) return "the author can no longer save this capture";
  if (!items || !isMember) return "the items and memberships are needed to check Save";
  const { needsOk, needsProject } = saveBlockers(items);
  if (needsOk) return `${plural(needsOk, "needs", "need")} your OK before this is saved`;
  if (needsProject) return `${plural(needsProject, "needs", "need")} a project before this is saved`;
  const lost = lostProjects(items, isMember);
  if (lost.length) return `no longer a member of ${lost.join(", ")}; withdraw those items first`;
  return null;
}

export const captureMachine = defineMachine<CaptureState, CaptureEvent, Ctx>({
  name: "capture",
  states: CAPTURE_STATES,
  arrows: [
    { from: ["received"], on: "START", to: "transcribing", guard: ({ record }) => (record.kind === "voice" ? null : "text needs no transcript") },
    { from: ["received"], on: "START", to: "reading" },
    { from: ["transcribing"], on: "TRANSCRIBED", to: "reading" },
    { from: ["reading"], on: "READ_FAILED", to: "retry_wait" },
    {
      from: ["retry_wait"],
      on: "RETRY",
      to: "reading",
      guard: ({ record }) => (record.tries < config.captureMaxTries ? null : `tried ${record.tries} times`),
    },
    { from: ["retry_wait"], on: "RETRY", to: "failed" },
    {
      from: ["reading"],
      on: "PROPOSALS_READY",
      to: "proposed",
      guard: (_, { count }) => (count > 0 ? null : "nothing to propose"),
    },
    { from: ["reading"], on: "PROPOSALS_READY", to: "nothing_to_update" }, // E4
    {
      from: ["proposed"],
      on: "OPEN_REVIEW",
      to: "reviewing",
      guard: ({ authorActive }) => (authorActive === true ? null : "the author can no longer review this capture"),
    },
    { from: ["reviewing"], on: "SAVE", to: "saving", guard: saveGuard },
    { from: ["saving"], on: "SAVE_DONE", to: "saved" },
    { from: ["saving"], on: "SAVE_FAILED", to: "reviewing" },
    { from: WAITING, on: "DISCARD", to: "rejected" },
    // The reminder is a self arrow: it records that the author was reminded, once
    { from: ["proposed"], on: "REMIND", to: "proposed", guard: remindGuard },
    { from: ["reviewing"], on: "REMIND", to: "reviewing", guard: remindGuard },
    {
      from: WAITING,
      on: "EXPIRE",
      to: "expired",
      guard: ({ record, elapsed }) => {
        // ReminderBeforeExpiry: a review never expires before its author was reminded
        if (!record.reminded) return "the author has not been reminded yet";
        if (!elapsed) return "elapsed time is needed";
        return elapsed.days >= config.reviewExpiryDays ? null : `waiting ${elapsed.days} of ${config.reviewExpiryDays} days`;
      },
    },
  ],
});

function remindGuard({ record, elapsed }: Ctx): string | null {
  if (record.reminded) return "already reminded";
  if (!elapsed) return "elapsed time is needed";
  const due = config.reviewReminderWorkingHours;
  return elapsed.workingHours >= due ? null : `waiting ${elapsed.workingHours} of ${due} working hours`;
}

/** Build plan 5.1: the channel's message id, or a hash of author, text and minute. */
export function captureDedupKey(input: { channel: string; author: string; text: string; sentAt: Date; messageId?: string | null }): string {
  if (input.messageId) return `${input.channel}:${input.messageId}`;
  const minute = input.sentAt.toISOString().slice(0, 16);
  return `${input.author}:${minute}:${fnv1a(input.text)}`;
}

// FNV-1a, 32 bit: stable across runs and machines, which is all a dedup key needs
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export type Received = { ok: true; record: CaptureRecord } | { ok: false; reason: string };

/** RECEIVED: a capture whose dedup key was seen before is dropped (E1). */
export function receiveCapture(input: { dedupKey: string; kind: "text" | "voice" }, seenKeys: ReadonlySet<string>): Received {
  if (seenKeys.has(input.dedupKey)) return { ok: false, reason: "already received" };
  return {
    ok: true,
    record: {
      dedupKey: input.dedupKey,
      kind: input.kind,
      state: "received",
      tries: 0,
      proposals: 0,
      moreFound: false,
      reminded: false,
      transcriptConfidence: null,
    },
  };
}

/** S8: keeps the first proposals in message order, and how many were left for later (E7). */
export function capProposals<T extends { ordinal: number }>(drafts: readonly T[]): { kept: T[]; more: number } {
  const ordered = [...drafts].sort((a, b) => a.ordinal - b.ordinal);
  const max = config.maxProposalsPerCapture;
  return { kept: ordered.slice(0, max), more: Math.max(0, ordered.length - max) };
}

/** E5: the most any item from this capture may claim. A poor transcript caps items at Medium. */
export function confidenceCap(record: CaptureRecord): Confidence {
  return record.transcriptConfidence === null || record.transcriptConfidence === "high" ? "high" : "medium";
}

export type CaptureResult = { outcome: Outcome<CaptureState>; record: CaptureRecord };

/** Applies an event to a capture. A refused event returns the record unchanged. */
export function applyCaptureEvent(record: CaptureRecord, event: CaptureEvent, ctx: CaptureContext = {}): CaptureResult {
  const outcome = transition(captureMachine, record.state, event, { ...ctx, record });
  if (!outcome.ok) return { outcome, record };
  const next: CaptureRecord = { ...record, state: outcome.to };
  switch (event.type) {
    case "START":
      if (outcome.to === "reading") next.tries = 1;
      break;
    case "TRANSCRIBED":
      [next.tries, next.transcriptConfidence] = [1, event.confidence];
      break;
    case "RETRY":
      if (outcome.to === "reading") next.tries = record.tries + 1;
      break;
    case "PROPOSALS_READY":
      next.proposals = Math.min(event.count, config.maxProposalsPerCapture);
      next.moreFound = event.count > config.maxProposalsPerCapture;
      break;
    case "REMIND":
      next.reminded = true;
      break;
  }
  return { outcome, record: next };
}

/** E77: before Save, items filed into a project the author has left are withdrawn; the rest save normally. */
export function withdrawForLostProjects(items: readonly ExtractedItem[], isMember: (projectId: string) => boolean): ExtractedItem[] {
  const lost = new Set(lostProjects(items, isMember));
  return items.map((i) =>
    i.draft.projectId !== null && lost.has(i.draft.projectId) && (OPEN_ITEM_STATES as readonly ItemState[]).includes(i.state)
      ? applyItemEvent(i, { type: "WITHDRAW", because: "left_project" }).item
      : i,
  );
}
