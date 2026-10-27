// One project as a member reads it (L14b): the plan with its calculated statuses, the set status
// and its reason, and the BRAID log with its sources. Privacy is applied here, from the viewer
// (P10): only members of the project read it at all, and a source's quote is shown only when the
// item behind it was filed into this project (rule 9, E79). The rest of the capture never leaves.
import { desc, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { loadBraidLog, loadProject, loadWorld, orgTagsOf, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { addDays, dateInZone, daysBetween, weekday, WEEKDAYS, type IsoDate } from "../domain/dates";
import { isOnLog, isSwitchable, switchedTo, type BraidEntryRecord, type BraidEntryState, type BraidLinkRelation, type ResolveOutcome } from "../domain/machines/braid-entry";
import { isCandidate, type World } from "../domain/machines/membership";
import { displayedStatus, type OverrideState } from "../domain/machines/set-status";
import { BRAID_KINDS, maySwitch, type BraidKind, type ProjectRole } from "../domain/rights";
import { maySeeQuote, projectSpans, type SavedItem } from "../domain/routing";
import type { SourceSpan } from "../domain/shared";
import { calculatePlan, milestoneStatus, workItemStatus, type MilestoneState, type WorkItemState } from "../domain/status/rules";
import type { SettableStatus, Status } from "../domain/status/status";

// ---- Shared by every query ----

/** What a viewer gets for something that does not exist or is not theirs. The two are never told apart. */
export type NotYours = { found: false; reason: string };
export const NOT_YOURS: NotYours = { found: false, reason: "Not found, or not yours to see" };

export type PersonRef = { id: string; name: string };

export const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  done: "Done",
};

/** A thing with no target has no status (A4.1); a project with none says so instead. */
export function statusLabel(status: Status | null): string {
  return status ? STATUS_LABEL[status] : "No target yet";
}

export const KIND_LABEL: Record<BraidKind, string> = {
  blocker: "Blocker",
  risk: "Risk",
  assumption: "Assumption",
  issue: "Issue",
  dependency: "Dependency",
  decision: "Decision",
};

// Lifecycle states are words, never statuses (A4.1): they get no tone and no dot
export const ENTRY_STATE_LABEL: Record<BraidEntryState, string> = {
  none: "Draft",
  reported: "Reported",
  resolved: "Resolved",
  proposed: "Waiting for approval",
  more_info: "More information asked",
  declined: "Declined",
  open: "Open",
  mitigating: "Mitigating",
  closed: "Closed",
  realised: "Realised",
  holding: "Holding",
  confirmed: "Confirmed",
  broken: "Broken",
  waiting: "Waiting",
  met: "Met",
  late: "Late",
  approved: "Approved",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
  merged: "Merged",
  switched: "Changed",
};

export const WORK_STATE_LABEL: Record<WorkItemState, string> = {
  to_do: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const MILESTONE_STATE_LABEL: Record<MilestoneState, string> = {
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  missed: "Missed",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "23 Oct" */
export function shortDate(date: IsoDate): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function todayIn(now: Date): IsoDate {
  return dateInZone(now, config.timeZone);
}

/** "9:10am" in the org time zone. */
export function clockTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}

/** Calendar days ago, in words: "today", "yesterday", "6 days ago". */
export function daysAgo(at: Date, now: Date): string {
  const days = daysBetween(todayIn(at), todayIn(now));
  if (days <= 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function firstName(name: string): string {
  return name.split(" ")[0];
}

export async function peopleById(conn: Conn, ids: Iterable<string | null | undefined>): Promise<Map<string, PersonRef>> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();
  const rows = await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(inArray(t.people.id, wanted));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Who can read a project: a current member, of a group connected to DPM, in an org the viewer is linked to (M13). */
export type ProjectReader = { world: World; orgTags: string[]; mayRead: (projectId: string) => boolean };

export async function projectReader(conn: Conn, viewerId: string): Promise<ProjectReader> {
  const [world, orgTags] = await Promise.all([loadWorld(conn), orgTagsOf(conn, viewerId)]);
  return { world, orgTags, mayRead: (projectId) => isCandidate(viewerId, orgTags, projectId, world) };
}

/**
 * For each source that came from a capture, the quote the viewer may read on this project, or null.
 * The item behind the source must be saved into this project (rule 9) and its span must be one of
 * the spans routed here (projectSpans), so a source pointing at another project's words shows nothing.
 */
export async function visibleQuotes(
  conn: Conn,
  viewerId: string,
  projectId: string,
  world: World,
  sources: readonly { id: string; captureId: string | null; extractionId: string | null; span: SourceSpan | null }[],
): Promise<Map<string, string>> {
  const quoted = sources.filter((s) => s.captureId && s.extractionId && s.span);
  const out = new Map<string, string>();
  if (!quoted.length) return out;
  const project = world.projects.find((p) => p.id === projectId);
  if (!project) return out;
  const captureIds = [...new Set(quoted.map((s) => s.captureId!))];
  const [captures, extractions] = await Promise.all([
    conn.select({ id: t.captures.id, authorId: t.captures.authorId, text: t.captures.text }).from(t.captures).where(inArray(t.captures.id, captureIds)),
    conn.select().from(t.extractions).where(inArray(t.extractions.captureId, captureIds)),
  ]);
  const saved = new Map<string, SavedItem & { captureId: string }>();
  for (const x of extractions) {
    const capture = captures.find((c) => c.id === x.captureId)!;
    // Filed only once Save applied it, into a project, as routed
    const filedInto = x.state === "applied" && x.scope === "project" && x.routing === "routed" ? x.projectId : null;
    saved.set(x.id, { ordinal: x.ordinal, authorId: capture.authorId, filedInto, spans: x.draft.spans, captureId: x.captureId });
  }
  const reader = { personId: viewerId, orgTag: project.orgTag };
  for (const s of quoted) {
    const item = saved.get(s.extractionId!);
    if (!item || item.captureId !== s.captureId || !maySeeQuote(reader, item, world)) continue;
    const allowed = projectSpans(projectId, [...saved.values()].filter((i) => i.captureId === s.captureId));
    if (!allowed.some((a) => a.start === s.span!.start && a.end === s.span!.end)) continue;
    const text = captures.find((c) => c.id === s.captureId)!.text;
    out.set(s.id, text.slice(s.span!.start, s.span!.end));
  }
  return out;
}

// ---- getProject ----

export type ProjectMilestone = {
  id: string;
  name: string;
  owner: PersonRef | null;
  state: MilestoneState;
  stateLabel: string;
  status: Status;
  statusLabel: string;
  targetDate: IsoDate;
  forecastDate: IsoDate;
  clientVisible: boolean;
};

export type ProjectWorkItem = {
  id: string;
  number: string | null;
  title: string;
  owner: PersonRef | null;
  state: WorkItemState;
  stateLabel: string;
  /** Null when it has no due date: no target, no status (E50). */
  status: Status | null;
  statusLabel: string;
  startDate: IsoDate | null;
  dueDate: IsoDate | null;
  /** The owner's forecast (section 20, U6); the due date stays the plan. What "why" reads (phase C). */
  forecastDate: IsoDate | null;
  blockedNote: string | null;
  /** The entries on this project's BRAID log it waits on (U1); what holds it up (phase C) reads them here. */
  blockedLinks: readonly string[];
  milestoneId: string | null;
};

export type ProjectThread = {
  id: string;
  name: string;
  description: string | null;
  status: Status | null;
  statusLabel: string;
  milestones: ProjectMilestone[];
  workItems: ProjectWorkItem[];
};

export type EntrySource = {
  id: string;
  person: PersonRef;
  at: Date;
  /** "today", "yesterday", "6 days ago" */
  ago: string;
  fromCapture: boolean;
  /** The words behind it, only when they were routed to this project (rule 9). */
  quote: string | null;
};

export type ProjectBraidEntry = {
  id: string;
  kind: BraidKind;
  kindLabel: string;
  title: string;
  state: BraidEntryState;
  /** A lifecycle state, not a status (A4.1). */
  stateLabel: string;
  onLog: boolean;
  waitingForApproval: boolean;
  reportCount: number;
  owner: PersonRef | null;
  reportedBy: PersonRef | null;
  decidedBy: PersonRef | null;
  decidedOn: IsoDate | null;
  selfApproved: boolean;
  resolvedBy: PersonRef | null;
  resolvedOn: IsoDate | null;
  sources: EntrySource[];
  links: { relation: BraidLinkRelation; entryId: string; title: string; kind: BraidKind; stateLabel: string }[];
  /** The version the viewer saw, so a switch on a newer one is refused (BK6). */
  version: number;
  /**
   * Section 13, for this viewer: a PM or Lead switches; a member asks, or sees that someone asked;
   * a finished entry or an approved decision keeps its kind.
   */
  kindControl: "switch" | "ask" | "asked" | "fixed";
  /** Why the kind stays, where someone might try: an approved decision is replaced, never switched. */
  fixedNote: string | null;
  /** The kind it was before its latest switch ("Was a risk"). */
  was: BraidKind | null;
  /** Section 20, U2: when what a dependency waits on was promised. */
  expectedOn: IsoDate | null;
  /** Section 20, U3: how members said it ended, oldest first, waiting for a PM or Lead. */
  outcomesProposed: ResolveOutcome[];
  switchNote: KindSwitchNote | null;
  /** A member's request to change the kind, while it waits (M17). */
  request: KindRequestView | null;
  /** The latest thing that happened to it: a report, a decision, a resolution or a switch. */
  updatedOn: IsoDate;
};

export type KindSwitchNote = { by: PersonRef | null; on: IsoDate; from: BraidKind; to: BraidKind; why: string; askedBy: PersonRef | null };
export type KindRequestView = { id: string; version: number; askedBy: PersonRef | null; toKind: BraidKind; why: string; mine: boolean };

/** One kind on the Dashboard's BRAID summary (L14d). */
export type BraidSummaryTile = {
  kind: BraidKind;
  label: string;
  /** Live on the log. */
  live: number;
  /** The one that needs someone first: an open request, then a proposal, else the latest change. */
  entry: { id: string; title: string; stateLabel: string; waiting: boolean } | null;
  note: string;
};

export type ProjectView = {
  found: true;
  project: { id: string; name: string; customer: string | null; owner: PersonRef | null; startDate: IsoDate | null; endDate: IsoDate | null };
  viewerRole: ProjectRole;
  /** From the rules only (P6), worked out at read time. */
  calculated: { status: Status | null; label: string };
  /** What the project shows: the set status once a reason is given, otherwise the plan (A4.3). */
  displayed: { status: Status | null; label: string; from: "set" | "calculated" };
  setStatus: {
    status: SettableStatus;
    label: string;
    override: OverrideState;
    setBy: PersonRef | null;
    setAt: Date | null;
    waitingForReason: boolean;
    /** Agrees with nothing the plan says now. */
    differsFromPlan: boolean;
  } | null;
  reason: {
    id: string;
    text: string;
    draftedByAtlas: boolean;
    edited: boolean;
    savedBy: PersonRef | null;
    savedAt: Date;
    /** The plan moved since the reason was given (S1). */
    stale: boolean;
    /** "given when the plan said At risk", when stale. */
    staleNote: string | null;
    links: { entryId: string; title: string; kind: BraidKind; stateLabel: string; onLog: boolean }[];
  } | null;
  threads: ProjectThread[];
  /** Milestones and work items in no thread; they count at project level. */
  unthreaded: { milestones: ProjectMilestone[]; workItems: ProjectWorkItem[] };
  braid: {
    entries: ProjectBraidEntry[];
    counts: Record<BraidKind, number>;
    waitingForApproval: number;
    kindChangesAsked: number;
    /** Entries whose kind changed since Monday. */
    switchedThisWeek: number;
    summary: BraidSummaryTile[];
  };
};

export const KIND_PLURAL: Record<BraidKind, string> = { blocker: "Blockers", risk: "Risks", assumption: "Assumptions", issue: "Issues", dependency: "Dependencies", decision: "Decisions" };
/** L14d reads in pairs: blockers and risks, issues and assumptions, dependencies and decisions. */
const SUMMARY_ORDER: readonly BraidKind[] = ["blocker", "risk", "issue", "assumption", "dependency", "decision"];
const article = (kind: BraidKind) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

// Hidden from the log: never reported, merged into another entry, or taken back by the reporter
// Section 13: an entry whose kind changed lives on as the entry it became, so only that one is shown
const OFF_THE_LOG_VIEW: readonly BraidEntryState[] = ["none", "merged", "withdrawn", "switched"];

export async function getProject(conn: Conn, viewerId: string, projectId: string, now: Date): Promise<ProjectView | NotYours> {
  const reader = await projectReader(conn, viewerId);
  if (!reader.mayRead(projectId)) return NOT_YOURS;
  const project = await loadProject(conn, projectId);
  if (!project) return NOT_YOURS;
  const today = todayIn(now);

  const [threads, milestones, workItems, { log, versions }, sourceRows, reasons] = await Promise.all([
    conn.select().from(t.threads).where(eq(t.threads.projectId, projectId)).orderBy(t.threads.position),
    conn.select().from(t.milestones).where(eq(t.milestones.projectId, projectId)).orderBy(t.milestones.targetDate),
    conn.select().from(t.workItems).where(eq(t.workItems.projectId, projectId)).orderBy(t.workItems.number),
    loadBraidLog(conn, projectId),
    conn
      .select({ id: t.braidSources.id, extractionId: t.braidSources.extractionId })
      .from(t.braidSources)
      .innerJoin(t.braidEntries, eq(t.braidEntries.id, t.braidSources.entryId))
      .where(eq(t.braidEntries.projectId, projectId)),
    conn.select().from(t.statusReasons).where(eq(t.statusReasons.projectId, projectId)).orderBy(desc(t.statusReasons.savedAt)).limit(1),
  ]);
  const rows = { threads, milestones, workItems };
  const plan = calculatePlan(rows, today);
  const record = setStatusRecordOf(project);
  const displayed = displayedStatus(record, plan.project);

  const requestRows = await conn.select().from(t.braidKindRequests).where(eq(t.braidKindRequests.projectId, projectId));
  const entries = Object.values(log).filter((e) => !OFF_THE_LOG_VIEW.includes(e.state) && !switchedTo(e));
  // The entry each one came from by its latest switch (a new entry's origin, or the entry switched back from)
  const predecessor = (e: BraidEntryRecord) =>
    Object.values(log)
      .filter((p) => switchedTo(p) === e.id && p.switchedOn)
      .sort((a, b) => b.switchedOn!.localeCompare(a.switchedOn!))[0];
  const extractionOf = new Map(sourceRows.map((s) => [s.id, s.extractionId]));
  const allSources = entries.flatMap((e) => e.sources);
  const quotes = await visibleQuotes(
    conn,
    viewerId,
    projectId,
    reader.world,
    allSources.map((s) => ({ id: s.id, captureId: s.captureId, extractionId: extractionOf.get(s.id) ?? null, span: s.span })),
  );

  const reason = record.override === "explained" || record.override === "reason_stale" ? (reasons[0] ?? null) : null;
  const reasonLinks = reason
    ? await conn.select().from(t.statusReasonLinks).where(eq(t.statusReasonLinks.reasonId, reason.id))
    : [];

  const people = await peopleById(conn, [
    project.ownerId,
    project.setBy,
    reason?.savedBy,
    ...milestones.map((m) => m.ownerId),
    ...workItems.map((w) => w.ownerId),
    ...entries.flatMap((e) => [e.ownerId, e.reportedBy, e.decidedBy, e.resolvedBy, ...e.sources.map((s) => s.personId)]),
    ...Object.values(log).map((e) => e.switchedBy),
    ...requestRows.map((r) => r.askedBy),
  ]);
  const person = (id: string | null) => (id ? (people.get(id) ?? null) : null);

  const milestone = (m: (typeof milestones)[number]): ProjectMilestone => {
    const status = milestoneStatus(m);
    return {
      id: m.id,
      name: m.name,
      owner: person(m.ownerId),
      state: m.state,
      stateLabel: MILESTONE_STATE_LABEL[m.state],
      status,
      statusLabel: STATUS_LABEL[status],
      targetDate: m.targetDate,
      forecastDate: m.forecastDate ?? m.targetDate,
      clientVisible: m.clientVisible,
    };
  };
  const workItem = (w: (typeof workItems)[number]): ProjectWorkItem => {
    const status = workItemStatus(w, today);
    return {
      id: w.id,
      number: w.number,
      title: w.title,
      owner: person(w.ownerId),
      state: w.state,
      stateLabel: WORK_STATE_LABEL[w.state],
      status,
      statusLabel: status ? STATUS_LABEL[status] : "No due date",
      startDate: w.startDate,
      dueDate: w.dueDate,
      forecastDate: w.forecastDate,
      blockedNote: w.blockedNote,
      blockedLinks: w.blockedLinks,
      milestoneId: w.milestoneId,
    };
  };

  const viewerRole_ = reader.world.memberships.find((m) => m.projectId === projectId && m.personId === viewerId && m.state === "member")?.role ?? null;
  const kindView = (e: BraidEntryRecord) => {
    const p = predecessor(e);
    const open = requestRows.find((r) => r.entryId === e.id && r.state === "asked");
    const switchable = isSwitchable(e);
    const kindControl: ProjectBraidEntry["kindControl"] = !switchable ? "fixed" : viewerRole_ && maySwitch(viewerRole_) ? "switch" : open ? "asked" : "ask";
    const asked = p ? requestRows.find((r) => r.entryId === p.id && r.state === "switched") : undefined;
    const dates = [e.decidedOn, e.resolvedOn, p?.switchedOn ?? null, ...e.sources.map((s) => dateInZone(new Date(s.at), config.timeZone))].filter((d): d is IsoDate => !!d);
    return {
      version: versions.get(e.id) ?? 0,
      kindControl,
      fixedNote: e.state === "approved" ? "To change it, add a new decision that replaces this one" : null,
      was: p?.kind ?? null,
      switchNote: p
        ? { by: person(p.switchedBy), on: p.switchedOn!, from: p.kind, to: e.kind, why: p.switchReason ?? "", askedBy: asked ? person(asked.askedBy) : null }
        : null,
      request: open ? { id: open.id, version: open.version, askedBy: person(open.askedBy), toKind: open.toKind, why: open.why, mine: open.askedBy === viewerId } : null,
      updatedOn: dates.sort().at(-1) ?? today,
    };
  };

  const byKind = (a: ProjectBraidEntry, b: ProjectBraidEntry) =>
    BRAID_KINDS.indexOf(a.kind) - BRAID_KINDS.indexOf(b.kind) || Number(b.waitingForApproval) - Number(a.waitingForApproval) || Number(b.onLog) - Number(a.onLog) || a.title.localeCompare(b.title);
  const braidEntries: ProjectBraidEntry[] = entries
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      kindLabel: KIND_LABEL[e.kind],
      title: e.title,
      state: e.state,
      stateLabel: ENTRY_STATE_LABEL[e.state],
      onLog: isOnLog(e),
      waitingForApproval: e.state === "proposed",
      reportCount: e.sources.length,
      expectedOn: e.expectedOn,
      outcomesProposed: e.outcomesProposed.map((o) => o.outcome),
      owner: person(e.ownerId),
      reportedBy: person(e.reportedBy),
      decidedBy: person(e.decidedBy),
      decidedOn: e.decidedOn,
      selfApproved: e.selfApproved,
      resolvedBy: person(e.resolvedBy),
      resolvedOn: e.resolvedOn,
      sources: [...e.sources]
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((s) => ({
          id: s.id,
          person: person(s.personId) ?? { id: s.personId, name: s.personId },
          at: new Date(s.at),
          ago: daysAgo(new Date(s.at), now),
          fromCapture: s.captureId !== null,
          quote: quotes.get(s.id) ?? null,
        })),
      links: e.links
        .filter((l) => log[l.entryId] && l.relation !== "switched_from" && l.relation !== "switched_to")
        .map((l) => ({ relation: l.relation, entryId: l.entryId, title: log[l.entryId].title, kind: log[l.entryId].kind, stateLabel: ENTRY_STATE_LABEL[log[l.entryId].state] })),
      ...kindView(e),
    }))
    .sort(byKind);

  const monday = addDays(today, -((WEEKDAYS.indexOf(weekday(today)) + 6) % 7));
  const counts = Object.fromEntries(BRAID_KINDS.map((k) => [k, braidEntries.filter((e) => e.kind === k).length])) as Record<BraidKind, number>;
  const viewerRole = reader.world.memberships.find((m) => m.projectId === projectId && m.personId === viewerId && m.state === "member")!.role;

  return {
    found: true,
    project: {
      id: project.id,
      name: project.name,
      customer: project.customer,
      owner: person(project.ownerId),
      startDate: project.startDate,
      endDate: project.endDate,
    },
    viewerRole,
    calculated: { status: plan.project, label: statusLabel(plan.project) },
    displayed: { status: displayed, label: statusLabel(displayed), from: record.override === "explained" || record.override === "reason_stale" ? "set" : "calculated" },
    setStatus: record.setStatus
      ? {
          status: record.setStatus,
          label: STATUS_LABEL[record.setStatus],
          override: record.override,
          setBy: person(project.setBy),
          setAt: project.setAt,
          waitingForReason: record.override === "reason_required",
          differsFromPlan: record.setStatus !== plan.project,
        }
      : null,
    reason: reason
      ? {
          id: reason.id,
          text: reason.text,
          draftedByAtlas: reason.draftedByAtlas,
          edited: reason.edited,
          savedBy: person(reason.savedBy),
          savedAt: reason.savedAt,
          stale: record.override === "reason_stale",
          staleNote: record.override === "reason_stale" ? `given when the plan said ${statusLabel(record.reasonGivenAt)}` : null,
          links: reasonLinks
            .filter((l) => log[l.braidEntryId])
            .map((l) => {
              const e = log[l.braidEntryId];
              return { entryId: e.id, title: e.title, kind: e.kind, stateLabel: ENTRY_STATE_LABEL[e.state], onLog: isOnLog(e) };
            }),
        }
      : null,
    threads: threads.map((th) => ({
      id: th.id,
      name: th.name,
      description: th.description,
      status: plan.threads[th.id] ?? null,
      statusLabel: statusLabel(plan.threads[th.id] ?? null),
      milestones: milestones.filter((m) => m.threadId === th.id).map(milestone),
      workItems: workItems.filter((w) => w.threadId === th.id).map(workItem),
    })),
    unthreaded: {
      milestones: milestones.filter((m) => m.threadId === null).map(milestone),
      workItems: workItems.filter((w) => w.threadId === null).map(workItem),
    },
    braid: {
      entries: braidEntries,
      counts,
      waitingForApproval: braidEntries.filter((e) => e.waitingForApproval).length,
      kindChangesAsked: braidEntries.filter((e) => e.request).length,
      switchedThisWeek: Object.values(log).filter((e) => e.switchedOn && e.switchedOn >= monday).length,
      summary: SUMMARY_ORDER.map((kind) => summaryTile(kind, braidEntries, Object.values(log), monday)),
    },
  };
}

function summaryTile(kind: BraidKind, entries: readonly ProjectBraidEntry[], log: readonly BraidEntryRecord[], monday: IsoDate): BraidSummaryTile {
  const mine = entries.filter((e) => e.kind === kind);
  const live = mine.filter((e) => e.onLog);
  const pick =
    mine.find((e) => e.request) ?? mine.find((e) => e.waitingForApproval) ?? [...live].sort((a, b) => b.updatedOn.localeCompare(a.updatedOn) || a.title.localeCompare(b.title))[0];
  const leftThisWeek = log.filter((e) => e.kind === kind && e.switchedOn && e.switchedOn >= monday && e.state !== "switched");
  const became = new Set(leftThisWeek.map((e) => log.find((x) => x.id === switchedTo(e))?.kind).filter(Boolean));
  const left = leftThisWeek.length ? (became.size === 1 ? `${leftThisWeek.length} became ${article([...became][0]!)} this week` : `${leftThisWeek.length} changed kind this week`) : null;
  let note: string;
  // An empty tile still says where its entries went
  if (!pick) note = left ?? "None on the log";
  else if (pick.request) note = `${pick.request.askedBy?.name.split(" ")[0] ?? "Someone"} asked to make it ${article(pick.request.toKind)}`;
  else if (pick.waitingForApproval) note = "Waiting for a PM or Lead";
  else if (left) note = left;
  else if (pick.was) note = `Was ${article(pick.was)} · switched ${shortDate(pick.switchNote!.on)}`;
  else note = live.length > 1 ? `${live.length - 1} more on the log` : `Since ${shortDate(pick.updatedOn)}`;
  return {
    kind,
    label: KIND_PLURAL[kind],
    live: live.length,
    entry: pick ? { id: pick.id, title: pick.title, stateLabel: pick.waitingForApproval ? "Waiting for PM or Lead" : pick.request ? "Kind change asked" : pick.stateLabel, waiting: pick.waitingForApproval || !!pick.request } : null,
    note,
  };
}

/** The project ids a viewer may read, for queries that list across projects. */
export async function readableProjects(conn: Conn, viewerId: string): Promise<string[]> {
  const reader = await projectReader(conn, viewerId);
  return reader.world.projects.filter((p) => reader.mayRead(p.id)).map((p) => p.id);
}

/** The project a BRAID entry belongs to, when the viewer may read it. */
export async function readableEntryProject(conn: Conn, viewerId: string, entryId: string): Promise<string | null> {
  const [entry] = await conn.select({ projectId: t.braidEntries.projectId }).from(t.braidEntries).where(eq(t.braidEntries.id, entryId));
  if (!entry) return null;
  const reader = await projectReader(conn, viewerId);
  return reader.mayRead(entry.projectId) ? entry.projectId : null;
}
