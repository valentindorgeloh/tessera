/**
 * TesseraContext: everything a service function needs for one call
 * (docs/contracts/service-api.md). The actor fills created_by / updated_by and
 * activity.actor_id; now() and today() are injectable so tests can freeze time.
 */
import type { Database } from "better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import type { TesseraDb } from "../db/client";
import { actor } from "../db/schema";
import type { ActorRow } from "../types";
import { notFound } from "./errors";
import { nowIso, todayLocal } from "./time";

export type TesseraContext = {
  db: TesseraDb;
  /** The raw better-sqlite3 handle under `db`, for transactions, FTS and PRAGMAs. */
  sqlite: Database;
  actor: ActorRow;
  /** ISO-8601 UTC timestamp. */
  now(): string;
  /** Server local date, `YYYY-MM-DD`. */
  today(): string;
};

export type CreateContextOptions = {
  db: TesseraDb;
  sqlite: Database;
  actorId: string;
  now?: () => string;
  today?: () => string;
};

/** Loads the (non-deleted) actor row; NOT_FOUND when it does not exist. */
export function createContext(options: CreateContextOptions): TesseraContext {
  const row = options.db
    .select()
    .from(actor)
    .where(and(eq(actor.id, options.actorId), isNull(actor.deleted_at)))
    .get();
  if (!row) throw notFound("actor", options.actorId);
  return {
    db: options.db,
    sqlite: options.sqlite,
    actor: row,
    now: options.now ?? nowIso,
    today: options.today ?? todayLocal,
  };
}

/** Same database, different actor; used by adapters that act on behalf of an agent. */
export function withActor(ctx: TesseraContext, actorId: string): TesseraContext {
  return createContext({ db: ctx.db, sqlite: ctx.sqlite, actorId, now: ctx.now, today: ctx.today });
}
