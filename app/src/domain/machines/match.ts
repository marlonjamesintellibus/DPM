// M16. Match (Ask, per BRAID item). Port of research/state-machines/js/models/match.mjs (model checked 26 Oct).
// Atlas suggests which entry a reported BRAID item is the same as; the suggestion is untrusted and
// the speaker confirms it on review (S15). Saving attaches a source only to the entry the speaker saw,
// in the state they saw it; anything else comes back to them as a conflict (E83), never a silent attach.
// After save a PM merges duplicates and unmerges them in reverse order, moving sources, never copying.
import { defineMachine, transition, type Outcome } from "../machine";
import type { BraidKind } from "../rights";
import type { MatchState } from "../shared";
import {
  applyBraidEvent,
  draftEntry,
  refused,
  type BraidCtx,
  type BraidEntryRecord,
  type BraidEntryState,
  type BraidLinkRelation,
  type BraidLog,
  type BraidSource,
} from "./braid-entry";
import { liveEntryOf } from "./kind-switch";

export const MATCH_STATES = ["new", "same_as", "related_to"] as const satisfies readonly MatchState[];

const GONE: readonly BraidEntryState[] = ["none", "merged", "withdrawn"];

type Item = { projectId: string; kind: BraidKind };

/** Entries a report may be the same as: same project, same kind, not merged or withdrawn. Resolved (S14) and declined (E85) count. */
export function matchCandidates(log: BraidLog, item: Item): BraidEntryRecord[] {
  return Object.values(log).filter((e) => e.projectId === item.projectId && e.kind === item.kind && !GONE.includes(e.state));
}

/** Entries of another kind a report may be linked to (for example a blocker about an open dependency). Never merged. */
export function relatedCandidates(log: BraidLog, item: Item): BraidEntryRecord[] {
  return Object.values(log).filter((e) => e.projectId === item.projectId && e.kind !== item.kind && !GONE.includes(e.state));
}

/** Decisions a proposed decision may conflict with: approved or still pending, in the same project (E87, E88). */
export function conflictCandidates(log: BraidLog, item: Item): BraidEntryRecord[] {
  if (item.kind !== "decision") return [];
  return Object.values(log).filter(
    (e) => e.projectId === item.projectId && e.kind === "decision" && ["proposed", "more_info", "approved"].includes(e.state),
  );
}

export type MatchRecord = {
  /** The extracted item (M3) this match belongs to. */
  itemId: string;
  projectId: string;
  kind: BraidKind;
  speakerId: string;
  state: MatchState;
  /** The entry for same_as or related_to. */
  entryId: string | null;
  /** The speaker confirmed what is shown. Atlas's suggestion alone never attaches anything. */
  confirmed: boolean;
  /** The entry's state as the speaker saw it when they confirmed; a change since is a conflict. */
  seen: BraidEntryState | null;
  /** Decisions Atlas says this one may conflict with; linked at save, never decided by Atlas. */
  conflictsWith: string[];
  /** The entry it was saved as or into; a saved match changes no more. */
  savedTo: string | null;
};

/**
 * Builds the match Atlas suggests, keeping only what the server can verify: a same_as entry must be a
 * candidate and a related_to entry a related candidate, otherwise the item is new. Kinds never merge.
 */
export function suggestMatch(
  item: { itemId: string; projectId: string; kind: BraidKind; speakerId: string },
  suggestion: { state: MatchState; entryId: string | null; conflictsWith?: readonly string[] },
  log: BraidLog,
): MatchRecord {
  const pool = suggestion.state === "same_as" ? matchCandidates(log, item) : suggestion.state === "related_to" ? relatedCandidates(log, item) : [];
  const kept = pool.some((e) => e.id === suggestion.entryId);
  const conflicts = conflictCandidates(log, item).map((e) => e.id);
  return {
    ...item,
    state: kept ? suggestion.state : "new",
    entryId: kept ? suggestion.entryId : null,
    confirmed: false,
    seen: null,
    conflictsWith: (suggestion.conflictsWith ?? []).filter((id) => conflicts.includes(id)),
    savedTo: null,
  };
}

