// M25 Draft (conversational plan, phase G): "Draft my standup", "Draft a client status for Forager" or "Draft
// the weekly summary for Forager" asks Atlas for a draft in the person's own chat. The request checks the right
// when it runs (DR3) and reads the facts for the asker then (P10); Atlas words them outside any transaction,
// and the machine's guard runs the facts check on what it wrote (DR2): a draft that adds anything is refused
// and tried again, and after the tries DPM's plain template is used, as it is at once with no model connected
// (DR6). A try the model leaves unanswered fails on its timer (config.draftModelSeconds), so a draft always
// reaches ready. The person edits it, copies it, refreshes it from the facts now with their edits kept aside
// (DR5), or discards it; nobody copying it lets it expire (config.draftExpiryHours). Copying a client status
// checks every fact against the client view now (rule 8, DR4). Posting waits on B8 and B9: M25 draws POST, and
// nothing here sends it. Once only by draft id (rule 6, DR8). Nothing here changes a record (rules 1 and 10).
import { and, eq, inArray, lte } from "drizzle-orm";
import { draftSystemPrompt, draftUserMessage } from "../atlas/draft";
import type { Drafter, Usage } from "../atlas/extractor";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import * as t from "../db/schema";
import { config } from "../domain/config";
import { clientCopyProblem, plainDraft, type DraftKind } from "../domain/drafts";
import type { Moved } from "../domain/machine";
import { isOwnChat } from "../domain/machines/clarification";
import { applyDraftEvent, DRAFT_FINAL, draftEndText, newDraft, type DraftEvent, type DraftRecord, type DraftState } from "../domain/machines/draft";
import { clientStatusFacts, draftFacts, draftOf, knownNames, mayDraft } from "../queries/drafts";
import { projectReader } from "../queries/project";
import { audit, CommandRefused, expectOne, moved, nextVersion, runCommand, type CommandCtx } from "./core";

type Row = typeof t.drafts.$inferSelect;
type Actor = { actorType: "person" | "atlas" | "rule"; actorId: string | null };

function auditMove(tx: Tx, now: Date, r: DraftRecord, outcome: Moved<DraftState>, by: Actor, detail: Record<string, unknown> = {}) {
  return audit(tx, now, {
    ...by,
    action: outcome.event,
    machine: "draft",
    subjectType: "draft",
    subjectId: r.id,
    fromState: outcome.from,
    toState: outcome.to,
    captureId: r.captureId,
    detail: { kind: r.kind, projectId: r.projectId, attempt: r.attempt, ...detail },
  });
}

async function persist(tx: Tx, now: Date, row: Row, r: DraftRecord): Promise<void> {
  const rows = await tx
    .update(t.drafts)
    .set({
      state: r.state,
      attempt: r.attempt,
      attemptAt: r.attemptAt,
      facts: r.facts,
      text: r.text,
      by: r.by,
      edited: r.edited,
      aside: r.aside,
      readyAt: r.readyAt,
      endedAt: r.endedAt,
      version: nextVersion(t.drafts.version),
      updatedAt: now,
    })
    .where(and(eq(t.drafts.id, row.id), eq(t.drafts.version, row.version)))
    .returning({ id: t.drafts.id });
  expectOne(rows, `draft ${row.id}`);
}

/**
 * REQUEST, while the message is read: in their own chat only (rule 8: a draft holds the asker's own facts), with
 * the right read now (DR3) and the facts read for them now (P10). One per message: the draft's id is the
 * message's, so a read delivered twice drafts once (rule 6). Returns the draft's id, or null when none was made
 * (the answer says why).
 */
