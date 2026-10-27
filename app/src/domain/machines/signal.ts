// M29. Signal (Ask), phase K of the conversational plan (section 13). Port of
// research/state-machines/js/models/signal.mjs with the model check's fixes (Memory 'perEpisode', Escalate).
// A rule notices trouble nobody reported (domain/signals.ts) and Atlas raises it to the people who can act.
// A signal is never a BRAID entry by itself: a PM or Lead accepts it into a risk (M15), checked when they do
// (rule 4), or dismisses it with a reason.
//   (none) ──DETECTED──▶ raised ──ACCEPT──▶ accepted                                          final
//   raised ──DISMISS(reason)──▶ dismissed ──TIMER signalSnoozeDays──▶ ended ((none) again)
//   raised ──CONDITION_GONE──▶ cleared   final;   raised ──TIMER signalExpiryDays──▶ expired   final
//   raised(owner) ──TIMER ownerAnswerDays──▶ raised(PM and Leads)     (stale work; the expiry clock starts here)
// One live signal per (project, rule, subject). The model's fixes: ACCEPT, DISMISS and expiry each leave a
// memory of the level and the condition's episode; DETECTED raises only with no memory, a new episode, or worse.
import { config } from "../config";
import { daysBetween, workingDaysBetween, type IsoDate } from "../dates";
import { defineMachine, transition, type Outcome } from "../machine";
import type { ProjectRole } from "../rights";
import { decidersFor, type BraidLog, type DecisionPolicy, type ProjectMember } from "./braid-entry";
import type { SignalCondition, SignalFacts, SignalRule, SignalSubjectType } from "../signals";

// none: drafted, not stored yet. ended: "dismissed ──TIMER──▶ (none)"; a later DETECTED starts a new signal,
// as M10 starts a new item for a new episode
export const SIGNAL_STATES = ["none", "raised", "dismissed", "accepted", "cleared", "expired", "ended"] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];
export const LIVE_SIGNAL: readonly SignalState[] = ["raised", "dismissed"];
export const FINAL_SIGNAL: readonly SignalState[] = ["accepted", "cleared", "expired", "ended"];

/** Who has it: the stale work's owner first (a due-date style check), then PM and Leads (or the rule's own people). */
export type SignalStage = "owner" | "leads";

/** SG2: a dismissal remembered from earlier, shown with the signal raised again. */
export type EarlierDismissal = { by: string; on: IsoDate; reason: string };

export type SignalRecord = {
  id: string;
  projectId: string;
  rule: SignalRule;
  subjectType: SignalSubjectType;
  subjectId: string;
  state: SignalState;
  stage: SignalStage;
  /** How bad it is; "worse" is per rule: another report, another slip, more days (in steps). */
  level: number;
  /** When the condition's current stretch began, from the facts (the model's episode). */
  episode: string;
  /** What the text is a template of; every one is this project's (P10). */
  facts: SignalFacts;
  raisedOn: IsoDate;
  /** The day it reached the people who have it now: the inbox groups by it (SG10), and expiry counts from it. */
  stageOn: IsoDate;
  decidedBy: string | null;
  decidedOn: IsoDate | null;
  dismissReason: string | null;
  /** The risk an ACCEPT filed, or added a source to (SG5). */
  riskEntryId: string | null;
  earlier: EarlierDismissal | null;
};

/**
 * One memory per (project, rule, subject): the last answer (accept, dismiss or expiry) with its level and
 * episode. seenGone: a run since then found the condition gone, so whatever comes back is a new episode even
 * when its facts give the same start (the model's Returns), for the rule whose facts carry no start.
 */
export type SignalMemory = {
  episode: string;
  level: number;
  answer: "accepted" | "dismissed" | "expired";
  by: string | null;
  on: IsoDate;
  reason: string | null;
  seenGone: boolean;
};

/** The model's DETECTED guard: no memory, a new episode, or worse than the last answer in this one. */
export function shouldRaise(memory: SignalMemory | null, condition: Pick<SignalCondition, "episode" | "level">): boolean {
  if (!memory || memory.seenGone || memory.episode !== condition.episode) return true;
  return condition.level > memory.level;
}

