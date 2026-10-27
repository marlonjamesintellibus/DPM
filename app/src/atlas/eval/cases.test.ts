// The evaluation cases name only records and entries their author can actually reach (D22).
import { describe, expect, it } from "vitest";
import { seededDb } from "../../test/seeded-db";
import { EVAL_CASES } from "./cases";
import { caseContext, evalContexts } from "./contexts";

describe("evaluation cases", () => {
  it("every id an expected item names is in its author's candidate data", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    for (const c of EVAL_CASES) {
      const ctx = caseContext(c, contexts);
      const records = new Set(ctx.projects.flatMap((p) => p.records.map((r) => r.id)).concat(ctx.leave.targetId));
      const entries = new Set(ctx.projects.flatMap((p) => p.braid.map((e) => e.id)));
      const projects = new Set(ctx.projects.map((p) => p.id).concat("none"));
      for (const key of c.expect.flat()) {
        const [type, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
        if (type === "upd" || type === "ask") expect(records, `${c.id}: ${key}`).toContain(rest.slice(0, rest.indexOf(".")));
        if (type === "track") expect(projects, `${c.id}: ${key}`).toContain(rest);
        if (type === "same" || type === "resolve" || type === "supersede") expect(entries, `${c.id}: ${key}`).toContain(rest);
        if (type === "outcome") expect(entries, `${c.id}: ${key}`).toContain(rest.split("=")[0]);
        if (type === "new") expect(projects, `${c.id}: ${key}`).toContain(rest.split(":")[1].split("@")[0]);
      }
    }
  });

  it("Andre's data has nothing of Forager's, and Alicia's has her two projects", async () => {
    const contexts = await evalContexts(await seededDb({ kemarNote: false, aliciaSetsStatus: false }));
    expect(contexts.andre.projects.map((p) => p.id)).toEqual(["insights"]);
    expect(contexts.alicia.projects.map((p) => p.id).sort()).toEqual(["forager", "gq"]);
  });
});
