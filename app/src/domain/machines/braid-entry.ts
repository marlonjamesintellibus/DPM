// M15. BRAID entry (Ask, then Stage, per kind). Port of research/state-machines/js/models/braidEntry.mjs
// (model checked 26 Oct), widened to all six kinds as the machines doc draws them, with the rights
// decided in S10 to S13. Every decide and resolve guard reads the actor's project role when the
// event runs (rule 7), never the role they had when the item reached their inbox.
// Matching, merging and conflict links between entries are M16 (match.ts).
import { config } from "../config";
import { daysBetween, workingDaysBetween, type IsoDate } from "../dates";
import { defineMachine, transition, type Arrow, type Outcome, type Refused } from "../machine";
import { landsAs, mayDecide, mayMerge, mayReport, mayResolve, maySwitch, type BraidKind, type ProjectRole } from "../rights";
import type { SourceSpan } from "../shared";
import type { CauseKey } from "./inbox-item";

export const BRAID_STATES = [
  "none", // drafted, not reported yet
  "reported",
  "resolved", // blocker, issue
  "proposed",
  "more_info",
  "declined", // risk, assumption, dependency, decision
  "open",
  "mitigating",
  "closed",
  "realised", // risk (open also for dependency)
  "holding",
  "confirmed",
  "broken", // assumption
  "waiting",
  "met",
  "late", // dependency
  "approved",
  "superseded", // decision
  "withdrawn",
  "merged", // every kind
  "switched", // every kind: its kind was changed, and the entry it became holds the reports (section 13)
] as const;
export type BraidEntryState = (typeof BRAID_STATES)[number];

const COMMON = ["none", "withdrawn", "merged", "switched"] as const;
const ASKED = ["proposed", "more_info", "declined"] as const;

/** The states each kind can be in (machines doc M15). */
export const KIND_STATES: Record<BraidKind, readonly BraidEntryState[]> = {
  blocker: [...COMMON, "reported", "resolved"],
  issue: [...COMMON, "reported", "resolved"],
  risk: [...COMMON, ...ASKED, "open", "mitigating", "closed", "realised"],
  assumption: [...COMMON, ...ASKED, "holding", "confirmed", "broken"],
  dependency: [...COMMON, ...ASKED, "open", "waiting", "met", "late"],
  decision: [...COMMON, ...ASKED, "approved", "superseded"],
};

/** Where an approved entry of each kind sits on the log. */
export const ON_LOG_AS: Record<BraidKind, BraidEntryState> = {
  blocker: "reported",
  issue: "reported",
  risk: "open",
  assumption: "holding",
  dependency: "open",
  decision: "approved",
};

/** Section 13: the states an entry's kind can be changed from. Finished entries and approved decisions keep their kind. */
export const SWITCHABLE_STATES: readonly BraidEntryState[] = ["reported", "open", "mitigating", "holding", "waiting", "proposed", "more_info"];

/**
 * Where the old entry ends when its kind changes: the move PMs already name (a risk that happened is
 * realised), else switched. An entry still waiting for approval was never on the log, so it is switched.
 */
export function switchEnd(from: BraidKind, to: BraidKind, state: BraidEntryState = "open"): BraidEntryState {
  if (state === "proposed" || state === "more_info") return "switched";
  if (from === "risk" && (to === "issue" || to === "blocker")) return "realised";
  if (from === "assumption" && (to === "issue" || to === "blocker")) return "broken";
  if (from === "dependency" && (to === "blocker" || to === "issue")) return "late";
  return "switched";
}

/** Each end a switch can leave, with the states it can be reached from (and reopened to, on switching back). */
export const SWITCH_ENDS: readonly (readonly [BraidEntryState, readonly BraidEntryState[]])[] = [
  ["realised", ["open", "mitigating"]],
  ["broken", ["holding"]],
  ["late", ["open", "waiting"]],
  ["switched", SWITCHABLE_STATES],
];

/** The entry this one became, when its kind was changed. */
export function switchedTo(entry: BraidEntryRecord): string | null {
  return entry.links.find((l) => l.relation === "switched_to")?.entryId ?? null;
}

export function isSwitchable(entry: BraidEntryRecord): boolean {
  return SWITCHABLE_STATES.includes(entry.state) && switchedTo(entry) === null;
}

/** Live on the log: a reason (M9) may link only these, never proposed, declined or withdrawn ones. */
export const ON_LOG_STATES: readonly BraidEntryState[] = ["reported", "open", "mitigating", "holding", "waiting", "approved"];

export function isOnLog(entry: { state: BraidEntryState }): boolean {
  return ON_LOG_STATES.includes(entry.state);
}

