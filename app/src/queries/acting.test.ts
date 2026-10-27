// Phase B against PGlite: where a line's record stands for a person now (the same read offers an act and
// guards it), what changed since an answer, and which answer is open in a conversation.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { reportBraidEntry } from "../commands/braid";
import { createCapture } from "../commands/capture";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { at, seededDb } from "../test/seeded-db";
import { lineActions, standingOf, whatChanged } from "./acting";
import { loadOpenAnswer } from "./check-context";

let db: Db;
let n = 0;
const work = (id: string) => ({ type: "work_item" as const, id, projectId: "forager" });
const forager = { type: "project" as const, id: "forager", projectId: "forager" };

async function say(who: string, text: string, minutes: number, conversationId: string | null = null) {
  const ctx = { db, now: at(minutes), actorId: who };
  const c = await createCapture(ctx, { channel: "app", messageId: `a-${++n}`, kind: "text", text, messageAt: at(minutes), receivedAt: at(minutes), conversationId });
  await readCapture(ctx, c.captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
  return c;
}

beforeEach(async () => {
  db = await seededDb({ kemarNote: false });
}, 30_000);

describe("standingOf: the right held now (rule 4)", () => {
  it("work: its owner, or a PM or Lead of the project; another member does not", async () => {
    const done = { act: "mark_done" as const, subject: work("wi-152"), proposal: null };
    expect(await standingOf(db, "kemar", done)).toMatchObject({ right: true, version: 1 });
    expect((await standingOf(db, "alicia", done)).right).toBe(true);
    expect((await standingOf(db, "jodian", done)).right).toBe(false);
    // P10: a project they cannot read holds no right on it
    expect((await standingOf(db, "andre", done)).right).toBe(false);
  });

  it("a status reason: the project's owner, or a PM or Lead (M9)", async () => {
    const reason = { act: "give_reason" as const, subject: forager, proposal: null };
    expect((await standingOf(db, "alicia", reason)).right).toBe(true);
    expect((await standingOf(db, "kemar", reason)).right).toBe(false);
  });

  it("deciding a proposal is the decider's right; saying it ended is decided by those who resolve", async () => {
    const risk = (await reportBraidEntry({ db, now: at(0), actorId: "kemar" }, "forager", { kind: "risk", title: "Trend model may slip" })).entry.id;
    const subject = { type: "braid_entry" as const, id: risk, projectId: "forager" };
    expect((await standingOf(db, "alicia", { act: "approve", subject, proposal: "entry" })).right).toBe(true);
    expect((await standingOf(db, "kemar", { act: "approve", subject, proposal: "entry" })).right).toBe(false);
    // S13: the owner of the blocked work resolves a blocker; Kemar owns #151, which br-feed-blocker holds
    await db.update(t.workItems).set({ blockedLinks: ["br-feed-blocker"] }).where(eq(t.workItems.id, "wi-151"));
    const blocker = { type: "braid_entry" as const, id: "br-feed-blocker", projectId: "forager" };
    expect((await standingOf(db, "kemar", { act: "resolve", subject: blocker, proposal: null })).right).toBe(true);
    expect((await standingOf(db, "jodian", { act: "resolve", subject: blocker, proposal: null })).right).toBe(false);
    // Gone from the project: no right, whatever the role was
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "alicia")));
    expect((await standingOf(db, "alicia", { act: "approve", subject, proposal: "entry" })).right).toBe(false);
  });

  it("a record that is gone has no version, so a command on it is refused as changed", async () => {
    expect((await standingOf(db, "kemar", { act: "mark_done", subject: work("wi-nope"), proposal: null })).version).toBeNull();
  });
});

describe("lineActions: what a line offers now", () => {
  it("only acts its card is for, that the viewer holds, on a record in the right state", async () => {
    expect((await lineActions(db, "kemar", work("wi-152"), ["mark_done", "unblock"])).map((a) => a.act)).toEqual(["mark_done"]);
    expect(await lineActions(db, "kemar", work("wi-152"), [])).toEqual([]);
    // Mark done only on their own work, even for a PM
    expect(await lineActions(db, "alicia", work("wi-152"), ["mark_done"])).toEqual([]);
    expect(await lineActions(db, "kemar", work("wi-142"), ["mark_done"])).toEqual([]); // already done
    // Alicia set Off track at 9:02 with no reason: Give a reason
    expect((await lineActions(db, "alicia", forager, ["give_reason"])).map((a) => a.act)).toEqual(["give_reason"]);
    expect(await lineActions(db, "kemar", forager, ["give_reason"])).toEqual([]);
  });
});

describe("whatChanged (AC2, AC3)", () => {
  it("says who did what and when, or that a rule changed it", async () => {
    const subject = work("wi-152");
    expect(await whatChanged(db, "kemar", subject, at(10))).toBe("This changed since your answer.");
    await db.insert(t.auditEntries).values({ at: at(5), actorType: "rule", action: "CALCULATED_CHANGED", subjectType: "work_item", subjectId: "wi-152" });
    expect(await whatChanged(db, "kemar", subject, at(10))).toBe("This changed at 9:15am, after your answer.");
    await db.insert(t.auditEntries).values({ at: at(6), actorType: "person", actorId: "alicia", action: "FINISH", subjectType: "work_item", subjectId: "wi-152" });
    expect(await whatChanged(db, "kemar", subject, at(10))).toBe("Alicia marked this done at 9:16am.");
    expect(await whatChanged(db, "alicia", subject, at(10))).toBe("You marked this done at 9:16am.");
    expect(await whatChanged(db, "alicia", subject, at(2 * 24 * 60))).toBe("You marked this done at 9:16am on 20 Oct.");
  });
});

describe("loadOpenAnswer: the answer a reply acts on", () => {
  it("the newest answer of the asker's own in this conversation; small talk does not close it, another conversation is not read", async () => {
    const first = await say("alicia", "What needs me today?", 0);
    const thanks = await say("alicia", "Thanks!", 1, first.conversationId);
    const open = await loadOpenAnswer(db, thanks.captureId);
    expect(open).toMatchObject({ captureId: first.captureId, asked: "What needs me today?", asOf: at(0).toISOString() });
    expect(open!.lines.find((l) => l.subject?.type === "project")).toMatchObject({ acts: ["give_reason"] });
    const second = await say("alicia", "What's blocked?", 2, first.conversationId);
    const reply = await say("alicia", "Thanks", 3, first.conversationId);
    expect((await loadOpenAnswer(db, reply.captureId))!.captureId).toBe(second.captureId);
    const elsewhere = await say("alicia", "Approve the second one", 4);
    expect(await loadOpenAnswer(db, elsewhere.captureId)).toBeNull();
  });
});
