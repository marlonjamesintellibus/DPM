// The capture commands (build plan 5.1 and 5.2; machines doc M2, M3, M4, M14): a message arrives,
// Atlas's proposals pass the server checks, the author confirms them, and Save applies every
// confirmed item to every project it touches in one transaction. Records change only through
// their own machines, with the author as actor, and every move writes an audit entry (A11).
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { captureRecordOf, itemOf, loadBraidLog, loadCapture, loadItems, loadWorld, orgTagsOf, persistBraidLog, persistCapture, persistItems } from "../db/records";
import * as t from "../db/schema";
import { runChecks } from "../domain/atlas-checks/checks";
import type { CheckContext, DroppedProposal, RawProposal } from "../domain/atlas-checks/types";
import { planSave, saveOutcome, settleItems, targetKey, type PlannedWrite, type SaveConflict } from "../domain/capture-save";
import { config } from "../domain/config";
import { dateInZone, daysBetween, isIsoDate, isWorkingDay } from "../domain/dates";
import type { Moved } from "../domain/machine";
import type { BraidActor, BraidEntryState, BraidLog, BraidSource } from "../domain/machines/braid-entry";
import {
  applyCaptureEvent,
  captureDedupKey,
  capProposals,
  confidenceCap,
  receiveCapture,
  type CaptureContext,
  type CaptureEvent,
  type CaptureRecord,
  type CaptureState,
} from "../domain/machines/capture";
import {
  applyItemEvent,
  isReady,
  OPEN_ITEM_STATES,
  startItem,
  type ExtractedItem,
  type ItemContext,
  type ItemEvent,
  type ItemState,
  type WithdrawReason,
} from "../domain/machines/extracted-item";
import { applyHandover, type HandoverRecord } from "../domain/machines/handover";
import { evaluateCause } from "../domain/machines/inbox-item";
import { acceptExtractedLeave, type ExtractedLeave, type LeaveRecord } from "../domain/machines/leave";
import { saveMatch, type MatchRecord } from "../domain/machines/match";
import { actorIn, isCandidate, type World } from "../domain/machines/membership";
import { applyMilestone, type MilestoneRecord } from "../domain/machines/milestone";
import { applyWorkItem, workItemEventTo, type WorkItemEvent, type WorkItemRecord } from "../domain/machines/work-item";
import { mayReport } from "../domain/rights";
import { applyRouting, planRoutingAtSave, type Author, type Route, type RoutingEvent } from "../domain/routing";
import type { Confidence, ExtractedItemDraft, MatchState } from "../domain/shared";
import type { WorkItemState } from "../domain/status/rules";
import { loadCheckContext } from "../queries/check-context";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, todayOf, type CommandCtx } from "./core";
import { evaluateProjects, type Evaluation } from "./evaluate";

type CaptureRow = typeof t.captures.$inferSelect;
type Actor = { type: "person" | "atlas" | "rule" | "system"; id: string | null };

const clock = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone, hour: "numeric", minute: "2-digit" }).format(d);

async function captureOf(tx: Tx, captureId: string) {
  const c = await loadCapture(tx, captureId);
  if (!c) throw new CommandRefused(`no capture ${captureId}`, "not_found");
  return c;
}

// M1: a capture is private to its author, and only they confirm what Atlas read in it
async function ownCapture(tx: Tx, captureId: string, actorId: string) {
  const c = await captureOf(tx, captureId);
  if (c.row.authorId !== actorId) throw new CommandRefused("only the author can review this update", "not_allowed");
  return c;
}

// There is no account switch yet, so an author is active while they exist (E29)
async function isActive(tx: Tx, personId: string): Promise<boolean> {
  const [p] = await tx.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, personId));
  return p !== undefined;
}

function moveCapture(record: CaptureRecord, event: CaptureEvent, ctx: CaptureContext = {}) {
  const r = applyCaptureEvent(record, event, ctx);
  return { record: r.record, outcome: moved(r.outcome) };
}

function moveItem(item: ExtractedItem, event: ItemEvent, ctx: ItemContext = {}) {
  const r = applyItemEvent(item, event, ctx);
  return { item: r.item, outcome: moved(r.outcome) };
}

async function auditCapture(tx: Tx, now: Date, captureId: string, outcome: Moved<CaptureState>, by: Actor, detail?: Record<string, unknown>) {
  await audit(tx, now, {
    actorType: by.type,
    actorId: by.id,
    action: outcome.event,
    machine: "capture",
    subjectType: "capture",
    subjectId: captureId,
    fromState: outcome.from,
    toState: outcome.to,
    captureId,
    detail,
  });
}

async function auditItem(tx: Tx, now: Date, captureId: string, item: ExtractedItem, outcome: Moved<ItemState>, by: Actor, detail?: Record<string, unknown>) {
  await audit(tx, now, {
    actorType: by.type,
    actorId: by.id,
    action: outcome.event,
    machine: "extracted_item",
    subjectType: "extraction",
    subjectId: item.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId,
    extractionId: item.id,
    detail,
  });
}

// ---- The author's review reminder (M2 TIMER review_reminder, an M10 inbox item) ----

/** The inbox cause for "1 update waiting for your OK"; its subject is the capture. */
export const reviewCause = (captureId: string) => `review_waiting:${captureId}`;