/** One report behind an entry: who said it, where and when, and the quote (A11). */
export type BraidSource = {
  /** The extraction (or seed row) it came from; a source is added once. */
  id: string;
  personId: string;
  captureId: string | null;
  span: SourceSpan | null;
  /** When it was said (message time, ISO instant). */
  at: string;
};

export type BraidLinkRelation = "related" | "supersedes" | "conflicts_with" | "raised_from" | "switched_to" | "switched_from";
export type BraidLink = { relation: BraidLinkRelation; entryId: string };

/** A decider's answer, or the reporter's reply. Kept for good, so a re-proposal shows what was said before (E85, E90). */
export type BraidAnswer = {
  by: string;
  act: "approve" | "decline" | "request_info" | "reply";
  note: string | null;
  /** Which proposal round it answered; a declined entry reported again starts a new round. */
  round: number;
  on: IsoDate;
};

export type BraidEntryRecord = {
  id: string;
  projectId: string;
  kind: BraidKind;
  title: string;
  state: BraidEntryState;
  /** The entry's owner (S13: an Issue's owner may resolve it). */
  ownerId: string | null;
  reportedBy: string | null;
  sources: BraidSource[];
  links: BraidLink[];
  answers: BraidAnswer[];
  round: number;
  proposedOn: IsoDate | null;
  remindersSent: number;
  lastRemindedOn: IsoDate | null;
  decidedBy: string | null;
  decidedOn: IsoDate | null;
  /** S12: the proposer approved their own entry; labelled and audited. */
  selfApproved: boolean;
  resolvedBy: string | null;
  resolvedOn: IsoDate | null;
  /** S13: someone without the right said a blocker is cleared; it waits for the owner or a PM or Lead. */
  resolveProposedBy: string | null;
  /** The "New blocker" alert is still waiting for the PM. Set by the first report only (E84). */
  newAlert: boolean;
  mergedInto: string | null;
  stateBeforeMerge: BraidEntryState | null;
  /** The sources this entry had when it was merged away, given back on unmerge. */
  mergedSources: BraidSource[];
  /** D9: a PM merged an open duplicate into this resolved entry and chose to keep it resolved. */
  keptOnMerge: boolean;
  /** Section 13: who changed this entry's kind, when and why, and the state it was in, for switching back. */
  switchedBy: string | null;
  switchedOn: IsoDate | null;
  switchReason: string | null;
  stateBeforeSwitch: BraidEntryState | null;
};

export function draftEntry(fields: { id: string; projectId: string; kind: BraidKind; title: string; ownerId?: string | null }): BraidEntryRecord {
  return {
    ownerId: null,
    ...fields,
    state: "none",
    reportedBy: null,
    sources: [],
    links: [],
    answers: [],
    round: 0,
    proposedOn: null,
    remindersSent: 0,
    lastRemindedOn: null,
    decidedBy: null,
    decidedOn: null,
    selfApproved: false,
    resolvedBy: null,
    resolvedOn: null,
    resolveProposedBy: null,
    newAlert: false,
    mergedInto: null,
    stateBeforeMerge: null,
    mergedSources: [],
    keptOnMerge: false,
    switchedBy: null,
    switchedOn: null,
    switchReason: null,
    stateBeforeSwitch: null,
  };
}

export type ResolveOutcome = "closed" | "realised" | "confirmed" | "broken" | "met" | "late";

export type BraidEvent =
  /** From the Apply job, for the speaker. Words such as "we agreed" are shown to the approver and never approve (E96). */
  | { type: "REPORT"; source: BraidSource; wordsClaimApproval?: boolean }
  | { type: "ADD_SOURCE"; projectId: string; kind: BraidKind; source: BraidSource }
  /** note: optional words to the reporter (L6b), kept with the answer. */
  | { type: "APPROVE"; note?: string }
  | { type: "DECLINE"; reason: string }
  | { type: "REQUEST_INFO"; question: string }
  | { type: "REPLY"; answer: string }
  | { type: "RESOLVE"; outcome?: ResolveOutcome }
  | { type: "REOPEN" }
  /** A risk starts mitigating; a dependency starts waiting. */
  | { type: "PROGRESS" }
  /** "It's cleared" from someone who may not resolve the blocker or issue (S13, D7). */
  | { type: "PROPOSE_RESOLVE" }
  /** The owner or a PM or Lead says a proposed clearing is wrong; the blocker stays. */
  | { type: "KEEP_OPEN" }
  /** The PM has seen the "New blocker" item. */
  | { type: "ACKNOWLEDGE" }
  /** S18 timer. A reminder never decides. */
  | { type: "REMIND" }
  | { type: "WITHDRAW" }
  /** M16: use mergeEntries and unmergeEntry in match.ts, which also move the sources. */
  | { type: "MERGE"; into: BraidEntryRecord }
  | { type: "UNMERGE"; target: BraidEntryRecord }
  /** Fired by applyToLog when a conflicting decision is approved; never by a person. */
  | { type: "SUPERSEDE"; by: BraidEntryRecord }
  /** Section 13: a PM or Lead changes the kind. Use switchKind in kind-switch.ts, which makes the new entry and moves the reports. */
  | { type: "SWITCH_KIND"; to: BraidKind; why: string }
  /** The new entry a switch makes, with the old entry's reports and owner. */
  | { type: "SWITCH_IN"; from: BraidEntryRecord }
  /** Switching back: the original reopens as it was, with the reports of the entry it became. */
  | { type: "RESTORE"; from: BraidEntryRecord };

