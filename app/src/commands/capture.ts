// The capture commands (build plan 5.1 and 5.2; machines doc M2, M3, M4, M14): a message arrives,
// Atlas's proposals pass the server checks, the author confirms them, and Save applies every
// confirmed item to every project it touches in one transaction. Records change only through
// their own machines, with the author as actor, and every move writes an audit entry (A11).
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { captureRecordOf, itemOf, leaveRecordOf, loadBraidLog, loadCapture, loadItems, loadWorld, orgTagsOf, persistBraidLog, persistCapture, persistItems, setStatusRecordOf } from "../db/records";
import * as t from "../db/schema";
import { runChecks } from "../domain/atlas-checks/checks";
import type { CheckContext, DroppedProposal, RawProposal } from "../domain/atlas-checks/types";
import { planSave, saveOutcome, settleItems, targetKey, type BraidIntent, type PlannedWrite, type SaveConflict } from "../domain/capture-save";
import { config } from "../domain/config";
import { dateInZone, daysBetween, isIsoDate, isWorkingDay } from "../domain/dates";
import type { Moved } from "../domain/machine";
import { applyToLog, withFollowUp, type BraidActor, type BraidEntryState, type BraidEvent, type BraidLog, type BraidSource } from "../domain/machines/braid-entry";
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
import { applyConversationEvent, autoTitle, draftConversation, type ConversationRecord, type ConversationState } from "../domain/machines/conversation";
import { applyHandover, applyStep, STEP_STATES, type HandoverRecord, type StepState } from "../domain/machines/handover";
import { evaluateCause } from "../domain/machines/inbox-item";
import { acceptExtractedLeave, changeLeave, fitLeave, type ExtractedLeave, type LeaveRecord } from "../domain/machines/leave";
import { redirectReport, saveMatch, type MatchRecord } from "../domain/machines/match";
import { actorIn, isCandidate, type World } from "../domain/machines/membership";
import { applyMilestone, type MilestoneRecord } from "../domain/machines/milestone";
import { applyWorkItem, workItemEventTo, type WorkItemEvent, type WorkItemRecord } from "../domain/machines/work-item";
import { mayReport, mayResolve } from "../domain/rights";
import { applyRouting, planRoutingAtSave, type Author, type Route, type RoutingEvent } from "../domain/routing";
import { checkQuestion, type Answer, type AskedQuestion, type RawQuestion } from "../domain/question";
import { topicById } from "../domain/topics";
import type { Confidence, ExtractedItemDraft, MatchState } from "../domain/shared";
import type { WorkItemState } from "../domain/status/rules";
import { answerFor } from "../queries/answer";
import { correctionParts } from "../queries/answers/correction";
import { loadCheckContext } from "../queries/check-context";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, todayOf, type CommandCtx } from "./core";
import { evaluateProjects, type Evaluation } from "./evaluate";
import { ownsBlockedWork } from "./braid";
import { logCandidate } from "./learning";
import { syncLeaveImpact } from "./leave";
import { noticeReporters } from "./notices";
import { noteBefore, toldBy, toldOfLeave, undoInTx, writeReceipt, type Receipt } from "./undo";
import { proposeFromMoves, proposeVocabularyChange } from "./vocabulary";

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
  /** Section 16, app only: the conversation it continues; none starts a new one. */
  conversationId?: string | null;
  /** Section 16, Atlas only: the Atlas chat it came from; the direct chat ("dm") when not given. */
  atlasChatId?: string | null;
};

export type Created = { captureId: string; duplicate: boolean; conversationId: string | null };

/** Stores a message as received. A repeat of one already received (same dedup key) is dropped and changes nothing (E1). */
export function createCapture(ctx: CommandCtx, input: NewCapture): Promise<Created> {
  return runCommand(ctx, async (tx) => {
    // D14: Atlas always sends its message id; without it a resend could not be told from a new message
    if (input.channel === "atlas" && !input.messageId) throw new CommandRefused("a message from Atlas needs its message id");
    const dedupKey = captureDedupKey({ channel: input.channel, author: ctx.actorId, text: input.text, sentAt: input.messageAt, messageId: input.messageId });
    const seen = await tx
      .select({ id: t.captures.id, dedupKey: t.captures.dedupKey, conversationId: t.captures.conversationId })
      .from(t.captures)
      .where(eq(t.captures.dedupKey, dedupKey));
    const received = receiveCapture({ dedupKey, kind: input.kind }, new Set(seen.map((s) => s.dedupKey)));
    // CV5: the same message again is one capture, in the conversation it is already in
    if (!received.ok) return { captureId: seen[0].id, duplicate: true, conversationId: seen[0].conversationId };
    const conversationId = await conversationFor(tx, ctx, input);
    const id = `cap-${randomUUID()}`;
    await tx.insert(t.captures).values({
      id,
      authorId: ctx.actorId,
      conversationId,
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
      detail: { channel: input.channel, authorId: ctx.actorId, conversationId },
    });
    return { captureId: id, duplicate: false, conversationId };
  });
}

/**
 * Section 16: the conversation a new message goes into. An Atlas app message goes to its author's Atlas
 * conversation (CV4); an app message continues the one named (CV2: only the sender's own) or starts one
 * (CV1). Sending to an archived conversation brings it back (CV3).
 */
