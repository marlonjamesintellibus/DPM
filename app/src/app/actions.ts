"use server";
// Every change a screen makes goes through here: the viewer comes from the View as cookie, the
// command runs as them (so rights are checked by the command, never by the screen), and the page
// refreshes with fresh data. A refusal comes back as a plain message for the screen to show.
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { atlasFromEnv } from "@/atlas";
import { readCapture } from "@/commands/atlas";
import {
  acknowledgeBlocker,
  answerKindChange,
  askKindChange,
  confirmFollowUp,
  decideBraidEntry,
  dropFollowUp,
  keepOpen,
  reportBraidEntry,
  resolveBraidEntry,
  setExpectedDate,
  switchEntryKind,
  withdrawKindChange,
  type KindAnswer,
} from "@/commands/braid";
import { withArticle } from "@/domain/shared";
import type { ResolveOutcome } from "@/domain/machines/braid-entry";
import type { BraidKind } from "@/domain/rights";
import {
  createCapture,
  decideExtraction,
  discardCapture,
  openReview,
  pickRecordExtraction,
  rematchExtraction,
  routeExtraction,
  saveCapture,
  type ExtractionDecision,
  type Rematch,
} from "@/commands/capture";
import { cancelCommand, confirmCommand, tapLine, type CommandRun } from "@/commands/chat-command";
import { answerClarification } from "@/commands/clarification";
import { answerCommitment, type CheckInAnswer } from "@/commands/commitment";
import { copyDraft, discardDraft, editDraft, refreshDraft, writeDraft } from "@/commands/draft";
import { CommandRefused, StaleVersion, type CommandCtx } from "@/commands/core";
import type { CommandAct, CommandInput } from "@/domain/machines/chat-command";
import { archiveConversation, renameConversation, restoreConversation } from "@/commands/conversations";
import { giveFeedback, setHelpImproveAtlas } from "@/commands/learning";
import { acceptOwnerAsk, declineOwnerAsk } from "@/commands/owner-ask";
import { approveLeave, declineLeave } from "@/commands/leave";
import { draftReasonFor, keepSetStatus, linkChange, saveReason, shareReasonWithClient, useCalculated } from "@/commands/status";
import { acceptSignal, dismissSignal, setProjectPaused, stillGoing } from "@/commands/signals";
import { tapStandup, type StandupTap } from "@/commands/standup";
import { undoSave } from "@/commands/undo";
import { decideVocabularyChange } from "@/commands/vocabulary";
import { undoReply } from "@/queries/answers/undo";
import { getDb } from "@/db/client";
import { now } from "./_lib/clock";
import { currentViewer, VIEWER_COOKIE, viewerInfo } from "./_lib/viewer";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function as(): Promise<CommandCtx> {
  const viewer = await currentViewer();
  return { db: await getDb(), now: now(), actorId: viewer.id };
}

// One place turns a command's refusal into words for the screen; anything else is a real error
async function run(work: (ctx: CommandCtx) => Promise<unknown>, done?: string): Promise<ActionResult> {
  try {
    await work(await as());
  } catch (e) {
    if (e instanceof CommandRefused) return { ok: false, message: sentence(e.reason) };
    if (e instanceof StaleVersion) return { ok: false, message: "Someone changed this just now. It has been reloaded; try again." };
    throw e;
  } finally {
    refresh();
  }
  return { ok: true, message: done };
}

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : s);

// ---- View as (L0) ----

export async function viewAs(id: string): Promise<void> {
  (await cookies()).set(VIEWER_COOKIE, viewerInfo(id).id, { path: "/", sameSite: "lax" });
  redirect("/");
}

// ---- Today chat: send an update, Atlas reads it after the reply (5.1) ----

export type SendResult = ActionResult & { conversationId?: string };