type EventOf<K extends BraidEvent["type"]> = Extract<BraidEvent, { type: K }>;

/** The person acting, with their project role now (null when they are not a member). */
export type BraidActor = {
  id: string;
  role: ProjectRole | null;
  /** For a blocker: they own the work it blocks (S13). */
  ownsBlockedWork?: boolean;
};

/** S11 and S12; per project later (braid_rights.approvers_needed), the config default for now. */
export type DecisionPolicy = { approversNeeded: number; selfApproval: boolean };
export const DEFAULT_POLICY: DecisionPolicy = { approversNeeded: config.decisionApprovers, selfApproval: config.selfApproval };

export type BraidCtx = { actor: BraidActor | null; today: IsoDate; policy?: Partial<DecisionPolicy> };

type Ctx = { record: BraidEntryRecord; actor: BraidActor | null; today: IsoDate; policy: DecisionPolicy };

// The doc gives merging to the PM (M15 table, S15). It belongs in the rights table once that has a merge row.

const LIVE = BRAID_STATES.filter((s) => !(COMMON as readonly string[]).includes(s));
// A repeat report adds a source in every live state; resolved and declined ones are decided again
const KEEPS_STATE_ON_SOURCE = LIVE.filter((s) => s !== "resolved" && s !== "declined");

function onlyKinds(c: Ctx, kinds: readonly BraidKind[]): string | null {
  return kinds.includes(c.record.kind) ? null : `not for a ${c.record.kind}`;
}

const NOT_MEMBER = "only a project member can do this";

function reportGuard(c: Ctx, lands: ReturnType<typeof landsAs>): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  if (!mayReport(role, c.record.kind)) return `a ${role} may not report a ${c.record.kind}`;
  return landsAs(c.record.kind, role) === lands ? null : `lands as ${landsAs(c.record.kind, role)}`;
}

export function approvalsThisRound(record: BraidEntryRecord): string[] {
  return record.answers.filter((a) => a.round === record.round && a.act === "approve").map((a) => a.by);
}

function approversNeeded(c: Ctx): number {
  return c.record.kind === "decision" ? c.policy.approversNeeded : 1;
}

// Rule 7: the right is read from the role the actor holds now
function decideGuard(c: Ctx): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  if (!mayDecide(role, c.record.kind)) return `a ${role} may not decide a ${c.record.kind}`;
  if (c.actor && approvalsThisRound(c.record).includes(c.actor.id)) return "already approved by you";
  return null;
}

function approveGuard(c: Ctx): string | null {
  const refused = decideGuard(c);
  if (refused) return refused;
  if (!c.policy.selfApproval && c.actor?.id === c.record.reportedBy) return "the proposer may not approve their own entry";
  return null;
}

function enoughApprovals(c: Ctx): boolean {
  return approvalsThisRound(c.record).length + 1 >= approversNeeded(c);
}

function isOwner(c: Ctx): boolean {
  if (c.record.kind === "blocker") return c.actor?.ownsBlockedWork ?? false;
  if (c.record.kind === "issue") return c.actor !== null && c.record.ownerId === c.actor.id;
  return false;
}

function resolveGuard(c: Ctx): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  if (mayResolve({ role, isOwner: isOwner(c) }, c.record.kind)) return null;
  return c.record.kind === "blocker"
    ? "only the owner of the blocked work, or a PM or Lead, resolves a blocker; say it is cleared instead"
    : `a ${role} may not resolve a ${c.record.kind}`;
}