async function conversationFor(tx: Tx, ctx: CommandCtx, input: NewCapture): Promise<string> {
  let row: typeof t.conversations.$inferSelect | undefined;
  if (input.channel === "atlas") {
    const chat = input.atlasChatId ?? "dm";
    [row] = await tx
      .select()
      .from(t.conversations)
      .where(and(eq(t.conversations.ownerId, ctx.actorId), eq(t.conversations.channel, "atlas"), eq(t.conversations.atlasChatId, chat)));
    if (!row) return startConversation(tx, ctx, draftConversation({ id: `conv-${randomUUID()}`, ownerId: ctx.actorId, channel: "atlas", atlasChatId: chat, title: chat === "dm" ? "Atlas" : "Atlas chat" }), input);
  } else if (input.conversationId) {
    [row] = await tx.select().from(t.conversations).where(eq(t.conversations.id, input.conversationId));
    // CV2: someone else's conversation reads exactly like one that does not exist (P10)
    if (!row || row.ownerId !== ctx.actorId) throw new CommandRefused(`no conversation ${input.conversationId}`, "not_found");
  } else {
    return startConversation(tx, ctx, draftConversation({ id: `conv-${randomUUID()}`, ownerId: ctx.actorId, channel: "app" }), input);
  }
  const r = applyConversationEvent(conversationOf(row), { type: "MESSAGE" }, ctx.actorId);
  const moved_ = moved(r.outcome);
  const lastMessageAt = row.lastMessageAt > input.messageAt ? row.lastMessageAt : input.messageAt;
  const rows = await tx
    .update(t.conversations)
    .set({ state: r.record.state, lastMessageAt, version: nextVersion(t.conversations.version), updatedAt: ctx.now })
    .where(and(eq(t.conversations.id, row.id), eq(t.conversations.version, row.version)))
    .returning({ id: t.conversations.id });
  expectOne(rows, `conversation ${row.id}`);
  if (moved_.from !== moved_.to) await auditConversation(tx, ctx, row.id, moved_);
  return row.id;
}

async function startConversation(tx: Tx, ctx: CommandCtx, draft: ConversationRecord, input: NewCapture): Promise<string> {
  const r = applyConversationEvent(draft, { type: "FIRST_MESSAGE", text: input.text }, ctx.actorId);
  const outcome = moved(r.outcome);
  const c = r.record;
  await tx.insert(t.conversations).values({ id: c.id, ownerId: c.ownerId, state: c.state, title: c.title || autoTitle(input.text, input.kind), titleBy: c.titleBy, channel: c.channel, atlasChatId: c.atlasChatId, lastMessageAt: input.messageAt, createdAt: ctx.now, updatedAt: ctx.now });
  await auditConversation(tx, ctx, c.id, outcome);
  return c.id;
}

export function conversationOf(row: typeof t.conversations.$inferSelect): ConversationRecord {
  return { id: row.id, ownerId: row.ownerId, state: row.state, title: row.title, titleBy: row.titleBy, channel: row.channel, atlasChatId: row.atlasChatId };
}

export function auditConversation(tx: Tx, ctx: CommandCtx, id: string, outcome: Moved<ConversationState>, detail: Record<string, unknown> = {}) {
  return audit(tx, ctx.now, {
    actorType: "person",
    actorId: ctx.actorId,
    action: outcome.event,
    machine: "conversation",
    subjectType: "conversation",
    subjectId: id,
    fromState: outcome.from,
    toState: outcome.to,
    detail,
  });
}

// ---- The Atlas step (build plan 5.1 steps 2 to 5) ----
// A read is short transactions around each slow call, so no database transaction waits on a model:
// beginRead (to transcribing or reading), then finishTranscribe or failTranscribe for a voice note,
// then proposeItems or failRead. Each step names the attempt it belongs to (beginRead's `tries`):
// when the stale timer or another worker has moved on, a late answer is dropped (D19).

/** A late answer: the capture moved on since this attempt started. Nothing changed. */
export class ReadSuperseded extends CommandRefused {
  constructor(captureId: string) {
    super(`capture ${captureId} moved on since this attempt started; its answer is dropped`);
    this.name = "ReadSuperseded";
  }
}

export type ReadStarted = {
  state: CaptureState;
  tries: number;
  /** reading: what the extractor is given. */
  context: CheckContext | null;
  /** transcribing: what Atlas sent with the voice note (its transcript, possibly empty). */
  voice: { text: string; confidence: Confidence | null } | null;
};

const atlasActor: Actor = { type: "atlas", id: null };

async function readContextOf(tx: Tx, row: CaptureRow, record: CaptureRecord): Promise<CheckContext> {
  return loadCheckContext(tx, { authorId: row.authorId, text: row.text, messageAt: row.messageAt, transcriptConfidence: record.transcriptConfidence, captureId: row.id });
}

/** The capture as this attempt left it, or ReadSuperseded when it has moved on. */
async function attemptOf(tx: Tx, captureId: string, attempt: number, state: CaptureState) {
  const c = await captureOf(tx, captureId);
  if (c.record.state !== state || c.record.tries !== attempt) throw new ReadSuperseded(captureId);
  return c;
}

/**
 * Starts the next try: the first (START) or the next one after a failure (RETRY). After
 * config.captureMaxTries the capture fails instead (E18, D1) and both `context` and `voice` are null.
 */
export function beginRead(ctx: CommandCtx, captureId: string): Promise<ReadStarted> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await captureOf(tx, captureId);
    const waiting = record.state === "retry_wait" || record.state === "transcribe_wait";
    const r = moveCapture(record, { type: waiting ? "RETRY" : "START" });
    await persistCapture(tx, captureId, row.version, r.record, ctx.now);
    await auditCapture(tx, ctx.now, captureId, r.outcome, atlasActor, { tries: r.record.tries, ...(r.record.failedStep ? { failedStep: r.record.failedStep } : {}) });
    return {
      state: r.record.state,
      tries: r.record.tries,
      context: r.record.state === "reading" ? await readContextOf(tx, row, r.record) : null,
      voice: r.record.state === "transcribing" ? { text: row.text, confidence: row.transcriptConfidence } : null,
    };
  });
}

/** The voice note has a transcript: on to reading (TRANSCRIBED). Returns what the extractor is given. */
export function finishTranscribe(ctx: CommandCtx, captureId: string, attempt: number, confidence: Confidence): Promise<CheckContext> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await attemptOf(tx, captureId, attempt, "transcribing");
    const r = moveCapture(record, { type: "TRANSCRIBED", confidence });
    await persistCapture(tx, captureId, row.version, r.record, ctx.now);
    await auditCapture(tx, ctx.now, captureId, r.outcome, atlasActor, { confidence });
    return readContextOf(tx, row, r.record);
  });
}

