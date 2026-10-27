// M7. Handover (Stage), C9: k of m steps, then handed over. Completing a step never makes the
// receiver cover the person on leave: cover is a rule (A10.2) over skills and dates, so the
// handover has no cover field and nothing here sets one ("Jodian has the runbook" is 3 of 4).
import { defineMachine, transition, type Outcome } from "../machine";

export const HANDOVER_STATES = ["not_started", "in_progress", "handed_over", "cancelled"] as const;
export type HandoverState = (typeof HANDOVER_STATES)[number];

export type HandoverRecord = {
  id: string;
  projectId: string;
  fromPersonId: string;
  toPersonId: string;
  title: string;
  state: HandoverState;
  stepsDone: number;
  stepsTotal: number;
};

export type HandoverEvent =
  // The update's new value, "3 of 4": steps done so far, not a step count to add
  | { type: "STEPS_DONE"; done: number }
  // The leave behind it was cancelled
  | { type: "CANCEL" };

const OPEN = ["not_started", "in_progress"] as const;

function stepError(record: HandoverRecord, done: number): string | null {
  if (!Number.isInteger(done)) return `${done} is not a step count`;
  if (done <= record.stepsDone) return `steps only move forward (${record.stepsDone} of ${record.stepsTotal} done)`;
  if (done > record.stepsTotal) return `this handover has ${record.stepsTotal} steps`;
  return null;
}

export const handoverMachine = defineMachine<HandoverState, HandoverEvent, HandoverRecord>({
  name: "handover",
  states: HANDOVER_STATES,
  arrows: [
    {
      from: OPEN,
      on: "STEPS_DONE",
      to: "handed_over",
      guard: (record, { done }) => stepError(record, done) ?? (done === record.stepsTotal ? null : "steps remain"),
    },
    {
      from: OPEN,
      on: "STEPS_DONE",
      to: "in_progress",
      guard: (record, { done }) => stepError(record, done) ?? (done < record.stepsTotal ? null : "this is the last step"),
    },
    { from: ["not_started", "in_progress", "handed_over"], on: "CANCEL", to: "cancelled" },
  ],
});

export type HandoverResult = { outcome: Outcome<HandoverState>; record: HandoverRecord };

/** Applies an event to a handover. A refused event returns the record unchanged. */
export function applyHandover(record: HandoverRecord, event: HandoverEvent): HandoverResult {
  const outcome = transition(handoverMachine, record.state, event, record);
  if (!outcome.ok) return { outcome, record };
  const stepsDone = event.type === "STEPS_DONE" ? event.done : record.stepsDone;
  return { outcome, record: { ...record, state: outcome.to, stepsDone } };
}