function resolveTo(kinds: readonly BraidKind[], outcome?: ResolveOutcome) {
  return (c: Ctx, e: EventOf<"RESOLVE">) =>
    resolveGuard(c) ?? onlyKinds(c, kinds) ?? (e.outcome === outcome ? null : `outcome ${e.outcome ?? "none"}, not ${outcome ?? "none"}`);
}

function reporterGuard(c: Ctx): string | null {
  return c.actor !== null && c.actor.id === c.record.reportedBy ? null : "only the reporter";
}

// D11: anyone who reported an entry may take back their own report
const ownSources = (c: Ctx) => c.record.sources.filter((s) => s.personId === c.actor?.id);
const othersReported = (c: Ctx) => c.record.sources.some((s) => s.personId !== c.actor?.id);

function withdrawGuard(c: Ctx): string | null {
  if (!c.actor || (!ownSources(c).length && c.actor.id !== c.record.reportedBy)) return "only someone who reported it";
  return null;
}

// A follow up Atlas drafted (D10) waits for a PM or Lead to confirm or drop it
function followUpGuard(c: Ctx): string | null {
  const role = c.actor?.role;
  if (role !== "pm" && role !== "lead") return "a PM or Lead confirms or drops a drafted follow up";
  return c.record.links.some((l) => l.relation === "raised_from") ? null : "not a drafted follow up";
}

function addSourceGuard(c: Ctx, e: EventOf<"ADD_SOURCE">): string | null {
  if (!c.actor?.role) return "only a project member can report";
  if (e.projectId !== c.record.projectId) return "the entry is in another project";
  if (e.kind !== c.record.kind) return `kinds never merge: a ${e.kind} report cannot join a ${c.record.kind}`;
  if (c.record.sources.some((s) => s.id === e.source.id)) return "this report is already a source";
  if (switchedTo(c.record)) return "its kind was changed; reports go to the entry it became";
  return null;
}

function mergeGuard(c: Ctx, { into }: EventOf<"MERGE">): string | null {
  if (!c.actor?.role || !mayMerge(c.actor.role)) return "only a PM merges entries";
  if (into.id === c.record.id) return "an entry cannot merge into itself";
  if (into.projectId !== c.record.projectId) return "entries in different projects never merge";
  if (into.kind !== c.record.kind) return `kinds never merge: a ${c.record.kind} into a ${into.kind}`;
  if ((COMMON as readonly string[]).includes(into.state)) return `cannot merge into a ${into.state} entry`;
  if (switchedTo(into)) return "its kind was changed; merge into the entry it became";
  return null;
}

// Unmerge in reverse order (model finding, section 9a): if the target was merged away since,
// this entry's sources sit further along and would be taken from the wrong entry
function unmergeGuard(c: Ctx, { target }: EventOf<"UNMERGE">): string | null {
  if (!c.actor?.role || !mayMerge(c.actor.role)) return "only a PM unmerges entries";
  if (target.id !== c.record.mergedInto) return "not the entry it was merged into";
  if (target.mergedInto !== null) return "unmerge the entry it was merged into first (reverse order)";
  // BK15: the reports moved on with the switch, so taking them back would take them from the wrong entry
  if (switchedTo(target)) return "the entry it was merged into has changed kind since; it can no longer be unmerged";
  return null;
}

function switchGuard(c: Ctx, e: EventOf<"SWITCH_KIND">, end: BraidEntryState): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  if (!maySwitch(role)) return "only a PM or Lead changes an entry's kind; ask them instead";
  if (e.to === c.record.kind) return `it is already a ${c.record.kind}`;
  if (!e.why.trim()) return "say why the kind changes";
  if (switchedTo(c.record)) return "its kind was changed already";
  const ends = switchEnd(c.record.kind, e.to, c.record.state);
  return ends === end ? null : `a ${c.record.kind} that becomes a ${e.to} ends as ${ends}`;
}

function switchInGuard(c: Ctx, lands: ReturnType<typeof landsAs>): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  if (!maySwitch(role)) return "only a PM or Lead changes an entry's kind";
  return landsAs(c.record.kind, role) === lands ? null : `lands as ${landsAs(c.record.kind, role)}`;
}

function restoreGuard(c: Ctx, e: EventOf<"RESTORE">, to: BraidEntryState): string | null {
  const role = c.actor?.role;
  if (!role) return NOT_MEMBER;
  if (!maySwitch(role)) return "only a PM or Lead changes an entry's kind";
  if (switchedTo(c.record) !== e.from.id) return "not the entry this one became";
  return c.record.stateBeforeSwitch === to ? null : `was ${c.record.stateBeforeSwitch} before the switch`;
}