export type MatchEvent =
  /** "Yes, this is right." shown: the entry's state on the card the speaker confirmed. */
  | { type: "CONFIRM"; shown: BraidEntryState | null }
  /** "No, it's this one." */
  | { type: "PICK"; entryId: string; shown: BraidEntryState }
  /** "This is different": a new entry (E86). */
  | { type: "DIFFERENT" };

type Ctx = { match: MatchRecord; log: BraidLog; actorId: string };

function speakerGuard({ match, actorId }: Ctx): string | null {
  if (actorId !== match.speakerId) return "only the speaker confirms a match";
  return match.savedTo ? "already saved" : null;
}

function isCandidate(c: Ctx, entryId: string | null, pool: typeof matchCandidates): string | null {
  return pool(c.log, c.match).some((e) => e.id === entryId) ? null : "that entry cannot take this report (other project or kind, merged or withdrawn)";
}

export const matchMachine = defineMachine<MatchState, MatchEvent, Ctx>({
  name: "match",
  states: MATCH_STATES,
  arrows: [
    { from: ["new"], on: "CONFIRM", to: "new", guard: speakerGuard },
    { from: ["same_as"], on: "CONFIRM", to: "same_as", guard: (c) => speakerGuard(c) ?? isCandidate(c, c.match.entryId, matchCandidates) },
    { from: ["related_to"], on: "CONFIRM", to: "related_to", guard: (c) => speakerGuard(c) ?? isCandidate(c, c.match.entryId, relatedCandidates) },
    { from: MATCH_STATES, on: "PICK", to: "same_as", guard: (c, e) => speakerGuard(c) ?? isCandidate(c, e.entryId, matchCandidates) },
    { from: ["same_as", "related_to"], on: "DIFFERENT", to: "new", guard: speakerGuard },
  ],
});

export type MatchResult = { outcome: Outcome<MatchState>; match: MatchRecord };

/** The speaker's answer on the review page. A refused event returns the match unchanged. */
export function applyMatchEvent(match: MatchRecord, event: MatchEvent, log: BraidLog, actorId: string): MatchResult {
  const outcome = transition(matchMachine, match.state, event, { match, log, actorId });
  if (!outcome.ok) return { outcome, match };
  switch (event.type) {
    case "CONFIRM":
      return { outcome, match: { ...match, confirmed: true, seen: match.state === "new" ? null : event.shown } };
    case "PICK":
      return { outcome, match: { ...match, state: "same_as", entryId: event.entryId, confirmed: true, seen: event.shown } };
    case "DIFFERENT":
      return { outcome, match: { ...match, state: "new", entryId: null, confirmed: true, seen: null } };
  }
}

function addLink(entry: BraidEntryRecord, relation: BraidLinkRelation, entryId: string): BraidEntryRecord {
  if (entry.links.some((l) => l.relation === relation && l.entryId === entryId)) return entry;
  return { ...entry, links: [...entry.links, { relation, entryId }] };
}

function linkBoth(log: BraidLog, a: string, b: string, relation: BraidLinkRelation): BraidLog {
  return { ...log, [a]: addLink(log[a], relation, b), [b]: addLink(log[b], relation, a) };
}

/**
 * Two decisions that may conflict get a conflicts_with link both ways, and both stay as they are:
 * a person decides (E87, E88). Approving one later supersedes the other only if it was approved.
 */
export function linkConflict(log: BraidLog, a: string, b: string): { ok: true; log: BraidLog } | { ok: false; reason: string; log: BraidLog } {
  const x = log[a];
  const y = log[b];
  if (!x || !y || a === b) return { ok: false, reason: "two different entries on this log", log };
  if (x.kind !== "decision" || y.kind !== "decision") return { ok: false, reason: "only decisions conflict", log };
  if (x.projectId !== y.projectId) return { ok: false, reason: "decisions in different projects", log };
  if (GONE.includes(x.state) || GONE.includes(y.state)) return { ok: false, reason: "a merged or withdrawn decision", log };
  return { ok: true, log: linkBoth(log, a, b, "conflicts_with") };
}

