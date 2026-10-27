// The server's timer loop (src/timers.ts): a read that stopped answering is marked stale and read
// again, a fresh note is left to the chat's own read, and every timer runs, the chat command's too.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createFixtureExtractor } from "./atlas/fixture";
import { readCapture } from "./commands/atlas";
import { reportBraidEntry } from "./commands/braid";
import { beginRead, createCapture } from "./commands/capture";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { at, seededDb } from "./test/seeded-db";
import { runTimers } from "./timers";

let db: Db;
const stateOf = async (id: string) => (await db.select({ state: t.captures.state }).from(t.captures).where(eq(t.captures.id, id)))[0].state;
async function note(minutes: number, id: string) {
  const { captureId } = await createCapture({ db, now: at(minutes), actorId: "kemar" }, { channel: "app", messageId: id, kind: "text", text: "#145 is done.", messageAt: at(minutes), receivedAt: at(minutes) });
  return captureId;
}

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("the timer loop", () => {
  it("D1, D19: a read with no answer for 5 minutes is marked stale, then read again", async () => {
    const id = await note(0, "m-1");
    await beginRead({ db, now: at(0), actorId: "kemar" }, id); // the process stops mid-read
    const early = await runTimers({ db, now: () => at(4), extractor: createFixtureExtractor() });
    expect(early).toEqual({ failed: [], read: [] });
    expect(await stateOf(id)).toBe("reading");
    const later = await runTimers({ db, now: () => at(5), extractor: createFixtureExtractor() });
    expect(later.read).toEqual([id]);
    expect(await stateOf(id)).not.toBe("reading");
  });

  it("a note nobody started is left to the chat for 2 minutes, then picked up", async () => {
    const id = await note(0, "m-2");
    expect((await runTimers({ db, now: () => at(1), extractor: createFixtureExtractor() })).read).toEqual([]);
    expect((await runTimers({ db, now: () => at(2), extractor: createFixtureExtractor() })).read).toEqual([id]);
  });

  it("phase B, AC10: a chat command's card nobody answered expires after 30 minutes", async () => {
    await reportBraidEntry({ db, now: at(-5), actorId: "kemar" }, "forager", { kind: "risk", title: "Trend model may slip to 24 Oct" });
    const say = async (text: string, minutes: number, conversationId: string | null) => {
      const ctx = { db, now: at(minutes), actorId: "alicia" };
      const c = await createCapture(ctx, { channel: "app", messageId: `t-${minutes}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), conversationId });
      await readCapture(ctx, c.captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
      return c;
    };
    const asked = await say("What needs me today?", 0, null);
    await say("Approve the trend model risk", 1, asked.conversationId);
    const cards = () => db.select({ state: t.chatCommands.state }).from(t.chatCommands);
    await runTimers({ db, now: () => at(30), extractor: createFixtureExtractor() });
    expect(await cards()).toEqual([{ state: "proposed" }]);
    expect((await runTimers({ db, now: () => at(31), extractor: createFixtureExtractor() })).failed).toEqual([]);
    expect(await cards()).toEqual([{ state: "expired" }]);
  });
});