function supersedeGuard(c: Ctx, { by }: EventOf<"SUPERSEDE">): string | null {
  if (c.record.kind !== "decision" || by.kind !== "decision") return "only a decision supersedes a decision";
  if (by.state !== "approved") return "the later decision is not approved";
  const linked = c.record.links.some((l) => l.relation === "conflicts_with" && l.entryId === by.id);
  return linked ? null : "not linked as conflicting";
}

/** S18: first reminder after 2 working days, then weekly. Reminders only remind. */
export function braidReminderDue(entry: BraidEntryRecord, today: IsoDate): boolean {
  if (entry.state !== "proposed" || entry.proposedOn === null) return false;
  if (entry.lastRemindedOn === null) return workingDaysBetween(entry.proposedOn, today) >= config.braidReminderWorkingDays;
  return daysBetween(entry.lastRemindedOn, today) >= 7;
}

type BraidArrow = Arrow<BraidEntryState, BraidEvent, Ctx>;

export const braidEntryMachine = defineMachine<BraidEntryState, BraidEvent, Ctx>({
  name: "braid_entry",
  states: BRAID_STATES,
  arrows: [
    // Where a report lands comes from the rights table. There is no arrow from none to approved:
    // words in a message never approve a decision, whoever says them.
    { from: ["none"], on: "REPORT", to: "reported", guard: (c) => reportGuard(c, "reported") },
    { from: ["none"], on: "REPORT", to: "proposed", guard: (c) => reportGuard(c, "proposed") },
    // E92: a PM or Lead reporting a risk, assumption or dependency puts it straight on the log
    { from: ["none"], on: "REPORT", to: "open", guard: (c) => reportGuard(c, "on_log") ?? onlyKinds(c, ["risk", "dependency"]) },
    { from: ["none"], on: "REPORT", to: "holding", guard: (c) => reportGuard(c, "on_log") ?? onlyKinds(c, ["assumption"]) },

    { from: ["resolved"], on: "ADD_SOURCE", to: "reported", guard: addSourceGuard }, // S14: same entry reopens
    { from: ["declined"], on: "ADD_SOURCE", to: "proposed", guard: addSourceGuard }, // E85: decided again
    ...KEEPS_STATE_ON_SOURCE.map((s): BraidArrow => ({ from: [s], on: "ADD_SOURCE", to: s, guard: addSourceGuard })),

    { from: ["proposed"], on: "APPROVE", to: "open", guard: (c) => approveGuard(c) ?? onlyKinds(c, ["risk", "dependency"]) },
    { from: ["proposed"], on: "APPROVE", to: "holding", guard: (c) => approveGuard(c) ?? onlyKinds(c, ["assumption"]) },
    {
      from: ["proposed"],
      on: "APPROVE",
      to: "approved",
      guard: (c) => approveGuard(c) ?? onlyKinds(c, ["decision"]) ?? (enoughApprovals(c) ? null : "waiting for more approvers"),
    },
    // S11 with more than one approver: the approval is recorded and the decision stays pending
    {
      from: ["proposed"],
      on: "APPROVE",
      to: "proposed",
      guard: (c) => approveGuard(c) ?? onlyKinds(c, ["decision"]) ?? (enoughApprovals(c) ? "enough approvers" : null),
    },
    { from: ["proposed"], on: "DECLINE", to: "declined", guard: (c, e) => decideGuard(c) ?? (e.reason.trim() ? null : "a decline needs a reason") },
    { from: ["proposed"], on: "REQUEST_INFO", to: "more_info", guard: (c, e) => decideGuard(c) ?? (e.question.trim() ? null : "say what you need to know") },
    { from: ["more_info"], on: "REPLY", to: "proposed", guard: reporterGuard },

    // D11: the last report goes, and so does the entry; but someone who said it is cleared is answered first
    { from: ["proposed", "more_info"], on: "WITHDRAW", to: "withdrawn", guard: (c) => withdrawGuard(c) ?? (othersReported(c) ? "others reported it too" : null) },
    {
      from: ["reported"],
      on: "WITHDRAW",
      to: "withdrawn",
      guard: (c) =>
        withdrawGuard(c) ??
        (othersReported(c) ? "others reported it too" : c.record.resolveProposedBy ? "someone said it is cleared; the owner or a PM or Lead answers first" : null),
    },
    // With others' reports on it, withdrawing takes back only the actor's own; the entry stays
    ...(["proposed", "more_info", "reported"] as const).map((s): BraidArrow => ({ from: [s], on: "WITHDRAW", to: s, guard: (c) => withdrawGuard(c) ?? (othersReported(c) ? null : "only you reported it") })),
    { from: ["none"], on: "WITHDRAW", to: "withdrawn", guard: followUpGuard },

    { from: ["reported"], on: "RESOLVE", to: "resolved", guard: resolveTo(["blocker", "issue"]) },
    { from: ["open", "mitigating"], on: "RESOLVE", to: "closed", guard: resolveTo(["risk"], "closed") },
    { from: ["open", "mitigating"], on: "RESOLVE", to: "realised", guard: resolveTo(["risk"], "realised") },
    { from: ["holding"], on: "RESOLVE", to: "confirmed", guard: resolveTo(["assumption"], "confirmed") },
    { from: ["holding"], on: "RESOLVE", to: "broken", guard: resolveTo(["assumption"], "broken") },
    { from: ["open", "waiting"], on: "RESOLVE", to: "met", guard: resolveTo(["dependency"], "met") },
    { from: ["open", "waiting"], on: "RESOLVE", to: "late", guard: resolveTo(["dependency"], "late") },
    { from: ["resolved"], on: "REOPEN", to: "reported", guard: (c) => resolveGuard(c) ?? onlyKinds(c, ["blocker", "issue"]) },
    { from: ["open"], on: "PROGRESS", to: "mitigating", guard: (c) => resolveGuard(c) ?? onlyKinds(c, ["risk"]) },
    { from: ["open"], on: "PROGRESS", to: "waiting", guard: (c) => resolveGuard(c) ?? onlyKinds(c, ["dependency"]) },

    {
      from: ["reported"],
      on: "PROPOSE_RESOLVE",
      to: "reported",
      guard: (c) => {
        if (!c.actor?.role) return NOT_MEMBER;
        if (c.record.kind !== "blocker" && c.record.kind !== "issue") return `not for a ${c.record.kind}`;
        if (resolveGuard(c) === null) return "you may resolve it yourself";
        return c.record.resolveProposedBy ? "already proposed as cleared" : null;
      },
    },
    { from: ["reported"], on: "KEEP_OPEN", to: "reported", guard: (c) => resolveGuard(c) ?? (c.record.resolveProposedBy ? null : "nobody said it is cleared") },
    {
      from: ["reported"],
      on: "ACKNOWLEDGE",
      to: "reported",
      guard: (c) => (c.actor?.role !== "pm" ? "the PM acknowledges a new blocker" : c.record.newAlert ? null : "nothing to acknowledge"),
    },

    { from: ["proposed"], on: "REMIND", to: "proposed", guard: (c) => (braidReminderDue(c.record, c.today) ? null : "no reminder due") },

    { from: LIVE, on: "MERGE", to: "merged", guard: mergeGuard },
    ...LIVE.map(
      (s): BraidArrow => ({
        from: ["merged"],
        on: "UNMERGE",
        to: s,
        guard: (c, e) => unmergeGuard(c, e) ?? (c.record.stateBeforeMerge === s ? null : `was ${c.record.stateBeforeMerge} before the merge`),
      }),
    ),
    { from: ["approved"], on: "SUPERSEDE", to: "superseded", guard: supersedeGuard },

    // Section 13: an approved decision is never switched (a new decision replaces it), nor is a finished entry
    ...SWITCH_ENDS.map(([end, from]): BraidArrow => ({ from, on: "SWITCH_KIND", to: end, guard: (c, e) => switchGuard(c, e, end) })),
    // The new entry lands where a report by the switcher lands; a switch never approves a decision
    { from: ["none"], on: "SWITCH_IN", to: "reported", guard: (c) => switchInGuard(c, "reported") },
    { from: ["none"], on: "SWITCH_IN", to: "proposed", guard: (c) => switchInGuard(c, "proposed") },
    { from: ["none"], on: "SWITCH_IN", to: "open", guard: (c) => switchInGuard(c, "on_log") ?? onlyKinds(c, ["risk", "dependency"]) },
    { from: ["none"], on: "SWITCH_IN", to: "holding", guard: (c) => switchInGuard(c, "on_log") ?? onlyKinds(c, ["assumption"]) },
    ...SWITCH_ENDS.flatMap(([end, back]) => back.map((s): BraidArrow => ({ from: [end], on: "RESTORE", to: s, guard: (c, e) => restoreGuard(c, e, s) }))),
  ],
});