async function syncReminder(tx: Tx, now: Date, ownerId: string, captureId: string, holds: boolean, byOwnerAction = false) {
  const causeKey = reviewCause(captureId);
  const rows = await tx.select().from(t.inboxItems).where(and(eq(t.inboxItems.ownerId, ownerId), eq(t.inboxItems.causeKey, causeKey)));
  const plan = evaluateCause(causeKey, rows.map((r) => ({ id: r.id, causeKey: r.causeKey, episode: r.episode, state: r.state })), holds, { byOwnerAction });
  if (plan.create) {
    const id = `inbox-${ownerId}-${causeKey}-${plan.create.episode}`;
    await tx.insert(t.inboxItems).values({ id, ownerId, causeKey, episode: plan.create.episode, state: "open", createdAt: now });
    await audit(tx, now, { actorType: "rule", action: "INBOX_ITEM_CREATED", machine: "inbox_item", subjectType: "inbox_item", subjectId: id, toState: "open", captureId, detail: { ownerId, causeKey } });
  }
  for (const c of plan.close) {
    const row = rows.find((r) => r.id === c.id)!;
    const updated = await tx
      .update(t.inboxItems)
      .set({ state: c.to, closedAt: now, version: nextVersion(t.inboxItems.version) })
      .where(and(eq(t.inboxItems.id, c.id), eq(t.inboxItems.version, row.version)))
      .returning({ id: t.inboxItems.id });
    expectOne(updated, `inbox item ${c.id}`);
    await audit(tx, now, { actorType: "rule", action: "CAUSE_GONE", machine: "inbox_item", subjectType: "inbox_item", subjectId: c.id, fromState: row.state, toState: c.to, captureId, detail: { ownerId, causeKey } });
  }
}

// ---- createCapture (build plan 5.1 step 1) ----

export type NewCapture = {
  channel: CaptureRow["channel"];
  kind: CaptureRow["kind"];
  text: string;
  messageAt: Date;
  receivedAt: Date;
  messageId?: string | null;
  durationSeconds?: number | null;
  /** Voice only: how sure the transcriber was (E5). */
  transcriptConfidence?: Confidence | null;
};

export type Created = { captureId: string; duplicate: boolean };

/** Stores a message as received. A repeat of one already received (same dedup key) is dropped and changes nothing (E1). */
export function createCapture(ctx: CommandCtx, input: NewCapture): Promise<Created> {
  return runCommand(ctx, async (tx) => {
    const dedupKey = captureDedupKey({ channel: input.channel, author: ctx.actorId, text: input.text, sentAt: input.messageAt, messageId: input.messageId });
    const seen = await tx.select({ id: t.captures.id, dedupKey: t.captures.dedupKey }).from(t.captures).where(eq(t.captures.dedupKey, dedupKey));
    const received = receiveCapture({ dedupKey, kind: input.kind }, new Set(seen.map((s) => s.dedupKey)));
    if (!received.ok) return { captureId: seen[0].id, duplicate: true };
    const id = `cap-${randomUUID()}`;
    await tx.insert(t.captures).values({
      id,
      authorId: ctx.actorId,
      channel: input.channel,
      kind: input.kind,
      text: input.text,
      durationSeconds: input.durationSeconds ?? null,
      messageAt: input.messageAt,
      receivedAt: input.receivedAt,
      dedupKey,
      state: received.record.state,
      // Kept until the transcript step reports it (TRANSCRIBED); a text message has none
      transcriptConfidence: input.kind === "voice" ? (input.transcriptConfidence ?? null) : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    await audit(tx, ctx.now, {
      actorType: "system",
      action: "RECEIVED",
      machine: "capture",
      subjectType: "capture",
      subjectId: id,
      toState: "received",
      captureId: id,
      detail: { channel: input.channel, authorId: ctx.actorId },
    });
    return { captureId: id, duplicate: false };
  });
}

// ---- The Atlas step (build plan 5.1 steps 2 to 5) ----
// A read is three short transactions around one network call, so no database transaction waits on
// the model: beginRead (received or retry_wait to reading), then proposeItems or failRead.

export type ReadStarted = { state: CaptureState; tries: number; context: CheckContext | null };

/**
 * Starts reading a capture: the first try (START, and TRANSCRIBED for voice) or the next one after
 * a failure (RETRY). After config.captureMaxTries the capture fails instead (E18) and `context` is null.
 */
export function beginRead(ctx: CommandCtx, captureId: string): Promise<ReadStarted> {
  return runCommand(ctx, async (tx) => {
    const { row, record: before } = await captureOf(tx, captureId);
    const atlas: Actor = { type: "atlas", id: null };
    const moves: Moved<CaptureState>[] = [];
    let record = before;
    const step = (event: CaptureEvent) => {
      const r = moveCapture(record, event);
      record = r.record;
      moves.push(r.outcome);
    };
    if (record.state === "retry_wait") step({ type: "RETRY" });
    else {
      step({ type: "START" });
      // A voice note with no reported confidence is treated as unsure, so it can only lower items
      if (record.state === "transcribing") step({ type: "TRANSCRIBED", confidence: row.transcriptConfidence ?? "medium" });
    }
    await persistCapture(tx, captureId, row.version, record, ctx.now);
    for (const m of moves) await auditCapture(tx, ctx.now, captureId, m, atlas, m.event === "RETRY" ? { tries: record.tries } : undefined);
    const context =
      record.state === "reading"
        ? await loadCheckContext(tx, { authorId: row.authorId, text: row.text, messageAt: row.messageAt, transcriptConfidence: record.transcriptConfidence })
        : null;
    return { state: record.state, tries: record.tries, context };
  });
}

/** What Atlas reported about a read, kept in the audit so the model can be measured (phase 4). */
export type ReadMeta = { model: string; usage?: unknown; malformed?: unknown[]; message?: string };

/** The model failed, timed out or sent something unreadable: wait, then try again (E18, E19). */
export function failRead(ctx: CommandCtx, captureId: string, why: "model_error" | "timeout" | "bad_output", meta: ReadMeta): Promise<CaptureState> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await captureOf(tx, captureId);
    const r = moveCapture(record, { type: "READ_FAILED", why });
    await persistCapture(tx, captureId, row.version, r.record, ctx.now);
    await auditCapture(tx, ctx.now, captureId, r.outcome, { type: "atlas", id: null }, { why, tries: record.tries, ...meta });
    return r.record.state;
  });
}

export type Proposed = { state: CaptureState; items: ExtractedItem[]; dropped: DroppedProposal[]; moreFound: boolean };

/**
 * Runs the server checks on what Atlas returned and stores the items that pass. Atlas is the actor;
 * nothing here changes a project. The checks read the database again here, so a record that changed
 * while the model was reading is checked as it is now. A received capture is started first, which
 * is how tests and the story feed recorded proposals in one step.
 */
