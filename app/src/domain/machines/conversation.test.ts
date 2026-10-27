// M18 (machines doc, section 16): every arrow, the owner guard, and the auto title (CV1, CV3, CV7).
import { describe, expect, it } from "vitest";
import { applyConversationEvent, autoTitle, conversationMachine, draftConversation, type ConversationEvent, type ConversationRecord, type ConversationState } from "./conversation";

const at = (state: ConversationState, patch: Partial<ConversationRecord> = {}): ConversationRecord => ({ ...draftConversation({ id: "c1", ownerId: "kemar", channel: "app" }), state, title: "Store feed", ...patch });

describe("conversation arrows", () => {
  const rows: [ConversationState, ConversationEvent, ConversationState][] = [
    ["none", { type: "FIRST_MESSAGE", text: "Finished #145." }, "active"],
    ["active", { type: "MESSAGE" }, "active"],
    ["archived", { type: "MESSAGE" }, "active"],
    ["active", { type: "RENAME", title: "Feed" }, "active"],
    ["archived", { type: "RENAME", title: "Feed" }, "archived"],
    ["active", { type: "ARCHIVE" }, "archived"],
    ["archived", { type: "RESTORE" }, "active"],
  ];
  it.each(rows)("%s --%o--> %s", (from, event, to) => {
    expect(applyConversationEvent(at(from), event, "kemar").record.state).toBe(to);
  });

  it("the rows cover every drawn arrow", () => {
    const drawn = new Set(conversationMachine.arrows.flatMap((a) => a.from.map((f) => `${f} ${a.on} ${a.to}`)));
    const tested = new Set(rows.map(([f, e, t]) => `${f} ${e.type} ${t}`));
    expect([...drawn].filter((a) => !tested.has(a))).toEqual([]);
  });

  it("only the owner acts on it", () => {
    for (const e of [{ type: "MESSAGE" }, { type: "ARCHIVE" }, { type: "RENAME", title: "x" }] as const) {
      const r = applyConversationEvent(at("active"), e, "alicia");
      expect(r.outcome.ok || r.outcome.reason).toBe("only its owner");
    }
  });

  it.each([
    ["", "give it a title"],
    ["   ", "give it a title"],
    ["x".repeat(81), "a title is at most 80 characters"],
  ])("CV7 rename to %j is refused", (title, reason) => {
    const r = applyConversationEvent(at("active"), { type: "RENAME", title }, "kemar");
    expect(r.outcome.ok || r.outcome.reason).toBe(reason);
  });

  it("a rename is the owner's from then on", () => {
    expect(applyConversationEvent(at("active"), { type: "RENAME", title: "  The feed  " }, "kemar").record).toMatchObject({ title: "The feed", titleBy: "person" });
  });

  it("nothing is archived twice or restored when active", () => {
    expect(applyConversationEvent(at("archived"), { type: "ARCHIVE" }, "kemar").outcome.ok).toBe(false);
    expect(applyConversationEvent(at("active"), { type: "RESTORE" }, "kemar").outcome.ok).toBe(false);
  });
});

describe("the auto title (CV7)", () => {
  it.each([
    ["What's blocked on Forager?", "What's blocked on Forager?"],
    ["Finished #145. The export is fixed too.", "Finished #145"],
    ["Still waiting on Kyle for the store feed, so I think the model slips a day and the buyer email moves too", "Still waiting on Kyle for the store feed, so I think the…"],
    ["", "New conversation"],
  ])("%j is titled %j", (text, title) => {
    expect(autoTitle(text)).toBe(title);
  });
  it("an empty voice note is a voice note", () => {
    expect(autoTitle("", "voice")).toBe("Voice note");
  });
});
