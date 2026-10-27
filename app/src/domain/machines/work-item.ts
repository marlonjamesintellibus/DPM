// M5. Work item (Stage + Blocked switch), C6 with decision S2: to_do -> done and blocked -> done
// are drawn (people finish things they never marked started, or clear a blocker and finish in
// one message). Apply (M4) fires these events; the table decides, Apply never writes the state.
import type { IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { WorkItemState } from "../status/rules";
import type { Actor } from "./membership";

export const WORK_ITEM_STATES = ["to_do", "in_progress", "blocked", "done", "cancelled"] as const satisfies readonly WorkItemState[];

export type WorkItemRecord = {
  id: string;
  projectId: string;
  ownerId: string;
  state: WorkItemState;
  dueDate: IsoDate | null;
  /** Section 20, U6: when its owner now expects it done. A field, not a state; Done clears it. */
  forecastDate: IsoDate | null;
  /** Set only while blocked: what it waits on ("waiting on Kyle (Sprouts IT)"). */
  blockedNote: string | null;
  /** BRAID entries the block relates to, when there are any (#151 to the Dependency and the Blocker). */
  blockedLinks: readonly string[];
};

export type WorkItemEvent =
  | { type: "START" }
  | { type: "FINISH" }
  | { type: "BLOCK"; note: string; links?: readonly string[] }
  // A refreshed note on an item that is already blocked (machines doc section 6, item 3)
  | { type: "UPDATE_BLOCKED_NOTE"; note: string; links?: readonly string[] }
  | { type: "UNBLOCK" }
  | { type: "REOPEN" }
  | { type: "CANCEL" }
  /** Section 20, U6: the owner says when it will be done (WorkForecast). The due date never moves from a message. */
  | { type: "SET_FORECAST"; forecast: IsoDate }
  // Phase L, M30: the author's own save is undone; back to the state, note, links and forecast it had before
  | { type: "UNDO"; to: WorkItemState; note: string | null; links: readonly string[]; forecast: IsoDate | null };

type Ctx = { record: WorkItemRecord; actor: Actor };

const needsNote = (note: string) => (note.trim() ? null : "a blocked item says what it is waiting on");

/**
 * Phase L, M30: one UNDO arrow back for each move a save can make (START, FINISH, BLOCK, UPDATE_BLOCKED_NOTE,
 * UNBLOCK, REOPEN, SET_FORECAST), as [from, to]. This is the only way back to To do, and only for the save that
 * left it. Section 20, U6: the forecast is a field, so its UNDO keeps the state, as a milestone's does.
 */
export const UNDO_BACK: readonly (readonly [WorkItemState, WorkItemState])[] = [
  ["in_progress", "to_do"],
  ["done", "to_do"],
  ["done", "in_progress"],
  ["done", "blocked"],
  ["blocked", "in_progress"],
  ["blocked", "blocked"],
  ["in_progress", "blocked"],
  ["in_progress", "done"],
  ["to_do", "to_do"],
  ["in_progress", "in_progress"],
];

// Rule 4: the right is held when the arrow runs, not when "Undo that" was asked
function undoGuard({ record, actor }: Ctx, e: Extract<WorkItemEvent, { type: "UNDO" }>, to: WorkItemState): string | null {
  if (!actor.role) return "only a project member can undo this";
  if (e.to !== to) return `goes back to ${e.to}`;
  // ForecastOnlyByOwner: only its owner, still the owner now, takes a forecast back
  if (e.forecast !== record.forecastDate && actor.personId !== record.ownerId) return "only its owner forecasts it";
  return to === "blocked" ? needsNote(e.note ?? "") : null;
}

export const workItemMachine = defineMachine<WorkItemState, WorkItemEvent, Ctx>({
  name: "work_item",
  states: WORK_ITEM_STATES,
  arrows: [
    { from: ["to_do"], on: "START", to: "in_progress" },
    { from: ["to_do", "in_progress", "blocked"], on: "FINISH", to: "done" },
    { from: ["in_progress"], on: "BLOCK", to: "blocked", guard: (_, e) => needsNote(e.note) },
    { from: ["blocked"], on: "UPDATE_BLOCKED_NOTE", to: "blocked", guard: (_, e) => needsNote(e.note) },
    { from: ["blocked"], on: "UNBLOCK", to: "in_progress" },
    {
      from: ["done"],
      on: "REOPEN",
      to: "in_progress",
      guard: ({ record, actor }) =>
        actor.personId === record.ownerId || actor.role === "pm" || actor.role === "lead"
          ? null
          : "only the owner, a PM or a Lead reopens finished work",
    },
    { from: ["to_do", "in_progress", "blocked", "done"], on: "CANCEL", to: "cancelled" },
    // Section 20, U6 (ForecastOnlyByOwner): its owner's word, as a milestone's forecast is its owner's (S5)
    ...(["to_do", "in_progress", "blocked"] as const).map((s) => ({
      from: [s],
      on: "SET_FORECAST" as const,
      to: s,
      guard: ({ record, actor }: Ctx) => (actor.personId === record.ownerId ? null : "only its owner forecasts it"),
    })),
    ...UNDO_BACK.map(([from, to]) => ({ from: [from], on: "UNDO" as const, to, guard: (c: Ctx, e: Extract<WorkItemEvent, { type: "UNDO" }>) => undoGuard(c, e, to) })),
  ],
});

export type WorkItemResult = { outcome: Outcome<WorkItemState>; record: WorkItemRecord };

/** Applies an event to a work item. A refused event returns the record unchanged. */
export function applyWorkItem(record: WorkItemRecord, event: WorkItemEvent, actor: Actor): WorkItemResult {
  const outcome = transition(workItemMachine, record.state, event, { record, actor });
  if (!outcome.ok) return { outcome, record };
  if (event.type === "SET_FORECAST") return { outcome, record: { ...record, forecastDate: event.forecast } };
  if (event.type === "UNDO") return { outcome, record: { ...record, state: outcome.to, blockedNote: event.note, blockedLinks: [...event.links], forecastDate: event.forecast } };
  // DoneHasNoForecast: finished work has nothing left to forecast
  if (outcome.to === "done") return { outcome, record: { ...record, state: outcome.to, blockedNote: null, forecastDate: null } };
  if (event.type === "BLOCK" || event.type === "UPDATE_BLOCKED_NOTE") {
    const links = event.links ?? (event.type === "BLOCK" ? [] : record.blockedLinks);
    return { outcome, record: { ...record, state: outcome.to, blockedNote: event.note.trim(), blockedLinks: links } };
  }
  // Leaving Blocked clears the note: it describes the block, and the audit entry keeps its history.
  // The links stay: they say which blockers held this work, so its owner may still resolve them (S13)
  // and a rule can ask them to once nothing they link to is blocked (E93)
  return { outcome, record: { ...record, state: outcome.to, blockedNote: null } };
}

/**
 * The event that moves a work item from one state to another, for Apply to fire from an update's
 * old and new value. null when no arrow is drawn (nothing goes back to To do).
 */
export function workItemEventTo(from: WorkItemState, to: WorkItemState, note = "", links?: readonly string[]): WorkItemEvent | null {
  if (to === "blocked") return from === "blocked" ? { type: "UPDATE_BLOCKED_NOTE", note, ...(links ? { links } : {}) } : { type: "BLOCK", note, ...(links ? { links } : {}) };
  if (from === to) return null;
  switch (to) {
    case "in_progress":
      if (from === "to_do") return { type: "START" };
      if (from === "blocked") return { type: "UNBLOCK" };
      return from === "done" ? { type: "REOPEN" } : null;
    case "done":
      return { type: "FINISH" };
    case "cancelled":
      return { type: "CANCEL" };
    default:
      return null;
  }
}
