// Domain records in and out of the database. Loaders return the record plus the version it was
// read at; persisters write only what changed and check the version (a stale one throws).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { expectOne, nextVersion, StaleVersion } from "../commands/core";
import type { BraidEntryRecord, BraidLog, BraidSource, ProjectMember } from "../domain/machines/braid-entry";
import type { CaptureRecord } from "../domain/machines/capture";
import type { ExtractedItem } from "../domain/machines/extracted-item";
import type { MembershipRecord, ProjectRef, World } from "../domain/machines/membership";
import type { SetStatusRecord } from "../domain/machines/set-status";
import type { PlanRows } from "../domain/status/rules";
import type { Status } from "../domain/status/status";
import type { Conn, Tx } from "./conn";
import type { KindRequestRecord } from "../domain/machines/kind-request";
import type { OwnerAskRecord } from "../domain/machines/owner-ask";
import type { CommitmentRecord } from "../domain/machines/commitment";
import type { CoverRecord } from "../domain/machines/cover-request";
import type { LeaveRecord } from "../domain/machines/leave";
import * as t from "./schema";

export type Versions = Map<string, number>;

// ---- World: memberships and projects with their group's org and connection (M13) ----

export async function loadWorld(conn: Conn): Promise<World> {
  const [memberships, projects, groups] = await Promise.all([
    conn.select().from(t.projectMemberships),
    conn.select().from(t.projects),
    conn.select().from(t.groups),
  ]);
  const refs: ProjectRef[] = projects.map((p) => {
    const g = groups.find((x) => x.id === p.groupId)!;
    return { id: p.id, name: p.name, orgTag: g.orgId, connected: g.connectedToDpm, adminId: g.ownerId };
  });
  const records: MembershipRecord[] = memberships.map((m) => ({ projectId: m.projectId, personId: m.personId, state: m.state, role: m.role }));
  return { memberships: records, projects: refs };
}

/** The orgs a person's Atlas account reaches: every org of a group they belong to (meeting D2). */
export async function orgTagsOf(conn: Conn, personId: string): Promise<string[]> {
  const rows = await conn
    .select({ orgId: t.groups.orgId })
    .from(t.groupMembers)
    .innerJoin(t.groups, eq(t.groups.id, t.groupMembers.groupId))
    .where(eq(t.groupMembers.personId, personId));
  return [...new Set(rows.map((r) => r.orgId))];
}

/** Current members with their role (rule 7: roles are read when the event runs). */
export async function membersOf(conn: Conn, projectId: string): Promise<ProjectMember[]> {
  const rows = await conn
    .select()
    .from(t.projectMemberships)
    .where(and(eq(t.projectMemberships.projectId, projectId), eq(t.projectMemberships.state, "member")));
  return rows.map((m) => ({ id: m.personId, role: m.role }));
}

export async function loadProject(conn: Conn, projectId: string) {
  const [row] = await conn.select().from(t.projects).where(eq(t.projects.id, projectId));
  return row ?? null;
}

// ---- Plan and status (M9, M12) ----

export async function loadPlanRows(conn: Conn, projectId: string): Promise<PlanRows> {
  const [threads, milestones, workItems] = await Promise.all([
    conn.select().from(t.threads).where(eq(t.threads.projectId, projectId)),
    conn.select().from(t.milestones).where(eq(t.milestones.projectId, projectId)),
    conn.select().from(t.workItems).where(eq(t.workItems.projectId, projectId)),
  ]);
  return { threads, milestones, workItems };
}

export function setStatusRecordOf(row: typeof t.projects.$inferSelect): SetStatusRecord {
  return { override: row.setOverride, setStatus: row.setStatus, reasonGivenAt: (row.reasonGivenAt as Status | null) ?? null };
}

/** setBy: the owner who set it now, or (phase L, an UNDO) who set it and when, as it was before. */
export async function persistSetStatus(tx: Tx, projectId: string, version: number, record: SetStatusRecord, now: Date, setBy?: string | { by: string | null; at: Date | null }): Promise<void> {
  const rows = await tx
    .update(t.projects)
    .set({
      setOverride: record.override,
      setStatus: record.setStatus,
      reasonGivenAt: record.reasonGivenAt,
      ...(typeof setBy === "string" ? { setBy, setAt: now } : setBy ? { setBy: setBy.by, setAt: setBy.at } : {}),
      ...(record.override === "calculated_only" ? { setBy: null, setAt: null } : {}),
      version: nextVersion(t.projects.version),
      updatedAt: now,
    })
    .where(and(eq(t.projects.id, projectId), eq(t.projects.version, version)))
    .returning({ id: t.projects.id });
  expectOne(rows, `project ${projectId}`);
}