/** D1: no transcript this time; wait, then try again. */
export function failTranscribe(ctx: CommandCtx, captureId: string, attempt: number, why: "no_transcript" | "timeout" | "error", message: string): Promise<CaptureState> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await attemptOf(tx, captureId, attempt, "transcribing");
    const r = moveCapture(record, { type: "TRANSCRIBE_FAILED", why });
    await persistCapture(tx, captureId, row.version, r.record, ctx.now);
    await auditCapture(tx, ctx.now, captureId, r.outcome, atlasActor, { why, tries: attempt, message });
    return r.record.state;
  });
}

/** What Atlas reported about a read, kept in the audit so the model can be measured (phase 4). */
export type ReadMeta = {
  model: string;
  usage?: unknown;
  malformed?: unknown[];
  message?: string;
  attempt?: number;
  /** Section 15: what Atlas says the message asks; checked here like the proposals. */
  question?: RawQuestion | null;
  /** Section 17: Atlas will word the answer next; until then it is pending. */
  wordWithAtlas?: boolean;
};

/** The model failed, timed out or sent something unreadable: wait, then try again (E18, E19). */
export function failRead(ctx: CommandCtx, captureId: string, why: "model_error" | "timeout" | "bad_output", meta: ReadMeta & { attempt: number }): Promise<CaptureState> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await attemptOf(tx, captureId, meta.attempt, "reading");
    const r = moveCapture(record, { type: "READ_FAILED", why });
    await persistCapture(tx, captureId, row.version, r.record, ctx.now);
    await auditCapture(tx, ctx.now, captureId, r.outcome, atlasActor, { why, tries: record.tries, ...meta });
    return r.record.state;
  });
}

export type Proposed = { state: CaptureState; items: ExtractedItem[]; dropped: DroppedProposal[]; moreFound: boolean; answer?: Answer | null };

/**
 * Runs the server checks on what Atlas returned and stores the items that pass. Atlas is the actor;
 * nothing here changes a project. The checks read the database again here, so a record that changed
 * while the model was reading is checked as it is now. A received capture is started first, which
 * is how tests and the story feed recorded proposals in one step.
 */
