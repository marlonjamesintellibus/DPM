// M18. Conversation (Stage). Machines doc, section 16: the chat works as Claude or ChatGPT do. A person
// starts a new conversation or continues one; Atlas app messages go into their own. A conversation only
// groups its owner's captures (each message is still its own capture, M1 and M2), is private to its
// owner, and is archived, never deleted, because updates in it may already have changed projects.
import { defineMachine, transition, type Outcome } from "../machine";

export const CONVERSATION_STATES = ["none", "active", "archived"] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export type ConversationRecord = {
  id: string;
  ownerId: string;
  state: ConversationState;
  title: string;
  /** "person" once the owner renames it; the auto title never replaces theirs. */
  titleBy: "auto" | "person";
  /** "atlas" for the Atlas app's chat, "app" for one started in DPM. */
  channel: "app" | "atlas";
  /** The Atlas chat it mirrors; "dm" for the app's direct chat until Atlas sends chat ids. */
  atlasChatId: string | null;
};

export type ConversationEvent =
  | { type: "FIRST_MESSAGE"; text: string }
  | { type: "MESSAGE" }
  | { type: "RENAME"; title: string }
  | { type: "ARCHIVE" }
  | { type: "RESTORE" };

type Ctx = { record: ConversationRecord; actorId: string };

export const TITLE_MAX = 80;
const AUTO_TITLE_NEAR = 60;

/** CV7: the first message's first sentence, cut at a word near 60 characters. */
export function autoTitle(text: string, kind: "text" | "voice" = "text"): string {
  const first = text.trim().split(/(?<=[.!?])\s+|\n+/)[0]?.trim() ?? "";
  if (!first) return kind === "voice" ? "Voice note" : "New conversation";
  if (first.length <= AUTO_TITLE_NEAR) return first.replace(/[.!]$/, "");
  const cut = first.slice(0, AUTO_TITLE_NEAR + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut.slice(0, AUTO_TITLE_NEAR)).replace(/[,;:]$/, "")}…`;
}

const ownerGuard = ({ record, actorId }: Ctx) => (record.ownerId === actorId ? null : "only its owner");

// CV7: a title is theirs to name, but never empty and never longer than a line
function renameGuard(c: Ctx, e: Extract<ConversationEvent, { type: "RENAME" }>): string | null {
  const title = e.title.trim();
  return ownerGuard(c) ?? (!title ? "give it a title" : title.length > TITLE_MAX ? `a title is at most ${TITLE_MAX} characters` : null);
}

export const conversationMachine = defineMachine<ConversationState, ConversationEvent, Ctx>({
  name: "conversation",
  states: CONVERSATION_STATES,
  arrows: [
    // CV1: a conversation is stored with its first message, never empty
    { from: ["none"], on: "FIRST_MESSAGE", to: "active", guard: ownerGuard },
    { from: ["active"], on: "MESSAGE", to: "active", guard: ownerGuard },
    // CV3, CV4: sending to an archived conversation, or an Atlas message arriving, brings it back
    { from: ["archived"], on: "MESSAGE", to: "active", guard: ownerGuard },
    ...(["active", "archived"] as const).map((s) => ({ from: [s], on: "RENAME" as const, to: s, guard: renameGuard })),
    { from: ["active"], on: "ARCHIVE", to: "archived", guard: ownerGuard },
    { from: ["archived"], on: "RESTORE", to: "active", guard: ownerGuard },
  ],
});

export type ConversationResult = { outcome: Outcome<ConversationState>; record: ConversationRecord };

/** Applies one event. A refused event returns the record unchanged. */
export function applyConversationEvent(record: ConversationRecord, event: ConversationEvent, actorId: string): ConversationResult {
  const outcome = transition(conversationMachine, record.state, event, { record, actorId });
  if (!outcome.ok) return { outcome, record };
  const next = { ...record, state: outcome.to };
  switch (event.type) {
    case "FIRST_MESSAGE":
      return { outcome, record: { ...next, title: record.titleBy === "person" ? record.title : record.title || autoTitle(event.text) } };
    case "RENAME":
      return { outcome, record: { ...next, title: event.title.trim(), titleBy: "person" } };
    default:
      return { outcome, record: next };
  }
}

/** A conversation about to be started; nothing is stored until its first message (CV1). */
export function draftConversation(fields: { id: string; ownerId: string; channel: "app" | "atlas"; atlasChatId?: string | null; title?: string }): ConversationRecord {
  return { id: fields.id, ownerId: fields.ownerId, channel: fields.channel, atlasChatId: fields.atlasChatId ?? null, state: "none", title: fields.title ?? "", titleBy: "auto" };
}
