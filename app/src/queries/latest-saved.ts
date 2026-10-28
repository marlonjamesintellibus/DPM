// The latest moment the story has reached in the database, on the app's clock: every command audits
// at its time, notices are written with it, and a note's receivedAt is when DPM got it. Columns that
// default to the real time (createdAt, updatedAt) are left out, because the demo clock is not real time.
import { max } from "drizzle-orm";
import type { Conn } from "../db/conn";
import * as t from "../db/schema";

export async function latestSavedAt(conn: Conn): Promise<Date | null> {
  const [[audit], [notice], [capture]] = await Promise.all([
    conn.select({ at: max(t.auditEntries.at) }).from(t.auditEntries),
    conn.select({ at: max(t.notices.at) }).from(t.notices),
    conn.select({ at: max(t.captures.receivedAt) }).from(t.captures),
  ]);
  const times = [audit?.at, notice?.at, capture?.at].filter((d): d is Date => d instanceof Date);
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
}