/** Section 16: the message goes into the conversation open on screen, or starts a new one. */
export async function sendUpdate(_: SendResult | null, form: FormData): Promise<SendResult> {
  const text = String(form.get("text") ?? "").trim();
  if (!text) return { ok: false, message: "Write your message first." };
  const ctx = await as();
  // DPM's own chat sends a message id too, so a double submit is one capture (D14)
  const messageId = String(form.get("messageId") ?? "") || randomUUID();
  const conversationId = String(form.get("conversationId") ?? "") || null;
  let created;
  try {
    created = await createCapture(ctx, { channel: "app", kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, messageId, conversationId });
  } catch (e) {
    if (e instanceof CommandRefused) return { ok: false, message: "That conversation is not yours, or no longer there. Start a new one." };
    throw e;
  }
  const { captureId } = created;
  // The model call can take seconds: the chat shows "Reading your update…" and refreshes until it lands
  after(async () => {
    const atlas = atlasFromEnv();
    await readCapture({ ...ctx, now: now() }, captureId, atlas.extractor, { clock: now, drafter: atlas.drafter });
  });
  refresh();
  return { ok: true, conversationId: created.conversationId ?? undefined };
}

/**
 * Section 17: Accept on a chat card. The review opens if it is not open yet, then the item is accepted
 * as on the review screen; the item's machine decides, so a card read later is checked again (MF6, MF7).
 */
export async function acceptFromChat(captureId: string, itemId: string): Promise<ActionResult> {
  return run(async (ctx) => {
    try {
      await openReview(ctx, captureId);
    } catch (e) {
      // Already open is fine; saved, discarded or expired is told by the accept below
      if (!(e instanceof CommandRefused)) throw e;
    }
    await decideExtraction(ctx, itemId, { type: "accept" });
  }, "Accepted.");
}

// ---- Acting from an answer (phase B, M20) ----

// A command that ran says what it did; one refused says why, and it is final (AC1 to AC3)
async function command(work: (ctx: CommandCtx) => Promise<CommandRun>): Promise<ActionResult> {
  let ran: CommandRun | null = null;
  const r = await run(async (ctx) => {
    ran = await work(ctx);
  });
  if (!r.ok || !ran) return r;
  const { record, message } = ran as CommandRun;
  return record.state === "refused" ? { ok: false, message } : { ok: true, message };
}

/**
 * A button on an answer line: the same command its screen runs, confirmed in the same tap. The right and
 * the version are checked now, so a button on an old answer still works only if nothing changed (AC5).
 */
export async function actOnLine(captureId: string, line: number, act: CommandAct, input?: CommandInput): Promise<ActionResult> {
  return command((ctx) => tapLine(ctx, captureId, line, act, input ?? null));
}

/** The confirm card for a reply in words ("Approve the Kyle risk"): confirm it, with the words a decline needs. */
export async function confirmChatCommand(commandId: string, input?: CommandInput): Promise<ActionResult> {
  return command((ctx) => confirmCommand(ctx, commandId, input ?? null));
}

export async function cancelChatCommand(commandId: string): Promise<ActionResult> {
  return command((ctx) => cancelCommand(ctx, commandId));
}

// ---- Asking when unsure (phase D, M21) ----

/** A button under Atlas's question: the option is checked again now (CL5); a second tap says how it ended. */
export async function answerClarificationAction(clarificationId: string, option: string): Promise<ActionResult> {
  let message = "";
  const r = await run(async (ctx) => {
    message = (await answerClarification(ctx, clarificationId, option)).message;
  });
  return r.ok ? { ok: true, message } : r;
}

// ---- Commitments (phase E, M22) ----

/**
 * The owner answers a check-in or CM11's question, in the chat or the inbox, or acts on a promise from "What did I
 * promise?": Done, a new date, Drop, or "it still stands". `commandId` is the buttons' own, so a second tap or a
 * retried request changes nothing (rule 6); the command checks it is theirs and still live.
 */