export type SignalEvent =
  /** away: SG4, stale work whose owner is on leave is not raised while they are away. */
  | { type: "DETECTED"; condition: SignalCondition; memory: SignalMemory | null; away: boolean }
  /** The rule on save sees it worse: the text moves on, and its version (an open card is then out of date). */
  | { type: "REFRESH"; condition: SignalCondition }
  | { type: "CONDITION_GONE" }
  | { type: "ESCALATE" }
  | { type: "EXPIRE" }
  | { type: "ACCEPT"; facts: SignalFacts }
  | { type: "DISMISS"; reason: string }
  | { type: "SNOOZE_OVER" };

/** The person answering, with their role in the signal's project now (rule 4), or null for the rule's timers. */
export type SignalActor = { id: string; role: ProjectRole | null };

/** recipients: who it is raised to now (signalRecipients), so someone who left has no right (SG9). */
type Ctx = { record: SignalRecord; actor: SignalActor | null; recipients: readonly string[]; today: IsoDate };

// Rule 4: a PM or Lead it is raised to, as they are when the answer runs; the owner's copy of stale work has no Accept
function answerGuard({ record, actor, recipients }: Ctx): string | null {
  if (actor?.role !== "pm" && actor?.role !== "lead") return "only a PM or Lead accepts or dismisses a signal";
  if (record.stage === "owner") return "it is with its owner first";
  return recipients.includes(actor.id) ? null : "this signal is not raised to you";
}

function detectGuard(_: Ctx, e: Extract<SignalEvent, { type: "DETECTED" }>): string | null {
  if (e.away) return "its owner is on leave"; // SG4
  return shouldRaise(e.memory, e.condition) ? null : "already answered, and no worse in this episode";
}

export const signalMachine = defineMachine<SignalState, SignalEvent, Ctx>({
  name: "signal",
  states: SIGNAL_STATES,
  arrows: [
    { from: ["none"], on: "DETECTED", to: "raised", guard: detectGuard },
    { from: ["raised"], on: "REFRESH", to: "raised", guard: ({ record }, e) => (e.condition.level > record.level ? null : "no worse") },
    { from: ["raised"], on: "CONDITION_GONE", to: "cleared" },
    {
      from: ["raised"],
      on: "ESCALATE",
      to: "raised",
      guard: ({ record, today }) =>
        record.stage !== "owner" ? "already with PM and Leads" : workingDaysBetween(record.stageOn, today) >= config.ownerAnswerDays ? null : "its owner still has time to answer",
    },
    // The model's fix: the expiry clock starts only once PM and Leads have it
    {
      from: ["raised"],
      on: "EXPIRE",
      to: "expired",
      guard: ({ record, today }) =>
        record.stage === "owner" ? "it is with its owner first" : daysBetween(record.stageOn, today) >= config.signalExpiryDays ? null : "not due to expire",
    },
    { from: ["raised"], on: "ACCEPT", to: "accepted", guard: answerGuard },
    { from: ["raised"], on: "DISMISS", to: "dismissed", guard: (c, e) => answerGuard(c) ?? (e.reason.trim() ? null : "say why you dismiss it") },
    { from: ["dismissed"], on: "SNOOZE_OVER", to: "ended", guard: ({ record, today }) => (daysBetween(record.decidedOn ?? today, today) >= config.signalSnoozeDays ? null : "still snoozed") },
  ],
});

/** A signal not stored yet, for DETECTED. */
export function draftSignal(id: string, projectId: string, condition: SignalCondition, today: IsoDate): SignalRecord {
  return {
    id,
    projectId,
    rule: condition.rule,
    subjectType: condition.subjectType,
    subjectId: condition.subjectId,
    state: "none",
    stage: condition.rule === "stale_work" ? "owner" : "leads",
    level: condition.level,
    episode: condition.episode,
    facts: condition.facts,
    raisedOn: today,
    stageOn: today,
    decidedBy: null,
    decidedOn: null,
    dismissReason: null,
    riskEntryId: null,
    earlier: null,
  };
}

