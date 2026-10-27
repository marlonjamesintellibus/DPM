// M18 commands (machines doc, section 16): the owner renames, archives and restores a conversation.
// Archiving changes nothing in it: an update waiting for review stays reachable from the inbox, and
// saved changes stay saved (CV13). New messages are put into conversations by createCapture.
import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import { applyConversationEvent, type ConversationEvent, type ConversationRecord } from "../domain/machines/conversation";
import { auditConversation, conversationOf } from "./capture";
import { CommandRefused, expectOne, moved, nextVersion, runCommand, StaleVersion, type CommandCtx } from "./core";

function act(ctx: CommandCtx, conversationId: string, event: ConversationEvent, seenVersion?: number): Promise<ConversationRecord> {
  return runCommand(ctx, async (tx) => {
    const [row] = await tx.select().from(t.conversations).where(eq(t.conversations.id, conversationId));
    // Someone else's conversation reads exactly like one that does not exist (P10)
    if (!row || row.ownerId !== ctx.actorId) throw new CommandRefused(`no conversation ${conversationId}`, "not_found");
    if (seenVersion !== undefined && seenVersion !== row.version) throw new StaleVersion(`conversation ${conversationId}`);
    const r = applyConversationEvent(conversationOf(row), event, ctx.actorId);
    const outcome = moved(r.outcome);
    const rows = await tx
      .update(t.conversations)
      .set({ state: r.record.state, title: r.record.title, titleBy: r.record.titleBy, version: nextVersion(t.conversations.version), updatedAt: ctx.now })
      .where(and(eq(t.conversations.id, conversationId), eq(t.conversations.version, row.version)))
      .returning({ id: t.conversations.id });
    expectOne(rows, `conversation ${conversationId}`);
    await auditConversation(tx, ctx, conversationId, outcome, event.type === "RENAME" ? { from: row.title, to: r.record.title } : {});
    return r.record;
  });
}

/** CV7: a title of 1 to 80 characters; from then on the title is the owner's. */
export function renameConversation(ctx: CommandCtx, conversationId: string, title: string): Promise<ConversationRecord> {
  return act(ctx, conversationId, { type: "RENAME", title });
}

export function archiveConversation(ctx: CommandCtx, conversationId: string): Promise<ConversationRecord> {
  return act(ctx, conversationId, { type: "ARCHIVE" });
}

export function restoreConversation(ctx: CommandCtx, conversationId: string): Promise<ConversationRecord> {
  return act(ctx, conversationId, { type: "RESTORE" });
}
