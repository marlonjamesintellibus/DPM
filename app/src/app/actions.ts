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

export async function sendUpdate(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const text = String(form.get("text") ?? "").trim();
  if (!text) return { ok: false, message: "Write your update first." };
  const ctx = await as();
  // DPM's own chat sends a message id too, so a double submit is one capture (D14)
  const messageId = String(form.get("messageId") ?? "") || randomUUID();
  const { captureId } = await createCapture(ctx, { channel: "app", kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now, messageId });
  // The model call can take seconds: the chat shows "Reading your update…" and refreshes until it lands
  after(async () => {
    await readCapture({ ...ctx, now: now() }, captureId, atlasFromEnv().extractor, { clock: now });
  });
  refresh();
  return { ok: true };
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