export function proposeItems(ctx: CommandCtx, captureId: string, proposals: readonly RawProposal[], meta?: ReadMeta): Promise<Proposed> {
  return runCommand(ctx, async (tx) => {
    const { row, record: received } = await captureOf(tx, captureId);
    const atlas: Actor = { type: "atlas", id: null };
    const moves: Moved<CaptureState>[] = [];
    let record = received;
    const step = (event: CaptureEvent) => {
      const r = moveCapture(record, event);
      record = r.record;
      moves.push(r.outcome);
    };
    if (record.state === "received") {
      step({ type: "START" });
      if ((record.state as CaptureState) === "transcribing") step({ type: "TRANSCRIBED", confidence: row.transcriptConfidence ?? "medium" });
    }

    const checkCtx = await loadCheckContext(tx, { authorId: row.authorId, text: row.text, messageAt: row.messageAt, transcriptConfidence: record.transcriptConfidence });
    const checked = runChecks(proposals, checkCtx);
    const { kept, more } = capProposals(checked.items);
    const capped = checked.dropped.filter((d) => d.check === "cap").length;
    const items = kept.map((draft) => startItem(`${captureId}-${draft.ordinal}`, draft, { maxConfidence: confidenceCap(record) }));
    step({ type: "PROPOSALS_READY", count: items.length + more + capped });

    if (items.length) {
      await tx.insert(t.extractions).values(
        items.map((item) => ({
          id: item.id,
          captureId,
          ordinal: item.draft.ordinal,
          kind: item.draft.kind,
          scope: item.draft.scope,
          projectId: item.draft.projectId,
          routing: item.draft.routing,
          draft: item.draft,
          state: item.state,
          confidence: item.confidence,
          value: item.value,
          saw: item.saw,
          conflict: item.conflict,
          withdrawn: item.withdrawn,
          touched: item.touched,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })),
      );
    }
    await persistCapture(tx, captureId, row.version, record, ctx.now);
    for (const m of moves) {
      // Dropped proposals are kept with their reason so the model can be measured (phase 4)
      const detail = m.event === "PROPOSALS_READY" ? { items: items.length, moreFound: record.moreFound, dropped: checked.dropped, ...meta } : undefined;
      await auditCapture(tx, ctx.now, captureId, m, atlas, detail);
    }
    for (const item of items) {
      await audit(tx, ctx.now, {
        actorType: "atlas",
        action: "MARK",
        machine: "extracted_item",
        subjectType: "extraction",
        subjectId: item.id,
        fromState: "proposed",
        toState: item.state,
        captureId,
        extractionId: item.id,
        detail: { mark: item.draft.mark, confidence: item.confidence, projectId: item.draft.projectId, routing: item.draft.routing },
      });
    }
    return { state: record.state, items, dropped: checked.dropped, moreFound: record.moreFound };
  });
}

// ---- openReview and discardCapture (M2) ----

export function openReview(ctx: CommandCtx, captureId: string): Promise<CaptureState> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await ownCapture(tx, captureId, ctx.actorId);
    const r = moveCapture(record, { type: "OPEN_REVIEW" }, { authorActive: await isActive(tx, row.authorId) });
    await persistCapture(tx, captureId, row.version, r.record, ctx.now);
    await auditCapture(tx, ctx.now, captureId, r.outcome, { type: "person", id: ctx.actorId });
    return r.record.state;
  });
}

/** "Discard all": every open item is withdrawn and nothing reaches any project. */
export function discardCapture(ctx: CommandCtx, captureId: string): Promise<{ withdrawn: string[] }> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await ownCapture(tx, captureId, ctx.actorId);
    const r = moveCapture(record, { type: "DISCARD" });
    const by: Actor = { type: "person", id: ctx.actorId };
    const withdrawn = await withdrawAll(tx, ctx.now, captureId, "discarded", by);
    await persistCapture(tx, captureId, row.version, r.record, ctx.now);
    await auditCapture(tx, ctx.now, captureId, r.outcome, by);
    await syncReminder(tx, ctx.now, row.authorId, captureId, false, true);
    return { withdrawn };
  });
}

async function withdrawAll(tx: Tx, now: Date, captureId: string, because: WithdrawReason, by: Actor): Promise<string[]> {
  const { items, versions } = await loadItems(tx, captureId);
  const after = items.map((i) => applyItemEvent(i, { type: "WITHDRAW", because }));
  await persistItems(tx, items, after.map((r) => r.item), versions, now);
  const withdrawn: string[] = [];
  for (const r of after) {
    if (!r.outcome.ok) continue; // settled items stay as they are
    withdrawn.push(r.item.id);
    await auditItem(tx, now, captureId, r.item, r.outcome, by, { because });
  }
  return withdrawn;
}

// ---- decideExtraction (M3) ----

export type ExtractionDecision = { type: "accept" } | { type: "edit"; value: string } | { type: "reject" } | { type: "undo" };

/** The extraction and its capture, for the author only, while the review is open. */
async function reviewing(tx: Tx, extractionId: string, actorId: string) {
  const [row] = await tx.select().from(t.extractions).where(eq(t.extractions.id, extractionId));
  if (!row) throw new CommandRefused(`no extraction ${extractionId}`, "not_found");
  const capture = await ownCapture(tx, row.captureId, actorId);
  if (capture.record.state !== "reviewing") throw new CommandRefused(`the update is ${capture.record.state}; open the review first`);
  return { row, item: itemOf(row), capture };
}

export function decideExtraction(ctx: CommandCtx, extractionId: string, decision: ExtractionDecision): Promise<ExtractedItem> {
  return runCommand(ctx, async (tx) => {
    const { row, item } = await reviewing(tx, extractionId, ctx.actorId);
    const event: ItemEvent =
      decision.type === "accept"
        ? { type: "ACCEPT" }
        : decision.type === "edit"
          ? { type: "EDIT", value: decision.value }
          : decision.type === "reject"
            ? { type: "REJECT" }
            : { type: "UNDO" };
    const checkEdit = decision.type === "edit" ? await editRule(tx, item, ctx.actorId) : undefined;
    const r = moveItem(item, event, { checkEdit });
    await persistItems(tx, [item], [r.item], new Map([[row.id, row.version]]), ctx.now);
    await auditItem(tx, ctx.now, row.captureId, r.item, r.outcome, { type: "person", id: ctx.actorId }, decision.type === "edit" ? { value: decision.value } : undefined);
    return r.item;
  });
}