export type BraidEntryResult = { outcome: Outcome<BraidEntryState>; record: BraidEntryRecord };

function newRound(r: BraidEntryRecord, today: IsoDate): Partial<BraidEntryRecord> {
  return { round: r.round + 1, proposedOn: today, remindersSent: 0, lastRemindedOn: null, decidedBy: null, decidedOn: null, selfApproved: false };
}

function effects(r: BraidEntryRecord, e: BraidEvent, to: BraidEntryState, by: string, today: IsoDate, role: ProjectRole | null): BraidEntryRecord {
  const answer = (act: BraidAnswer["act"], note: string | null) => [...r.answers, { by, act, note, round: r.round, on: today }];
  switch (e.type) {
    case "REPORT": {
      const reported = { ...r, reportedBy: by, sources: [e.source], newAlert: r.kind === "blocker" };
      if (to === "proposed") return { ...reported, ...newRound(r, today) };
      if (to === "reported") return reported;
      return { ...reported, decidedBy: by, decidedOn: today, selfApproved: true }; // E92: reported and approved by the reporter
    }
    case "ADD_SOURCE": {
      const added = { ...r, sources: [...r.sources, e.source] };
      if (to === "proposed") return { ...added, ...newRound(r, today) };
      if (r.state === "resolved") return { ...added, resolvedBy: null, resolvedOn: null };
      return added;
    }
    case "APPROVE": {
      const note = e.note?.trim() || null;
      if (to === "proposed") return { ...r, answers: answer("approve", note) };
      return { ...r, answers: answer("approve", note), decidedBy: by, decidedOn: today, selfApproved: by === r.reportedBy };
    }
    case "DECLINE":
      return { ...r, answers: answer("decline", e.reason), decidedBy: by, decidedOn: today, selfApproved: false };
    case "REQUEST_INFO":
      return { ...r, answers: answer("request_info", e.question) };
    case "REPLY":
      // Back in front of the deciders, so their reminders start again
      return { ...r, answers: answer("reply", e.answer), proposedOn: today, remindersSent: 0, lastRemindedOn: null };
    case "RESOLVE":
      return { ...r, resolvedBy: by, resolvedOn: today, resolveProposedBy: null, newAlert: false };
    case "REOPEN":
      return { ...r, resolvedBy: null, resolvedOn: null };
    case "PROPOSE_RESOLVE":
      return { ...r, resolveProposedBy: by };
    case "KEEP_OPEN":
      return { ...r, resolveProposedBy: null };
    case "ACKNOWLEDGE":
      return { ...r, newAlert: false };
    case "REMIND":
      return { ...r, remindersSent: r.remindersSent + 1, lastRemindedOn: today };
    case "WITHDRAW": {
      if (to === r.state) {
        // D11: only the actor's own reports leave; the next reporter becomes the entry's reporter
        const sources = r.sources.filter((s) => s.personId !== by);
        return { ...r, sources, reportedBy: r.reportedBy === by ? (sources[0]?.personId ?? null) : r.reportedBy };
      }
      return { ...r, newAlert: false, resolveProposedBy: null };
    }
    case "MERGE":
      // This entry's half of the move; mergeEntries puts the same sources on the other entry
      return { ...r, mergedInto: e.into.id, stateBeforeMerge: r.state, mergedSources: r.sources, sources: [], newAlert: false, resolveProposedBy: null };
    case "UNMERGE":
      return { ...r, mergedInto: null, stateBeforeMerge: null, sources: r.mergedSources, mergedSources: [] };
    case "SWITCH_KIND":
      // The reports leave with the switch; kind-switch.ts puts them on the new entry
      return { ...r, sources: [], newAlert: false, resolveProposedBy: null, switchedBy: by, switchedOn: today, switchReason: e.why.trim(), stateBeforeSwitch: r.state };
    case "SWITCH_IN": {
      // The PM switching in a blocker has seen it; anyone else's switch tells the PM
      const moved = { ...r, ownerId: e.from.ownerId, reportedBy: e.from.reportedBy, sources: e.from.sources, newAlert: r.kind === "blocker" && role !== "pm" };
      if (to === "proposed") return { ...moved, ...newRound(r, today) };
      if (to === "reported") return moved;
      return { ...moved, decidedBy: by, decidedOn: today, selfApproved: false };
    }
    case "RESTORE":
      return {
        ...r,
        sources: e.from.sources,
        links: r.links.filter((l) => !(l.relation === "switched_to" && l.entryId === e.from.id)),
        switchedBy: null,
        switchedOn: null,
        switchReason: null,
        stateBeforeSwitch: null,
      };
    case "PROGRESS":
    case "SUPERSEDE":
      return r;
  }
}

