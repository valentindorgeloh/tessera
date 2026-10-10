/**
 * withTx: every mutation runs inside one BEGIN IMMEDIATE transaction on the
 * better-sqlite3 handle. Nested calls join the open transaction (so a service
 * function can call another one), a throw rolls everything back, and
 * SQLITE_BUSY after busy_timeout surfaces as TrackerError BUSY.
 */
import type { TesseraContext } from "./context";
import { fromSqliteError } from "./errors";

export function withTx<T>(ctx: TesseraContext, fn: (ctx: TesseraContext) => T): T {
  if (ctx.sqlite.inTransaction) return fn(ctx);
  try {
    return ctx.sqlite.transaction(() => fn(ctx)).immediate();
  } catch (err) {
    throw fromSqliteError(err);
  }
}

/** Throws when called outside a transaction; used by helpers that must only run inside withTx. */
export function assertInTransaction(ctx: TesseraContext, what: string): void {
  if (!ctx.sqlite.inTransaction) {
    throw new Error(`${what} must be called inside withTx`);
  }
}