const STEP_ORDER = ["not_done", "in_progress", "handed_over"] as const;
const SETTABLE_WORK_STATES: readonly string[] = ["to_do", "in_progress", "blocked", "done"];

function parseLeave(value: string | null, personId: string): ExtractedLeave | null {
  const [start, end] = (value ?? "").split("/");
  if (!start) return null;
  return { personId, start, end: !end || end === ".." ? null : end };
}

function leaveRecords(rows: (typeof t.leave.$inferSelect)[]): LeaveRecord[] {
  return rows.map((l) => ({ id: l.id, personId: l.personId, start: l.startDate, end: l.endDate, state: l.state }));
}

/**
 * E22: an edited value must pass the target's own rules, read now: the record's machine must
 * accept it, and a forecast may not fall before the project starts.
 */
async function editRule(tx: Tx, item: ExtractedItem, authorId: string): Promise<(value: string) => string | null> {
  const target = item.draft.target;
  if (item.draft.kind !== "update" || !target) return () => null; // a BRAID title: the machine wants it non-empty
  const world = await loadWorld(tx);
  switch (target.type) {
    case "work_item": {
      const [row] = await tx.select().from(t.workItems).where(eq(t.workItems.id, target.id));
      if (!row) return () => "this issue no longer exists";
      const record = workItemRecordOf(row);
      const actor = actorIn(authorId, row.projectId, world.memberships);
      return (value) => {
        if (target.field === "blocked_note") return applyWorkItem(record, { type: "UPDATE_BLOCKED_NOTE", note: value }, actor).outcome.ok ? null : `${row.number ?? row.title} is not blocked`;
        if (!SETTABLE_WORK_STATES.includes(value)) return `"${value}" is not a state an update can set`;
        if (value === row.state) return null;
        const event = workItemEventTo(row.state, value as WorkItemState, target.note ?? "");
        if (!event) return `${row.number ?? row.title} cannot go from ${row.state} to ${value}`;
        const r = applyWorkItem(record, event, actor);
        return r.outcome.ok ? null : r.outcome.reason;
      };
    }
    case "milestone": {
      const [row] = await tx.select().from(t.milestones).where(eq(t.milestones.id, target.id));
      if (!row) return () => "this milestone no longer exists";
      const [project] = await tx.select().from(t.projects).where(eq(t.projects.id, row.projectId));
      const actor = actorIn(authorId, row.projectId, world.memberships);
      return (value) => {
        if (!isIsoDate(value)) return `${value} is not a date`;
        if (project?.startDate && daysBetween(project.startDate, value) < 0) return `${value} is before ${project.name} starts (${project.startDate})`;
        if (value === (row.forecastDate ?? row.targetDate)) return null;
        const r = applyMilestone(milestoneRecordOf(row), { type: "FORECAST_CHANGED", forecast: value }, actor);
        return r.outcome.ok ? null : r.outcome.reason;
      };
    }
    case "handover": {
      const [step] = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, target.id));
      if (!step) return () => "this handover step no longer exists";
      return (value) => {
        const to = STEP_ORDER.indexOf(value as (typeof STEP_ORDER)[number]);
        if (to < 0) return `"${value}" is not a handover step state (${STEP_ORDER.join(", ")})`;
        return to < STEP_ORDER.indexOf(step.state) ? `${step.title} is already ${step.state}; steps only move forward` : null;
      };
    }
    case "leave": {
      const leaves = leaveRecords(await tx.select().from(t.leave).where(eq(t.leave.personId, authorId)));
      return (value) => {
        const extracted = parseLeave(value, authorId);
        if (!extracted) return "leave reads start/end, for example 2026-10-26/2026-10-30";
        const r = acceptExtractedLeave(extracted, leaves);
        return r.kind === "refused" ? r.reason : null;
      };
    }
  }
}

function workItemRecordOf(row: typeof t.workItems.$inferSelect): WorkItemRecord {
  return { id: row.id, projectId: row.projectId, ownerId: row.ownerId, state: row.state, dueDate: row.dueDate, blockedNote: row.blockedNote, blockedLinks: row.blockedLinks };
}

function milestoneRecordOf(row: typeof t.milestones.$inferSelect): MilestoneRecord {
  return { id: row.id, projectId: row.projectId, ownerId: row.ownerId, state: row.state, targetDate: row.targetDate, forecastDate: row.forecastDate };
}

// ---- routeExtraction (M14) ----

export type RouteTo = { projectId: string } | "keep_private";

function routeOf(draft: ExtractedItemDraft): Route {
  return { state: draft.routing, scope: draft.scope, projectId: draft.projectId, options: draft.options ?? [], reason: draft.routingReason };
}

async function authorOf(tx: Tx, personId: string): Promise<{ author: Author; world: World }> {
  const [world, orgTags] = await Promise.all([loadWorld(tx), orgTagsOf(tx, personId)]);
  return { author: { personId, orgTags }, world };
}

/** The project an update's record or a same-as entry lives in, for check 10. */
async function targetProjectOf(tx: Tx, draft: ExtractedItemDraft): Promise<string | null> {
  const { target, braid } = draft;
  if (draft.kind !== "update") {
    if (!braid?.matchEntryId) return null;
    const [entry] = await tx.select({ projectId: t.braidEntries.projectId }).from(t.braidEntries).where(eq(t.braidEntries.id, braid.matchEntryId));
    return entry?.projectId ?? null;
  }
  if (!target) return null;
  if (target.type === "work_item") return (await tx.select({ p: t.workItems.projectId }).from(t.workItems).where(eq(t.workItems.id, target.id)))[0]?.p ?? null;
  if (target.type === "milestone") return (await tx.select({ p: t.milestones.projectId }).from(t.milestones).where(eq(t.milestones.id, target.id)))[0]?.p ?? null;
  if (target.type === "handover") {
    const [row] = await tx
      .select({ p: t.handovers.projectId })
      .from(t.handoverSteps)
      .innerJoin(t.handovers, eq(t.handovers.id, t.handoverSteps.handoverId))
      .where(eq(t.handoverSteps.id, target.id));
    return row?.p ?? null;
  }
  return null;
}