export function proposeItems(ctx: CommandCtx, captureId: string, proposals: readonly RawProposal[], meta?: ReadMeta): Promise<Proposed> {
  return runCommand(ctx, async (tx) => {
    // A read names its attempt; recorded proposals (tests, the seed) start a received capture here
    const { row, record: received } = meta?.attempt !== undefined ? await attemptOf(tx, captureId, meta.attempt, "reading") : await captureOf(tx, captureId);
    const atlas = atlasActor;
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

    const checkCtx = await loadCheckContext(tx, { authorId: row.authorId, text: row.text, messageAt: row.messageAt, transcriptConfidence: record.transcriptConfidence, captureId: row.id });
    const checked = runChecks(proposals, checkCtx);
    const { kept, more } = capProposals(checked.items);
    const capped = checked.dropped.filter((d) => d.check === "cap").length;
    const items = kept.map((draft) => startItem(`${captureId}-${draft.ordinal}`, draft, { maxConfidence: confidenceCap(record) }));
    const asked = checkQuestion(meta?.question, checkCtx);
    step({ type: "PROPOSALS_READY", count: items.length + more + capped, asked: asked !== null });

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
    // CV10: a correction withdraws the earlier unsaved item it replaces; the checks kept only such links
    for (const item of items.filter((i) => i.draft.replaces)) {
      const replaced = item.draft.replaces!;
      const [old] = await tx.select({ captureId: t.extractions.captureId }).from(t.extractions).where(eq(t.extractions.id, replaced));
      if (!old) continue;
      const { items: before, versions } = await loadItems(tx, old.captureId);
      const target = before.find((i) => i.id === replaced);
      if (!target) continue;
      const r = applyItemEvent(target, { type: "WITHDRAW", because: "replaced" });
      if (!r.outcome.ok) continue;
      await persistItems(tx, before, before.map((i) => (i.id === replaced ? r.item : i)), versions, ctx.now);
      await audit(tx, ctx.now, {
        actorType: "atlas",
        action: "WITHDRAW",
        machine: "extracted_item",
        subjectType: "extraction",
        subjectId: replaced,
        fromState: r.outcome.from,
        toState: r.outcome.to,
        captureId: old.captureId,
        extractionId: replaced,
        detail: { because: "replaced", by: item.id },
      });
    }
    // Phase L: "Undo that" and a correction are the asker's own commands; they run now, as the asker
    const question = asked ? await actOn(tx, ctx.now, row.authorId, captureId, asked) : null;
    // Section 15: the answer is read from the asker's own data now, and kept with the message (QA10)
    const found = question ? await answerFor(tx, row.authorId, question, ctx.now) : null;
    // Section 18: small talk has no facts to word, so DPM's reply stands at once
    const answer = found && meta?.wordWithAtlas && topicById(found.topic).worded !== false ? { ...found, wording: "pending" as const, rulesText: found.text } : found;
    if (question) await tx.update(t.captures).set({ question, answer }).where(eq(t.captures.id, captureId));
    // Phase S: an answer DPM could not give is a candidate for the eval set, with the asker's OK (LF1).
    // The words are the asker's; Atlas's job found it, so the audit says Atlas
    if (asked && answer && (asked.topic === "other" || asked.topic === "unclear")) {
      const detail = { topic: asked.topic, answer: answer.rulesText ?? answer.text };
      await logCandidate(tx, ctx.now, row.authorId, { cause: asked.topic, captureId, text: row.text, detail }, { actorType: atlas.type, actorId: atlas.id });
    }
    for (const m of moves) {
      // Dropped proposals are kept with their reason so the model can be measured (phase 4)
      const detail = m.event === "PROPOSALS_READY" ? { items: items.length, moreFound: record.moreFound, dropped: checked.dropped, ...meta, question: asked } : undefined;
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
    return { state: record.state, items, dropped: checked.dropped, moreFound: record.moreFound, answer };
  });
}

/**
 * Phase L. "Undo that" (M30) runs the undo job on the asker's last save; its id goes with the question, so
 * the answer says what it did. A correction (M31) proposes each change it names to that project's PM or
 * Lead; one that cannot be proposed is left out, and the answer says how each part stands.
 */
async function actOn(tx: Tx, now: Date, authorId: string, captureId: string, asked: AskedQuestion): Promise<AskedQuestion> {
  if (asked.topic === "undo") {
    const r = await undoInTx(tx, now, authorId, { commandId: `undo-${captureId}` });
    return { ...asked, made: r.kind === "job" ? [r.job.id] : [] };
  }
  if (asked.topic === "correction" && asked.correction) {
    for (const part of correctionParts(asked.correction)) {
      try {
        await tx.transaction((sp) => proposeVocabularyChange(sp, now, { ...part, proposedBy: authorId, forId: authorId, captureId }));
      } catch (e) {
        if (!(e instanceof CommandRefused)) throw e;
      }
    }
  }
  return asked;
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

const SETTABLE_WORK_STATES: readonly string[] = ["to_do", "in_progress", "blocked", "done"];

function parseLeave(value: string | null, personId: string): ExtractedLeave | null {
  const [start, end] = (value ?? "").split("/");
  if (!start) return null;
  return { personId, start, end: !end || end === ".." ? null : end };
}

function leaveRecords(rows: (typeof t.leave.$inferSelect)[]): LeaveRecord[] {
  return rows.map(leaveRecordOf);
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
        const to = STEP_STATES.indexOf(value as (typeof STEP_STATES)[number]);
        if (to < 0) return `"${value}" is not a handover step state (${STEP_STATES.join(", ")})`;
        return to < STEP_STATES.indexOf(step.state) ? `${step.title} is already ${step.state}; steps only move forward` : null;
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

// ---- rematchExtraction (D18, M16 on review) ----

export type Rematch = { type: "different" } | { type: "pick"; entryId: string };

/**
 * D18: the author corrects Atlas's match on review. "Not the same" makes a same-as report a new
 * entry; "Pick an entry" points it at another open entry of the same kind in the same project.
 * Choosing is confirming, so the item counts as accepted.
 */
export function rematchExtraction(ctx: CommandCtx, extractionId: string, to: Rematch): Promise<ExtractedItem> {
  return runCommand(ctx, async (tx) => {
    const { row, item } = await reviewing(tx, extractionId, ctx.actorId);
    const braid = item.draft.braid;
    if (!braid || item.draft.kind === "braid_resolve") throw new CommandRefused("only a BRAID report has a match to change");
    if (!(OPEN_ITEM_STATES as readonly ItemState[]).includes(item.state) || item.state === "rejected") throw new CommandRefused(`this item is ${item.state}`);
    let draft: ExtractedItemDraft;
    let saw: string | null;
    if (to.type === "different") {
      const { seenState: _seen, ...rest } = braid;
      draft = { ...item.draft, kind: "braid_new", braid: { ...rest, match: "new", matchEntryId: null } };
      saw = null;
    } else {
      const [entry] = await tx.select().from(t.braidEntries).where(eq(t.braidEntries.id, to.entryId));
      if (!entry || entry.projectId !== item.draft.projectId) throw new CommandRefused("pick an entry on this project's log");
      if (entry.kind !== braid.kind) throw new CommandRefused(`kinds never merge: this report is a ${braid.kind}, that entry a ${entry.kind}`);
      if (["none", "merged", "withdrawn"].includes(entry.state)) throw new CommandRefused(`"${entry.title}" is ${entry.state}`);
      draft = { ...item.draft, kind: "braid_same", braid: { ...braid, title: entry.title, match: "same_as", matchEntryId: entry.id, seenState: entry.state } };
      saw = entry.state;
    }
    let next: ExtractedItem = { ...item, draft, saw, value: draft.braid!.title, touched: true, conflict: null };
    if (next.state === "pre_accepted" || next.state === "needs_ok" || next.state === "conflict") next = moveItem(next, { type: "ACCEPT" }).item;
    await persistItems(tx, [item], [next], new Map([[row.id, row.version]]), ctx.now);
    await audit(tx, ctx.now, {
      actorType: "person",
      actorId: ctx.actorId,
      action: to.type === "different" ? "MATCH_DIFFERENT" : "MATCH_PICK",
      machine: "match",
      subjectType: "extraction",
      subjectId: item.id,
      fromState: braid.match,
      toState: draft.braid!.match,
      captureId: row.captureId,
      extractionId: item.id,
      detail: { from: braid.matchEntryId, to: draft.braid!.matchEntryId },
    });
    return next;
  });
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
    const { row, item, capture } = await reviewing(tx, extractionId, ctx.actorId);
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
    // D13, E74: an update to a record stays in that record's project (G2); the review offers no Move for it
    if (r.recheck === "pick_target") {
      const what = draft.target?.type === "work_item" ? ((await tx.select({ n: t.workItems.number }).from(t.workItems).where(eq(t.workItems.id, draft.target.id)))[0]?.n ?? "That record") : "That record";
      throw new CommandRefused(`${what} is in ${name(targetProjectId)}. To log this somewhere else, add it as a BRAID item in that project`);
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
      // Phase L, CD14: the word Atlas routed it by, so moves of the same word can be counted
      detail: { fromProject: draft.projectId, toProject: next.projectId, reason: next.routingReason, ...(draft.routedBy ? { word: draft.routedBy.word } : {}) },
    });
    // Phase S: Atlas put it in the wrong project, so the update is a candidate for the eval set (LF1)
    if (outcome.event === "MOVE") {
      const detail = { kind: draft.kind, fromProject: draft.projectId, toProject: next.projectId };
      await logCandidate(tx, ctx.now, ctx.actorId, { cause: "moved", captureId: row.captureId, extractionId: item.id, text: capture.row.text, detail });
      // UN10, CD14: the second move of the same word to the same project proposes it as a correction
      if (draft.routedBy && next.projectId) {
        await proposeFromMoves(tx, ctx.now, ctx.actorId, { ...draft.routedBy, toProject: next.projectId, captureId: row.captureId });
      }
    }
    return after;
  });
}

