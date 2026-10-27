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
import type { BraidKind } from "@/domain/rights";
import {
  createCapture,
  decideExtraction,
  discardCapture,
  openReview,
  rematchExtraction,
  routeExtraction,
  saveCapture,
  type ExtractionDecision,
  type Rematch,
} from "@/commands/capture";
import { CommandRefused, StaleVersion, type CommandCtx } from "@/commands/core";
import { archiveConversation, renameConversation, restoreConversation } from "@/commands/conversations";
import { giveFeedback, setHelpImproveAtlas } from "@/commands/learning";
import { approveLeave, declineLeave } from "@/commands/leave";
import { draftReasonWithAtlas, keepSetStatus, linkChange, saveReason, useCalculated } from "@/commands/status";
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

/** Section 20, U2: a PM or Lead ends a due dependency, met or late. Late drafts its follow up (D10). */
export async function endDependency(entryId: string, outcome: "met" | "late"): Promise<ActionResult> {
  return run((ctx) => resolveBraidEntry(ctx, entryId, outcome), outcome === "met" ? "Marked met." : "Marked late.");
}

/** Section 20, U2: a PM or Lead gives a dependency a new expected date. */
export async function newExpectedDate(entryId: string, date: string): Promise<ActionResult> {
  return run((ctx) => setExpectedDate(ctx, entryId, date), "New date saved.");
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

/** Atlas rewords the rules draft (G21); the facts stay the rules' own. Nothing is saved. */
export async function atlasReason(projectId: string): Promise<{ text: string; entryIds: string[]; by: "rules" | "atlas" }> {
  const ctx = await as();
  const d = await draftReasonWithAtlas(ctx.db, projectId, ctx.now, atlasFromEnv().drafter);
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