/** Applies one event to one entry. A refused event returns the record unchanged. */
export function applyBraidEvent(record: BraidEntryRecord, event: BraidEvent, ctx: BraidCtx): BraidEntryResult {
  const policy = { ...DEFAULT_POLICY, ...ctx.policy };
  const outcome = transition(braidEntryMachine, record.state, event, { record, actor: ctx.actor, today: ctx.today, policy });
  if (!outcome.ok) return { outcome, record };
  // Timer and log events have no person; "rule" is what the audit entry records for them
  const by = ctx.actor?.id ?? "rule";
  return { outcome, record: { ...effects(record, event, outcome.to, by, ctx.today, ctx.actor?.role ?? null), state: outcome.to } };
}

/** One project's BRAID log, by entry id. */
export type BraidLog = Readonly<Record<string, BraidEntryRecord>>;

export function refused(event: string, from: string, reason: string): Refused {
  return { ok: false, machine: braidEntryMachine.name, event, from, reason };
}

/**
 * Applies a person's event to an entry on the log, with what follows from it on other entries.
 * Approving a decision supersedes an approved decision it is linked to as conflicting (E87);
 * a pending one is left for a person to decide (E88).
 */
export function applyToLog(log: BraidLog, entryId: string, event: BraidEvent, ctx: BraidCtx): { outcome: Outcome<BraidEntryState>; log: BraidLog } {
  const entry = log[entryId];
  if (!entry) return { outcome: refused(event.type, "missing", `no entry ${entryId} on this log`), log };
  if (event.type === "MERGE" || event.type === "UNMERGE") {
    return { outcome: refused(event.type, entry.state, "merging moves sources between entries; use mergeEntries or unmergeEntry"), log };
  }
  if (event.type === "SUPERSEDE") return { outcome: refused(event.type, entry.state, "only approving a conflicting decision supersedes one"), log };
  if (event.type === "SWITCH_KIND" || event.type === "SWITCH_IN" || event.type === "RESTORE") {
    return { outcome: refused(event.type, entry.state, "a switch makes or reopens another entry; use switchKind"), log };
  }
  const r = applyBraidEvent(entry, event, ctx);
  if (!r.outcome.ok) return { outcome: r.outcome, log };
  let next: Record<string, BraidEntryRecord> = { ...log, [entryId]: r.record };
  if (event.type === "APPROVE" && r.outcome.to === "approved") {
    for (const link of r.record.links) {
      const other = next[link.entryId];
      if (link.relation !== "conflicts_with" || other?.state !== "approved") continue;
      const s = applyBraidEvent(other, { type: "SUPERSEDE", by: next[entryId] }, { ...ctx, actor: null });
      if (!s.outcome.ok) continue;
      const winner = next[entryId];
      next = { ...next, [other.id]: s.record, [entryId]: { ...winner, links: [...winner.links, { relation: "supersedes", entryId: other.id }] } };
    }
  }
  return { outcome: r.outcome, log: next };
}

