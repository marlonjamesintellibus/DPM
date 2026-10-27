// M37. Ask to the owner (Ask). Machines doc section 20, U5 and U7; model checked 27 Oct
// (research/state-machines/js/models/ownerAsk.mjs). Someone's update says something about a record
// they may not change ("Jodian finished #160"), or about work with no record yet. Saving changes
// nothing: it asks the person with the right, who accepts (as said, or with their own value) or
// declines. An accept is checked again when it runs: the right then (rule 7), and the record still as
// the author saw it (NeverOverwriteUnseen). The record reaching the value another way makes it moot.
import { config } from "../config";
import { daysBetween, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { ProjectRole } from "../rights";
import type { CauseKey } from "./inbox-item";

export const OWNER_ASK_STATES = ["asked", "applied", "declined", "moot", "withdrawn", "expired"] as const;
export type OwnerAskState = (typeof OWNER_ASK_STATES)[number];

/** U5: a change to one field of a record the author may not change. U7: new work for the PM and Leads. */
export type OwnerAskKind = "change" | "new_work";

export type OwnerAskRecord = {
  id: string;
  projectId: string;
  captureId: string;
  extractionId: string;
  authorId: string;
  kind: OwnerAskKind;
  /** The record and field a change is to; null for new work. */
  target: { type: "work_item" | "milestone" | "handover"; id: string; field: string } | null;
  /** U5: who owns the record, and so is asked. Null for new work, which asks the PM and Leads. */
  ownerId: string | null;
  /** The value the author saw when Atlas read it (compared again on accept). */
  saw: string | null;
  /** What the author asked for: the new value, or new work's starting state. */
  value: string;
  /** U7: new work's title. */
  title: string | null;
  state: OwnerAskState;
  askedOn: IsoDate;
  decidedBy: string | null;
  decidedOn: IsoDate | null;
  /** Why it was declined, or why it was withdrawn when its target went (OA9). */
  reason: string | null;
  /** What was written: the asked value, or the one the person accepting chose. */
  appliedValue: string | null;
};

export type OwnerAskEvent =
  /** value: the person asked may accept with their own value (CHANGE then ACCEPT). */
  | { type: "ACCEPT"; value?: string }
  | { type: "DECLINE"; reason: string }
  /** Rule: the record already holds the asked value. */
  | { type: "MOOT" }
  | { type: "WITHDRAW" }
  /** Rule: the record was cancelled, or the author or the person asked left the project (OA9). */
  | { type: "TARGET_GONE"; why: string }
  /** UD1: after config.ownerAskExpiryDays the ask expires and the author is told. */
  | { type: "EXPIRE" };

export type OwnerAskActor = { id: string; role: ProjectRole | null };

type Ctx = {
  record: OwnerAskRecord;
  actor: OwnerAskActor | null;
  /** The record's field today; null for new work. */
  current: string | null;
  today: IsoDate;
};

/** Who the ask is for: the record's owner (S5), or a PM or Lead for new work. Never the author by themselves. */
export function mayAnswer(record: OwnerAskRecord, actor: OwnerAskActor | null): boolean {
  if (!actor?.role) return false;
  if (record.kind === "new_work") return actor.role === "pm" || actor.role === "lead";
  return actor.id === record.ownerId;
}

function answerGuard(c: Ctx): string | null {
  if (mayAnswer(c.record, c.actor)) return null;
  return c.record.kind === "new_work" ? "a PM or Lead answers new work" : "only the owner answers this";
}

function acceptGuard(c: Ctx, e: Extract<OwnerAskEvent, { type: "ACCEPT" }>): string | null {
  const refused = answerGuard(c);
  if (refused) return refused;
  if (!(e.value ?? c.record.value).trim()) return "an accept needs a value";
  // NeverOverwriteUnseen: someone changed it since the author read it; the asked person sees today's value
  if (c.record.kind === "change" && c.current !== c.record.saw) return `it is ${c.current ?? "empty"} now, not ${c.record.saw ?? "empty"} as the update saw it`;
  return null;
}

export const ownerAskMachine = defineMachine<OwnerAskState, OwnerAskEvent, Ctx>({
  name: "owner_ask",
  states: OWNER_ASK_STATES,
  arrows: [
    { from: ["asked"], on: "ACCEPT", to: "applied", guard: acceptGuard },
    { from: ["asked"], on: "DECLINE", to: "declined", guard: (c, e) => answerGuard(c) ?? (e.reason.trim() ? null : "say why") },
    { from: ["asked"], on: "MOOT", to: "moot", guard: (c) => (c.record.kind === "change" && c.current === c.record.value ? null : "the record does not hold the asked value") },
    { from: ["asked"], on: "WITHDRAW", to: "withdrawn", guard: (c) => (c.actor?.id === c.record.authorId ? null : "only the person who asked") },
    { from: ["asked"], on: "TARGET_GONE", to: "withdrawn" },
    { from: ["asked"], on: "EXPIRE", to: "expired", guard: (c) => (daysBetween(c.record.askedOn, c.today) >= config.ownerAskExpiryDays ? null : "not expired yet") },
  ],
});

export type OwnerAskResult = { outcome: Outcome<OwnerAskState>; record: OwnerAskRecord };

/** Applies one event to an ask. A refused event returns the record unchanged. */
export function applyOwnerAskEvent(record: OwnerAskRecord, event: OwnerAskEvent, ctx: { actor: OwnerAskActor | null; current?: string | null; today: IsoDate }): OwnerAskResult {
  const outcome = transition(ownerAskMachine, record.state, event, { record, actor: ctx.actor, current: ctx.current ?? null, today: ctx.today });
  if (!outcome.ok) return { outcome, record };
  const next: OwnerAskRecord = { ...record, state: outcome.to };
  switch (event.type) {
    case "ACCEPT":
      return { outcome, record: { ...next, decidedBy: ctx.actor!.id, decidedOn: ctx.today, appliedValue: (event.value ?? record.value).trim() } };
    case "DECLINE":
      return { outcome, record: { ...next, decidedBy: ctx.actor!.id, decidedOn: ctx.today, reason: event.reason.trim() } };
    case "TARGET_GONE":
      return { outcome, record: { ...next, reason: event.why } };
    case "MOOT":
    case "WITHDRAW":
    case "EXPIRE":
      return { outcome, record: next };
  }
}

/** M10: a live ask is in front of the person asked (the owner, or the PM and Leads for new work). */
export function ownerAskCauses(r: OwnerAskRecord): CauseKey[] {
  return r.state === "asked" ? [`owner_ask:${r.id}`] : [];
}
