// A fresh in-memory database with the 20 Oct snapshot, for tests of commands and queries.
// Migrating and seeding PGlite is slow, so it happens once per test worker; each test then gets
// its own database restored from that data folder, isolated from every other test.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { openPglite, type Db } from "../db/client";
import * as schema from "../db/schema";
import { seedSnapshot, type SeedOptions } from "../db/seed/seed";

/** 9:10am in Jamaica on Tuesday 20 Oct 2026: the moment the story's screens show. */
export const AT_910 = new Date("2026-10-20T14:10:00Z");

/** Minutes after 9:10am, for steps later in the story. */
export const at = (minutesAfter910: number) => new Date(AT_910.getTime() + minutesAfter910 * 60_000);

const templates = new Map<string, Promise<File | Blob>>();

function template(options: SeedOptions): Promise<File | Blob> {
  const key = JSON.stringify(options);
  let dump = templates.get(key);
  if (!dump) {
    dump = (async () => {
      const opened = openPglite();
      await opened.migrate();
      await seedSnapshot(opened.db, options);
      const client = (opened.db as unknown as { $client: PGlite }).$client;
      const data = await client.dumpDataDir("none");
      await opened.close();
      return data;
    })();
    templates.set(key, dump);
  }
  return dump;
}

/** The snapshot at 9:10am. `{ kemarNote: false, aliciaSetsStatus: false }` gives the world only. */
export async function seededDb(options: SeedOptions = {}): Promise<Db> {
  const client = new PGlite({ loadDataDir: await template(options) });
  return drizzle({ client, schema });
}