export async function answerCommitmentAction(commitmentId: string, answer: CheckInAnswer, commandId: string): Promise<ActionResult> {
  let message = "";
  const r = await run(async (ctx) => {
    message = (await answerCommitment(ctx, commitmentId, answer, commandId)).message;
  });
  return r.ok ? { ok: true, message } : r;
}

// ---- Standup with Atlas (phase J, M28) ----

/**
 * A button under a standup question: a tap answer, Skip or That's all, for the question it was shown with
 * (rule 6). When it ends the standup, the answers it composed are read after the reply, as a sent message is.
 */
export async function answerStandupAction(standupId: string, n: number, tap: StandupTap): Promise<ActionResult> {
  let ran: { ctx: CommandCtx; composed: string | null } | null = null;
  const r = await run(async (ctx) => {
    ran = { ctx, composed: (await tapStandup(ctx, standupId, n, tap)).composed };
  });
  const done = ran as { ctx: CommandCtx; composed: string | null } | null;
  if (r.ok && done?.composed) {
    const captureId = done.composed;
    after(async () => {
      const atlas = atlasFromEnv();
      await readCapture({ ...done.ctx, now: now() }, captureId, atlas.extractor, { clock: now, drafter: atlas.drafter });
    });
  }
  return r;
}

// ---- Drafts (phase G, M25) ----

/** Their edits, kept with the draft so a reload shows them. */
export async function editDraftAction(draftId: string, text: string): Promise<ActionResult> {
  return run((ctx) => editDraft(ctx, draftId, text));
}

/**
 * Copy, with the words on screen: the server checks it (a client status against the client view now, DR4) and
 * gives back the text the browser puts on the clipboard. A refusal offers Refresh.
 */
export async function copyDraftAction(draftId: string, text: string): Promise<ActionResult & { text?: string }> {
  let copied = "";
  const r = await run(async (ctx) => {
    copied = (await copyDraft(ctx, draftId, text)).text;
  });
  return r.ok ? { ...r, text: copied } : r;
}

/** DR5: Refresh drafts again from the facts now, their edits kept aside; Atlas writes it after the reply. */
export async function refreshDraftAction(draftId: string, text: string): Promise<ActionResult> {
  let ran: CommandCtx | null = null;
  const r = await run(async (ctx) => {
    await refreshDraft(ctx, draftId, text);
    ran = ctx;
  });
  const done = ran as CommandCtx | null;
  if (r.ok && done) {
    const db = done.db;
    after(async () => {
      await writeDraft(db, now, draftId, atlasFromEnv().drafter);
    });
  }
  return r;
}

export async function discardDraftAction(draftId: string): Promise<ActionResult> {
  return run((ctx) => discardDraft(ctx, draftId));
}

// ---- Learning from use (phase S) ----

/**
 * A thumbs up or down on an answer, with "What was wrong?"; giving it again changes it (LF6). What was
 * wrong is kept only while "Help improve Atlas" is on, and the reply says when it was not (LF1).
 */
export async function rateAnswer(captureId: string, rating: "up" | "down", wrong?: string): Promise<ActionResult> {
  const kept = { wrong: null as string | null };
  const r = await run(async (ctx) => {
    kept.wrong = (await giveFeedback(ctx, captureId, { rating, wrong })).wrong;
  });
  if (!r.ok) return r;
  const said = rating === "down" && !!wrong?.trim();
  return { ok: true, message: !said ? "Thanks." : kept.wrong ? "Thanks. That helps." : "Thanks. Help improve Atlas is off, so only your thumbs down was kept." };
}

/** "Help improve Atlas": off deletes their candidates still waiting, and what they said was wrong (LF2). */
export async function setHelpImproveAtlasAction(on: boolean): Promise<ActionResult> {
  return run(
    (ctx) => setHelpImproveAtlas(ctx, on),
    on ? "On. What Atlas gets wrong or cannot answer goes to the team building DPM." : "Off. What you said was wrong, and anything of yours the team had not looked at yet, is deleted.",
  );
}