export type ProjectMember = { id: string; role: ProjectRole };

/** Who on the project can answer this proposal now (rule 7: from current roles). */
export function decidersFor(entry: BraidEntryRecord, members: readonly ProjectMember[], policy: Partial<DecisionPolicy> = {}): string[] {
  const p = { ...DEFAULT_POLICY, ...policy };
  const approved = approvalsThisRound(entry);
  return members
    .filter((m) => mayDecide(m.role, entry.kind) && !approved.includes(m.id) && (p.selfApproval || m.id !== entry.reportedBy))
    .map((m) => m.id);
}

/**
 * The inbox causes an entry raises now, for evaluateCause in inbox-item.ts (M10).
 * approve: a proposal waits for a decider. no_decider: nobody on the project can decide it (E91).
 * more_info: the reporter was asked for more. blocker_new: a new blocker, from its first report only,
 * never for an added source (E84). clear: someone said a blocker is cleared and the owner or a PM or Lead should confirm.
 */
export function braidEntryCauses(entry: BraidEntryRecord, members: readonly ProjectMember[], policy: Partial<DecisionPolicy> = {}): CauseKey[] {
  const keys: CauseKey[] = [];
  if (entry.state === "proposed") keys.push(decidersFor(entry, members, policy).length ? `approve:${entry.id}` : `no_decider:${entry.id}`);
  if (entry.state === "more_info") keys.push(`more_info:${entry.id}`);
  if (entry.state === "reported" && entry.newAlert) keys.push(`blocker_new:${entry.id}`);
  if (entry.state === "reported" && entry.resolveProposedBy) keys.push(`clear:${entry.id}`);
  // D10: a follow up Atlas drafted when a risk was realised, an assumption broke or a dependency was late
  if (entry.state === "none" && entry.links.some((l) => l.relation === "raised_from")) keys.push(`follow_up:${entry.id}`);
  return keys;
}
