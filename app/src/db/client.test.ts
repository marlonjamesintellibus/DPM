import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openPglite } from "./client";
import { appMeta } from "./schema";

describe("database", () => {
  it("runs the migrations on an in-memory PGlite and round-trips a row", async () => {
    const { db, migrate } = openPglite();
    await migrate();

    await db.insert(appMeta).values({ key: "phase", value: "0" });
    const rows = await db.select().from(appMeta).where(eq(appMeta.key, "phase"));

    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("0");
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
  });

  it("opens an on-disk PGlite whose parent folders do not exist yet", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dpm-db-"));
    try {
      const { db, migrate } = openPglite(path.join(root, "nested", "pglite"));
      await migrate();
      await db.insert(appMeta).values({ key: "disk", value: "yes" });
      expect(await db.select().from(appMeta)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("can run the migrations twice without failing", async () => {
    const { migrate } = openPglite();
    await migrate();
    await expect(migrate()).resolves.toBeUndefined();
  });
});
