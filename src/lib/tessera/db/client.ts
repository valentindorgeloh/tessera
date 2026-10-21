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
import { acquireLock, LOCK_TIMEOUT_MS, migrate, migrateIfNeeded, pendingMigrations, REPO_ROOT, sleepSync } from "./migrate";
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

const WAL_RETRY_MS = 5000;

/**
 * Switches a file database to WAL. The switch needs an exclusive lock, and SQLite answers
 * SQLITE_BUSY at once (it skips the busy handler) while another connection is opening or switching the
 * same fresh file, so a first open by several processes retries here. WAL persists in the file: an
 * already-WAL database returns without a lock.
 */
function enableWal(sqlite: SqliteDatabase): void {
  const deadline = Date.now() + WAL_RETRY_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      sqlite.pragma("journal_mode = WAL");
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if ((code !== "SQLITE_BUSY" && code !== "SQLITE_LOCKED") || Date.now() >= deadline) throw err;
      // Spread the retries of competing processes by pid (no Math.random in engine code).
      sleepSync(10 + ((process.pid + attempt * 7) % 40));
    }
  }
}

function applyPragmas(sqlite: SqliteDatabase, inMemory: boolean): void {
  sqlite.pragma("busy_timeout = 5000");
  if (!inMemory) enableWal(sqlite);
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
}

/**
 * Applies pending migrations. A file database takes the migration lock around the
 * apply (the lock getDb() already uses), so processes that open one fresh file at
 * once do not race on CREATE TABLE; the losers find nothing pending afterwards.
 */
function migrateOnOpen(db: TesseraDb, sqlite: SqliteDatabase, filePath: string): void {
  if (filePath === MEMORY_DB || pendingMigrations(sqlite) === 0) {
    migrate(db, sqlite);
    return;
  }
  const release = acquireLock(filePath, LOCK_TIMEOUT_MS);
  try {
    migrate(db, sqlite);
  } finally {
    release();
  }
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
  migrateOnOpen(db, sqlite, filePath);
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