export async function requestDraft(tx: Tx, now: Date, capture: { id: string; authorId: string; conversationId: string | null; channel: "app" | "atlas" }, kind: DraftKind, projectId: string | null): Promise<string | null> {
  const [conversation] = capture.conversationId ? await tx.select({ atlasChatId: t.conversations.atlasChatId }).from(t.conversations).where(eq(t.conversations.id, capture.conversationId)) : [];
  if (!isOwnChat(capture.channel, conversation?.atlasChatId)) return null;
  if (kind !== "standup" && !projectId) return null;
  const right = await mayDraft(tx, capture.authorId, kind, projectId);
  const facts = right ? await draftFacts(tx, capture.authorId, kind, projectId, now) : null;
  if (!facts) return null;
  const r = applyDraftEvent(newDraft({ id: `draft-${capture.id}`, ownerId: capture.authorId, kind, projectId, captureId: capture.id, facts }), { type: "REQUEST" }, { actorId: capture.authorId, now, right });
  if (!r.outcome.ok) return null;
  const rec = r.record;
  const inserted = await tx
    .insert(t.drafts)
    .values({ id: rec.id, ownerId: rec.ownerId, kind: rec.kind, projectId: rec.projectId, captureId: rec.captureId, state: rec.state, attempt: rec.attempt, attemptAt: rec.attemptAt, facts: rec.facts, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning({ id: t.drafts.id });
  if (!inserted.length) return rec.id;
  await auditMove(tx, now, rec, r.outcome as Moved<DraftState>, { actorType: "person", actorId: capture.authorId });
  return rec.id;
}

/** One move by Atlas or a rule on a draft that is requested, on the try it was read on; false when it moved on meanwhile (rule 6). */
async function moveRequested(db: Db, now: Date, draft: Pick<Row, "id" | "ownerId">, attempt: number, event: DraftEvent, by: Actor, detail: Record<string, unknown> = {}): Promise<DraftRecord | null> {
  // DR2, DR4: the names DPM knows for the asker now, so one the draft was not given is refused
  const known = event.type === "DRAFTED" ? await knownNames(db, draft.ownerId, now) : undefined;
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.drafts).where(eq(t.drafts.id, draft.id));
    if (!row || row.state !== "requested" || row.attempt !== attempt) return null;
    const r = applyDraftEvent(draftOf(row), event, { actorId: row.ownerId, now, known });
    if (!r.outcome.ok) return null;
    await persist(tx, now, row, r.record);
    await auditMove(tx, now, r.record, r.outcome, by, { ...detail, ...(r.record.state === "ready" ? { by: r.record.by } : {}) });
    return r.record;
  });
}

/**
 * Atlas writes the draft: one model call per try, with no transaction open, each try given
 * config.draftModelSeconds. What it wrote is checked by the machine (DR2); a failed call, or no model at all
 * (DR6), is DRAFT_FAILED. A try someone else ended meanwhile (the model timer, a Refresh) is left as it is.
 * Returns the state it ended in.
 */
export async function writeDraft(db: Db, clock: () => Date, draftId: string, drafter: Drafter | null): Promise<DraftState | null> {
  for (;;) {
    const [row] = await db.select().from(t.drafts).where(eq(t.drafts.id, draftId));
    if (!row || row.state !== "requested") return row?.state ?? null;
    const attempt = row.attempt;
    let event: DraftEvent;
    let detail: Record<string, unknown> = {};
    if (!drafter) event = { type: "DRAFT_FAILED", attempt, why: "no model connected" };
    else {
      try {
        const out: { text: string; model: string; usage: Usage | null } = await drafter.draft(draftSystemPrompt(row.kind), draftUserMessage(row.facts), { signal: AbortSignal.timeout(config.draftModelSeconds * 1000) });
        event = { type: "DRAFTED", attempt, text: plainDraft(out.text) };
        detail = { model: out.model, usage: out.usage };
      } catch (e) {
        event = { type: "DRAFT_FAILED", attempt, why: e instanceof Error ? e.message : String(e) };
      }
    }
    if (event.type === "DRAFT_FAILED") detail = { why: event.why };
    const r = await moveRequested(db, clock(), row, attempt, event, { actorType: "atlas", actorId: null }, detail);
    if (!r) {
      const [now_] = await db.select({ state: t.drafts.state, attempt: t.drafts.attempt }).from(t.drafts).where(eq(t.drafts.id, draftId));
      // Someone else moved it (the timer took this try): carry on with the next try, if there is one
      if (now_?.state === "requested" && now_.attempt !== attempt) continue;
      return now_?.state ?? null;
    }
    if (r.state !== "requested") return r.state;
  }
}

