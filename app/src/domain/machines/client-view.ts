// A contact's client view (Switch), decision CD49 (W3-D11): whether an outside contact tied to a project
// reads its client view (KB A7.3; queries/client-view.ts, phase Q, EX4). One switch per contact per project,
// stored as project_contacts.client_view. A contact added or restored starts off; only the project's PM turns
// it on or off, the right read when the command runs (rule 7). Its model is clientView.mjs in
// research/state-machines/js/models: the right is read when it runs, it is on only for an outside contact,
// a tie added back starts off, and the trail says what the flag was (the write is over the flag as read).
import { defineMachine, eventsFrom, transition, type Outcome } from "../machine";

export const CLIENT_VIEW_STATES = ["off", "on"] as const;
export type ClientViewState = (typeof CLIENT_VIEW_STATES)[number];

export type ClientViewRecord = { projectId: string; personId: string; state: ClientViewState };

export type ClientViewEvent = { type: "TURN_ON" } | { type: "TURN_OFF" };

/**
 * Who is acting and on whom. byPm: the actor is a current PM of this project now. outside: the contact
 * has no role in the org (Kyle at Sprouts IT); someone in the org reads a project as a member or not at
 * all, never through a client view.
 */
export type ClientViewCtx = { byPm: boolean; outside: boolean };

/** The switch's subject on the audit trail: one contact on one project, as project_contacts keys it. */
export const contactSubject = (projectId: string, personId: string) => `${projectId}@${personId}`;

export type ClientViewAudit = {
  action: ClientViewEvent["type"];
  projectId: string;
  personId: string;
  by: string;
  from: ClientViewState;
  to: ClientViewState;
};

const pm = ({ byPm }: ClientViewCtx) => (byPm ? null : "only the project's PM turns a contact's client view on or off");

export const clientViewMachine = defineMachine<ClientViewState, ClientViewEvent, ClientViewCtx>({
  name: "client_view",
  states: CLIENT_VIEW_STATES,
  arrows: [
    // The right first, so someone without it hears that, whatever the contact is
    { from: ["off"], on: "TURN_ON", to: "on", guard: (c) => pm(c) ?? (c.outside ? null : "only an outside contact has a client view; someone in the org reads the project as a member") },
    // Off needs only the right: it takes something away, so it is never refused for who the contact is
    { from: ["on"], on: "TURN_OFF", to: "off", guard: pm },
  ],
});

export type ClientViewResult = {
  outcome: Outcome<ClientViewState>;
  record: ClientViewRecord;
  /** Written with every move; null when the event was refused. */
  audit: ClientViewAudit | null;
};

/** Applies an event to one contact's switch. A refused event returns the record unchanged and no audit entry. */
export function switchClientView(record: ClientViewRecord, event: ClientViewEvent, by: string, ctx: ClientViewCtx): ClientViewResult {
  // Rule 6: a repeat (on when it is on) has no arrow, so it changes nothing; it says so in words, after the right
  if (!eventsFrom(clientViewMachine, record.state).includes(event.type)) {
    const reason = pm(ctx) ?? `it is already ${record.state}`;
    return { outcome: { ok: false, machine: clientViewMachine.name, event: event.type, from: record.state, reason }, record, audit: null };
  }
  const outcome = transition(clientViewMachine, record.state, event, ctx);
  if (!outcome.ok) return { outcome, record, audit: null };
  const next = { ...record, state: outcome.to };
  return { outcome, record: next, audit: { action: event.type, projectId: record.projectId, personId: record.personId, by, from: record.state, to: next.state } };
}

/** The switch as a stored flag reads it. */
export const clientViewState = (on: boolean): ClientViewState => (on ? "on" : "off");
