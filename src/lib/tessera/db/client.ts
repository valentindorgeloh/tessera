/**
 * Database handles (docs/contracts/schema.md "Migrations and database file").
 * `openDatabase()` is the primitive for tests and scripts; `getDb()` is the
 * process-wide singleton the Next server uses through `@/lib/tessera/server`.
 * Paths resolve against the repo root derived from the module location, never
 * against the working directory.
 */
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ensureSystemActors } from "../actors";
import { ensureWorkspaceSettings } from "../workspace/settings";
import { ensureFtsTables } from "./fts";
import { migrate, migrateIfNeeded, REPO_ROOT } from "./migrate";
import { schema } from "./schema";

export type TesseraDb = BetterSQLite3Database<typeof schema>;
export type DbHandles = { sqlite: SqliteDatabase; db: TesseraDb };

export const DEFAULT_DB_PATH = "data/tessera.db";
export const MEMORY_DB = ":memory:";

/** Absolute database path from `raw`, TESSERA_DB_PATH or the default; `:memory:` passes through. */
export function resolveDbPath(raw?: string): string {
  const value = raw ?? process.env.TESSERA_DB_PATH ?? DEFAULT_DB_PATH;
  if (value === MEMORY_DB) return MEMORY_DB;
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

function applyPragmas(sqlite: SqliteDatabase, inMemory: boolean): void {
  if (!inMemory) sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
}

/**
 * Opens a database (file path or ":memory:"), applies the PRAGMAs, applies
 * pending migrations and seeds the user / assistant / system actors.
 */
export function openDatabase(filePath: string = MEMORY_DB): DbHandles {
  const inMemory = filePath === MEMORY_DB;
  if (!inMemory) fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  applyPragmas(sqlite, inMemory);
  const db = drizzle(sqlite, { schema });
  migrate(db, sqlite);
  ensureFtsTables(sqlite);
  ensureSystemActors(db);
  ensureWorkspaceSettings(db);
  return { sqlite, db };
}

let singleton: DbHandles | null = null;

/** Lazy process-wide handles for the configured database; file databases migrate under the lock with a backup. */
export function getDb(): DbHandles {
  if (singleton) return singleton;
  const filePath = resolveDbPath();
  if (filePath !== MEMORY_DB) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    migrateIfNeeded(filePath);
  }
  singleton = openDatabase(filePath);
  return singleton;
}

export function closeDb(): void {
  if (!singleton) return;
  singleton.sqlite.close();
  singleton = null;
}
