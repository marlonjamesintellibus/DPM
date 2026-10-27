import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema";

// Both drivers share PgDatabase, so queries are written once against this type.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type Opened = { db: Db; migrate: () => Promise<void> };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

// PGlite: Postgres in process. No dataDir means in memory (tests).
// PGlite creates only the last folder of dataDir, so create the parents first.
export function openPglite(dataDir?: string): Opened {
  if (dataDir) mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite({ client, schema });
  return { db, migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS }) };
}

export function openPostgres(url: string): Opened {
  const db = drizzlePg({ connection: url, schema });
  return { db, migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS }) };
}

// One database per server process: Postgres when DATABASE_URL is set,
// otherwise PGlite in app/.data/pglite. Migrations run once, on first use.
// A failed open is not cached, so the next request tries again.
const globalForDb = globalThis as unknown as { dpmDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.dpmDb ??= (async () => {
    const url = process.env.DATABASE_URL;
    const opened = url ? openPostgres(url) : openPglite(path.join(process.cwd(), ".data", "pglite"));
    await opened.migrate();
    return opened.db;
  })().catch((error: unknown) => {
    globalForDb.dpmDb = undefined;
    throw error;
  });
  return globalForDb.dpmDb;
}