// ---- Conversations (M18, section 16) ----

export async function renameConversationAction(conversationId: string, title: string): Promise<ActionResult> {
  return run((ctx) => renameConversation(ctx, conversationId, title), "Renamed.");
}

export async function archiveConversationAction(conversationId: string): Promise<ActionResult> {
  return run((ctx) => archiveConversation(ctx, conversationId), "Archived.");
}

export async function restoreConversationAction(conversationId: string): Promise<ActionResult> {
  return run((ctx) => restoreConversation(ctx, conversationId), "Restored.");
}

// ---- Review my update (L16b) ----

export async function startReview(captureId: string): Promise<void> {
  const ctx = await as();
  try {
    await openReview(ctx, captureId);
  } catch (e) {
    // Already open, or already saved: the page shows it as it is
    if (!(e instanceof CommandRefused)) throw e;
  }
  redirect(`/review/${captureId}`);
}

export async function decideItem(itemId: string, decision: ExtractionDecision): Promise<ActionResult> {
  return run((ctx) => decideExtraction(ctx, itemId, decision));
}

export async function rematchItem(itemId: string, to: Rematch): Promise<ActionResult> {
  return run((ctx) => rematchExtraction(ctx, itemId, to));
}

/** Phase D: which record an unsure update means, chosen on the review; choosing is confirming. */
export async function pickRecord(itemId: string, recordId: string): Promise<ActionResult> {
  return run((ctx) => pickRecordExtraction(ctx, itemId, recordId));
}

export async function moveItem(itemId: string, to: { projectId: string } | "keep_private"): Promise<ActionResult> {
  return run((ctx) => routeExtraction(ctx, itemId, to));
}

export async function saveUpdate(captureId: string): Promise<ActionResult> {
  let result: ActionResult = { ok: true };
  const r = await run(async (ctx) => {
    const saved = await saveCapture(ctx, captureId);
    if (saved.outcome === "failed") result = { ok: false, message: saved.message };
    else if (saved.outcome === "conflict") {
      const n = saved.conflicts.length;
      result = { ok: false, message: `${n} ${n === 1 ? "item changed" : "items changed"} since you read ${n === 1 ? "it" : "them"}. Nothing was saved; check the highlighted cards.` };
    } else result = { ok: true, message: `Saved ${saved.applied.length} ${saved.applied.length === 1 ? "update" : "updates"}.` };
  });
  return r.ok ? result : r;
}

/**
 * Section 19: an update with one item is decided and saved in one step. The decision and the save are
 * the same commands as two clicks; a refused decision saves nothing, a failed save leaves it decided (RS1 to RS3).
 */
export async function decideAndSave(captureId: string, itemId: string, decision: ExtractionDecision | null): Promise<ActionResult> {
  if (decision) {
    const decided = await decideItem(itemId, decision);
    if (!decided.ok) return decided;
  }
  return saveUpdate(captureId);
}

/**
 * Phase L, M30: the Undo button on a saved message. `commandId` is the button's own, so pressing it twice
 * undoes once (UN5); the command checks the window, every version and the right as it runs. The reply is
 * what "Undo that" would say.
 */
export async function undoUpdate(captureId: string, commandId: string): Promise<ActionResult> {
  let reply = "";
  const r = await run(async (ctx) => {
    const done = await undoSave(ctx, { commandId, captureId });
    const body = await undoReply(ctx.db, ctx.actorId, done.kind === "job" ? done.job.id : null, ctx.now, captureId);
    reply = body.text;
    if (done.kind !== "job" || done.job.state !== "undone") throw new CommandRefused(body.text);
  });
  return r.ok ? { ok: true, message: reply } : r;
}

export async function discardUpdate(captureId: string): Promise<ActionResult> {
  return run((ctx) => discardCapture(ctx, captureId), "Discarded. Nothing was changed.");
}

// ---- BRAID decisions (L6b, L6c, L14b) ----

