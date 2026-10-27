import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { seededDb } from "../test/seeded-db";
import { getChatSummary } from "./chat";

let db: Db;
beforeEach(async () => {
  db = await seededDb();
});

describe("getChatSummary (L18f)", () => {
  it("Kemar's latest capture: one update, two projects, 4 need his OK", async () => {
    const { latest } = await getChatSummary(db, "kemar");
    expect(latest).toMatchObject({
      id: "cap-kemar-0858",
      channel: "whatsapp",
      kind: "voice",
      time: "8:58am",
      state: "proposed",
      changes: 9,
      projects: 2,
      needsOk: 4,
      needsProject: 0,
      personal: 0,
      notFiled: 0,
      line: "Got it. 9 updates for 2 projects; 4 need your OK.",
    });
    expect(latest!.rows).toEqual([
      { projectId: "forager", name: "Forager 2.0", changes: 7, needsOk: 4 },
      { projectId: "insights", name: "Store Insights", changes: 2, needsOk: 0 },
    ]);
  });

  it("after Save, the line says so", async () => {
    await db
      .update(t.extractions)
      .set({ state: "applied" })
      .where(and(eq(t.extractions.captureId, "cap-kemar-0858"), notInArray(t.extractions.ordinal, [1, 5])));
    await db.update(t.captures).set({ state: "saved" }).where(eq(t.captures.id, "cap-kemar-0858"));
    const { latest } = await getChatSummary(db, "kemar");
    expect(latest!.line).toBe("Saved. 9 updates for 2 projects.");
  });

  it("only the viewer's own captures, newest first", async () => {
    expect(await getChatSummary(db, "alicia")).toEqual({ viewerId: "alicia", latest: null });
    expect(await getChatSummary(db, "andre")).toEqual({ viewerId: "andre", latest: null });

    await db.insert(t.captures).values({
      id: "cap-kemar-1400",
      authorId: "kemar",
      channel: "app",
      kind: "text",
      text: "morning!",
      messageAt: new Date("2026-10-20T19:00:00Z"),
      receivedAt: new Date("2026-10-20T19:00:01Z"),
      dedupKey: "kemar-1400",
      state: "nothing_to_update",
    });
    const { latest } = await getChatSummary(db, "kemar");
    expect(latest).toMatchObject({ id: "cap-kemar-1400", time: "2:00pm", changes: 0, rows: [], line: "Got it. Nothing in this one changes a project." });
  });
});
