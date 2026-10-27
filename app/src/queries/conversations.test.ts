// Section 16 against PGlite: conversations as in Claude or ChatGPT (CV1 to CV15). Messages go into the
// conversation they were sent in; follow-ups are read with it; a correction replaces an unsaved item.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Extractor } from "../atlas/extractor";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { createCapture, openReview, saveCapture } from "../commands/capture";
import { archiveConversation, renameConversation, restoreConversation } from "../commands/conversations";
import { CommandRefused } from "../commands/core";
import type { Db } from "../db/client";
import { loadItems } from "../db/records";
import * as t from "../db/schema";
import type { CheckContext, RawProposal } from "../domain/atlas-checks/types";
import type { RawQuestion } from "../domain/question";
import { loadEarlierTurns } from "./check-context";
import { at, seededDb } from "../test/seeded-db";
import { getConversationList, getThread } from "./chat";

let db: Db;
let n = 0;
const noWait = { retryDelayMs: () => 0 };
const as = (who: string, minutes = 30) => ({ db, now: at(minutes), actorId: who });

async function send(who: string, text: string, conversationId: string | null, opts: { minutes?: number; extractor?: Extractor; channel?: "app" | "atlas" } = {}) {
  const minutes = opts.minutes ?? 30 + ++n;
  const ctx = as(who, minutes);
  const created = await createCapture(ctx, { channel: opts.channel ?? "app", messageId: `m-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), conversationId });
  if (opts.extractor !== null) await readCapture(ctx, created.captureId, opts.extractor ?? createFixtureExtractor(), noWait);
  const [row] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { ...created, row };
}

const update = (targetId: string, newValue: string, quote: string, replacesItemId: string | null = null): RawProposal => ({
  kind: "update",
  projectId: targetId === "wi-208" ? "insights" : "forager",
  routingReason: { basis: "target", evidence: quote, label: quote },
  targetId,
  field: "state",
  newValue,
  quote,
  confidence: "high",
  rationale: "Said so",
  replacesItemId,
});
/** Atlas that proposes these and says this was asked, and records what it was shown. */
function says(proposals: RawProposal[], question: RawQuestion | null = null): Extractor & { seen: CheckContext[] } {
  const seen: CheckContext[] = [];
  return { name: "fake", seen, extract: async (ctx) => (seen.push(ctx), { proposals, question, malformed: [], model: "fake", usage: null }) };
}

beforeEach(async () => {
  db = await seededDb();
}, 30_000);

describe("conversations (M18)", () => {
  it("CV15, CV4 Kemar's 8:58 Atlas note is in his Atlas conversation, which opens first", async () => {
    const list = await getConversationList(db, "kemar", at(30));
    expect(list.active.map((c) => [c.title, c.channel])).toEqual([["Atlas", "atlas"]]);
    const thread = await getThread(db, "kemar", list.active[0].id, at(30));
    expect(thread.found && thread.turns.map((c) => c.id)).toEqual(["cap-kemar-0858"]);
  });

  it("CV1 a new conversation is stored with its first message, titled from it; continuing adds to it", async () => {
    expect((await getConversationList(db, "jodian", at(30))).active).toEqual([]);
    const first = await send("jodian", "What needs me today?", null);
    const second = await send("jodian", "What's blocked on Forager?", first.conversationId);
    expect(second.conversationId).toBe(first.conversationId);
    const list = await getConversationList(db, "jodian", at(40));
    expect(list.active.map((c) => c.title)).toEqual(["What needs me today?"]);
    const thread = await getThread(db, "jodian", first.conversationId!, at(40));
    expect(thread.found && thread.turns.map((c) => c.text)).toEqual(["What needs me today?", "What's blocked on Forager?"]);
  });

  it("CV2 nobody sends into, or reads, someone else's conversation", async () => {
    const mine = await send("jodian", "What needs me today?", null);
    await expect(send("kemar", "hello?", mine.conversationId)).rejects.toBeInstanceOf(CommandRefused);
    expect((await getThread(db, "kemar", mine.conversationId!, at(40))).found).toBe(false);
    await expect(archiveConversation(as("kemar"), mine.conversationId!)).rejects.toBeInstanceOf(CommandRefused);
  });

  it("CV3, CV13 archived: off the list, nothing in it changes, and a new message brings it back", async () => {
    await archiveConversation(as("kemar"), "conv-atlas-kemar");
    let list = await getConversationList(db, "kemar", at(40));
    expect(list.active).toEqual([]);
    expect(list.archived.map((c) => c.id)).toEqual(["conv-atlas-kemar"]);
    // The 8:58 review is untouched and still reachable
    expect((await db.select().from(t.captures).where(eq(t.captures.id, "cap-kemar-0858")))[0].state).toBe("proposed");
    await send("kemar", "What needs me today?", "conv-atlas-kemar");
    list = await getConversationList(db, "kemar", at(50));
    expect(list.active.map((c) => c.id)).toEqual(["conv-atlas-kemar"]);
    await archiveConversation(as("kemar", 51), "conv-atlas-kemar");
    await restoreConversation(as("kemar", 52), "conv-atlas-kemar");
    expect((await getConversationList(db, "kemar", at(53))).active.map((c) => c.id)).toEqual(["conv-atlas-kemar"]);
  });

  it("CV4 an Atlas app message goes to the Atlas conversation, whatever is open, and brings it back if archived", async () => {
    const app = await send("kemar", "What needs me today?", null);
    await archiveConversation(as("kemar"), "conv-atlas-kemar");
    const atlas = await send("kemar", "#208 is done.", null, { channel: "atlas", extractor: null as unknown as Extractor });
    expect(atlas.conversationId).toBe("conv-atlas-kemar");
    expect(app.conversationId).not.toBe("conv-atlas-kemar");
    expect((await getConversationList(db, "kemar", at(60))).archived).toEqual([]);
  });

  it("CV7 a rename is kept, and a bad one is refused", async () => {
    await renameConversation(as("kemar"), "conv-atlas-kemar", "My Atlas notes");
    await expect(renameConversation(as("kemar"), "conv-atlas-kemar", " ")).rejects.toBeInstanceOf(CommandRefused);
    expect((await getConversationList(db, "kemar", at(40))).active[0].title).toBe("My Atlas notes");
  });

  it("CV14 a notice about something Kemar reported in a conversation shows in that conversation", async () => {
    await openReview(as("kemar", 1), "cap-kemar-0858");
    for (const item of (await loadItems(db, "cap-kemar-0858")).items.filter((i) => i.state === "needs_ok")) {
      await (await import("../commands/capture")).decideExtraction(as("kemar", 1), item.id, { type: "accept" });
    }
    await saveCapture(as("kemar", 2), "cap-kemar-0858");
    const risk = (await db.select().from(t.braidEntries).where(eq(t.braidEntries.title, "Trend model may slip to 24 Oct")))[0];
    await (await import("../commands/braid")).decideBraidEntry({ db, now: at(5), actorId: "alicia" }, risk.id, { type: "approve", note: "Logged" });
    const other = await send("kemar", "What needs me today?", null, { minutes: 6 });
    const atlas = await getThread(db, "kemar", "conv-atlas-kemar", at(10));
    const newer = await getThread(db, "kemar", other.conversationId!, at(10));
    expect(atlas.found && atlas.notices.map((x) => x.text)).toContain("Alicia approved your risk: Trend model may slip to 24 Oct. Note: Logged");
    expect(newer.found && newer.notices).toEqual([]);
  });
});

describe("follow-ups read with the conversation", () => {
  it("CV8 'and on GQ & Academy?' after a blocked question is answered as blocked, for GQ", async () => {
    const first = await send("alicia", "What's blocked on Forager?", null);
    const next = await send("alicia", "and on GQ & Academy?", first.conversationId);
    expect(next.row.question).toEqual({ asked: "and on GQ & Academy?", topic: "blocked", projectId: "gq" });
    expect(next.row.answer?.text).toBe("Nothing is blocked on GQ & Academy.");
  });

  it("CV9 the same follow-up in a new conversation asks for the whole question", async () => {
    const lone = await send("alicia", "and on that one?", null);
    expect(lone.row.answer?.text).toBe("I'm not sure what you mean. Ask the whole question, for example: What's blocked on Forager?");
  });

  it("CV11 Atlas reads only this conversation's earlier messages, the asker's own, and the unsaved items in them", async () => {
    const atlas = says([update("wi-208", "done", "#208 is done")]);
    const first = await send("kemar", "#208 is done.", null, { extractor: atlas });
    await send("kemar", "What needs me today?", null); // another conversation: never read with this one
    const probe = says([]);
    await send("kemar", "Actually not yet.", first.conversationId, { extractor: probe });
    const earlier = probe.seen[0].earlier ?? [];
    expect(earlier.map((e) => e.text)).toEqual(["#208 is done."]);
    expect(earlier[0].openItems).toEqual([{ id: `${first.captureId}-1`, summary: "update work_item wi-208: state to done" }]);
  });
});

describe("corrections (CV10 to CV12)", () => {
  it("CV10 'actually it was #145' before the earlier update is saved: the earlier item is withdrawn as replaced", async () => {
    const first = await send("kemar", "#208 is done.", null, { extractor: says([update("wi-208", "done", "#208 is done")]) });
    const itemId = `${first.captureId}-1`;
    await send("kemar", "Sorry, I meant #145 is done, not #208.", first.conversationId, { extractor: says([update("wi-145", "done", "#145 is done", itemId)]) });
    const [old] = (await loadItems(db, first.captureId)).items;
    expect(old).toMatchObject({ state: "withdrawn", withdrawn: "replaced" });
  });

  it("CV11 after the earlier update was saved, the correction is a new update and the saved change stays", async () => {
    const first = await send("kemar", "#208 is done.", null, { extractor: says([update("wi-208", "done", "#208 is done")]) });
    await openReview(as("kemar", 70), first.captureId);
    await saveCapture(as("kemar", 71), first.captureId);
    const itemId = `${first.captureId}-1`;
    const fix = await send("kemar", "Sorry, #145 is done, not #208.", first.conversationId, { minutes: 72, extractor: says([update("wi-145", "done", "#145 is done", itemId)]) });
    expect((await loadItems(db, first.captureId)).items[0].state).not.toBe("withdrawn");
    expect((await loadItems(db, fix.captureId)).items[0].draft.replaces).toBeUndefined();
  });

  it("CV12 a correction naming an item from another conversation keeps no link", async () => {
    const elsewhere = await send("kemar", "#208 is done.", null, { extractor: says([update("wi-208", "done", "#208 is done")]) });
    const here = await send("kemar", "What needs me today?", null);
    const fix = await send("kemar", "Sorry, #145 is done.", here.conversationId, { extractor: says([update("wi-145", "done", "#145 is done", `${elsewhere.captureId}-1`)]) });
    expect((await loadItems(db, elsewhere.captureId)).items[0].state).not.toBe("withdrawn");
    expect((await loadItems(db, fix.captureId)).items[0].draft.replaces).toBeUndefined();
  });

  it("loadEarlierTurns is empty for a message outside any conversation", async () => {
    expect(await loadEarlierTurns(db, "no-such-capture")).toEqual([]);
  });
});