/**
 * The author moves an item to another of their projects, picks one, files it, or keeps it private.
 * Every move into a project re-runs checks 9 to 11 against memberships and records as they are now.
 */
export function routeExtraction(ctx: CommandCtx, extractionId: string, to: RouteTo): Promise<ExtractedItem> {
  return runCommand(ctx, async (tx) => {
    const { row, item } = await reviewing(tx, extractionId, ctx.actorId);
    if (!(OPEN_ITEM_STATES as readonly ItemState[]).includes(item.state)) throw new CommandRefused(`this item is ${item.state}`);
    const { author, world } = await authorOf(tx, ctx.actorId);
    const draft = item.draft;
    const route = routeOf(draft);
    const event: RoutingEvent =
      to === "keep_private"
        ? { type: "KEEP_PRIVATE" }
        : route.state === "routed"
          ? { type: "MOVE", projectId: to.projectId }
          : route.state === "choose_project"
            ? { type: "PICK", projectId: to.projectId }
            : { type: "FILE", projectId: to.projectId };
    const targetProjectId = await targetProjectOf(tx, draft);
    // A related_to link points at an entry, not at a record, so it never pins the project
    const pinned = draft.kind === "braid_new" ? null : targetProjectId;
    const r = applyRouting(route, event, author, world, { kind: draft.kind, targetProjectId: pinned });
    const outcome = moved(r.outcome);
    const name = (id: string | null) => world.projects.find((p) => p.id === id)?.name ?? "that project";
    // Check 10 (E74): this slice has no "pick a target" step yet, so the move is refused with the way out
    if (r.recheck === "pick_target") {
      throw new CommandRefused(`that record is in ${name(targetProjectId)}; pick a record in ${name(r.route.projectId)} or report it as a BRAID item instead`);
    }
    if (r.recheck === "rematch") throw new CommandRefused(`that entry is on ${name(targetProjectId)}'s log; a same-as report can only join it there`);
    if (draft.braid && r.route.projectId !== null) {
      const role = actorIn(ctx.actorId, r.route.projectId, world.memberships).role;
      if (role && !mayReport(role, draft.braid.kind)) throw new CommandRefused(`on ${name(r.route.projectId)}, a ${role} may not report a ${draft.braid.kind}`);
    }

    const { options: _options, ...rest } = draft;
    const next: ExtractedItemDraft = { ...rest, projectId: r.route.projectId, routing: r.route.state, routingReason: r.route.reason };
    if (r.route.state === "choose_project") next.options = [...r.route.options];
    if (next.braid?.match === "related_to" && targetProjectId !== r.route.projectId) {
      // Links never cross projects: in its new project the report starts as a new entry
      const { seenState: _seen, ...braid } = next.braid;
      next.braid = { ...braid, match: "new", matchEntryId: null };
    }
    const after: ExtractedItem = { ...item, draft: next };
    await persistItems(tx, [item], [after], new Map([[row.id, row.version]]), ctx.now);
    await audit(tx, ctx.now, {
      actorType: "person",
      actorId: ctx.actorId,
      action: outcome.event,
      machine: "routing",
      subjectType: "extraction",
      subjectId: item.id,
      fromState: outcome.from,
      toState: outcome.to,
      captureId: row.captureId,
      extractionId: item.id,
      detail: { fromProject: draft.projectId, toProject: next.projectId, reason: next.routingReason },
    });
    return after;
  });
}

// ---- saveCapture (M2 SAVE, M4 Apply) ----

export type SaveResult =
  | { outcome: "conflict"; conflicts: SaveConflict[]; withdrawn: string[] }
  | {
      outcome: "saved";
      applied: string[];
      noChange: string[];
      keptPrivate: string[];
      withdrawn: string[];
      /** Every project a write or a BRAID report touched; each was evaluated once. */
      projects: string[];
      evaluations: Map<string, Evaluation>;
    };

type SaveScope = {
  tx: Tx;
  now: Date;
  authorId: string;
  capture: CaptureRow;
  world: World;
  byId: Map<string, ExtractedItem>;
};

const person = (id: string): Actor => ({ type: "person", id });

async function recordAudit(s: SaveScope, itemId: string, entry: { action: string; machine: string; subjectType: string; subjectId: string; fromState?: string | null; toState?: string | null; detail?: Record<string, unknown> }) {
  await audit(s.tx, s.now, { actorType: "person", actorId: s.authorId, captureId: s.capture.id, extractionId: itemId, ...entry });
}

/** Today's value of the field an item compares against, keyed exactly as targetKey builds it. */
async function readCurrent(tx: Tx, item: ExtractedItem, authorId: string): Promise<string | null> {
  const { target, braid, kind } = item.draft;
  const gone = (what: string): never => {
    throw new CommandRefused(`${what} no longer exists; reject item ${item.draft.ordinal} or discard the update`);
  };
  if (kind === "braid_same" && braid?.matchEntryId) {
    const [entry] = await tx.select({ state: t.braidEntries.state }).from(t.braidEntries).where(eq(t.braidEntries.id, braid.matchEntryId));
    return entry ? entry.state : gone(`"${braid.title}"`);
  }
  if (!target) throw new Error(`item ${item.id} has nothing to compare`);
  switch (target.type) {
    case "work_item": {
      const [row] = await tx.select().from(t.workItems).where(eq(t.workItems.id, target.id));
      if (!row) return gone("that issue");
      return target.field === "blocked_note" ? row.blockedNote : row.state;
    }
    case "milestone": {
      const [row] = await tx.select().from(t.milestones).where(eq(t.milestones.id, target.id));
      // No forecast means the forecast is the target (M12)
      return row ? (row.forecastDate ?? row.targetDate) : gone("that milestone");
    }
    case "handover": {
      const [row] = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, target.id));
      return row ? row.state : gone("that handover step");
    }
    case "leave": {
      // Leave is read only here: it already "has" the value when approved leave covers it (M8)
      const extracted = parseLeave(item.value, authorId);
      if (!extracted) return null;
      const leaves = leaveRecords(await tx.select().from(t.leave).where(eq(t.leave.personId, authorId)));
      return acceptExtractedLeave(extracted, leaves).kind === "no_change" ? item.value : null;
    }
  }
}