export type SignalResult = { outcome: Outcome<SignalState>; record: SignalRecord };

/** Applies one event. A refused event returns the record unchanged. Timers pass actor null. */
export function applySignalEvent(record: SignalRecord, event: SignalEvent, ctx: { actor: SignalActor | null; recipients?: readonly string[]; today: IsoDate }): SignalResult {
  const outcome = transition(signalMachine, record.state, event, { record, actor: ctx.actor, recipients: ctx.recipients ?? [], today: ctx.today });
  if (!outcome.ok) return { outcome, record };
  const next = { ...record, state: outcome.to };
  switch (event.type) {
    case "DETECTED": {
      // SG2: a dismissal in the memory is shown with the signal raised again
      const m = event.memory;
      const earlier = m?.answer === "dismissed" && m.by && m.reason ? { by: m.by, on: m.on, reason: m.reason } : null;
      return { outcome, record: { ...next, level: event.condition.level, episode: event.condition.episode, facts: event.condition.facts, earlier } };
    }
    case "REFRESH":
      return { outcome, record: { ...next, level: event.condition.level, facts: event.condition.facts } };
    case "ESCALATE":
      return { outcome, record: { ...next, stage: "leads", stageOn: ctx.today } };
    case "ACCEPT":
      // The facts as they are when it is accepted are the risk's source
      return { outcome, record: { ...next, facts: event.facts, decidedBy: ctx.actor!.id, decidedOn: ctx.today } };
    case "DISMISS":
      return { outcome, record: { ...next, decidedBy: ctx.actor!.id, decidedOn: ctx.today, dismissReason: event.reason.trim() } };
    case "CONDITION_GONE":
    case "EXPIRE":
    case "SNOOZE_OVER":
      return { outcome, record: next };
  }
}

/** The memory an answer leaves: ACCEPT, DISMISS and expiry (the model's 'perEpisode' remember). */
export function rememberOf(record: SignalRecord, today: IsoDate): SignalMemory | null {
  if (record.state !== "accepted" && record.state !== "dismissed" && record.state !== "expired") return null;
  return { episode: record.episode, level: record.level, answer: record.state, by: record.decidedBy, on: record.decidedOn ?? today, reason: record.dismissReason, seenGone: false };
}

/**
 * Who it is raised to now, from current roles (rule 4, SG9): stale work's owner while it is with them, the
 * project's PM for a quiet project, the deciders for a waiting decision, otherwise PM and Leads. Everyone
 * here is a member of the project, so may see every fact in it (rule 8).
 */
export function signalRecipients(record: Pick<SignalRecord, "rule" | "stage" | "subjectType" | "subjectId" | "facts">, members: readonly ProjectMember[], log: BraidLog, policy: Partial<DecisionPolicy> = {}): string[] {
  const leads = members.filter((m) => m.role === "pm" || m.role === "lead").map((m) => m.id);
  if (record.stage === "owner") {
    const owner = record.facts.rule === "stale_work" ? record.facts.ownerId : null;
    return owner && members.some((m) => m.id === owner) ? [owner] : [];
  }
  switch (record.rule) {
    case "quiet_project":
      return members.filter((m) => m.role === "pm").map((m) => m.id);
    case "waiting_decision": {
      const entry = record.subjectType === "braid_entry" ? log[record.subjectId] : undefined;
      return entry ? decidersFor(entry, members, policy) : leads;
    }
    default:
      return leads;
  }
}

/** SG10: one inbox item per project per day, for everyone a signal reached that day. */
export function signalCause(record: Pick<SignalRecord, "state" | "projectId" | "stageOn">): string | null {
  return record.state === "raised" ? `signals:${record.projectId}@${record.stageOn}` : null;
}

/** The key one live signal and one memory hang on. */
export function signalKey(s: { projectId: string; rule: SignalRule; subjectId: string }): string {
  return `${s.projectId}|${s.rule}|${s.subjectId}`;
}
