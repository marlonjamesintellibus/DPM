import { count } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { appMeta } from "@/db/schema";

// Request-time check that the database opens and its migrations have run
// (the query fails if app_meta does not exist).
export async function GET() {
  await connection();
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(appMeta);
  return Response.json({
    ok: true,
    database: process.env.DATABASE_URL ? "postgres" : "pglite",
    appMetaRows: row.n,
  });
}