// ---- saveCapture (M2 SAVE, M4 Apply) ----

const s0 = (items: readonly ExtractedItem[], id: string) => items.find((i) => i.id === id)!;

function savedBefore({ items }: { items: ExtractedItem[] }): SaveResult {
  const of = (state: ItemState) => items.filter((i) => i.state === state).map((i) => i.id);
  return { outcome: "saved", retried: true, applied: of("applied"), noChange: of("no_change"), keptPrivate: [], withdrawn: of("withdrawn"), projects: [], evaluations: new Map() };
}

export type SaveResult =
  /** Nothing applied: items changed since the author saw them, or (D12) their record refuses the change. */
  | { outcome: "conflict"; conflicts: SaveConflict[]; refused: { itemId: string; reason: string }[]; withdrawn: string[] }
  /** D3: every try failed on a database error. Nothing was changed; the author may press Save again. */
  | { outcome: "failed"; message: string; tries: number }
  | {
      outcome: "saved";
      /** D3: an earlier try had saved it and only the reply was lost; nothing ran again. */
      retried?: boolean;
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
  /** Blocked work and the blockers reported in the same words (M5): item id to entry ids. */
  blockLinks: Map<string, string[]>;
  /** Phase L, M30: what this save writes, with each record as it was, so "Undo that" can take it back. */
  receipt: Receipt;
};

/**
 * M5: "Still waiting on Kyle for the store feed" blocks #151 and reports the blocker, from the same
 * words. Saving links the two, so the blocker knows whose work it holds (S13, E93).
 */
function blockLinksOf(items: readonly ExtractedItem[], plan: { writes: readonly PlannedWrite[]; braid: readonly BraidIntent[] }): Map<string, string[]> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const overlaps = (a: ExtractedItem, b: ExtractedItem) => a.draft.spans.some((x) => b.draft.spans.some((y) => x.start < y.end && y.start < x.end));
  const out = new Map<string, string[]>();
  for (const w of plan.writes.filter((w) => w.target.type === "work_item" && w.target.field === "state" && w.value === "blocked")) {
    const item = byId.get(w.itemId)!;
    const entries = plan.braid
      .filter((b) => b.kind === "blocker" && b.event !== "RESOLVE" && b.projectId === item.draft.projectId && overlaps(item, byId.get(b.itemId)!))
      .map((b) => (b.event === "ADD_SOURCE" ? b.matchEntryId! : `br-${b.itemId}`));
    if (entries.length) out.set(w.itemId, entries);
  }
  return out;
}

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
  if ((kind === "braid_same" || kind === "braid_resolve") && braid?.matchEntryId) {
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
      // Leave already "has" the value when live leave, requested or approved, covers it (M8, D6)
      // A change compares against the leave's dates as they are now, so a leave that moved meanwhile is a conflict
      const extracted = parseLeave(item.value, authorId);
      if (!extracted) return null;
      const leaves = leaveRecords(await tx.select().from(t.leave).where(eq(t.leave.personId, authorId)));
      const fit = fitLeave(extracted, leaves);
      if (fit.kind === "matches") return item.value;
      if (fit.kind === "change") return `${fit.from.start}/${fit.from.end}`;
      return null;
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
      else {
        const links = s.blockLinks.get(item.id);
        event = workItemEventTo(row.state, w.value as WorkItemState, item.draft.target?.note ?? "", links ? [...new Set([...row.blockedLinks, ...links])] : undefined);
      }
      if (!event) throw new CommandRefused(`${label} cannot go from ${row.state} to ${w.value}`);
      const r = applyWorkItem(workItemRecordOf(row), event, actorIn(s.authorId, row.projectId, s.world.memberships));
      if (!r.outcome.ok) throw new CommandRefused(`${label}: ${r.outcome.reason}`);
      noteBefore(s.receipt, { type: "work_item", id: row.id, projectId: row.projectId, version: 0, before: { state: row.state, blockedNote: row.blockedNote, blockedLinks: [...row.blockedLinks] } });
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
      noteBefore(s.receipt, { type: "milestone", id: row.id, projectId: row.projectId, version: 0, before: { forecastDate: row.forecastDate } });
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
      // Phase L, rule 2: the step moves along its own arrows (handoverStepMachine), so an undo can take it back
      const stepMove = applyStep(step.state, { type: "MOVE", to: w.value as StepState });
      if (!stepMove.ok) throw new CommandRefused(`${step.title} cannot go from ${step.state} to ${w.value}`);
      noteBefore(s.receipt, { type: "handover_step", id: step.id, projectId: handover.projectId, version: 0, before: { state: step.state } });
      const rows = await tx
        .update(t.handoverSteps)
        .set({ state: stepMove.to, version: nextVersion(t.handoverSteps.version), updatedAt: now })
        .where(and(eq(t.handoverSteps.id, step.id), eq(t.handoverSteps.version, step.version)))
        .returning({ id: t.handoverSteps.id });
      expectOne(rows, `handover step ${step.id}`);
      await recordAudit(s, item.id, { action: "STEP_CHANGED", machine: "handover_step", subjectType: "handover_step", subjectId: step.id, fromState: step.state, toState: stepMove.to });
      // "k of m" is the steps handed over, so only handing a step over moves the handover itself
      if (stepMove.to === "handed_over" && step.state !== "handed_over") {
        const done = steps.filter((x) => x.state === "handed_over").length;
        const record: HandoverRecord = { ...handover, stepsDone: done, stepsTotal: steps.length };
        const r = applyHandover(record, { type: "STEPS_DONE", done: done + 1 });
        if (!r.outcome.ok) throw new CommandRefused(`${handover.title}: ${r.outcome.reason}`);
        noteBefore(s.receipt, { type: "handover", id: handover.id, projectId: handover.projectId, version: 0, before: { state: handover.state, stepsDone: done } });
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
      const rows = await tx.select().from(t.leave).where(eq(t.leave.personId, s.authorId));
      const r = acceptExtractedLeave(extracted, leaveRecords(rows));
      if (r.kind === "refused") throw new CommandRefused(r.reason);
      let leaveId: string | null = null;
      if (r.kind === "request") {
        // M8: a capture only ever asks for leave; approving it is an admin's act (D6)
        leaveId = `lv-${item.id}`;
        await tx.insert(t.leave).values({ id: leaveId, personId: r.request.personId, startDate: r.request.start, endDate: r.request.end, state: r.request.state, createdAt: now, updatedAt: now });
        await recordAudit(s, item.id, { action: "REQUESTED", machine: "leave", subjectType: "leave", subjectId: leaveId, toState: "requested", detail: { start: r.request.start, end: r.request.end } });
        noteBefore(s.receipt, { type: "leave", id: leaveId, projectId: null, version: 0, before: null });
      } else if (r.kind === "change") {
        // D6: a request just moves; approved leave keeps its dates while the change waits for an admin
        const row = rows.find((x) => x.id === r.leaveId)!;
        const next = changeLeave(leaveRecordOf(row), r.to);
        const change = row.changeStart && row.changeEnd ? { start: row.changeStart, end: row.changeEnd } : null;
        noteBefore(s.receipt, { type: "leave", id: row.id, projectId: null, version: 0, before: { start: row.startDate, end: row.endDate, change } });
        const updated = await tx
          .update(t.leave)
          .set({ startDate: next.start, endDate: next.end, changeStart: next.change?.start ?? null, changeEnd: next.change?.end ?? null, version: nextVersion(t.leave.version), updatedAt: now })
          .where(and(eq(t.leave.id, row.id), eq(t.leave.version, row.version)))
          .returning({ id: t.leave.id });
        expectOne(updated, `leave ${row.id}`);
        leaveId = row.id;
        await recordAudit(s, item.id, { action: "CHANGE_ASKED", machine: "leave", subjectType: "leave", subjectId: row.id, fromState: row.state, toState: row.state, detail: { from: { start: row.startDate, end: row.endDate }, to: r.to } });
      }
      // Phase L, M30: the leads shown its impact hear "Kemar undid this." if it is undone
      if (leaveId) s.receipt.told.push(...toldOfLeave((await syncLeaveImpact(tx, now, leaveId, { actorId: s.authorId })).opened, s.authorId, leaveId));
      return null; // personal: no project is touched
    }
  }
}

