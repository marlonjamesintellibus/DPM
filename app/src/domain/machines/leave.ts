// M8. Leave, with the decision of 26 Oct on D6 (machines doc, section 11; research model leave.mjs).
// What someone says about leave is matched against every live leave of theirs, requested or
// approved: covered is no change, overlapping is a change to that leave, anything else a new
// request. A capture never approves leave: the admin does. Approved dates stay approved while a
// change waits. A leave reason never reaches a record a lead can see (A5.2, A7.3): the types below
// have no reason field, and every function copies dates only.
import { addDays, daysBetween, isIsoDate, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import { isMember, type World } from "./membership";

// C9: requested -> approved -> handover_in_progress -> covered | uncovered -> active -> ended
// D6: requested -> declined (admin) | withdrawn (the person)
export const LEAVE_STATES = ["requested", "approved", "handover_in_progress", "covered", "uncovered", "active", "ended", "declined", "withdrawn"] as const;
export type LeaveState = (typeof LEAVE_STATES)[number];

export type LeaveRange = { start: IsoDate; end: IsoDate };

/** Leave as the rest of DPM sees it. HR may hold a reason; it is never part of this record. */
export type LeaveRecord = {
  id: string;
  personId: string;
  start: IsoDate;
  end: IsoDate;
  state: LeaveState;
  /** D6: new dates asked for on approved leave; the approved dates stand until the admin decides. */
  change?: LeaveRange | null;
};

/**
 * What Atlas may extract about leave: dates only, never why ("not feeling well" stays out, E17). back (phase P,
 * LV6): the dates are the leave they are on, as it now ends because they are back early (see endsOnReturn).
 */
export type ExtractedLeave = { personId: string; start: IsoDate; end: IsoDate | null; back?: boolean };

export type LeaveRequest = { personId: string; start: IsoDate; end: IsoDate; state: "requested" };

/** Leave that still counts: not declined, withdrawn or over. */
export const LIVE_LEAVE: readonly LeaveState[] = ["requested", "approved", "handover_in_progress", "covered", "uncovered", "active"];
/** Phase P, LV4 and declineCancels: leave called off, by the person or the admin. A leave that ended is not off. */
export const CALLED_OFF_LEAVE: readonly LeaveState[] = ["declined", "withdrawn"];
// Approved and every state after it, while it can still change
const CHANGEABLE: readonly LeaveState[] = ["approved", "handover_in_progress", "covered", "uncovered"];

/** Waiting on the admin: a request, or approved leave with a change asked for. */
export function leaveWaiting(l: Pick<LeaveRecord, "state" | "change">): boolean {
  return l.state === "requested" || (CHANGEABLE.includes(l.state) && !!l.change);
}

export type LeaveFit =
  /** Covered by live leave: nothing to change. */
  | { kind: "matches"; leaveId: string; requested: boolean; range: LeaveRange }
  /** Overlaps live leave: change it to `to`. */
  | { kind: "change"; leaveId: string; requested: boolean; from: LeaveRange; to: LeaveRange }
  | { kind: "new"; range: LeaveRange }
  | { kind: "refused"; reason: string };

const inside = (day: IsoDate, r: LeaveRange) => daysBetween(r.start, day) >= 0 && daysBetween(day, r.end) >= 0;
const covers = (r: LeaveRange, s: LeaveRange) => inside(s.start, r) && inside(s.end, r);
const overlaps = (r: LeaveRange, s: LeaveRange) => daysBetween(r.start, s.end) >= 0 && daysBetween(s.start, r.end) >= 0;

/**
 * Server check 8 for leave, and what Save does with it (D6). "Out from Monday the 26th" has no end:
 * it matches leave that starts that day, changes leave it falls inside, or is a one day request.
 */
export function fitLeave(said: ExtractedLeave, leaves: readonly LeaveRecord[]): LeaveFit {
  const end = said.end ?? said.start;
  if (!isIsoDate(said.start) || !isIsoDate(end)) return { kind: "refused", reason: "leave needs real dates" };
  if (daysBetween(said.start, end) < 0) return { kind: "refused", reason: "leave ends before it starts" };
  // Approved leave first: what was agreed is what a new message is most likely about
  const live = leaves
    .filter((l) => l.personId === said.personId && LIVE_LEAVE.includes(l.state))
    .sort((a, b) => Number(a.state === "requested") - Number(b.state === "requested") || a.start.localeCompare(b.start));
  // A change waiting on approved leave counts too: saying the new dates again is no change
  const ranges = (l: LeaveRecord): LeaveRange[] => [{ start: l.start, end: l.end }, ...(l.change ? [l.change] : [])];
  const requested = (l: LeaveRecord) => l.state === "requested";

  if (said.back) {
    // Phase P, LV6: back early, the leave they are on ends sooner. Shorter dates inside live leave would match it
    // (covered is no change), so a day back is its own reading: same start, an earlier end, a D6 change
    const on = live.find((l) => l.start === said.start && inside(end, l));
    if (!on) return { kind: "refused", reason: "you're not on leave then" };
    const range = { start: said.start, end };
    if (ranges(on).some((r) => r.start === range.start && r.end === range.end)) return { kind: "matches", leaveId: on.id, requested: requested(on), range };
    return { kind: "change", leaveId: on.id, requested: requested(on), from: { start: on.start, end: on.end }, to: range };
  }

  if (said.end === null) {
    for (const l of live) for (const r of ranges(l)) if (r.start === said.start) return { kind: "matches", leaveId: l.id, requested: requested(l), range: r };
    const within = live.find((l) => inside(said.start, l));
    if (within) return { kind: "change", leaveId: within.id, requested: requested(within), from: { start: within.start, end: within.end }, to: { start: said.start, end: within.end } };
    return { kind: "new", range: { start: said.start, end } };
  }
  const range = { start: said.start, end };
  for (const l of live) for (const r of ranges(l)) if (covers(r, range)) return { kind: "matches", leaveId: l.id, requested: requested(l), range: r };
  const touching = live.find((l) => overlaps(l, range));
  if (touching) return { kind: "change", leaveId: touching.id, requested: requested(touching), from: { start: touching.start, end: touching.end }, to: range };
  return { kind: "new", range };
}

/**
 * Phase P, LV6: back at work on `day`, the live leave they are on (begun before that day, the latest) as it now
 * ends: the day before they are back, or its own end when they are back on time or later. Null when no leave of
 * theirs has begun by then: there is nothing to come back from.
 */
export function endsOnReturn(personId: string, day: IsoDate, leaves: readonly LeaveRecord[]): LeaveRange | null {
  const on = leaves
    .filter((l) => l.personId === personId && LIVE_LEAVE.includes(l.state) && daysBetween(l.start, day) > 0)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  if (!on) return null;
  const last = addDays(day, -1);
  return { start: on.start, end: daysBetween(last, on.end) > 0 ? last : on.end };
}

export type LeaveOutcome =
  | { kind: "no_change"; leaveId: string }
  | { kind: "request"; request: LeaveRequest }
  | { kind: "change"; leaveId: string; to: LeaveRange }
  | { kind: "refused"; reason: string };

/** What an accepted leave item does when the capture is saved. Never approved leave. */
export function acceptExtractedLeave(extracted: ExtractedLeave, leaves: readonly LeaveRecord[]): LeaveOutcome {
  const fit = fitLeave(extracted, leaves);
  switch (fit.kind) {
    case "matches":
      return { kind: "no_change", leaveId: fit.leaveId };
    case "change":
      return { kind: "change", leaveId: fit.leaveId, to: fit.to };
    case "refused":
      return fit;
    case "new":
      // Copy the fields by name, so nothing else the extraction carried can ride along
      return { kind: "request", request: { personId: extracted.personId, start: fit.range.start, end: fit.range.end, state: "requested" } };
  }
}

/** Applies a saved change (from a capture) to the person's own leave: a request moves, approved leave asks. */
export function changeLeave(record: LeaveRecord, to: LeaveRange): LeaveRecord {
  if (record.state === "requested") return { ...record, start: to.start, end: to.end };
  return { ...record, change: { start: to.start, end: to.end } };
}

// ---- Deciding leave (D6) ----

export type LeaveEvent =
  | { type: "APPROVE" }
  | { type: "DECLINE" }
  | { type: "WITHDRAW" }
  // Phase L, M30: the person's own save changed the dates, or asked for a change; it goes back to what it was
  | { type: "UNDO"; before: LeaveRange & { change: LeaveRange | null } };

/** Who is acting: the person whose leave it is, or an admin of one of their projects. */
export type LeaveActor = { id: string; isPerson: boolean; isAdmin: boolean };

type Ctx = { record: LeaveRecord; actor: LeaveActor };

const adminOnly = ({ actor }: Ctx) => (actor.isAdmin && !actor.isPerson ? null : "only an admin of one of their projects decides leave");
const personOnly = ({ actor }: Ctx) => (actor.isPerson ? null : "only the person withdraws their own leave request");
const changeWaits = ({ record }: Ctx) => (record.change ? null : "no change is waiting");

export const leaveMachine = defineMachine<LeaveState, LeaveEvent, Ctx>({
  name: "leave",
  states: LEAVE_STATES,
  arrows: [
    { from: ["requested"], on: "APPROVE", to: "approved", guard: adminOnly },
    { from: ["requested"], on: "DECLINE", to: "declined", guard: adminOnly },
    { from: ["requested"], on: "WITHDRAW", to: "withdrawn", guard: personOnly },
    // A change to approved leave: approving moves the dates; declining or withdrawing keeps the old ones
    ...CHANGEABLE.flatMap((s) => [
      { from: [s], on: "APPROVE" as const, to: s, guard: (c: Ctx) => adminOnly(c) ?? changeWaits(c) },
      { from: [s], on: "DECLINE" as const, to: s, guard: (c: Ctx) => adminOnly(c) ?? changeWaits(c) },
      { from: [s], on: "WITHDRAW" as const, to: s, guard: (c: Ctx) => personOnly(c) ?? changeWaits(c) },
    ]),
    // A request's dates moved, or a change was asked on approved leave: the same state, the dates as they were
    ...(["requested", ...CHANGEABLE] as const).map((s) => ({ from: [s], on: "UNDO" as const, to: s, guard: personOnly })),
  ],
});

export function applyLeaveEvent(record: LeaveRecord, event: LeaveEvent, actor: LeaveActor): { outcome: Outcome<LeaveState>; record: LeaveRecord } {
  const outcome = transition(leaveMachine, record.state, event, { record, actor });
  if (!outcome.ok) return { outcome, record };
  const next: LeaveRecord = { ...record, state: outcome.to };
  if (event.type === "UNDO") return { outcome, record: { ...next, start: event.before.start, end: event.before.end, change: event.before.change } };
  if (record.state !== "requested" && record.change) {
    if (event.type === "APPROVE") Object.assign(next, record.change);
    next.change = null;
  }
  return { outcome, record: next };
}

/** D4, D6: the admins of the projects the person is in; any of them may decide the person's leave. */
export function leaveAdmins(personId: string, world: World): string[] {
  const projects = world.projects.filter((p) => isMember(personId, p.id, world.memberships));
  return [...new Set(projects.map((p) => p.adminId).filter((id): id is string => !!id && id !== personId))].sort();
}

/**
 * D6: who is shown what a person's absence touches, per project: its PMs and Leads, and its admin.
 * Each sees only their own project's part.
 */
export function leaveImpactOwners(personId: string, world: World): { ownerId: string; projectId: string }[] {
  const out: { ownerId: string; projectId: string }[] = [];
  for (const p of world.projects.filter((x) => isMember(personId, x.id, world.memberships))) {
    const leads = world.memberships.filter((m) => m.projectId === p.id && m.state === "member" && (m.role === "pm" || m.role === "lead")).map((m) => m.personId);
    for (const ownerId of new Set([...leads, ...(p.adminId ? [p.adminId] : [])])) if (ownerId !== personId) out.push({ ownerId, projectId: p.id });
  }
  return out.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.ownerId.localeCompare(b.ownerId));
}

