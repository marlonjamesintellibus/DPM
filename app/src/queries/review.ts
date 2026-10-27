// Review my update (L16b): one capture and every item Atlas found in it, grouped by project.
// The whole capture belongs to its author (M1), so only the author reads this; anyone else gets
// the same answer as for a capture that does not exist.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Conn } from "../db/conn";
import { itemOf } from "../db/records";
import { weekday } from "../domain/dates";
import * as t from "../db/schema";
import { saveBlockers } from "../domain/machines/capture";
import type { ResolveOutcome } from "../domain/machines/braid-entry";
import { displayMark, type ExtractedItem, type ItemState, type WithdrawReason } from "../domain/machines/extracted-item";
import { landsAs, type BraidKind, type ProjectRole } from "../domain/rights";
import { mayReadCapture } from "../domain/routing";
import { setAside, type SetAside, type StoredDrop } from "../domain/set-aside";
import type { Confidence, ItemKind, MatchState, RoutingState, SourceSpan } from "../domain/shared";
import type { WorkItemState } from "../domain/status/rules";
import { firstName, KIND_LABEL, NOT_YOURS, projectReader, shortDate, WORK_STATE_LABEL, type NotYours, type PersonRef } from "./project";

export type ReviewMark = ReturnType<typeof displayMark>;

// B5: the design's words for each mark; "Ready" stands for pre-accepted until Save
export const MARK_LABEL: Record<ReviewMark, string> = {
  no_change: "No change",
  matches_leave: "Matches approved leave",
  ready: "Ready",
  needs_ok: "Needs your OK",
  accepted: "Accepted",
  edited: "Edited by you",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  conflict: "Changed since",
  applied: "Saved",
};

export type ReviewItem = {
  id: string;
  ordinal: number;
  kind: ItemKind;
  /** "Update", or "BRAID · Risk". Kinds are neutral labels, never coloured (A4.1). */
  kindLabel: string;
  braidKind: BraidKind | null;
  /** "Issue #145 Google Trends connector", "Milestone Trend model", or the BRAID entry title. */
  title: string;
  /** "In progress to Done", "Forecast 23 Oct to 24 Oct", "Add Kemar as a source (2 reports)" */
  change: string;
  /** BRAID items: "New" or "Same as: Store sales feed access". */
  match: { state: MatchState; entryId: string | null; label: string } | null;
  state: ItemState;
  confidence: Confidence;
  mark: ReviewMark;
  markLabel: string;
  routing: { state: RoutingState; projectId: string | null; reason: string; options: { id: string; name: string }[] };
  spans: SourceSpan[];
  quotes: string[];
  rationale: string;
  conflict: { current: string | null; reason: string | null; refused?: boolean } | null;
  /** Why a withdrawn card was withdrawn: "This issue was cancelled" (E26, D2). */
  withdrawnNote: string | null;
  /** D13: only new BRAID entries and items with no target may move to another project. */
  canMove: boolean;
  /** How "Change" edits it, and the value it would save now. Null when there is nothing to edit. */
  edit: { input: "choice" | "date" | "text"; value: string; options: { value: string; label: string }[] } | null;
  /** D18: for a BRAID report, the project's other open entries of the same kind ("Pick an entry"). */
  matchOptions: { id: string; title: string; stateLabel: string }[];
};

export type ReviewGroup =
  | { type: "project"; projectId: string; name: string; pm: PersonRef | null; label: string; items: ReviewItem[] }
  | { type: "choose"; label: "Choose a project"; items: ReviewItem[] }
  | { type: "you"; label: "You"; items: ReviewItem[] }
  | { type: "not_filed"; label: "Not filed"; items: ReviewItem[] };

export type ReviewCounts = {
  /** Items that would change something if saved now. */
  changes: number;
  projects: number;
  needsOk: number;
  needsProject: number;
  /** Ordinals of the items that hold Save. */
  needsOkOrdinals: number[];
};

