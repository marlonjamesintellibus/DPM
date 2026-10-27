// D5 against PGlite: the timer moves milestones whose target passed, planned ones too.
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { getProject } from "../queries/project";
import { seededDb } from "../test/seeded-db";
import { runMilestoneTimers } from "./milestones";

let db: Db;
beforeEach(async () => {
  db = await seededDb({ kemarNote: false, aliciaSetsStatus: false });
}, 30_000);

// 9am in Jamaica (UTC-5)
const day = (d: string) => new Date(`${d}T14:00:00Z`);
const state = async (id: string) => (await db.select().from(t.milestones).where(eq(t.milestones.id, id)))[0].state;

describe("D5: the milestone timer", () => {
  it("a planned milestone whose target passed is missed and reads Off track; one not due yet stays planned", async () => {
    expect(await runMilestoneTimers({ db, now: day("2026-11-03") })).toEqual({ missed: expect.not.arrayContaining(["ms-prod-checks"]) });
    const r = await runMilestoneTimers({ db, now: day("2026-11-04") });
    expect(r.missed).toContain("ms-prod-checks");
    expect(await state("ms-prod-checks")).toBe("missed");
    expect(await state("ms-release-2")).toBe("planned");
    const forager = await getProject(db, "alicia", "forager", day("2026-11-04"));
    if (!forager.found) throw new Error("Alicia reads Forager");
    expect(forager.calculated.status).toBe("off_track");
  });

  it("runs once per milestone: a second run changes nothing", async () => {
    await runMilestoneTimers({ db, now: day("2026-11-04") });
    const again = await runMilestoneTimers({ db, now: day("2026-11-04") });
    expect(again.missed).toEqual([]);
  });

  it("the date is read in Jamaica: just after midnight UTC on the target's next day is still the target day there", async () => {
    // 00:30 UTC on 4 Nov is 7:30pm on 3 Nov in Jamaica
    const r = await runMilestoneTimers({ db, now: new Date("2026-11-04T00:30:00Z") });
    expect(r.missed).not.toContain("ms-prod-checks");
  });
});