/** Runs one planned write through its record's machine, with the author as actor. Returns the project it touched. */
async function applyWrite(s: SaveScope, w: PlannedWrite): Promise<string | null> {
  const { tx, now } = s;
  const item = s.byId.get(w.itemId)!;
  switch (w.target.type) {
    case "work_item": {
      const [row] = await tx.select().from(t.workItems).where(eq(t.workItems.id, w.target.id));
      const label = row.number ?? row.title;
      let event: WorkItemEvent | null;
      if (w.target.field === "blocked_note") event = { type: "UPDATE_BLOCKED_NOTE", note: w.value };
      else if (!SETTABLE_WORK_STATES.includes(w.value)) event = null;
      else event = workItemEventTo(row.state, w.value as WorkItemState, item.draft.target?.note ?? "");
      if (!event) throw new CommandRefused(`${label} cannot go from ${row.state} to ${w.value}`);
      const r = applyWorkItem(workItemRecordOf(row), event, actorIn(s.authorId, row.projectId, s.world.memberships));
      if (!r.outcome.ok) throw new CommandRefused(`${label}: ${r.outcome.reason}`);
      const rows = await tx
        .update(t.workItems)
        .set({ state: r.record.state, blockedNote: r.record.blockedNote, blockedLinks: [...r.record.blockedLinks], version: nextVersion(t.workItems.version), updatedAt: now })
        .where(and(eq(t.workItems.id, row.id), eq(t.workItems.version, row.version)))
        .returning({ id: t.workItems.id });
      expectOne(rows, `work item ${row.id}`);
      await recordAudit(s, item.id, {
        action: event.type,
        machine: "work_item",
        subjectType: "work_item",
        subjectId: row.id,
        fromState: r.outcome.from,
        toState: r.outcome.to,
        detail: { field: w.target.field, value: w.value, ...(r.record.blockedNote ? { note: r.record.blockedNote } : {}) },
      });
      return row.projectId;
    }
    case "milestone": {
      const [row] = await tx.select().from(t.milestones).where(eq(t.milestones.id, w.target.id));
      const r = applyMilestone(milestoneRecordOf(row), { type: "FORECAST_CHANGED", forecast: w.value }, actorIn(s.authorId, row.projectId, s.world.memberships));
      if (!r.outcome.ok) throw new CommandRefused(`${row.name}: ${r.outcome.reason}`);
      const rows = await tx
        .update(t.milestones)
        .set({ state: r.record.state, forecastDate: r.record.forecastDate, version: nextVersion(t.milestones.version), updatedAt: now })
        .where(and(eq(t.milestones.id, row.id), eq(t.milestones.version, row.version)))
        .returning({ id: t.milestones.id });
      expectOne(rows, `milestone ${row.id}`);
      await recordAudit(s, item.id, {
        action: "FORECAST_CHANGED",
        machine: "milestone",
        subjectType: "milestone",
        subjectId: row.id,
        fromState: r.outcome.from,
        toState: r.outcome.to,
        detail: { forecast: { from: row.forecastDate ?? row.targetDate, to: r.record.forecastDate } },
      });
      return row.projectId;
    }
    case "handover": {
      const [step] = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.id, w.target.id));
      const [handover] = await tx.select().from(t.handovers).where(eq(t.handovers.id, step.handoverId));
      const steps = await tx.select().from(t.handoverSteps).where(eq(t.handoverSteps.handoverId, handover.id));
      const to = STEP_ORDER.indexOf(w.value as (typeof STEP_ORDER)[number]);
      if (to < 0 || to < STEP_ORDER.indexOf(step.state)) throw new CommandRefused(`${step.title} cannot go from ${step.state} to ${w.value}`);
      const rows = await tx
        .update(t.handoverSteps)
        .set({ state: STEP_ORDER[to], version: nextVersion(t.handoverSteps.version), updatedAt: now })
        .where(and(eq(t.handoverSteps.id, step.id), eq(t.handoverSteps.version, step.version)))
        .returning({ id: t.handoverSteps.id });
      expectOne(rows, `handover step ${step.id}`);
      await recordAudit(s, item.id, { action: "STEP_CHANGED", machine: "handover_step", subjectType: "handover_step", subjectId: step.id, fromState: step.state, toState: STEP_ORDER[to] });
      // "k of m" is the steps handed over, so only handing a step over moves the handover itself
      if (STEP_ORDER[to] === "handed_over" && step.state !== "handed_over") {
        const done = steps.filter((x) => x.state === "handed_over").length;
        const record: HandoverRecord = { ...handover, stepsDone: done, stepsTotal: steps.length };
        const r = applyHandover(record, { type: "STEPS_DONE", done: done + 1 });
        if (!r.outcome.ok) throw new CommandRefused(`${handover.title}: ${r.outcome.reason}`);
        const moved = await tx
          .update(t.handovers)
          .set({ state: r.record.state, version: nextVersion(t.handovers.version), updatedAt: now })
          .where(and(eq(t.handovers.id, handover.id), eq(t.handovers.version, handover.version)))
          .returning({ id: t.handovers.id });
        expectOne(moved, `handover ${handover.id}`);
        await recordAudit(s, item.id, {
          action: "STEPS_DONE",
          machine: "handover",
          subjectType: "handover",
          subjectId: handover.id,
          fromState: r.outcome.from,
          toState: r.outcome.to,
          detail: { done: r.record.stepsDone, total: r.record.stepsTotal },
        });
      }
      return handover.projectId;
    }
    case "leave": {
      const extracted = parseLeave(w.value, s.authorId);
      if (!extracted) throw new CommandRefused("leave needs real dates");
      const leaves = leaveRecords(await tx.select().from(t.leave).where(eq(t.leave.personId, s.authorId)));
      const r = acceptExtractedLeave(extracted, leaves);
      if (r.kind === "refused") throw new CommandRefused(r.reason);
      if (r.kind === "request") {
        // M8: a capture only ever asks for leave; approving it is someone else's act
        const id = `lv-${item.id}`;
        await tx.insert(t.leave).values({ id, personId: r.request.personId, startDate: r.request.start, endDate: r.request.end, state: r.request.state, createdAt: now, updatedAt: now });
        await recordAudit(s, item.id, { action: "REQUESTED", machine: "leave", subjectType: "leave", subjectId: id, toState: "requested", detail: { start: r.request.start, end: r.request.end } });
      }
      return null; // personal: no project is touched
    }
  }
}