// ---- Captures and extracted items (M2, M3) ----

/** A leave row as the domain sees it (M8): dates, state, and a change waiting (D6). Never a reason. */
export function leaveRecordOf(row: typeof t.leave.$inferSelect): LeaveRecord {
  return {
    id: row.id,
    personId: row.personId,
    start: row.startDate,
    end: row.endDate,
    state: row.state,
    change: row.changeStart && row.changeEnd ? { start: row.changeStart, end: row.changeEnd } : null,
  };
}

export function captureRecordOf(row: typeof t.captures.$inferSelect): CaptureRecord {
  return {
    dedupKey: row.dedupKey,
    kind: row.kind,
    state: row.state,
    tries: row.tries,
    proposals: row.proposals,
    moreFound: row.moreFound,
    reminded: row.reminded,
    transcriptConfidence: row.transcriptConfidence,
    failedStep: row.failedStep,
  };
}

export async function loadCapture(conn: Conn, captureId: string) {
  const [row] = await conn.select().from(t.captures).where(eq(t.captures.id, captureId));
  return row ? { row, record: captureRecordOf(row) } : null;
}

export async function persistCapture(tx: Tx, captureId: string, version: number, record: CaptureRecord, now: Date): Promise<void> {
  const rows = await tx
    .update(t.captures)
    .set({
      state: record.state,
      tries: record.tries,
      proposals: record.proposals,
      moreFound: record.moreFound,
      reminded: record.reminded,
      transcriptConfidence: record.transcriptConfidence,
      failedStep: record.failedStep,
      version: nextVersion(t.captures.version),
      updatedAt: now,
    })
    .where(and(eq(t.captures.id, captureId), eq(t.captures.version, version)))
    .returning({ id: t.captures.id });
  expectOne(rows, `capture ${captureId}`);
}

export function itemOf(row: typeof t.extractions.$inferSelect): ExtractedItem {
  return {
    id: row.id,
    draft: row.draft,
    state: row.state,
    confidence: row.confidence,
    value: row.value,
    saw: row.saw,
    conflict: row.conflict,
    withdrawn: row.withdrawn,
    touched: row.touched,
  };
}

export async function loadItems(conn: Conn, captureId: string): Promise<{ items: ExtractedItem[]; versions: Versions }> {
  const rows = await conn.select().from(t.extractions).where(eq(t.extractions.captureId, captureId)).orderBy(t.extractions.ordinal);
  return { items: rows.map(itemOf), versions: new Map(rows.map((r) => [r.id, r.version])) };
}

/** Writes the items that changed. The draft's routing columns are kept in step with the draft. */
export async function persistItems(tx: Tx, before: readonly ExtractedItem[], after: readonly ExtractedItem[], versions: Versions, now: Date): Promise<void> {
  for (const item of after) {
    const old = before.find((i) => i.id === item.id);
    if (old && JSON.stringify(old) === JSON.stringify(item)) continue;
    const version = versions.get(item.id);
    if (version === undefined) throw new Error(`extraction ${item.id} was not loaded`);
    const rows = await tx
      .update(t.extractions)
      .set({
        state: item.state,
        confidence: item.confidence,
        value: item.value,
        saw: item.saw,
        conflict: item.conflict,
        withdrawn: item.withdrawn,
        touched: item.touched,
        draft: item.draft,
        kind: item.draft.kind,
        projectId: item.draft.projectId,
        routing: item.draft.routing,
        scope: item.draft.scope,
        appliedAt: item.state === "applied" && old?.state !== "applied" ? now : undefined,
        version: nextVersion(t.extractions.version),
        updatedAt: now,
      })
      .where(and(eq(t.extractions.id, item.id), eq(t.extractions.version, version)))
      .returning({ id: t.extractions.id });
    expectOne(rows, `extraction ${item.id}`);
  }
}

// ---- BRAID log (M15, M16) ----

/**
 * The project's log as the domain sees it. A source row's entry_id is where it is now; an entry merged
 * away keeps, as mergedSources, the sources first reported on it that now sit on another entry.
 */
