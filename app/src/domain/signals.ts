// The six signal rules of phase K (conversational plan, section 13): patterns in one project's data that
// nobody reported. Pure: a command or query loads the project as a SignalWorld (queries/signals.ts) and
// these say which conditions hold now, how bad each is (its level) and since when (its episode). M29
// (machines/signal.ts) decides what is raised. The text is a template over the facts, never the model's.
import { config } from "./config";
import { workingDaysBetween, type IsoDate } from "./dates";
import { withArticle } from "./shared";
import type { BraidLog } from "./machines/braid-entry";
import type { BraidKind } from "./rights";
import { milestoneStatus, type MilestoneState, type WorkItemState } from "./status/rules";

export const SIGNAL_RULES = ["repeated_blocker", "stale_work", "slipping_forecast", "waiting_decision", "milestone_at_risk", "quiet_project"] as const;
export type SignalRule = (typeof SIGNAL_RULES)[number];
export type SignalSubjectType = "braid_entry" | "work_item" | "milestone" | "kind_request" | "project";

/** What a signal says, as facts; names are first names of people on the project. */
export type SignalFacts =
  | { rule: "repeated_blocker"; title: string; reporters: string[]; reports: number; reopenedOn: IsoDate | null }
  | { rule: "stale_work"; label: string; ownerId: string; days: number; since: IsoDate }
  | { rule: "slipping_forecast"; milestone: string; moves: IsoDate[] }
  | { rule: "waiting_decision"; request: boolean; kind: BraidKind; toKind: BraidKind | null; title: string; by: string | null; days: number }
  | { rule: "milestone_at_risk"; milestone: string; bad: string[]; total: number }
  | { rule: "quiet_project"; project: string; days: number; lastOn: IsoDate };

export type SignalCondition = {
  rule: SignalRule;
  subjectType: SignalSubjectType;
  subjectId: string;
  level: number;
  episode: string;
  facts: SignalFacts;
};

/** One project as the rules read it, on one day. Loaded by queries/signals.ts. */
export type SignalWorld = {
  projectId: string;
  projectName: string;
  /** CD13: a paused project raises no quiet signal. */
  paused: boolean;
  startDate: IsoDate | null;
  today: IsoDate;
  workItems: readonly { id: string; number: string | null; title: string; ownerId: string; state: WorkItemState; milestoneId: string | null; dueDate: IsoDate | null }[];
  milestones: readonly { id: string; name: string; state: MilestoneState; targetDate: IsoDate; forecastDate: IsoDate | null }[];
  log: BraidLog;
  kindRequests: readonly { id: string; entryId: string; toKind: BraidKind; askedBy: string | null; askedOn: IsoDate | null; remindersSent: number; state: string }[];
  /** Stale work: each item's last change or mention in a saved update (or its start), by work item id. */
  lastActivity: ReadonlyMap<string, IsoDate>;
  /** Slipping forecast: the dates each milestone's forecast moved later to, in order. */
  slips: ReadonlyMap<string, readonly IsoDate[]>;
  /** Repeated blocker: when each entry last went to reported, and whether that was a reopen after it was resolved. */
  reportedSince: ReadonlyMap<string, { on: IsoDate; reopened: boolean }>;
  /** Quiet project: the day of the last update from a member (or the project's start). */
  lastUpdateOn: IsoDate | null;
  /** First names of the project's people. */
  names: ReadonlyMap<string, string>;
};

const steps = (days: number, every: number) => Math.floor(days / every);
const nameOf = (w: SignalWorld, id: string | null) => (id ? (w.names.get(id) ?? "Someone") : null);

/** "#145 Google Trends connector" */
export function workLabel(w: { number: string | null; title: string }): string {
  return w.number ? `${w.number} ${w.title}` : w.title;
}