/**
 * Saves the BRAID items of one project onto its log: REPORT and ADD_SOURCE through M16 saveMatch, and
 * (D7) RESOLVE, which resolves the entry when the speaker may and otherwise proposes it to those who
 * may. D8: a report on an entry that has finished goes where redirectReport says.
 */
async function applyBraid(s: SaveScope, projectId: string, intents: readonly BraidIntent[]) {
  const { log: before, versions } = await loadBraidLog(s.tx, projectId);
  const role = actorIn(s.authorId, projectId, s.world.memberships).role;
  const actor: BraidActor = { id: s.authorId, role };
  const today = todayOf(s.now);
  const sourceItems = new Map<string, string>();
  const audits: Parameters<typeof recordAudit>[] = [];
  const resolved: string[] = [];
  let log: BraidLog = before;
  const auditOf = (item: ExtractedItem, action: string, entryId: string, from: string | null, detail: Record<string, unknown> = {}): Parameters<typeof recordAudit> => [
    s,
    item.id,
    { action, machine: "braid_entry", subjectType: "braid_entry", subjectId: entryId, fromState: from, toState: log[entryId].state, detail: { kind: log[entryId].kind, title: log[entryId].title, sources: log[entryId].sources.length, ...detail } },
  ];
  for (const b of intents) {
    const item = s.byId.get(b.itemId)!;
    const braid = item.draft.braid!;
    const source: BraidSource = { id: `src-${item.id}`, personId: s.authorId, captureId: s.capture.id, span: item.draft.spans[0] ?? null, at: s.capture.messageAt.toISOString() };

    if (b.event === "RESOLVE") {
      const entry = log[braid.matchEntryId!];
      const owns = await ownsBlockedWork(s.tx, entry, s.authorId);
      const isOwner = entry.kind === "blocker" ? owns : entry.ownerId === s.authorId;
      const may = role !== null && mayResolve({ role, isOwner }, entry.kind);
      // Section 20, U3: a risk, assumption or dependency ends as the words say when the author may decide it, else it is proposed (D7)
      const event: BraidEvent = b.outcome ? (may ? { type: "RESOLVE", outcome: b.outcome } : { type: "PROPOSE_OUTCOME", outcome: b.outcome }) : may ? { type: "RESOLVE" } : { type: "PROPOSE_RESOLVE" };
      const r = applyToLog(log, entry.id, event, { actor: { ...actor, ownsBlockedWork: owns }, today });
      if (!r.outcome.ok) throw new CommandRefused(`"${entry.title}": ${r.outcome.reason}`);
      const from = log[entry.id].state;
      // D10: what follows a realised risk, broken assumption or late dependency is drafted, as from the button
      log = may ? withFollowUp(r.log, entry.id) : r.log;
      if (may) resolved.push(entry.id);
      audits.push(auditOf(item, r.outcome.event, entry.id, from));
      continue;
    }

    let state: MatchState = b.event === "ADD_SOURCE" ? "same_as" : braid.match === "related_to" ? "related_to" : "new";
    let entryId = state === "new" ? null : braid.matchEntryId;
    let seen = state === "same_as" ? (item.saw as BraidEntryState | null) : null;
    let kind = braid.kind;
    let raisedAgainFrom: string | null = null;
    if (state === "same_as" && entryId) {
      const go = redirectReport(log, entryId);
      if (go.to === "entry") [entryId, seen, kind] = [go.entryId, log[go.entryId].state, log[go.entryId].kind];
      if (go.to === "new_raised_again") [state, raisedAgainFrom, entryId, seen] = ["new", go.fromId, null, null];
    }
    // The author confirmed this match when they accepted the item (or left it ready and saved)
    // Section 20, U4: a reversal is linked as conflicting with the decision it names; approving it supersedes that one (E87), never saving it
    const conflictsWith = b.supersedes && log[b.supersedes] ? [b.supersedes] : [];
    const match: MatchRecord = { itemId: item.id, projectId, kind, speakerId: s.authorId, state, entryId, confirmed: true, seen, conflictsWith, savedTo: null };
    const r = saveMatch(match, log, { newEntryId: `br-${item.id}`, title: b.title, ownerId: null, source, expectedOn: b.expectedOn ?? null }, { actor, today });
    if (!r.ok) throw new CommandRefused(r.outcome === "conflict" ? `"${braid.title}" changed since you saw it (now ${r.now})` : `"${braid.title}": ${r.reason}`);
    const from = r.outcome === "created" ? "none" : log[r.entryId].state;
    log = r.log;
    if (raisedAgainFrom) {
      // D8: a closed risk reported again is a new proposal, linked so the leads see it was closed before
      const fresh = log[r.entryId];
      const old = log[raisedAgainFrom];
      log = { ...log, [fresh.id]: { ...fresh, links: [...fresh.links, { relation: "raised_from", entryId: old.id }] }, [old.id]: { ...old, links: [...old.links, { relation: "related", entryId: fresh.id }] } };
    }
    sourceItems.set(source.id, item.id);
    audits.push(auditOf(item, b.event, r.entryId, from, raisedAgainFrom ? { raisedAgainFrom } : r.entryId !== braid.matchEntryId && b.event === "ADD_SOURCE" ? { redirectedFrom: braid.matchEntryId } : {}));
  }
  const changed = await persistBraidLog(s.tx, before, log, versions, s.now, { extractionIdBySource: sourceItems });
  for (const id of changed) noteBefore(s.receipt, { type: "braid_entry", id, projectId, version: 0, before: before[id] ?? null });
  for (const a of audits) await recordAudit(...a);
  for (const id of resolved) {
    for (const personId of await noticeReporters(s.tx, s.now, log[id], s.authorId, { act: "resolved" })) s.receipt.told.push({ personId, projectId, subjectType: "braid_entry", subjectId: id });
  }
}