export async function approveEntry(entryId: string, note?: string): Promise<ActionResult> {
  return run((ctx) => decideBraidEntry(ctx, entryId, { type: "approve", note }), "Approved.");
}

export async function declineEntry(entryId: string, reason: string): Promise<ActionResult> {
  return run((ctx) => decideBraidEntry(ctx, entryId, { type: "decline", reason }), "Declined.");
}

export async function askForMore(entryId: string, question: string): Promise<ActionResult> {
  return run((ctx) => decideBraidEntry(ctx, entryId, { type: "request_info", question }), "Asked.");
}

// ---- An entry's kind (machines doc, section 13) ----

/** A PM or Lead changes the kind; `version` is the entry as they saw it (BK6). */
export async function switchKindAction(entryId: string, version: number, to: BraidKind, why: string): Promise<ActionResult> {
  return run((ctx) => switchEntryKind(ctx, entryId, to, why, { seenVersion: version }), `Now ${withArticle(to)}.`);
}

/** A member asks a PM or Lead to change it (M17). */
export async function askKindAction(entryId: string, to: BraidKind, why: string): Promise<ActionResult> {
  return run((ctx) => askKindChange(ctx, entryId, to, why), "Asked. A PM or Lead decides.");
}

export async function answerKindAction(requestId: string, version: number, answer: KindAnswer): Promise<ActionResult> {
  return run((ctx) => answerKindChange(ctx, requestId, answer, { seenVersion: version }), answer.type === "switch" ? "Switched." : "Kept as it is.");
}

export async function withdrawKindAction(requestId: string): Promise<ActionResult> {
  return run((ctx) => withdrawKindChange(ctx, requestId), "Withdrawn.");
}

export async function resolveEntry(entryId: string): Promise<ActionResult> {
  return run((ctx) => resolveBraidEntry(ctx, entryId), "Resolved.");
}

/**
 * Section 20, U2 and U3: a PM or Lead ends a risk, assumption or dependency as it ended. Realised, broken
 * and late draft their follow up (D10).
 */
export async function endEntry(entryId: string, outcome: ResolveOutcome): Promise<ActionResult> {
  return run((ctx) => resolveBraidEntry(ctx, entryId, outcome), `Marked ${outcome}.`);
}

/** Section 20, U2: a PM or Lead gives a dependency a new expected date. */
export async function newExpectedDate(entryId: string, date: string): Promise<ActionResult> {
  return run((ctx) => setExpectedDate(ctx, entryId, date), "New date saved.");
}

// ---- Asks to the owner (M37, section 20, U5 and U7) ----

export async function acceptAsk(askId: string): Promise<ActionResult> {
  return run((ctx) => acceptOwnerAsk(ctx, askId), "Accepted.");
}

export async function declineAsk(askId: string, reason: string): Promise<ActionResult> {
  return run((ctx) => declineOwnerAsk(ctx, askId, reason), "Declined. They are told why.");
}

export async function keepEntryOpen(entryId: string): Promise<ActionResult> {
  return run((ctx) => keepOpen(ctx, entryId), "Kept open.");
}

export async function acknowledgeEntry(entryId: string): Promise<ActionResult> {
  return run((ctx) => acknowledgeBlocker(ctx, entryId), "Acknowledged.");
}

export async function confirmDraft(entryId: string): Promise<ActionResult> {
  return run((ctx) => confirmFollowUp(ctx, entryId), "Added to the log.");
}

export async function dropDraft(entryId: string): Promise<ActionResult> {
  return run((ctx) => dropFollowUp(ctx, entryId), "Dropped.");
}

// ---- Corrections (phase L, M31) ----

export async function decideCorrection(changeId: string, act: "approve" | "decline"): Promise<ActionResult> {
  return run((ctx) => decideVocabularyChange(ctx, changeId, act), act === "approve" ? "Approved. Atlas reads it this way from now on." : "Declined. Atlas reads it as before.");
}