/** Their own draft; anyone else's reads as not found (P10, rule 10). */
async function ownDraft(tx: Tx, actorId: string, id: string): Promise<Row> {
  const [row] = await tx.select().from(t.drafts).where(eq(t.drafts.id, id));
  if (!row || row.ownerId !== actorId) throw new CommandRefused("no such draft", "not_found");
  // P10: a draft about a project they can no longer read is not theirs to use
  if (row.projectId && !(await projectReader(tx, actorId)).mayRead(row.projectId)) throw new CommandRefused("you can no longer read this project", "not_found");
  if (DRAFT_FINAL.includes(row.state)) throw new CommandRefused(draftEndText(row) ?? "this draft has ended");
  if (row.state === "requested") throw new CommandRefused("Atlas is still writing this draft");
  return row;
}

/** EDIT, inside a command: their words replace the draft's; the same words again change nothing. */
async function edited(tx: Tx, now: Date, row: Row, actorId: string, text: string | undefined): Promise<Row> {
  if (text === undefined || text.trim() === (row.text ?? "")) return row;
  const r = applyDraftEvent(draftOf(row), { type: "EDIT", text }, { actorId, now });
  const outcome = moved(r.outcome);
  await persist(tx, now, row, r.record);
  await auditMove(tx, now, r.record, outcome, { actorType: "person", actorId });
  const [after] = await tx.select().from(t.drafts).where(eq(t.drafts.id, row.id));
  return after;
}

/** Their edits, kept with the draft so a reload shows them. */
export function editDraft(ctx: CommandCtx, draftId: string, text: string): Promise<DraftRecord> {
  return runCommand(ctx, async (tx) => draftOf(await edited(tx, ctx.now, await ownDraft(tx, ctx.actorId, draftId), ctx.actorId, text)));
}

export const CLIENT_VIEW_CHANGED = "This draft says something the client view doesn't show now. Refresh it to draft from what the client can see.";

/**
 * COPY, with the words on screen: the text to put on the clipboard. A client status is checked against the
 * client view now (rule 8, DR4): a release hidden or moved since, a status no longer shared, or any name the
 * client view does not show refuses it, and Refresh is offered. Once only: a second copy finds it copied (DR8).
 */
export function copyDraft(ctx: CommandCtx, draftId: string, text?: string): Promise<{ text: string }> {
  return runCommand(ctx, async (tx) => {
    const row = await edited(tx, ctx.now, await ownDraft(tx, ctx.actorId, draftId), ctx.actorId, text);
    let readersOk = true;
    if (row.kind === "client") {
      const now_ = row.projectId ? await clientStatusFacts(tx, ctx.actorId, row.projectId, ctx.now) : null;
      readersOk = !!now_ && clientCopyProblem(row.facts, now_.facts, row.text ?? "", now_.hidden) === null;
    }
    const r = applyDraftEvent(draftOf(row), { type: "COPY" }, { actorId: ctx.actorId, now: ctx.now, readersOk });
    if (!r.outcome.ok) throw new CommandRefused(row.kind === "client" && !readersOk ? CLIENT_VIEW_CHANGED : r.outcome.reason);
    await persist(tx, ctx.now, row, r.record);
    await auditMove(tx, ctx.now, r.record, r.outcome, { actorType: "person", actorId: ctx.actorId });
    return { text: r.record.text ?? "" };
  });
}

/**
 * REFRESH (DR5): the facts read again for them now, with the right checked again (rule 4); what they wrote is
 * kept aside, and Atlas writes the draft again (writeDraft, after this commits).
 */