/** Saves the BRAID reports of one project onto its log (M15 REPORT, ADD_SOURCE through M16 saveMatch). */
async function applyBraid(s: SaveScope, projectId: string, intents: { itemId: string; event: "REPORT" | "ADD_SOURCE"; title: string }[]) {
  const { log: before, versions } = await loadBraidLog(s.tx, projectId);
  const actor: BraidActor = { id: s.authorId, role: actorIn(s.authorId, projectId, s.world.memberships).role };
  const today = todayOf(s.now);
  const sourceItems = new Map<string, string>();
  const audits: Parameters<typeof recordAudit>[] = [];
  let log: BraidLog = before;
  for (const b of intents) {
    const item = s.byId.get(b.itemId)!;
    const braid = item.draft.braid!;
    const state: MatchState = b.event === "ADD_SOURCE" ? "same_as" : braid.match === "related_to" ? "related_to" : "new";
    // The author confirmed this match when they accepted the item (or left it ready and saved)
    const match: MatchRecord = {
      itemId: item.id,
      projectId,
      kind: braid.kind,
      speakerId: s.authorId,
      state,
      entryId: state === "new" ? null : braid.matchEntryId,
      confirmed: true,
      seen: state === "same_as" ? (item.saw as BraidEntryState | null) : null,
      conflictsWith: [],
      savedTo: null,
    };
    const source: BraidSource = { id: `src-${item.id}`, personId: s.authorId, captureId: s.capture.id, span: item.draft.spans[0] ?? null, at: s.capture.messageAt.toISOString() };
    const r = saveMatch(match, log, { newEntryId: `br-${item.id}`, title: b.title, ownerId: null, source }, { actor, today });
    if (!r.ok) throw new CommandRefused(r.outcome === "conflict" ? `"${braid.title}" changed since you saw it (now ${r.now})` : `"${braid.title}": ${r.reason}`);
    const from = r.outcome === "created" ? "none" : log[r.entryId].state;
    log = r.log;
    sourceItems.set(source.id, item.id);
    audits.push([
      s,
      item.id,
      {
        action: b.event,
        machine: "braid_entry",
        subjectType: "braid_entry",
        subjectId: r.entryId,
        fromState: from,
        toState: log[r.entryId].state,
        detail: { kind: braid.kind, title: log[r.entryId].title, sources: log[r.entryId].sources.length },
      },
    ]);
  }
  await persistBraidLog(s.tx, before, log, versions, s.now, { extractionIdBySource: sourceItems });
  for (const a of audits) await recordAudit(...a);
}

/**
 * Save (L16). One transaction across every project the items are routed to: either every confirmed
 * item is applied or, on any conflict, none is and the review reopens with both values shown.
 */
