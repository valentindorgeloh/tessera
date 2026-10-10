/**
 * Migrations (docs/contracts/schema.md "Migrations and database file").
 * `migrate()` applies the drizzle/ folder through the drizzle migrator;
 * `migrateIfNeeded()` is the file-database path used by getDb() and
 * `npm run db:migrate`: lock file, VACUUM INTO backup when something is
 * pending, keep the newest 10 backups, then migrate.
 *
 * Paths are resolved from this module's location so the engine works from the
 * source tree (tsx, Vitest) and from a Next server bundle alike.
 */
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate as runDrizzleMigrations } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { busy } from "../core/errors";
import { schema } from "./schema";

type MigrateDb = Parameters<typeof runDrizzleMigrations>[0];

/** Walks up from `startDir` to the directory that holds drizzle/meta/_journal.json. */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "drizzle", "meta", "_journal.json")) && fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Tessera repo root not found above ${startDir} (expected drizzle/meta/_journal.json)`);
    }
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "drizzle");
export const MIGRATIONS_TABLE = "__drizzle_migrations";
export const BACKUP_KEEP = 10;
export const LOCK_TIMEOUT_MS = 30_000;

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean };
type Journal = { entries: JournalEntry[] };

function readJournal(): Journal {
  const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
  return JSON.parse(raw) as Journal;
}

function migrationsTableExists(sqlite: SqliteDatabase): boolean {
  const row = sqlite
    .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  return row !== undefined;
}

/** Latest applied migration timestamp, mirroring the drizzle migrator (`ORDER BY created_at DESC LIMIT 1`). */
function lastAppliedMillis(sqlite: SqliteDatabase): number | null {
  if (!migrationsTableExists(sqlite)) return null;
  const row = sqlite
    .prepare<[], { created_at: number | string | null }>(`SELECT created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`)
    .get();
  if (!row || row.created_at === null) return null;
  return Number(row.created_at);
}

/** Number of journal entries the drizzle migrator would still apply to this database. */
export function pendingMigrations(sqlite: SqliteDatabase): number {
  const last = lastAppliedMillis(sqlite);
  const entries = readJournal().entries;
  if (last === null) return entries.length;
  return entries.filter((entry) => entry.when > last).length;
}

/** Applies every pending migration from drizzle/ and returns how many were applied. */
export function migrate(db: MigrateDb, sqlite: SqliteDatabase): number {
  const pending = pendingMigrations(sqlite);
  if (pending === 0) return 0;
  runDrizzleMigrations(db, { migrationsFolder: MIGRATIONS_DIR, migrationsTable: MIGRATIONS_TABLE });
  return pending;
}

/** `data/backups` next to the database file. */
export function backupDir(filePath: string): string {
  return path.join(path.dirname(filePath), "backups");
}

function backupStamp(now = new Date()): string {
  // Colons are not safe in file names on every platform.
  return now.toISOString().replace(/:/g, "-");
}

/** Copies the live database with VACUUM INTO and returns the backup path. */
export function backupDatabase(filePath: string, now = new Date()): string {
  const dir = backupDir(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `tessera-${backupStamp(now)}.db`);
  const sqlite = new Database(filePath);
  try {
    sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    sqlite.close();
  }
  return target;
}

/** Deletes all but the newest `keep` `tessera-*.db` files in `dir`; returns the removed paths. */
export function pruneBackups(dir: string, keep = BACKUP_KEEP): string[] {
  if (!fs.existsSync(dir)) return [];
  const backups = fs
    .readdirSync(dir)
    .filter((name) => /^tessera-.*\.db$/.test(name))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const name of backups.slice(keep)) {
    const full = path.join(dir, name);
    fs.rmSync(full, { force: true });
    removed.push(full);
  }
  return removed;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Creates `<filePath>.migrate.lock` exclusively, waiting up to `timeoutMs` for another process to finish (BUSY afterwards). */
function acquireLock(filePath: string, timeoutMs: number): () => void {
  const lockPath = `${filePath}.migrate.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return () => fs.rmSync(lockPath, { force: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        throw busy(`Another process holds the migration lock ${lockPath}; remove it if no migration is running`);
      }
      sleepSync(100);
    }
  }
}

export type MigrateResult = { applied: number; backup: string | null; pruned: string[] };

export type MigrateOptions = {
  /** How long to wait for another process's migration lock before giving up with BUSY; LOCK_TIMEOUT_MS by default. */
  lockTimeoutMs?: number;
};

/**
 * File databases only (`:memory:` goes straight through openDatabase). Takes
 * the lock, backs up an existing file when migrations are pending, migrates
 * and prunes old backups. The lock is released whatever happens inside.
 */
export function migrateIfNeeded(filePath: string, options: MigrateOptions = {}): MigrateResult {
  if (filePath === ":memory:") throw new Error("migrateIfNeeded needs a file database");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const release = acquireLock(filePath, options.lockTimeoutMs ?? LOCK_TIMEOUT_MS);
  try {
    const existed = fs.existsSync(filePath);
    let backup: string | null = null;
    let pruned: string[] = [];
    const sqlite = new Database(filePath);
    try {
      sqlite.pragma("busy_timeout = 5000");
      const pending = pendingMigrations(sqlite);
      if (pending === 0) return { applied: 0, backup, pruned };
      if (existed) {
        backup = backupDatabase(filePath);
        pruned = pruneBackups(backupDir(filePath));
      }
      const db = drizzle(sqlite, { schema });
      const applied = migrate(db, sqlite);
      return { applied, backup, pruned };
    } finally {
      sqlite.close();
    }
  } finally {
    release();
  }
}
