// The server's timer loop (src/timers.ts): a read that stopped answering is marked stale and read
// again, a fresh note is left to the chat's own read, and every timer runs.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createFixtureExtractor } from "./atlas/fixture";
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
});