export type Review = {
  found: true;
  capture: {
    id: string;
    text: string;
    channel: "atlas" | "app";
    kind: "text" | "voice";
    durationSeconds: number | null;
    messageAt: Date;
    receivedAt: Date;
    state: string;
  };
  author: PersonRef;
  /** The author's projects, for Move and for picking a project (M14). */
  projects: { id: string; name: string }[];
  groups: ReviewGroup[];
  items: ReviewItem[];
  /** For "hover a highlight, see its cards": each quoted range and the items it feeds. */
  highlights: { start: number; end: number; text: string; ordinals: number[] }[];
  counts: ReviewCounts;
  /** "9 updates for 2 projects. 4 need your OK." */
  footer: string;
  /** "Got it. 9 updates for 2 projects; 4 need your OK." */
  chatLine: string;
  /** Section 20, U1: what the checks refused and what fed nothing. The author only, like the capture. */
  setAside: SetAside;
  canSave: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Settled with nothing to write: these do not count as changes
const NOTHING_TO_SAVE: readonly ItemState[] = ["no_change", "rejected", "withdrawn"];

/** Footer and chat counts for a capture's items, shared with the chat summary (L18f). */
export function countItems(items: readonly ExtractedItem[]): ReviewCounts & { perProject: Map<string, { changes: number; needsOk: number }>; personal: number; notFiled: number } {
  const changes = items.filter((i) => !NOTHING_TO_SAVE.includes(i.state));
  const blockers = saveBlockers(items);
  const undecided = new Set(items.filter((i) => i.state === "proposed" || i.state === "needs_ok" || i.state === "conflict").map((i) => i.id));
  const perProject = new Map<string, { changes: number; needsOk: number }>();
  for (const i of changes) {
    if (i.draft.scope !== "project" || i.draft.routing !== "routed" || !i.draft.projectId) continue;
    const row = perProject.get(i.draft.projectId) ?? { changes: 0, needsOk: 0 };
    row.changes += 1;
    if (undecided.has(i.id)) row.needsOk += 1;
    perProject.set(i.draft.projectId, row);
  }
  return {
    changes: changes.length,
    projects: perProject.size,
    needsOk: blockers.needsOk,
    needsProject: blockers.needsProject,
    needsOkOrdinals: items.filter((i) => undecided.has(i.id)).map((i) => i.draft.ordinal),
    perProject,
    personal: changes.filter((i) => i.draft.scope === "personal").length,
    notFiled: changes.filter((i) => i.draft.scope === "project" && i.draft.routing === "not_filed").length,
  };
}

/** "1 update for 1 project; 1 part not used." */
export function withSetAside(line: string, s: SetAside): string {
  const tail = setAsideLine(s);
  return tail ? `${line.replace(/\.$/, "")}; ${tail}.` : line;
}

export function countsLine(c: ReviewCounts, separator: "; " | ". "): string {
  const head = `${plural(c.changes, "update", "updates")} for ${plural(c.projects, "project", "projects")}`;
  const waits = [c.needsOk ? `${plural(c.needsOk, "needs", "need")} your OK` : null, c.needsProject ? `${plural(c.needsProject, "needs", "need")} a project` : null].filter(Boolean);
  return waits.length ? `${head}${separator}${waits.join("; ")}.` : `${head}.`;
}

/**
 * Section 20, U1: what Atlas set aside, from the item spans and the refusals the read kept in its
 * PROPOSALS_READY audit entry (UD6). A capture read before the audit kept them has none.
 */
export async function readSetAside(
  conn: Conn,
  capture: { id: string; text: string; question: { asked: string } | null },
  items: readonly ExtractedItem[],
): Promise<SetAside> {
  const [read] = await conn
    .select({ detail: t.auditEntries.detail })
    .from(t.auditEntries)
    .where(and(eq(t.auditEntries.captureId, capture.id), eq(t.auditEntries.action, "PROPOSALS_READY")))
    .orderBy(desc(t.auditEntries.id))
    .limit(1);
  const dropped = (read?.detail?.dropped ?? []) as StoredDrop[];
  return setAside({ text: capture.text, used: items.flatMap((i) => i.draft.spans), dropped, asked: capture.question?.asked ?? null });
}

/** "1 part not used", for the chat's summary line; empty when nothing was set aside. */
export function setAsideLine(s: SetAside): string {
  const n = s.refused.length + s.unused.length;
  return n ? `${plural(n, "part", "parts")} not used` : "";
}

/** Section 20, U3: what a PM or Lead's own words do, and how a member's are put to them. */
export const OUTCOME_ACT: Record<ResolveOutcome, string> = { closed: "Close it", realised: "Mark it realised", confirmed: "Mark it confirmed", broken: "Mark it broken", met: "Mark it met", late: "Mark it late" };
export const OUTCOME_SAID: Record<ResolveOutcome, string> = { closed: "it's gone", realised: "it happened", confirmed: "it held", broken: "it broke", met: "it was delivered", late: "it's late" };

const WITHDRAWN_NOTE: Record<WithdrawReason, string | null> = {
  target_cancelled: "This issue was cancelled",
  left_project: "You are no longer in this project",
  discarded: null,
  expired: null,
  replaced: "Replaced by a later message",
};

const WORK_CHOICES = ["to_do", "in_progress", "blocked", "done"] as const;
const STEP_CHOICES = ["not_done", "in_progress", "handed_over"] as const;

function editOf(item: ExtractedItem): ReviewItem["edit"] {
  const d = item.draft;
  if (d.kind === "braid_resolve") return null;
  if (d.braid) return { input: "text", value: item.value ?? d.braid.title, options: [] };
  const target = d.target;
  if (!target) return null;
  const value = item.value ?? target.newValue;
  if (target.type === "work_item" && target.field === "state")
    return { input: "choice", value, options: WORK_CHOICES.map((v) => ({ value: v, label: WORK_STATE_LABEL[v] })) };
  if (target.type === "handover") return { input: "choice", value, options: STEP_CHOICES.map((v) => ({ value: v, label: HANDOVER_STEP_LABEL[v] })) };
  if (target.type === "milestone") return { input: "date", value, options: [] };
  return { input: "text", value, options: [] };
}

const HANDOVER_STEP_LABEL: Record<string, string> = { not_done: "Not done", in_progress: "In progress", handed_over: "Handed over" };

function leaveRange(value: string): string {
  const [start, end] = value.split("/");
  if (!end || end === "..") return `From ${shortDate(start)}`;
  const [s, e] = [shortDate(start), shortDate(end)];
  return s.split(" ")[1] === e.split(" ")[1] ? `${s.split(" ")[0]} to ${e}` : `${s} to ${e}`;
}

export async function getReview(conn: Conn, viewerId: string, captureId: string): Promise<Review | NotYours> {
  const [capture] = await conn.select().from(t.captures).where(eq(t.captures.id, captureId));
  if (!capture || !mayReadCapture({ personId: viewerId }, capture)) return NOT_YOURS;

  const rows = await conn.select().from(t.extractions).where(eq(t.extractions.captureId, captureId)).orderBy(t.extractions.ordinal);
  const items = rows.map(itemOf);
  const drafts = items.map((i) => i.draft);
  const ids = (pick: (d: (typeof drafts)[number]) => string | null | undefined) => [...new Set(drafts.map(pick).filter((x): x is string => !!x))];

  const workIds = ids((d) => (d.target?.type === "work_item" ? d.target.id : null));
  const milestoneIds = ids((d) => (d.target?.type === "milestone" ? d.target.id : null));
  const stepIds = ids((d) => (d.target?.type === "handover" ? d.target.id : null));
  const entryIds = ids((d) => d.braid?.matchEntryId);
  const projectIds = [...new Set([...ids((d) => d.projectId), ...drafts.flatMap((d) => d.options ?? [])])];

  const [author] = await conn.select({ id: t.people.id, name: t.people.name }).from(t.people).where(eq(t.people.id, capture.authorId));
  // D7: whether the author may resolve a blocker they say is cleared (S13), for the card's wording
  const authorsHeld = await conn.select({ blockedLinks: t.workItems.blockedLinks }).from(t.workItems).where(eq(t.workItems.ownerId, capture.authorId));
  const [workItems, milestones, steps, entries, sources, projects, memberships] = await Promise.all([
    workIds.length ? conn.select().from(t.workItems).where(inArray(t.workItems.id, workIds)) : [],
    milestoneIds.length ? conn.select().from(t.milestones).where(inArray(t.milestones.id, milestoneIds)) : [],
    stepIds.length
      ? conn
          .select({ id: t.handoverSteps.id, title: t.handoverSteps.title, toName: t.people.name })
          .from(t.handoverSteps)
          .innerJoin(t.handovers, eq(t.handovers.id, t.handoverSteps.handoverId))
          .innerJoin(t.people, eq(t.people.id, t.handovers.toPersonId))
          .where(inArray(t.handoverSteps.id, stepIds))
      : [],
    entryIds.length ? conn.select().from(t.braidEntries).where(inArray(t.braidEntries.id, entryIds)) : [],
    entryIds.length ? conn.select({ entryId: t.braidSources.entryId, extractionId: t.braidSources.extractionId }).from(t.braidSources).where(inArray(t.braidSources.entryId, entryIds)) : [],
    projectIds.length ? conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).where(inArray(t.projects.id, projectIds)) : [],
    projectIds.length
      ? conn
          .select({ projectId: t.projectMemberships.projectId, personId: t.projectMemberships.personId, role: t.projectMemberships.role, state: t.projectMemberships.state, name: t.people.name })
          .from(t.projectMemberships)
          .innerJoin(t.people, eq(t.people.id, t.projectMemberships.personId))
          .where(inArray(t.projectMemberships.projectId, projectIds))
      : [],
  ]);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  // The author's projects (for Move), and their open BRAID entries (for "Pick an entry", D18)
  const reader = await projectReader(conn, capture.authorId);
  const authorProjects = (await conn.select({ id: t.projects.id, name: t.projects.name }).from(t.projects).orderBy(t.projects.name)).filter((p) => reader.mayRead(p.id));
  const projectEntries = authorProjects.length
    ? (await conn.select().from(t.braidEntries).where(inArray(t.braidEntries.projectId, authorProjects.map((p) => p.id)))).filter(
        (e) => !["none", "merged", "withdrawn"].includes(e.state),
      )
    : [];
  const authorRole = (projectId: string | null): ProjectRole =>
    memberships.find((m) => m.projectId === projectId && m.personId === capture.authorId && m.state === "member")?.role ?? "member";
  const authorFirst = firstName(author?.name ?? capture.authorId);

  const titleOf = (item: ExtractedItem): string => {
    const d = item.draft;
    if (d.braid) {
      if (d.kind === "braid_same" || d.kind === "braid_resolve" || d.braid.match === "same_as") return entries.find((e) => e.id === d.braid!.matchEntryId)?.title ?? d.braid.title;
      return item.value ?? d.braid.title;
    }
    const target = d.target!;
    switch (target.type) {
      case "work_item": {
        const w = workItems.find((x) => x.id === target.id);
        return w ? `Issue ${w.number ?? ""} ${w.title}`.replace("  ", " ") : target.id;
      }
      case "milestone":
        return `Milestone ${milestones.find((x) => x.id === target.id)?.name ?? target.id}`;
      case "handover":
        return `Handover ${steps.find((x) => x.id === target.id)?.title ?? target.id}`;
      case "leave":
        return `Leave ${author?.name ?? capture.authorId}`;
    }
  };

  const changeOf = (item: ExtractedItem): string => {
    const d = item.draft;
    if (d.braid) {
      if (d.kind === "braid_resolve") {
        const entry = entries.find((e) => e.id === d.braid!.matchEntryId);
        const role = authorRole(d.projectId);
        // Section 20, U3: a risk, assumption or dependency ends as said by a PM or Lead; anyone else tells them
        const outcome = d.braid.outcome;
        if (outcome) {
          if (role === "pm" || role === "lead") return OUTCOME_ACT[outcome];
          const pm = memberships.find((m) => m.projectId === d.projectId && m.role === "pm" && m.state === "member" && m.personId !== capture.authorId);
          return `${pm ? `Propose to ${firstName(pm.name)}, the PM` : "Propose to the PM"}: ${OUTCOME_SAID[outcome]}`;
        }
        const owns = entry?.ownerId === capture.authorId || authorsHeld.some((w) => w.blockedLinks.includes(d.braid!.matchEntryId ?? ""));
        return role === "pm" || role === "lead" || owns ? "Resolve it" : "Tell the owner and the PM it is cleared";
      }
      if (d.kind === "braid_same") {
        const already = sources.filter((s) => s.entryId === d.braid!.matchEntryId);
        const n = already.length + (already.some((s) => s.extractionId === item.id) ? 0 : 1);
        return d.braid.kind === "blocker" || d.braid.kind === "issue"
          ? `Add ${authorFirst} as a source (${plural(n, "report", "reports")})`
          : `Add as evidence (${plural(n, "source", "sources")})`;
      }
      const lands = landsAs(d.braid.kind, authorRole(d.projectId));
      // Section 20, U2: a dependency says when it was promised
      const by = d.braid.expectedOn ? `, expected ${weekday(d.braid.expectedOn).slice(0, 3)} ${shortDate(d.braid.expectedOn)}` : "";
      if (lands !== "proposed") return `Add to the log${by}`;
      if (d.braid.kind === "decision") return "Propose to the decider";
      // Section 19: say who decides, not only their role
      const pm = memberships.find((m) => m.projectId === d.projectId && m.role === "pm" && m.state === "member" && m.personId !== capture.authorId);
      return `${pm ? `Propose to ${firstName(pm.name)}, the PM` : "Propose to the PM"}${by}`;
    }
    const target = d.target!;
    const value = item.value ?? target.newValue;
    const nothing = item.state === "no_change";
    switch (target.type) {
      case "work_item": {
        if (target.field === "blocked_note") return `Note: ${value}`;
        const label = (s: string | null) => (s ? (WORK_STATE_LABEL[s as WorkItemState] ?? s) : "None");
        if (nothing) return `Already ${label(value)}`;
        return `${label(target.oldValue)} to ${label(value)}${target.note ? `: ${target.note}` : ""}`;
      }
      case "milestone": {
        const date = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? shortDate(s) : (s ?? "none"));
        return nothing ? `Forecast already ${date(value)}` : `Forecast ${date(target.oldValue)} to ${date(value)}`;
      }
      case "handover": {
        const to = steps.find((x) => x.id === target.id)?.toName;
        const label = (s: string | null) => (s === "handed_over" && to ? `Handed to ${firstName(to)}` : s ? (HANDOVER_STEP_LABEL[s] ?? s) : "Not done");
        return nothing ? `Already ${label(value).toLowerCase()}` : `${label(target.oldValue)} to ${label(value)}`;
      }
      case "leave":
        // D6: a change to live leave shows both, so the author sees what moves
        if (item.draft.leave?.fit === "change" && target.oldValue) return `Change ${leaveRange(target.oldValue)} to ${leaveRange(value)}`;
        return leaveRange(value);
    }
  };

  const reviewItems: ReviewItem[] = items.map((item) => {
    const d = item.draft;
    const mark = displayMark(item);
    const matchEntry = d.braid?.matchEntryId ? entries.find((e) => e.id === d.braid!.matchEntryId) : undefined;
    return {
      id: item.id,
      ordinal: d.ordinal,
      kind: d.kind,
      kindLabel: d.braid ? `BRAID · ${KIND_LABEL[d.braid.kind]}` : "Update",
      braidKind: d.braid?.kind ?? null,
      title: titleOf(item),
      change: changeOf(item),
      match: d.braid
        ? {
            state: d.braid.match,
            entryId: d.braid.matchEntryId,
            label:
              d.kind === "braid_resolve"
                ? `${d.braid.outcome ? "Ends" : "Resolves"}: ${matchEntry?.title ?? d.braid.title}`
                : d.braid.match === "new"
                  ? "New"
                  : `${d.braid.match === "same_as" ? "Same as" : "Related to"}: ${matchEntry?.title ?? d.braid.title}`,
          }
        : null,
      state: item.state,
      confidence: item.confidence,
      mark,
      // D12: the record's own rules refuse it, which is not the same as someone changing it
      markLabel: item.conflict?.refused ? "Can't apply" : mark === "matches_leave" && d.leave?.requested ? "Matches your leave request" : MARK_LABEL[mark],
      routing: {
        state: d.routing,
        projectId: d.projectId,
        reason: d.routingReason,
        options: (d.options ?? []).map((id) => ({ id, name: projectName(id) })),
      },
      spans: d.spans,
      quotes: d.spans.map((s) => capture.text.slice(s.start, s.end)),
      rationale: d.rationale,
      conflict: item.conflict,
      withdrawnNote: item.state === "withdrawn" && item.withdrawn ? WITHDRAWN_NOTE[item.withdrawn] : null,
      edit: editOf(item),
      matchOptions:
        d.braid && d.kind !== "braid_resolve" && d.projectId
          ? projectEntries
              .filter((e) => e.projectId === d.projectId && e.kind === d.braid!.kind && e.id !== d.braid!.matchEntryId)
              .map((e) => ({ id: e.id, title: e.title, stateLabel: e.state.replace("_", " ") }))
          : [],
      // A same-as report or a resolution belongs to its entry's log, like an update to its record
      canMove: d.scope === "project" && (d.kind === "braid_new" || (d.kind === "update" && !d.target)),
    };
  });

  // Projects in the order the note first mentions them, then the author's own, then the rest
  const groups: ReviewGroup[] = [];
  for (const item of reviewItems) {
    const d = items.find((i) => i.id === item.id)!.draft;
    if (d.scope !== "project" || d.routing !== "routed" || !d.projectId) continue;
    let group = groups.find((g): g is Extract<ReviewGroup, { type: "project" }> => g.type === "project" && g.projectId === d.projectId);
    if (!group) {
      const pm =
        memberships.find((m) => m.projectId === d.projectId && m.role === "pm" && m.state === "member") ??
        memberships.find((m) => m.projectId === d.projectId && m.role === "lead" && m.state === "member");
      group = { type: "project", projectId: d.projectId, name: projectName(d.projectId), pm: pm ? { id: pm.personId, name: pm.name } : null, label: projectName(d.projectId), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  const rest = (pick: (d: ExtractedItem["draft"]) => boolean) => reviewItems.filter((r) => pick(items.find((i) => i.id === r.id)!.draft));
  const choose = rest((d) => d.scope === "project" && d.routing === "choose_project");
  const you = rest((d) => d.scope === "personal");
  const notFiled = rest((d) => d.scope === "project" && (d.routing === "not_filed" || (d.routing === "routed" && !d.projectId)));
  if (choose.length) groups.push({ type: "choose", label: "Choose a project", items: choose });
  if (you.length) groups.push({ type: "you", label: "You", items: you });
  if (notFiled.length) groups.push({ type: "not_filed", label: "Not filed", items: notFiled });

  const highlightMap = new Map<string, { start: number; end: number; text: string; ordinals: number[] }>();
  for (const r of reviewItems) {
    for (const s of r.spans) {
      const key = `${s.start}:${s.end}`;
      const h = highlightMap.get(key) ?? { start: s.start, end: s.end, text: capture.text.slice(s.start, s.end), ordinals: [] };
      h.ordinals.push(r.ordinal);
      highlightMap.set(key, h);
    }
  }

  const { perProject: _perProject, personal: _personal, notFiled: _notFiled, ...counts } = countItems(items);
  const aside = await readSetAside(conn, capture, items);
  return {
    found: true,
    capture: {
      id: capture.id,
      text: capture.text,
      channel: capture.channel,
      kind: capture.kind,
      durationSeconds: capture.durationSeconds,
      messageAt: capture.messageAt,
      receivedAt: capture.receivedAt,
      state: capture.state,
    },
    author: author ?? { id: capture.authorId, name: capture.authorId },
    projects: authorProjects,
    groups,
    items: reviewItems,
    highlights: [...highlightMap.values()].sort((a, b) => a.start - b.start || a.end - b.end),
    counts,
    footer: countsLine(counts, ". "),
    chatLine: `Got it. ${withSetAside(countsLine(counts, "; "), aside)}`,
    setAside: aside,
    canSave: (capture.state === "proposed" || capture.state === "reviewing") && counts.needsOk === 0 && counts.needsProject === 0,
  };
}
