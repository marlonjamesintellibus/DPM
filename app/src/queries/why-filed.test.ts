// Phase L: "Why did you file that?" against the seeded 9:10am snapshot, where Kemar's 8:58 note waits for
// his review. His own items only, each with the routing reason, the deciding words and the match (UN7, P10).
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createCapture, proposeItems } from "../commands/capture";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { at, seededDb } from "../test/seeded-db";

let db: Db;

async function asks(who: string, text: string) {
  const { captureId } = await createCapture({ db, now: at(1), actorId: who }, { channel: "app", kind: "text", text, messageAt: at(1), receivedAt: at(1), messageId: `why-${who}-${text}` });
  return (await proposeItems({ db, now: at(1), actorId: who }, captureId, [], { model: "fixture", question: { asked: text, topic: "why_filed", projectId: null } })).answer!;
}

describe("why did you file that?", () => {
  beforeEach(async () => {
    db = await seededDb();
  }, 30_000);

  it("explains each item of the asker's latest update: where, why, the words, and the match", async () => {
    const answer = await asks("kemar", "Why did you file that?");
    expect(answer.text).toBe("Here's where each part of your 8:58am update went, and why.");
    expect(answer.cards).toHaveLength(7); // 11 items: 7 cards and "4 more in the review" (MF11)
    expect(answer.more).toMatchObject({ label: "4 more in the review", href: "/review/cap-kemar-0858" });
    const blocked = answer.cards.find((c) => c.title.startsWith("Issue #151"))!;
    expect(blocked).toMatchObject({ tag: "Forager 2.0", href: "/review/cap-kemar-0858" });
    expect(blocked.detail).toBe('Filed in Forager 2.0 because: Kyle is the contact on #151. You said "Still waiting on Kyle for the store feed".');
    const same = answer.cards.find((c) => c.title === "Blocker: Store sales feed access")!;
    expect(same.detail).toContain('It\'s the same as "Store sales feed access" on the log.');
  });

  it("a named record of theirs: only that item", async () => {
    const answer = await asks("kemar", "Why did #208 go to Store Insights?");
    expect(answer.cards).toHaveLength(1);
    expect(answer.cards[0].detail).toContain('Filed in Store Insights because: "On Store Insights". You said "On Store Insights, the weekly sales export is fixed".');
  });

  it("UN7: someone else's item, or none of theirs: only their own updates", async () => {
    expect((await asks("alicia", "Why did you file #151?")).text).toBe("I can only tell you about your own updates.");
    expect((await asks("andre", "Why did you file that?")).text).toBe("I can only tell you about your own updates.");
    expect((await asks("kemar", "Why did #160 go to Forager?")).text).toBe("I can only tell you about your own updates.");
  });

  it("UN7: someone else's item named by title or by whose it is gets the same answer, never the asker's latest update", async () => {
    expect((await asks("kemar", "Why did you file Feature store backfill?")).text).toBe("I can only tell you about your own updates.");
    expect((await asks("kemar", "Why did you file Alicia's risk?")).text).toBe("I can only tell you about your own updates.");
  });

  it("a record or person named in the asker's own update: only those items", async () => {
    const byTitle = await asks("kemar", "Why did you file Store sales feed access?");
    // #151 is called that too: both are about it
    expect(byTitle.cards.map((c) => c.title)).toEqual(["Issue #151 Store sales feed access: In progress to Blocked: waiting on Kyle (Sprouts IT)", "Blocker: Store sales feed access"]);
    const byPerson = await asks("kemar", "Why did you file Kyle's blocker?");
    expect(byPerson.cards.length).toBeGreaterThan(0);
    expect(byPerson.cards.every((c) => c.detail?.includes("Kyle"))).toBe(true);
  });

  it("P10: an item in a project the asker has left is left out, with its match", async () => {
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "insights"), eq(t.projectMemberships.personId, "kemar")));
    const answer = await asks("kemar", "Why did you file that?");
    expect(JSON.stringify(answer)).not.toContain("Store Insights");
    expect(JSON.stringify(answer)).not.toContain("refresh");
  });
});