/** The leave a lead sees: dates and state only, whatever the stored row holds besides. */
export function leaveSeenByLead(row: LeaveRecord): LeaveRecord {
  return { id: row.id, personId: row.personId, start: row.start, end: row.end, state: row.state, ...(row.change ? { change: { start: row.change.start, end: row.change.end } } : {}) };
}

/** Leave someone is away on: approved, and every state after it while it lasts. A request is not leave yet. */
const AWAY: readonly LeaveState[] = [...CHANGEABLE, "active"];
/** Phase P: leave an admin approved and that has not ended (LV2, LV9: a handover waits for it). */
export const DECIDED_LEAVE = AWAY;

/**
 * Phase H, PP7: the last day of the leave the person is on today, or null. Approved dates only: a change
 * still waiting on the admin is not their leave yet (D6).
 */
export function onLeaveUntil(leaves: readonly LeaveRecord[], today: IsoDate): IsoDate | null {
  const away = leaves.filter((l) => AWAY.includes(l.state) && inside(today, l));
  return away.length ? away.map((l) => l.end).sort().at(-1)! : null;
}

/**
 * W3-D5: the soonest leave decided and still ahead of today (approved, its handover under way or done),
 * or null. As onLeaveUntil, a change still waiting on the admin is not their leave yet.
 */
export function leaveAhead(leaves: readonly LeaveRecord[], today: IsoDate): LeaveRange | null {
  const ahead = leaves.filter((l) => CHANGEABLE.includes(l.state) && daysBetween(today, l.start) > 0).sort((a, b) => a.start.localeCompare(b.start));
  return ahead.length ? { start: ahead[0].start, end: ahead[0].end } : null;
}