/** Every condition that holds in the project now, at most one per (rule, subject). */
export function signalConditions(w: SignalWorld): SignalCondition[] {
  const out: SignalCondition[] = [];

  // Repeated blocker: an open blocker reported by three or more people, or reported again after it was resolved
  for (const e of Object.values(w.log)) {
    if (e.kind !== "blocker" || e.state !== "reported") continue;
    const reporters = [...new Set(e.sources.map((s) => s.personId))];
    const since = w.reportedSince.get(e.id);
    const reopened = since?.reopened ?? false;
    if (reporters.length < 3 && !reopened) continue;
    out.push({
      rule: "repeated_blocker",
      subjectType: "braid_entry",
      subjectId: e.id,
      level: e.sources.length, // worse: another report
      episode: since?.on ?? "",
      facts: { rule: "repeated_blocker", title: e.title, reporters: reporters.map((id) => nameOf(w, id)!), reports: e.sources.length, reopenedOn: reopened ? since!.on : null },
    });
  }

  // Stale work: In progress for staleWorkDays with no change and no mention in any update; worse is another such stretch
  for (const item of w.workItems) {
    if (item.state !== "in_progress") continue;
    const since = w.lastActivity.get(item.id);
    if (!since) continue;
    const days = workingDaysBetween(since, w.today);
    if (days < config.staleWorkDays) continue;
    out.push({
      rule: "stale_work",
      subjectType: "work_item",
      subjectId: item.id,
      level: steps(days, config.staleWorkDays),
      episode: since,
      facts: { rule: "stale_work", label: workLabel(item), ownerId: item.ownerId, days, since },
    });
  }

  // Slipping forecast: a milestone's forecast moved later slipCount times; worse is another slip
  for (const m of w.milestones) {
    const moves = w.slips.get(m.id) ?? [];
    if (m.state === "done" || moves.length < config.slipCount) continue;
    out.push({ rule: "slipping_forecast", subjectType: "milestone", subjectId: m.id, level: moves.length, episode: m.targetDate, facts: { rule: "slipping_forecast", milestone: m.name, moves: [...moves] } });
  }

  // Waiting decision: a proposal or kind request waiting longer than decisionWaitDays, after the S18 reminders
  for (const e of Object.values(w.log)) {
    if (e.state !== "proposed" || !e.proposedOn || e.remindersSent < 1) continue;
    const days = workingDaysBetween(e.proposedOn, w.today);
    if (days < config.decisionWaitDays) continue;
    out.push({
      rule: "waiting_decision",
      subjectType: "braid_entry",
      subjectId: e.id,
      level: steps(days, config.decisionWaitDays),
      // A reply puts it back in front of the deciders: a new round is a new episode
      episode: `${e.round}@${e.proposedOn}`,
      facts: { rule: "waiting_decision", request: false, kind: e.kind, toKind: null, title: e.title, by: nameOf(w, e.reportedBy), days },
    });
  }
  for (const r of w.kindRequests) {
    const entry = w.log[r.entryId];
    if (r.state !== "asked" || !r.askedOn || r.remindersSent < 1 || !entry) continue;
    const days = workingDaysBetween(r.askedOn, w.today);
    if (days < config.decisionWaitDays) continue;
    out.push({
      rule: "waiting_decision",
      subjectType: "kind_request",
      subjectId: r.id,
      level: steps(days, config.decisionWaitDays),
      episode: r.askedOn,
      facts: { rule: "waiting_decision", request: true, kind: entry.kind, toKind: r.toKind, title: entry.title, by: nameOf(w, r.askedBy), days },
    });
  }

  // Milestone at risk from its work: most of its work Blocked or past due while it still shows On track
  for (const m of w.milestones) {
    if (m.state === "done" || milestoneStatus(m) !== "on_track") continue;
    const work = w.workItems.filter((i) => i.milestoneId === m.id && i.state !== "cancelled");
    const bad = work.filter((i) => i.state === "blocked" || (i.state !== "done" && i.dueDate !== null && i.dueDate < w.today));
    if (!work.length || bad.length * 2 <= work.length) continue;
    // Its facts carry no start, so a new episode is one a run saw end (SignalMemory.seenGone)
    out.push({ rule: "milestone_at_risk", subjectType: "milestone", subjectId: m.id, level: bad.length, episode: "", facts: { rule: "milestone_at_risk", milestone: m.name, bad: bad.map(workLabel), total: work.length } });
  }

  // Quiet project: no update from any member for quietProjectDays working days, unless it is paused (CD13)
  if (!w.paused && w.lastUpdateOn) {
    const days = workingDaysBetween(w.lastUpdateOn, w.today);
    if (days >= config.quietProjectDays) {
      out.push({
        rule: "quiet_project",
        subjectType: "project",
        subjectId: w.projectId,
        level: steps(days, config.quietProjectDays),
        episode: w.lastUpdateOn,
        facts: { rule: "quiet_project", project: w.projectName, days, lastOn: w.lastUpdateOn },
      });
    }
  }
  return out;
}

const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "23 Oct" */
const day = (d: IsoDate) => SHORT.format(new Date(`${d}T00:00:00Z`));
const list = (xs: readonly string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const workingDays = (n: number) => `${n} working ${n === 1 ? "day" : "days"}`;

/** What the signal says, a template over its facts ("Forecast for Trend model moved 3 times: 23 Oct, 28 Oct, 4 Nov"). */
export function signalText(f: SignalFacts): string {
  switch (f.rule) {
    case "repeated_blocker":
      return f.reopenedOn
        ? `The blocker "${f.title}" was reported again on ${day(f.reopenedOn)} after it was resolved`
        : `The blocker "${f.title}" was reported by ${f.reporters.length} people: ${list(f.reporters)}`;
    case "stale_work":
      return `${f.label} has been In progress for ${workingDays(f.days)} with no change and no mention in any update`;
    case "slipping_forecast":
      return `Forecast for ${f.milestone} moved ${f.moves.length} times: ${f.moves.map(day).join(", ")}`;
    case "waiting_decision":
      return f.request
        ? `${f.by ?? "Someone"}'s request to make "${f.title}" ${withArticle(f.toKind!)} has waited ${workingDays(f.days)} for a PM or Lead`
        : `${f.by ?? "Someone"}'s ${f.kind} "${f.title}" has waited ${workingDays(f.days)} for a decision`;
    case "milestone_at_risk":
      return `${f.milestone} still shows On track, but ${f.bad.length} of its ${f.total} work items are blocked or past due: ${list(f.bad)}`;
    case "quiet_project":
      return `No update on ${f.project} from anyone for ${workingDays(f.days)}, since ${day(f.lastOn)}`;
  }
}

/** Stale work while it is with its owner: a due-date style check, asked of them. */
export function ownerCheckText(f: Extract<SignalFacts, { rule: "stale_work" }>): string {
  return `Is ${f.label} still going? No change or mention for ${workingDays(f.days)}`;
}

/** The title of the risk an ACCEPT files, from the same facts. */
export function riskTitle(f: SignalFacts): string {
  switch (f.rule) {
    case "repeated_blocker":
      return `${f.title} may keep blocking work`;
    case "stale_work":
      return `${f.label} may be stuck`;
    case "slipping_forecast":
      return `${f.milestone} may keep slipping`;
    case "waiting_decision":
      return `"${f.title}" is held up waiting for a decision`;
    case "milestone_at_risk":
      return `${f.milestone} may be later than it shows`;
    case "quiet_project":
      return `${f.project} may have stalled`;
  }
}
