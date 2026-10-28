// The latest saved time the demo clock carries on from after a restart (src/app/_lib/clock.ts).
import { describe, expect, it } from "vitest";
import { createCapture } from "../commands/capture";
import { notice } from "../commands/notices";
import { at, seededDb } from "../test/seeded-db";
import { latestSavedAt } from "./latest-saved";

describe("latestSavedAt", () => {
  it("is no later than 9:10am on the fresh snapshot", async () => {
    const db = await seededDb();
    const latest = await latestSavedAt(db);
    expect(latest!.getTime()).toBeLessThanOrEqual(at(0).getTime());
  });

  it("is the latest of a command, a note and a notice", async () => {
    const db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
    await createCapture({ db, now: at(20), actorId: "kemar" }, { channel: "app", messageId: "m-1", kind: "text", text: "#145 is done.", messageAt: at(20), receivedAt: at(20) });
    expect(await latestSavedAt(db)).toEqual(at(20));
    await db.transaction((tx) => notice(tx, at(119), ["kemar"], "Alicia made it a blocker, as you asked.", { type: "kind_request", id: "kr-1", projectId: "forager", act: "switched" }));
    expect(await latestSavedAt(db)).toEqual(at(119));
  });
});