export async function loadBraidLog(conn: Conn, projectId: string): Promise<{ log: BraidLog; versions: Versions }> {
  const entries = await conn.select().from(t.braidEntries).where(eq(t.braidEntries.projectId, projectId));
  const ids = entries.map((e) => e.id);
  if (!ids.length) return { log: {}, versions: new Map() };
  const [sources, links, answers] = await Promise.all([
    // D11: a report taken back stays in the table for the history, never on the entry
    conn.select().from(t.braidSources).where(and(inArray(t.braidSources.originEntryId, ids), isNull(t.braidSources.withdrawnAt))),
    conn.select().from(t.braidLinks).where(inArray(t.braidLinks.entryId, ids)),
    conn.select().from(t.braidAnswers).where(inArray(t.braidAnswers.entryId, ids)).orderBy(t.braidAnswers.id),
  ]);
  const toSource = (s: (typeof sources)[number]): BraidSource => ({
    id: s.id,
    personId: s.personId,
    captureId: s.captureId,
    span: s.spanStart !== null && s.spanEnd !== null ? { start: s.spanStart, end: s.spanEnd } : null,
    at: s.at.toISOString(),
  });
  const log: Record<string, BraidEntryRecord> = {};
  for (const e of entries) {
    log[e.id] = {
      id: e.id,
      projectId: e.projectId,
      kind: e.kind,
      title: e.title,
      state: e.state,
      ownerId: e.ownerId,
      reportedBy: e.reportedBy,
      sources: sources.filter((s) => s.entryId === e.id).map(toSource),
      links: links.filter((l) => l.entryId === e.id).map((l) => ({ relation: l.relation, entryId: l.otherEntryId })),
      answers: answers.filter((a) => a.entryId === e.id).map((a) => ({ by: a.by, act: a.act, note: a.note, round: a.round, on: a.on })),
      round: e.round,
      proposedOn: e.proposedOn,
      remindersSent: e.remindersSent,
      lastRemindedOn: e.lastRemindedOn,
      decidedBy: e.decidedBy,
      decidedOn: e.decidedOn,
      selfApproved: e.selfApproved,
      resolvedBy: e.resolvedBy,
      resolvedOn: e.resolvedOn,
      resolveProposedBy: e.resolveProposedBy,
      newAlert: e.newAlert,
      mergedInto: e.mergedInto,
      stateBeforeMerge: e.stateBeforeMerge,
      // Only a merged entry is owed its reports back; a switched one handed them on for good
      mergedSources: e.state === "merged" ? sources.filter((s) => s.originEntryId === e.id && s.entryId !== e.id).map(toSource) : [],
      keptOnMerge: e.keptOnMerge,
      switchedBy: e.switchedBy,
      switchedOn: e.switchedOn,
      switchReason: e.switchReason,
      stateBeforeSwitch: e.stateBeforeSwitch,
      expectedOn: e.expectedOn,
      outcomesProposed: e.outcomesProposed,
    };
  }
  return { log, versions: new Map(entries.map((e) => [e.id, e.version])) };
}

function entryColumns(e: BraidEntryRecord) {
  return {
    projectId: e.projectId,
    kind: e.kind,
    title: e.title,
    state: e.state,
    ownerId: e.ownerId,
    reportedBy: e.reportedBy,
    round: e.round,
    proposedOn: e.proposedOn,
    remindersSent: e.remindersSent,
    lastRemindedOn: e.lastRemindedOn,
    decidedBy: e.decidedBy,
    decidedOn: e.decidedOn,
    selfApproved: e.selfApproved,
    resolvedBy: e.resolvedBy,
    resolvedOn: e.resolvedOn,
    resolveProposedBy: e.resolveProposedBy,
    newAlert: e.newAlert,
    mergedInto: e.mergedInto,
    stateBeforeMerge: e.stateBeforeMerge,
    keptOnMerge: e.keptOnMerge,
    switchedBy: e.switchedBy,
    switchedOn: e.switchedOn,
    switchReason: e.switchReason,
    stateBeforeSwitch: e.stateBeforeSwitch,
    expectedOn: e.expectedOn,
    outcomesProposed: e.outcomesProposed,
  };
}