export function refreshDraft(ctx: CommandCtx, draftId: string, text?: string): Promise<DraftRecord> {
  return runCommand(ctx, async (tx) => {
    const row = await edited(tx, ctx.now, await ownDraft(tx, ctx.actorId, draftId), ctx.actorId, text);
    const right = await mayDraft(tx, ctx.actorId, row.kind, row.projectId);
    const facts = right ? await draftFacts(tx, ctx.actorId, row.kind, row.projectId, ctx.now) : null;
    const r = applyDraftEvent(draftOf(row), { type: "REFRESH", facts: facts ?? row.facts }, { actorId: ctx.actorId, now: ctx.now, right: right && !!facts });
    const outcome = moved(r.outcome);
    await persist(tx, ctx.now, row, r.record);
    await auditMove(tx, ctx.now, r.record, outcome, { actorType: "person", actorId: ctx.actorId }, { aside: !!r.record.aside });
    return r.record;
  });
}

export function discardDraft(ctx: CommandCtx, draftId: string): Promise<DraftRecord> {
  return runCommand(ctx, async (tx) => {
    const row = await ownDraft(tx, ctx.actorId, draftId);
    const r = applyDraftEvent(draftOf(row), { type: "DISCARD" }, { actorId: ctx.actorId, now: ctx.now });
    const outcome = moved(r.outcome);
    await persist(tx, ctx.now, row, r.record);
    await auditMove(tx, ctx.now, r.record, outcome, { actorType: "person", actorId: ctx.actorId });
    return r.record;
  });
}

/**
 * Timers draft_model (the model check's fix: a try with no answer after config.draftModelSeconds counts as
 * DRAFT_FAILED) and draft_expiry (config.draftExpiryHours after ready). `retry` are the drafts left requested on
 * their next try, for the caller to write again (rule 5: nothing stuck, even if the worker that asked died).
 */
export async function runDraftTimers(ctx: { db: Db; now: Date }): Promise<{ retry: string[]; failed: string[]; expired: string[] }> {
  const { db, now } = ctx;
  const modelCutoff = new Date(now.getTime() - config.draftModelSeconds * 1000);
  const expiryCutoff = new Date(now.getTime() - config.draftExpiryHours * 3_600_000);
  const [waiting, stale] = await Promise.all([
    db.select().from(t.drafts).where(and(eq(t.drafts.state, "requested"), lte(t.drafts.attemptAt, modelCutoff))),
    db.select().from(t.drafts).where(and(eq(t.drafts.state, "ready"), lte(t.drafts.readyAt, expiryCutoff))),
  ]);
  const failed: string[] = [];
  const retry: string[] = [];
  for (const row of waiting) {
    const r = await moveRequested(db, now, row, row.attempt, { type: "DRAFT_FAILED", attempt: row.attempt, why: "timer" }, { actorType: "rule", actorId: null }, { why: "timer" });
    if (!r) continue;
    failed.push(row.id);
    if (r.state === "requested") retry.push(row.id);
  }
  const expired = await db.transaction(async (tx) => {
    const ids: string[] = [];
    const rows = stale.length ? await tx.select().from(t.drafts).where(inArray(t.drafts.id, stale.map((s) => s.id))) : [];
    for (const row of rows) {
      const r = applyDraftEvent(draftOf(row), { type: "EXPIRE" }, { actorId: row.ownerId, now });
      if (!r.outcome.ok) continue;
      await persist(tx, now, row, r.record);
      await auditMove(tx, now, r.record, r.outcome, { actorType: "rule", actorId: null });
      ids.push(row.id);
    }
    return ids;
  });
  return { retry, failed, expired };
}

/** The draft a message asked for, if it made one: readCapture writes it once the read is stored. */
export async function draftOfCapture(db: Db, captureId: string): Promise<string | null> {
  const [row] = await db.select({ id: t.drafts.id, state: t.drafts.state }).from(t.drafts).where(eq(t.drafts.captureId, captureId));
  return row?.state === "requested" ? row.id : null;
}
