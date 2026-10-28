// pnpm db:reset: an empty database, migrated, with the 20 Oct snapshot loaded.
// Local PGlite: deletes app/.data/pglite (or DPM_DATA_DIR) first (stop `pnpm dev` before running this).
// Postgres (DATABASE_URL): drops and recreates the schema, so it asks for --yes. --e2e adds the browser
// story's own data (`pnpm e2e` runs it so).
import { rmSync } from "node:fs";
import { sql } from "drizzle-orm";
import { openPglite, openPostgres, pgliteDir } from "../src/db/client";
import { seedE2e } from "../src/db/seed/e2e";
import { seedSnapshot } from "../src/db/seed/seed";

async function main() {
  const url = process.env.DATABASE_URL;
  if (url && !process.argv.includes("--yes")) {
    console.error("DATABASE_URL is set: this would delete every row in that database. Run `pnpm db:reset --yes` if you mean it.");
    process.exit(1);
  }

  let opened;
  if (url) {
    opened = openPostgres(url);
    await opened.db.execute(sql`drop schema if exists drizzle cascade`);
    await opened.db.execute(sql`drop schema if exists public cascade`);
    await opened.db.execute(sql`create schema public`);
  } else {
    const dir = pgliteDir();
    rmSync(dir, { recursive: true, force: true });
    opened = openPglite(dir);
  }

  try {
    await opened.migrate();
    const summary = await seedSnapshot(opened.db);
    // --e2e: the browser story's own data on top (src/db/seed/e2e.ts)
    const e2e = process.argv.includes("--e2e");
    if (e2e) await seedE2e(opened.db);
    console.log(
      `Seeded the ${url ? "Postgres" : "PGlite"} database: ${summary.projects} projects, Forager 2.0 calculated ${summary.foragerCalculated} and set Off track, ${summary.extractions} items from Kemar's note, ${summary.inboxItems} open inbox item${e2e ? ", and the story's own data" : ""}.`,
    );
  } finally {
    await opened.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
