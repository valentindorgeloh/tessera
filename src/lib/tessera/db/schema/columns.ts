/**
 * Tessera database schema (Drizzle, SQLite). Implements docs/contracts/schema.md;
 * the contract wins when the two disagree. Migrations are generated from this
 * file by `npm run db:generate`. The FTS5 tables live in a hand-written
 * migration (drizzle/0001_fts.sql) and in db/fts.ts, not here.
 *
 * Conventions: UUIDv7 text ids, ISO text timestamps, `YYYY-MM-DD` dates,
 * booleans as integer({ mode: "boolean" }), JSON as text({ mode: "json" }) typed
 * with the zod-inferred shapes from ../types, enums as plain text validated by
 * zod, soft delete through `deleted_at` with partial unique indexes.
 */
import { sql } from "drizzle-orm";
import { text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { actor } from "./core";

export const DELETED_AT_IS_NULL = sql`deleted_at IS NULL`;

/** created_at / updated_at / created_by / updated_by / deleted_at on every entity table. */
export function auditColumns() {
  return {
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    created_by: text("created_by")
      .notNull()
      .references((): AnySQLiteColumn => actor.id, { onDelete: "restrict" }),
    updated_by: text("updated_by")
      .notNull()
      .references((): AnySQLiteColumn => actor.id, { onDelete: "restrict" }),
    deleted_at: text("deleted_at"),
  };
}

/** Append-only rows (junctions, reactions, versions) record who and when, nothing else. */
export function createdColumns() {
  return {
    created_at: text("created_at").notNull(),
    created_by: text("created_by")
      .notNull()
      .references((): AnySQLiteColumn => actor.id, { onDelete: "restrict" }),
  };
}