export function saveCapture(ctx: CommandCtx, captureId: string): Promise<SaveResult> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await ownCapture(tx, captureId, ctx.actorId);
    // E3: the second session sees when the first one saved; nothing is applied twice
    if (record.state === "saved") throw new CommandRefused(`already saved at ${clock(row.updatedAt)}; nothing was applied twice`);
    const authorId = row.authorId;
    const by = person(authorId);
    const [{ items: loaded, versions }, { author, world }] = await Promise.all([loadItems(tx, captureId), authorOf(tx, authorId)]);
    const isMember = (projectId: string) => isCandidate(authorId, author.orgTags, projectId, world);
    let items = loaded;
    const itemMoves: { item: ExtractedItem; outcome: Moved<ItemState>; detail?: Record<string, unknown> }[] = [];
    const withdraw = (id: string, because: WithdrawReason, detail: Record<string, unknown>) => {
      items = items.map((i) => {
        if (i.id !== id) return i;
        const r = moveItem(i, { type: "WITHDRAW", because });
        itemMoves.push({ item: r.item, outcome: r.outcome, detail: { because, ...detail } });
        return r.item;
      });
    };

    // G1, E77: items routed to a project the author is no longer a candidate for are withdrawn; the rest saves
    const open = items.filter((i) => (OPEN_ITEM_STATES as readonly ItemState[]).includes(i.state));
    const routing = planRoutingAtSave(open.map((i) => ({ ordinal: i.draft.ordinal, route: routeOf(i.draft) })), author, world);
    if (routing.ok) {
      for (const w of routing.withdrawn) withdraw(open.find((i) => i.draft.ordinal === w.ordinal)!.id, "left_project", { projectId: w.projectId });
    }

    const saving = moveCapture(record, { type: "SAVE" }, { authorActive: await isActive(tx, authorId), items, isMember });
    const captureMoves: Moved<CaptureState>[] = [saving.outcome];

    // D2, E26: a target cancelled since the author last saw it withdraws the item rather than conflicting
    for (const item of items.filter(isReady)) {
      const target = item.draft.target;
      if (target?.type !== "work_item" || item.saw === "cancelled") continue;
      const [wi] = await tx.select({ state: t.workItems.state }).from(t.workItems).where(eq(t.workItems.id, target.id));
      if (wi?.state === "cancelled") withdraw(item.id, "target_cancelled", { workItemId: target.id });
    }

    const current: Record<string, string | null> = {};
    for (const item of items.filter(isReady)) {
      const key = targetKey(item);
      if (key !== null && !(key in current)) current[key] = await readCurrent(tx, item, authorId);
    }
    const plan = planSave(saving.record, items, current);
    if (plan.outcome === "refused") throw new CommandRefused(plan.reason);
    const finish = saveOutcome(plan)!;
    const settled = settleItems(items, plan);
    const finished = moveCapture(saving.record, finish);
    captureMoves.push(finished.outcome);

    const writeAll = async (extra: (s: SaveScope) => Promise<void>) => {
      const s: SaveScope = { tx, now: ctx.now, authorId, capture: row, world, byId: new Map(items.map((i) => [i.id, i])) };
      await extra(s);
      const final = settled.map((i) => (i.state === "conflict" && i.conflict ? { ...i, conflict: { ...i.conflict, reason: conflictReason(i) } } : i));
      await persistItems(tx, loaded, final, versions, ctx.now);
      for (const m of itemMoves) await auditItem(tx, ctx.now, captureId, m.item, m.outcome, by, m.detail);
      for (const i of final) {
        const was = items.find((x) => x.id === i.id)!;
        if (was.state === i.state) continue;
        const event = i.state === "conflict" ? "CONFLICT" : i.state === "no_change" ? "ALREADY_TRUE" : "APPLIED";
        await auditItem(tx, ctx.now, captureId, i, { ok: true, machine: "extracted_item", event, from: was.state, to: i.state }, by, i.conflict ? { saw: i.saw, current: i.conflict.current } : undefined);
      }
      await persistCapture(tx, captureId, row.version, finished.record, ctx.now);
      for (const m of captureMoves) await auditCapture(tx, ctx.now, captureId, m, by);
    };

    // All or nothing (S3, E24, E83): a conflict writes the items and the capture, nothing else
    if (plan.outcome === "conflict") {
      await writeAll(async () => {});
      return { outcome: "conflict", conflicts: plan.conflicts, withdrawn: itemMoves.map((m) => m.item.id) };
    }

    const touched = new Set<string>();
    await writeAll(async (s) => {
      // E27: any record machine that refuses throws, and the whole transaction rolls back
      for (const w of plan.writes) {
        const projectId = await applyWrite(s, w);
        if (projectId) touched.add(projectId);
      }
      const byProject = new Map<string, { itemId: string; event: "REPORT" | "ADD_SOURCE"; title: string }[]>();
      for (const b of plan.braid) byProject.set(b.projectId, [...(byProject.get(b.projectId) ?? []), b]);
      for (const [projectId, intents] of [...byProject].sort(([a], [b]) => a.localeCompare(b))) {
        await applyBraid(s, projectId, intents);
        touched.add(projectId);
      }
    });
    await syncReminder(tx, ctx.now, authorId, captureId, false, true);
    // Rules run after the change, as the author, so items their own save resolved close as acted
    const evaluations = await evaluateProjects(tx, touched, ctx.now, { actorId: authorId });
    return {
      outcome: "saved",
      applied: settled.filter((i) => i.state === "applied" && loaded.find((l) => l.id === i.id)?.state !== "applied").map((i) => i.id),
      noChange: plan.noChange,
      keptPrivate: plan.keptPrivate,
      withdrawn: itemMoves.map((m) => m.item.id),
      projects: [...touched].sort(),
      evaluations,
    };
  });
}

function conflictReason(item: ExtractedItem): string {
  const now = item.conflict?.current ?? "nothing";
  if (item.draft.kind === "braid_same") return `"${item.draft.braid?.title}" was ${item.saw ?? "new"} when Atlas read it and is now ${now}`;
  return `Atlas read "${item.saw ?? "nothing"}" but it is now "${now}"`;
}

// ---- runCaptureTimers (M2 TIMER review_reminder and review_expiry, S4, E28) ----

const HOUR_MS = 3_600_000;

/**
 * Time a capture has waited since it arrived. Office hours are not in config yet, so a working
 * hour is any hour that starts on a working day in the org time zone.
 */
export function elapsedSince(from: Date, now: Date): { workingHours: number; days: number } {
  let workingHours = 0;
  for (let at = from.getTime(); at + HOUR_MS <= now.getTime(); at += HOUR_MS) {
    if (isWorkingDay(dateInZone(new Date(at), config.timeZone))) workingHours++;
  }
  return { workingHours, days: daysBetween(dateInZone(from, config.timeZone), dateInZone(now, config.timeZone)) };
}

/**
 * Reminds the author once, then expires the review. Each capture moves at most once per run, so a
 * reminder always lands before expiry (ReminderBeforeExpiry). Expiry withdraws every open item and
 * applies nothing (NothingAfterExpiry).
 */
export function runCaptureTimers(ctx: { db: Db; now: Date }): Promise<{ reminded: string[]; expired: string[] }> {
  return runCommand({ ...ctx, actorId: "rule" }, async (tx) => {
    const waiting = await tx.select().from(t.captures).where(inArray(t.captures.state, ["proposed", "reviewing"]));
    const reminded: string[] = [];
    const expired: string[] = [];
    const rule: Actor = { type: "rule", id: null };
    for (const row of waiting) {
      const record = captureRecordOf(row);
      const r = applyCaptureEvent(record, { type: record.reminded ? "EXPIRE" : "REMIND" }, { elapsed: elapsedSince(row.receivedAt, ctx.now) });
      if (!r.outcome.ok) continue; // not due yet
      if (r.outcome.event === "EXPIRE") await withdrawAll(tx, ctx.now, row.id, "expired", rule);
      await persistCapture(tx, row.id, row.version, r.record, ctx.now);
      await auditCapture(tx, ctx.now, row.id, r.outcome, rule);
      await syncReminder(tx, ctx.now, row.authorId, row.id, r.outcome.event === "REMIND");
      (r.outcome.event === "REMIND" ? reminded : expired).push(row.id);
    }
    return { reminded, expired };
  });
}