// ---- Signals (phase K, M29) ----

export async function acceptSignalAction(signalId: string, version: number, sameAs: string | null): Promise<ActionResult> {
  return run((ctx) => acceptSignal(ctx, signalId, { seenVersion: version, sameAs }), sameAs ? "Added to the risk." : "Accepted. It is a risk on the log.");
}

export async function dismissSignalAction(signalId: string, version: number, reason: string): Promise<ActionResult> {
  return run((ctx) => dismissSignal(ctx, signalId, reason, { seenVersion: version }), "Dismissed. Atlas raises it again only if it gets worse.");
}

export async function stillGoingAction(workItemId: string): Promise<ActionResult> {
  return run((ctx) => stillGoing(ctx, workItemId), "Noted. Its clock starts again.");
}

/** Phase G: the PM shares the status and its reason with the client, so a client status may hold them. */
export async function shareReasonAction(projectId: string, reasonId: string, shared: boolean): Promise<ActionResult> {
  return run((ctx) => shareReasonWithClient(ctx, projectId, reasonId, shared), shared ? "Shared. A client status can now say the status and its reason." : "No longer shared with the client.");
}

export async function setPausedAction(projectId: string, paused: boolean): Promise<ActionResult> {
  return run((ctx) => setProjectPaused(ctx, projectId, paused), paused ? "Marked paused. Atlas will not flag it as quiet." : "Resumed.");
}

// ---- Set status and reason (L6, L6b) ----

export async function giveReason(projectId: string, input: { text: string; entryIds: string[]; draftedByAtlas: boolean; edited: boolean }): Promise<ActionResult> {
  return run((ctx) => saveReason(ctx, projectId, input), "Reason saved.");
}

export async function keepStatus(projectId: string): Promise<ActionResult> {
  return run((ctx) => keepSetStatus(ctx, projectId), "Kept.");
}

export async function showCalculatedStatus(projectId: string): Promise<ActionResult> {
  return run((ctx) => useCalculated(ctx, projectId), "Now showing the calculated status.");
}

/**
 * Atlas rewords the rules draft (G21); the facts stay the rules' own. Nothing is saved. Only the viewer's
 * own right gets a draft (M9, P10): the inbox and the chat's Give a reason both ask with a project id.
 */
export async function atlasReason(projectId: string): Promise<{ text: string; entryIds: string[]; by: "rules" | "atlas" }> {
  const ctx = await as();
  const d = await draftReasonFor(ctx.db, ctx.actorId, projectId, ctx.now, atlasFromEnv().drafter);
  return { text: d.text, entryIds: d.entryIds, by: d.by };
}

/** D17: add an entry to the log while writing a reason; it lands by the writer's right. */
export async function addEntry(projectId: string, kind: BraidKind, title: string): Promise<ActionResult & { entryId?: string; onLog?: boolean }> {
  let created: { id: string; onLog: boolean } | null = null;
  const r = await run(async (ctx) => {
    const res = await reportBraidEntry(ctx, projectId, { kind, title });
    created = { id: res.entry.id, onLog: ["reported", "open", "holding", "approved"].includes(res.entry.state) };
  });
  if (!r.ok || !created) return r;
  const c = created as { id: string; onLog: boolean };
  return { ok: true, entryId: c.id, onLog: c.onLog, message: c.onLog ? "Added to the log." : "Proposed: it goes on the log once a PM or Lead approves." };
}

// ---- Work (M5, D18) ----

export async function linkWorkChange(workItemId: string, url: string): Promise<ActionResult> {
  return run((ctx) => linkChange(ctx, workItemId, url), "Linked.");
}

// ---- Leave (D6) ----

export async function decideLeave(leaveId: string, approve: boolean): Promise<ActionResult> {
  return run((ctx) => (approve ? approveLeave(ctx, leaveId) : declineLeave(ctx, leaveId)), approve ? "Leave approved." : "Leave declined.");
}