export type SaveOptions = {
  /** Waits between tries; tests pass a fake. Default 1s, then 2s. */
  sleep?: (ms: number) => Promise<void>;
};

export const SAVE_FAILED_MESSAGE = "This didn't save, and nothing was changed. Try Save again.";

/**
 * Save (L16). One transaction across every project the items are routed to: either every confirmed
 * item is applied or, on any conflict, none is and the review reopens with both values shown.
 * D3: a database error rolls the try back and Save tries again with the same item IDs, up to
 * config.saveMaxTries; then the author is told nothing changed. A refusal is not retried: it is
 * returned as it is and written to the audit (rule 2, D12).
 */
export async function saveCapture(ctx: CommandCtx, captureId: string, options: SaveOptions = {}): Promise<SaveResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.saveMaxTries; attempt++) {
    try {
      return await saveOnce(ctx, captureId, attempt);
    } catch (e) {
      if (e instanceof CommandRefused) {
        await logSaveProblem(ctx, captureId, "SAVE_REFUSED", { reason: e.reason, attempt });
        throw e;
      }
      lastError = e;
      if (attempt < config.saveMaxTries) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await logSaveProblem(ctx, captureId, "SAVE_ERROR", { message, tries: config.saveMaxTries });
  return { outcome: "failed", message: SAVE_FAILED_MESSAGE, tries: config.saveMaxTries };
}

// Written in its own transaction, after the save's was rolled back. If even this fails, the
// author still gets the refusal or the "didn't save" message.
async function logSaveProblem(ctx: CommandCtx, captureId: string, action: "SAVE_REFUSED" | "SAVE_ERROR", detail: Record<string, unknown>) {
  try {
    await runCommand(ctx, (tx) =>
      audit(tx, ctx.now, { actorType: "person", actorId: ctx.actorId, action, machine: "capture", subjectType: "capture", subjectId: captureId, captureId, detail }),
    );
  } catch {
    // Nothing more to do: the database is not taking writes
  }
}

function saveOnce(ctx: CommandCtx, captureId: string, attempt: number): Promise<SaveResult> {
  return runCommand(ctx, async (tx) => {
    const { row, record } = await ownCapture(tx, captureId, ctx.actorId);
    if (record.state === "saved") {
      // D3: an earlier try went through and only its reply was lost
      if (attempt > 1) return savedBefore(await loadItems(tx, captureId));
      // E3: the second session sees when the first one saved; nothing is applied twice
      throw new CommandRefused(`already saved at ${clock(row.updatedAt)}; nothing was applied twice`);
    }
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

    // D2, E26: an update to cancelled work is withdrawn, never a conflict: there is nothing to resolve
    for (const item of items.filter(isReady)) {
      const target = item.draft.target;
      if (target?.type !== "work_item") continue;
      const [wi] = await tx.select({ state: t.workItems.state }).from(t.workItems).where(eq(t.workItems.id, target.id));
      if (wi?.state === "cancelled") withdraw(item.id, "target_cancelled", { workItemId: target.id });
    }

    const current: Record<string, string | null> = {};
    for (const item of items.filter(isReady)) {
      const key = targetKey(item);
      if (key !== null && !(key in current)) current[key] = await readCurrent(tx, item, authorId);
    }
    let plan = planSave(saving.record, items, current);
    if (plan.outcome === "refused") throw new CommandRefused(plan.reason);
    // D12: every write is checked against its record's machine before anything is written. A
    // refusal goes back to its card, and all or nothing (S3) means the rest waits with it
    const refusals = new Map<string, string>();
    if (plan.outcome === "apply") {
      for (const w of plan.writes) {
        const reason = (await editRule(tx, s0(items, w.itemId), authorId))(w.value);
        if (reason) refusals.set(w.itemId, `${reason}. Edit it or reject it`);
      }
      if (refusals.size) {
        const refused = plan.writes.filter((w) => refusals.has(w.itemId));
        plan = { outcome: "conflict", conflicts: refused.map((w) => ({ itemId: w.itemId, key: w.key, saw: w.expected, current: current[w.key] ?? null })) };
      }
    }
    const finish = saveOutcome(plan)!;
    const settled = settleItems(items, plan);
    const finished = moveCapture(saving.record, finish);
    captureMoves.push(finished.outcome);

    const receipt: Receipt = { records: new Map(), told: [] };
    const writeAll = async (extra: (s: SaveScope) => Promise<void>) => {
      const s: SaveScope = {
        tx,
        now: ctx.now,
        authorId,
        capture: row,
        world,
        byId: new Map(items.map((i) => [i.id, i])),
        blockLinks: plan.outcome === "apply" ? blockLinksOf(items, plan) : new Map(),
        receipt,
      };
      await extra(s);
      const final = settled.map((i) => {
        if (i.state !== "conflict" || !i.conflict) return i;
        const refusal = refusals.get(i.id);
        return { ...i, conflict: refusal ? { ...i.conflict, reason: refusal, refused: true } : { ...i.conflict, reason: conflictReason(i) } };
      });
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
      for (const [itemId, reason] of refusals) {
        await audit(tx, ctx.now, { actorType: "person", actorId: authorId, action: "SAVE_REFUSED", machine: "extracted_item", subjectType: "extraction", subjectId: itemId, captureId, extractionId: itemId, detail: { reason } });
      }
      const refused = [...refusals].map(([itemId, reason]) => ({ itemId, reason }));
      return { outcome: "conflict", conflicts: plan.conflicts, refused, withdrawn: itemMoves.map((m) => m.item.id) };
    }

    const touched = new Set<string>();
    await writeAll(async (s) => {
      // E27: any record machine that refuses throws, and the whole transaction rolls back
      for (const w of plan.writes) {
        const projectId = await applyWrite(s, w);
        if (projectId) touched.add(projectId);
      }
      const byProject = new Map<string, BraidIntent[]>();
      for (const b of plan.braid) byProject.set(b.projectId, [...(byProject.get(b.projectId) ?? []), b]);
      for (const [projectId, intents] of [...byProject].sort(([a], [b]) => a.localeCompare(b))) {
        await applyBraid(s, projectId, intents);
        touched.add(projectId);
      }
    });
    await syncReminder(tx, ctx.now, authorId, captureId, false, true);
    // Phase L: a set status the rules move after this save is part of it, and goes back with an undo
    const statusBefore = new Map<string, typeof t.projects.$inferSelect>();
    for (const id of touched) statusBefore.set(id, (await tx.select().from(t.projects).where(eq(t.projects.id, id)))[0]);
    // Rules run after the change, as the author, so items their own save resolved close as acted
    const evaluations = await evaluateProjects(tx, touched, ctx.now, { actorId: authorId });
    for (const [id, was] of statusBefore) {
      const [moved_] = await tx.select({ version: t.projects.version }).from(t.projects).where(eq(t.projects.id, id));
      if (moved_.version === was.version) continue;
      noteBefore(receipt, { type: "set_status", id, projectId: id, version: 0, before: { ...setStatusRecordOf(was), setBy: was.setBy, setAt: was.setAt?.toISOString() ?? null } });
    }
    receipt.told.push(...(await toldBy(tx, evaluations, authorId)));
    await writeReceipt(tx, ctx.now, captureId, authorId, receipt);
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

const MINUTE_MS = 60_000;

/**
 * The capture timers. A transcription or read with no answer for config.staleReadMinutes goes back
 * to retry (D19). A review is reminded once, then expired: each capture moves at most once per run,
 * so a reminder always lands before expiry (ReminderBeforeExpiry). Expiry withdraws every open item
 * and applies nothing (NothingAfterExpiry).
 */
export function runCaptureTimers(ctx: { db: Db; now: Date }): Promise<{ reminded: string[]; expired: string[]; stale: string[] }> {
  return runCommand({ ...ctx, actorId: "rule" }, async (tx) => {
    const reminded: string[] = [];
    const expired: string[] = [];
    const stale: string[] = [];
    const rule: Actor = { type: "rule", id: null };

    const working = await tx.select().from(t.captures).where(inArray(t.captures.state, ["transcribing", "reading"]));
    for (const row of working) {
      const idleMinutes = Math.floor((ctx.now.getTime() - row.updatedAt.getTime()) / MINUTE_MS);
      const r = applyCaptureEvent(captureRecordOf(row), { type: "STALE" }, { idleMinutes });
      if (!r.outcome.ok) continue; // still within the 5 minutes
      await persistCapture(tx, row.id, row.version, r.record, ctx.now);
      await auditCapture(tx, ctx.now, row.id, r.outcome, rule, { idleMinutes, tries: row.tries });
      stale.push(row.id);
    }

    const waiting = await tx.select().from(t.captures).where(inArray(t.captures.state, ["proposed", "reviewing"]));
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
    return { reminded, expired, stale };
  });
}