export type MatchReport = {
  /** The id a new entry gets. */
  newEntryId: string;
  title: string;
  ownerId: string | null;
  source: BraidSource;
  /** Section 20, U2: a new dependency's promised date. A report joining an entry never moves its date (DP3). */
  expectedOn?: string | null;
};

export type SaveMatchResult =
  | { ok: true; outcome: "created" | "attached"; entryId: string; log: BraidLog; match: MatchRecord }
  /** E83: the entry changed since the speaker saw it. Nothing is attached; the speaker decides again. */
  | { ok: false; outcome: "conflict"; entryId: string; seen: BraidEntryState | null; now: BraidEntryState; log: BraidLog; match: MatchRecord }
  | { ok: false; outcome: "refused"; reason: string; log: BraidLog; match: MatchRecord };

/**
 * Saves one BRAID item onto its project's log (the Apply job, M4). new and related_to fire REPORT on a
 * new entry (related_to also links, never merges); same_as fires ADD_SOURCE on the confirmed entry.
 * ctx.actor is the speaker with their project role now.
 */
export function saveMatch(match: MatchRecord, log: BraidLog, report: MatchReport, ctx: BraidCtx): SaveMatchResult {
  const refuse = (reason: string): SaveMatchResult => ({ ok: false, outcome: "refused", reason, log, match });
  if (match.savedTo) return refuse("already saved");
  if (ctx.actor?.id !== match.speakerId) return refuse("only the speaker's save applies their report");
  if (match.state !== "new" && !match.confirmed) return refuse("the speaker has not confirmed this match");

  const entry = match.entryId ? log[match.entryId] : undefined;
  if (match.state !== "new") {
    if (!entry) return refuse(`no entry ${match.entryId} on this log`);
    // Rule: a match is checked against what the speaker saw. A resolved blocker reopens only when they saw it resolved
    const changed = match.state === "same_as" ? entry.state !== match.seen : isCandidate({ match, log, actorId: match.speakerId }, entry.id, relatedCandidates) !== null;
    if (changed) {
      return { ok: false, outcome: "conflict", entryId: entry.id, seen: match.seen, now: entry.state, log, match: { ...match, confirmed: false } };
    }
  }

  if (match.state === "same_as" && entry) {
    const r = applyBraidEvent(entry, { type: "ADD_SOURCE", projectId: match.projectId, kind: match.kind, source: report.source }, ctx);
    if (!r.outcome.ok) return refuse(r.outcome.reason);
    return { ok: true, outcome: "attached", entryId: entry.id, log: { ...log, [entry.id]: r.record }, match: { ...match, savedTo: entry.id } };
  }

  if (log[report.newEntryId]) return refuse(`entry ${report.newEntryId} already exists`);
  const draft = draftEntry({ id: report.newEntryId, projectId: match.projectId, kind: match.kind, title: report.title, ownerId: report.ownerId });
  const r = applyBraidEvent(draft, { type: "REPORT", source: report.source, expectedOn: report.expectedOn ?? null }, ctx);
  if (!r.outcome.ok) return refuse(r.outcome.reason);
  let next: BraidLog = { ...log, [draft.id]: r.record };
  if (match.state === "related_to" && entry) next = linkBoth(next, draft.id, entry.id, "related");
  for (const other of match.conflictsWith) {
    const linked = linkConflict(next, draft.id, other);
    if (linked.ok) next = linked.log;
  }
  return { ok: true, outcome: "created", entryId: draft.id, log: next, match: { ...match, savedTo: draft.id } };
}

export type LogResult = { outcome: Outcome<BraidEntryState>; log: BraidLog };

/** D9: merging an open report into a resolved blocker or issue asks the PM what the target becomes. */
export type MergeChoice = "reopen" | "keep_resolved";

/** The PM must choose when an open duplicate goes into a resolved entry (D9). */
export function mergeNeedsChoice(from: BraidEntryRecord, into: BraidEntryRecord): boolean {
  return into.state === "resolved" && from.state === "reported";
}

/**
 * A PM merges a duplicate into another entry of the same kind. The sources move: the duplicate keeps
 * none and remembers them for unmerge, the other entry gains them once. Nothing is copied or lost.
 * D9: an open duplicate into a resolved entry either reopens it or is recorded as kept resolved.
 */
