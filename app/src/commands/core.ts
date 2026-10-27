// What every command shares (build plan, section 1): one transaction per command, refusals as
// errors that roll it back, optimistic versions, and an audit entry for every move (A11).
import { sql, type AnyColumn } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/conn";
import { auditEntries } from "../db/schema";
import { config } from "../domain/config";
import { dateInZone, type IsoDate } from "../domain/dates";
import type { Outcome } from "../domain/machine";

/** Who is acting and when. Commands take the time as input, so the story can be replayed at 9:10am. */
export type CommandCtx = { db: Db; now: Date; actorId: string };

/** A rule said no. The transaction rolls back and nothing changes; `reason` is shown to the person. */
export class CommandRefused extends Error {
  constructor(
    readonly reason: string,
    readonly code: "refused" | "not_found" | "not_allowed" = "refused",
  ) {
    super(reason);
    this.name = "CommandRefused";
  }
}

/** Someone else moved the row first. Reload and decide again; never overwrite (machines doc, section 1). */
export class StaleVersion extends Error {
  constructor(readonly subject: string) {
    super(`${subject} changed since it was read; reload and try again`);
    this.name = "StaleVersion";
  }
}

export function runCommand<T>(ctx: CommandCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return ctx.db.transaction(fn);
}

/** The calendar day of the command, in the org time zone (dates in rules are days, not instants). */
export function todayOf(now: Date): IsoDate {
  return dateInZone(now, config.timeZone);
}

/** Turns a refused machine outcome into a refusal of the whole command. */
export function moved<S extends string>(outcome: Outcome<S>): Extract<Outcome<S>, { ok: true }> {
  if (!outcome.ok) throw new CommandRefused(outcome.reason);
  return outcome as Extract<Outcome<S>, { ok: true }>;
}

/** `version = version + 1`, for the set() of a versioned update. */
export function nextVersion(column: AnyColumn) {
  return sql`${column} + 1`;
}

/** A versioned update must touch exactly one row; none means someone else moved it first. */
export function expectOne(rows: readonly unknown[], subject: string): void {
  if (rows.length !== 1) throw new StaleVersion(subject);
}

export type AuditInput = Omit<typeof auditEntries.$inferInsert, "id" | "at">;

export async function audit(tx: Tx, now: Date, entry: AuditInput): Promise<void> {
  await tx.insert(auditEntries).values({ ...entry, at: now });
}