/** Writes every entry that changed between two versions of a log: rows, sources, links, new answers. */
export async function persistBraidLog(
  tx: Tx,
  before: BraidLog,
  after: BraidLog,
  versions: Versions,
  now: Date,
  extras: { extractionIdBySource?: ReadonlyMap<string, string>; signalIdBySource?: ReadonlyMap<string, string> } = {},
): Promise<string[]> {
  const changed: string[] = [];
  for (const entry of Object.values(after)) {
    const old = before[entry.id];
    if (old && JSON.stringify(old) === JSON.stringify(entry)) continue;
    changed.push(entry.id);
    if (!old) {
      await tx.insert(t.braidEntries).values({ id: entry.id, ...entryColumns(entry) });
    } else {
      const version = versions.get(entry.id);
      if (version === undefined) throw new StaleVersion(`BRAID entry ${entry.id}`);
      const rows = await tx
        .update(t.braidEntries)
        .set({ ...entryColumns(entry), version: nextVersion(t.braidEntries.version), updatedAt: now })
        .where(and(eq(t.braidEntries.id, entry.id), eq(t.braidEntries.version, version)))
        .returning({ id: t.braidEntries.id });
      expectOne(rows, `BRAID entry ${entry.id}`);
    }
  }
  for (const id of changed) {
    const entry = after[id];
    // Sources move between entries on merge and unmerge; their origin never changes
    for (const s of entry.sources) {
      const [existing] = await tx.select().from(t.braidSources).where(eq(t.braidSources.id, s.id));
      if (!existing) {
        await tx.insert(t.braidSources).values({
          id: s.id,
          entryId: id,
          originEntryId: id,
          personId: s.personId,
          captureId: s.captureId,
          extractionId: extras.extractionIdBySource?.get(s.id) ?? null,
          signalId: extras.signalIdBySource?.get(s.id) ?? null,
          spanStart: s.span?.start ?? null,
          spanEnd: s.span?.end ?? null,
          at: new Date(s.at),
        });
      } else if (existing.entryId !== id) {
        await tx.update(t.braidSources).set({ entryId: id }).where(eq(t.braidSources.id, s.id));
      }
    }
    const old = before[id];
    // D11: a source that left this entry and sits on no other one was taken back by its reporter
    const everywhere = new Set(Object.values(after).flatMap((e) => [...e.sources, ...e.mergedSources].map((s) => s.id)));
    for (const s of old?.sources ?? []) {
      if (!everywhere.has(s.id)) await tx.update(t.braidSources).set({ withdrawnAt: now }).where(eq(t.braidSources.id, s.id));
    }
    if (!old || JSON.stringify(old.links) !== JSON.stringify(entry.links)) {
      await tx.delete(t.braidLinks).where(eq(t.braidLinks.entryId, id));
      if (entry.links.length) await tx.insert(t.braidLinks).values(entry.links.map((l) => ({ entryId: id, otherEntryId: l.entryId, relation: l.relation })));
    }
    // Answers are kept for good: only new ones are added
    const fresh = entry.answers.slice(old?.answers.length ?? 0);
    if (fresh.length) await tx.insert(t.braidAnswers).values(fresh.map((a) => ({ entryId: id, by: a.by, act: a.act, note: a.note, round: a.round, on: a.on })));
  }
  return changed;
}

// ---- Kind change requests (M17, section 13) ----

export type KindRequestRow = typeof t.braidKindRequests.$inferSelect;
export type OwnerAskRow = typeof t.ownerAsks.$inferSelect;

/** M37: an ask as its row holds it. */
export function ownerAskOf(row: OwnerAskRow): OwnerAskRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    captureId: row.captureId,
    extractionId: row.extractionId,
    authorId: row.authorId,
    kind: row.kind,
    target: row.targetType && row.targetId && row.targetField ? { type: row.targetType, id: row.targetId, field: row.targetField } : null,
    ownerId: row.ownerId,
    saw: row.saw,
    value: row.value,
    title: row.title,
    state: row.state,
    askedOn: row.askedOn,
    decidedBy: row.decidedBy,
    decidedOn: row.decidedOn,
    reason: row.reason,
    appliedValue: row.appliedValue,
  };
}

/** Inserts a new ask (version null) or updates it where its version still matches. */
export async function persistOwnerAsk(tx: Tx, r: OwnerAskRecord, version: number | null, now: Date): Promise<void> {
  const { id, target, ...rest } = r;
  const columns = { ...rest, targetType: target?.type ?? null, targetId: target?.id ?? null, targetField: target?.field ?? null };
  if (version === null) {
    await tx.insert(t.ownerAsks).values({ id, ...columns, createdAt: now, updatedAt: now });
    return;
  }
  const rows = await tx
    .update(t.ownerAsks)
    .set({ ...columns, version: nextVersion(t.ownerAsks.version), updatedAt: now })
    .where(and(eq(t.ownerAsks.id, id), eq(t.ownerAsks.version, version)))
    .returning({ id: t.ownerAsks.id });
  expectOne(rows, `ask ${id}`);
}