export function mergeEntries(log: BraidLog, fromId: string, intoId: string, ctx: BraidCtx, choice?: MergeChoice): LogResult {
  const from = log[fromId];
  const into = log[intoId];
  if (!from || !into) return { outcome: refused("MERGE", from?.state ?? "missing", "both entries must be on this log"), log };
  const needsChoice = mergeNeedsChoice(from, into);
  if (needsChoice && !choice) return { outcome: refused("MERGE", from.state, `"${into.title}" is resolved and this report is open: reopen it, or keep it resolved`), log };
  const r = applyBraidEvent(from, { type: "MERGE", into }, ctx);
  if (!r.outcome.ok) return { outcome: r.outcome, log };
  let gained: BraidEntryRecord = { ...into, sources: [...into.sources, ...from.sources] };
  if (needsChoice && choice === "reopen") {
    const reopened = applyBraidEvent(gained, { type: "REOPEN" }, ctx);
    if (!reopened.outcome.ok) return { outcome: reopened.outcome, log };
    gained = reopened.record;
  } else if (needsChoice) gained = { ...gained, keptOnMerge: true };
  return { outcome: r.outcome, log: { ...log, [fromId]: r.record, [intoId]: gained } };
}

/**
 * D8: where a report on an entry that has finished goes. Finished entries never reopen from a
 * message, except blockers and issues (S14) and declined proposals (E85), which the machine handles.
 * A closed risk gets a new risk linked to it; a realised risk, broken assumption or late dependency
 * sends the report to the entry it raised; a superseded decision, to the decision that replaced it.
 */
export type Redirect = { to: "same"; entryId: string } | { to: "entry"; entryId: string } | { to: "new_raised_again"; fromId: string };

export function redirectReport(log: BraidLog, entryId: string): Redirect {
  const entry = log[entryId];
  if (!entry) return { to: "same", entryId };
  // Section 13: an entry whose kind changed sends the report along the chain to where it lives now
  const live = liveEntryOf(log, entryId);
  if (live !== entryId) {
    const onward = redirectReport(log, live);
    return onward.to === "same" ? { to: "entry", entryId: live } : onward;
  }
  const pointingAt = (relation: BraidLinkRelation) =>
    Object.values(log).find((e) => e.id !== entryId && !GONE.includes(e.state) && e.links.some((l) => l.relation === relation && l.entryId === entryId));
  if (entry.kind === "risk" && entry.state === "closed") return { to: "new_raised_again", fromId: entryId };
  if (["realised", "broken", "late"].includes(entry.state)) {
    const raised = pointingAt("raised_from");
    if (raised) return { to: "entry", entryId: raised.id };
  }
  if (entry.state === "superseded") {
    const winner = pointingAt("supersedes");
    if (winner) return { to: "entry", entryId: winner.id };
  }
  return { to: "same", entryId };
}

/** Undoes a merge, latest first: the entry gets back exactly the sources it had, and they leave the other entry. */
export function unmergeEntry(log: BraidLog, entryId: string, ctx: BraidCtx): LogResult {
  const entry = log[entryId];
  const target = entry?.mergedInto ? log[entry.mergedInto] : undefined;
  if (!entry || !target) return { outcome: refused("UNMERGE", entry?.state ?? "missing", "not merged into an entry on this log"), log };
  const r = applyBraidEvent(entry, { type: "UNMERGE", target }, ctx);
  if (!r.outcome.ok) return { outcome: r.outcome, log };
  const back = new Set(entry.mergedSources.map((s) => s.id));
  // D9: "kept resolved" was a choice about the merged report; with none merged into it any more, it goes
  const stillMerged = Object.values(log).some((e) => e.id !== entryId && e.mergedInto === target.id);
  const lost = { ...target, sources: target.sources.filter((s) => !back.has(s.id)), keptOnMerge: target.keptOnMerge && stillMerged };
  return { outcome: r.outcome, log: { ...log, [entryId]: r.record, [target.id]: lost } };
}
