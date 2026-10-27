// M17. Kind change request (Ask). Machines doc, section 13; model checked 27 Oct
// (research/state-machines/js/models/braidKindSwitch.mjs). A member asks a PM or Lead to change a
// BRAID entry's kind and says why (D31: any member). The entry stays as it is until a PM or Lead
// switches it or keeps it with a reason; the request lapses when the entry can no longer be switched.
// Rights are read from the role held when the event runs (rule 7).
import { config } from "../config";
import { daysBetween, workingDaysBetween, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import { maySwitch, type BraidKind } from "../rights";
import { isSwitchable, type BraidActor, type BraidEntryRecord } from "./braid-entry";
import type { CauseKey } from "./inbox-item";

export const KIND_REQUEST_STATES = ["none", "asked", "switched", "kept", "withdrawn", "lapsed"] as const;
export type KindRequestState = (typeof KIND_REQUEST_STATES)[number];

export type KindRequestRecord = {
  id: string;
  projectId: string;
  entryId: string;
  state: KindRequestState;
  askedBy: string | null;
  toKind: BraidKind;
  why: string;
  askedOn: IsoDate | null;
  answeredBy: string | null;
  answeredOn: IsoDate | null;
  keepReason: string | null;
  remindersSent: number;
  lastRemindedOn: IsoDate | null;
};

export function draftKindRequest(fields: { id: string; projectId: string; entryId: string; toKind: BraidKind }): KindRequestRecord {
  return { ...fields, state: "none", askedBy: null, why: "", askedOn: null, answeredBy: null, answeredOn: null, keepReason: null, remindersSent: 0, lastRemindedOn: null };
}

export type KindRequestEvent =
  | { type: "ASK"; why: string }
  /** A PM or Lead switches the entry to the asked kind (kind-switch.ts does the switch). */
  | { type: "SWITCH" }
  | { type: "KEEP"; reason: string }
  | { type: "WITHDRAW" }
  /** Rule: the entry can no longer be switched (finished, merged, withdrawn, or switched by someone). */
  | { type: "LAPSE" }
  /** S18 timer, as for BRAID proposals. A reminder never decides. */
  | { type: "REMIND" };

type Ctx = {
  record: KindRequestRecord;
  entry: BraidEntryRecord;
  actor: BraidActor | null;
  /** Another request on this entry is waiting already. */
  openRequest: boolean;
  today: IsoDate;
};

const NOT_MEMBER = "only a project member can do this";

/** S18 for requests: the first reminder after 2 working days, then weekly. */
export function kindRequestReminderDue(r: KindRequestRecord, today: IsoDate): boolean {
  if (r.state !== "asked" || r.askedOn === null) return false;
  if (r.lastRemindedOn === null) return workingDaysBetween(r.askedOn, today) >= config.braidReminderWorkingDays;
  return daysBetween(r.lastRemindedOn, today) >= 7;
}

function deciderGuard(c: Ctx): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  return maySwitch(role) ? null : "a PM or Lead answers a kind change";
}

function askGuard(c: Ctx, e: Extract<KindRequestEvent, { type: "ASK" }>): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  if (maySwitch(role)) return "a PM or Lead changes the kind directly";
  if (c.entry.projectId !== c.record.projectId) return "the entry is in another project";
  if (c.entry.state === "approved") return "an approved decision keeps its kind; add a new decision that replaces it";
  if (!isSwitchable(c.entry)) return "a finished entry keeps its kind";
  if (c.entry.kind === c.record.toKind) return `it is already a ${c.entry.kind}`;
  if (!e.why.trim()) return "say why the kind should change";
  if (c.openRequest) return "a change is already asked for this entry";
  return null;
}

export const kindRequestMachine = defineMachine<KindRequestState, KindRequestEvent, Ctx>({
  name: "kind_request",
  states: KIND_REQUEST_STATES,
  arrows: [
    { from: ["none"], on: "ASK", to: "asked", guard: askGuard },
    { from: ["asked"], on: "SWITCH", to: "switched", guard: (c) => deciderGuard(c) ?? (isSwitchable(c.entry) ? null : "the entry can no longer be switched") },
    { from: ["asked"], on: "KEEP", to: "kept", guard: (c, e) => deciderGuard(c) ?? (e.reason.trim() ? null : "say why it stays as it is") },
    { from: ["asked"], on: "WITHDRAW", to: "withdrawn", guard: (c) => (c.actor !== null && c.actor.id === c.record.askedBy ? null : "only the person who asked") },
    { from: ["asked"], on: "LAPSE", to: "lapsed", guard: (c) => (isSwitchable(c.entry) ? "the entry can still be switched" : null) },
    { from: ["asked"], on: "REMIND", to: "asked", guard: (c) => (kindRequestReminderDue(c.record, c.today) ? null : "no reminder due") },
  ],
});

export type KindRequestResult = { outcome: Outcome<KindRequestState>; record: KindRequestRecord };

/** Applies one event to a request. A refused event returns the record unchanged. */
export function applyKindRequestEvent(
  record: KindRequestRecord,
  event: KindRequestEvent,
  ctx: { entry: BraidEntryRecord; actor: BraidActor | null; openRequest?: boolean; today: IsoDate },
): KindRequestResult {
  const outcome = transition(kindRequestMachine, record.state, event, { record, entry: ctx.entry, actor: ctx.actor, openRequest: ctx.openRequest ?? false, today: ctx.today });
  if (!outcome.ok) return { outcome, record };
  const by = ctx.actor?.id ?? null;
  const next: KindRequestRecord = { ...record, state: outcome.to };
  switch (event.type) {
    case "ASK":
      return { outcome, record: { ...next, askedBy: by, why: event.why.trim(), askedOn: ctx.today } };
    case "SWITCH":
      return { outcome, record: { ...next, answeredBy: by, answeredOn: ctx.today } };
    case "KEEP":
      return { outcome, record: { ...next, answeredBy: by, answeredOn: ctx.today, keepReason: event.reason.trim() } };
    case "REMIND":
      return { outcome, record: { ...next, remindersSent: record.remindersSent + 1, lastRemindedOn: ctx.today } };
    case "WITHDRAW":
    case "LAPSE":
      return { outcome, record: next };
  }
}

/** M10: a waiting request asks the project's PMs and Leads. */
export function kindRequestCauses(r: KindRequestRecord): CauseKey[] {
  return r.state === "asked" ? [`kind_change:${r.id}`] : [];
}
