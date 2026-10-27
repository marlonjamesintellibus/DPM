import type { Db } from "./client";

/** A transaction, as handed to db.transaction(...). Commands write only inside one. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Queries read through either a database or a transaction. */
export type Conn = Db | Tx;