type CommitmentRow = typeof t.commitments.$inferSelect;

/** M22, phase E: a commitment row as its machine reads it. */
export function commitmentOf(row: CommitmentRow): CommitmentRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    captureId: row.captureId,
    extractionId: row.extractionId,
    what: row.what,
    dueOn: row.dueOn,
    link: row.linkType && row.linkId && row.linkProjectId ? { type: row.linkType, id: row.linkId, projectId: row.linkProjectId } : null,
    state: row.state,
    moves: row.moves,
    checkIns: row.checkIns,
    checkInOut: row.checkInOut,
    checkInOn: row.checkInOn,
    stands: row.stands,
    savedOn: row.savedOn,
    endedOn: row.endedOn,
    endedBy: row.endedBy,
  };
}

/** Inserts a new commitment (version null), or writes a move against the version it was read at. */
export async function persistCommitment(tx: Tx, r: CommitmentRecord, version: number | null, now: Date): Promise<void> {
  const { id, link, ...rest } = r;
  const columns = { ...rest, linkType: link?.type ?? null, linkId: link?.id ?? null, linkProjectId: link?.projectId ?? null };
  if (version === null) {
    await tx.insert(t.commitments).values({ id, ...columns, createdAt: now, updatedAt: now });
    return;
  }
  const rows = await tx
    .update(t.commitments)
    .set({ ...columns, version: nextVersion(t.commitments.version), updatedAt: now })
    .where(and(eq(t.commitments.id, id), eq(t.commitments.version, version)))
    .returning({ id: t.commitments.id });
  expectOne(rows, `commitment ${id}`);
}

type CoverRow = typeof t.coverRequests.$inferSelect;

/** M35, phase P: a cover request row as its machine reads it. */
export function coverOf(row: CoverRow): CoverRecord {
  return {
    id: row.id,
    leaveId: row.leaveId,
    askerId: row.askerId,
    captureId: row.captureId,
    projectId: row.projectId,
    toId: row.toId,
    items: row.items,
    declined: row.declined,
    state: row.state,
    handover: row.handover,
    handoverId: row.handoverId,
    endedWhy: row.endedWhy,
    askedAt: row.askedAt,
  };
}

/**
 * Inserts a new cover request (version null), or writes a move against the version it was read at. commands: the
 * PICK's or the answer's command id, kept so a repeat changes nothing (rule 6).
 */
export async function persistCover(tx: Tx, r: CoverRecord, version: number | null, now: Date, commands: { askCommandId?: string; answerCommandId?: string } = {}): Promise<void> {
  const { id, ...rest } = r;
  if (version === null) {
    await tx.insert(t.coverRequests).values({ id, ...rest, ...commands, createdAt: now, updatedAt: now });
    return;
  }
  const rows = await tx
    .update(t.coverRequests)
    .set({ ...rest, ...commands, version: nextVersion(t.coverRequests.version), updatedAt: now })
    .where(and(eq(t.coverRequests.id, id), eq(t.coverRequests.version, version)))
    .returning({ id: t.coverRequests.id });
  expectOne(rows, `cover request ${id}`);
}

export function kindRequestOf(row: KindRequestRow): KindRequestRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    entryId: row.entryId,
    state: row.state,
    askedBy: row.askedBy,
    toKind: row.toKind,
    why: row.why,
    askedOn: row.askedOn,
    answeredBy: row.answeredBy,
    answeredOn: row.answeredOn,
    keepReason: row.keepReason,
    remindersSent: row.remindersSent,
    lastRemindedOn: row.lastRemindedOn,
  };
}

function kindRequestColumns(r: KindRequestRecord) {
  const { id: _id, ...rest } = r;
  return rest;
}

/** Writes a request: a new one is inserted, a known one is updated only at the version it was read. */
export async function persistKindRequest(tx: Tx, record: KindRequestRecord, version: number | null, now: Date): Promise<void> {
  if (version === null) {
    await tx.insert(t.braidKindRequests).values({ id: record.id, ...kindRequestColumns(record) });
    return;
  }
  const rows = await tx
    .update(t.braidKindRequests)
    .set({ ...kindRequestColumns(record), version: nextVersion(t.braidKindRequests.version), updatedAt: now })
    .where(and(eq(t.braidKindRequests.id, record.id), eq(t.braidKindRequests.version, version)))
    .returning({ id: t.braidKindRequests.id });
  expectOne(rows, `kind change request ${record.id}`);
}
