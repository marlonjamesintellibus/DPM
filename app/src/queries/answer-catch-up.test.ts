// Phase P against PGlite: "Catch me up" (LV5 to LV7), asked through the same read as an update with the recorded
// fixture, whose rule spots it. Kemar's leave is Mon 26 to Fri 30 Oct, approved in the seed; before it he asks Jodian
// to cover #152 Store feed connector, due Tue 27 Oct, and she accepts. What happened while he was away comes from the
// per-viewer queries (P10): notices to him, and a status Alicia set on Forager.
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createFixtureExtractor } from "../atlas/fixture";
import { readCapture } from "../commands/atlas";
import { createCapture, decideExtraction, openReview, proposeItems, saveCapture } from "../commands/capture";
import { answerCover, askCover } from "../commands/cover";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { at, seededDb } from "../test/seeded-db";

let db: Db;
let n = 0;
const DAY = 24 * 60;
/** 9:30am on a later day: Wed 28 Oct is 8 days on, Mon 2 Nov 13. */
const morning = (days: number) => days * DAY + 20;
const as = (actorId: string, minutes = 0) => ({ db, now: at(minutes), actorId });

async function ask(who: string, text: string, minutes: number) {
  const ctx = as(who, minutes);
  const created = await createCapture(ctx, { channel: "app", messageId: `c-${++n}`, kind: "text", text, messageAt: ctx.now, receivedAt: ctx.now });
  await readCapture(ctx, created.captureId, createFixtureExtractor(), { retryDelayMs: () => 0 });
  const [row] = await db.select().from(t.captures).where(eq(t.captures.id, created.captureId));
  return { question: row.question!, answer: row.answer! };
}

/** Kemar says his leave, saves, and Jodian accepts covering #152 before it starts. */
async function coveredBeforeLeave() {
  const { captureId } = await createCapture(as("kemar"), { channel: "app", messageId: `c-${++n}`, kind: "text", text: "I'm off Monday 26 Oct to Friday 30 Oct.", messageAt: at(0), receivedAt: at(0) });
  await proposeItems(as("kemar"), captureId, [
    { kind: "update", projectId: null, routingReason: { basis: "personal", evidence: "I'm off", label: "Personal" }, targetId: "leave-kemar", field: "dates", newValue: "", quote: "I'm off Monday 26 Oct to Friday 30 Oct", confidence: "high", rationale: "Leave" },
  ]);
  await openReview(as("kemar"), captureId);
  await saveCapture(as("kemar"), captureId);
  const { record } = await askCover(as("kemar", 1), "lv-kemar-oct", "jodian", ["work_item:wi-152"], "pick");
  await answerCover(as("jodian", 2), record.id, { act: "accept" }, "yes");
}

/** A notice to Kemar at a time, about a project or none, as Atlas tells him things (D15). */
const noticeAt = (minutes: number, text: string, projectId: string | null) =>
  db.insert(t.notices).values({ id: `ntc-test-${++n}`, personId: "kemar", at: at(minutes), text, subjectType: "braid_entry", subjectId: "br-feed-blocker", projectId });

beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

describe("catch me up", () => {
  it("after his leave: what happened since it began, and what was handed over and where it stands now", async () => {
    await coveredBeforeLeave();
    await noticeAt(morning(3), "Alicia approved your risk: before the leave.", "forager");
    await noticeAt(morning(7), "Alicia approved your risk: while away.", "forager");
    const { question, answer } = await ask("kemar", "I'm back, what did I miss?", morning(13));
    expect(question).toMatchObject({ topic: "catch_up", projectId: null });
    expect(answer.text).toBe("Since your leave began Mon 26 Oct: 1 update on your projects. 1 thing was covered for you.");
    expect(answer.cards.map((c) => [c.title, c.detail, c.tag])).toEqual([
      ["#152 Store feed connector", "Forager 2.0: Jodian covered it. Now To do, due Tue 27 Oct", "Handed over"],
      ["Alicia approved your risk: while away.", "Forager 2.0: 6 days ago", "For you"],
    ]);
  });

  it("LV6: back early, it covers every day since the leave began", async () => {
    await coveredBeforeLeave();
    await noticeAt(morning(6) + 60, "Alicia approved your risk: Monday.", "forager");
    const { answer } = await ask("kemar", "Catch me up", morning(8));
    expect(answer.text).toBe("Since your leave began Mon 26 Oct: 1 update on your projects. 1 thing was covered for you.");
  });

  it("LV7: a project he left while away is not shown, nor what was covered on it", async () => {
    await coveredBeforeLeave();
    await noticeAt(morning(7), "Andre approved your decision.", "insights");
    await noticeAt(morning(7), "Alicia approved your risk.", "forager");
    await db.update(t.projectMemberships).set({ state: "left" }).where(and(eq(t.projectMemberships.projectId, "forager"), eq(t.projectMemberships.personId, "kemar")));
    const { answer } = await ask("kemar", "Catch me up", morning(13));
    expect(answer.text).toBe("Since your leave began Mon 26 Oct: 1 update on your projects.");
    expect(answer.cards.map((c) => c.title)).toEqual(["Andre approved your decision."]);
  });

  it("LV5: no leave on record, since his last saved update, at most 7 days back", async () => {
    // Before his leave starts there is none to catch up from
    const { captureId } = await createCapture(as("kemar"), { channel: "app", messageId: `c-${++n}`, kind: "text", text: "Finished #145.", messageAt: at(0), receivedAt: at(0) });
    const { items } = await proposeItems(as("kemar"), captureId, [
      { kind: "update", projectId: "forager", routingReason: { basis: "target", evidence: "#145", label: "#145" }, targetId: "wi-145", field: "state", newValue: "done", quote: "Finished #145", confidence: "high", rationale: "Done" },
    ]);
    await openReview(as("kemar"), captureId);
    if (items[0].state === "needs_ok") await decideExtraction(as("kemar"), items[0].id, { type: "accept" });
    await saveCapture(as("kemar"), captureId);
    await noticeAt(DAY, "Alicia approved your risk.", "forager");
    const { answer } = await ask("kemar", "Catch me up", morning(2));
    expect(answer.text).toBe("Since your last update, Tue 20 Oct, 9:10am: 1 update on your projects.");
    // Andre has neither leave nor a saved update: the last 7 days
    expect((await ask("andre", "Catch me up", morning(2))).answer.text).toBe("Nothing new on your projects in the last 7 days.");
  });

  it("is its own topic: \"Any updates?\" stays the updates cursor", async () => {
    await coveredBeforeLeave();
    expect((await ask("kemar", "Any updates?", morning(13))).question.topic).toBe("updates");
  });
});
