/**
 * `npm run db:restore -- <backup> [--yes]`: restores a VACUUM INTO copy over
 * the configured database. Refuses without --yes while a migrate lock exists
 * or another process holds a write lock. Never opens data/tessera.db unless
 * that is the configured path and the operator passes --yes.
 */
import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backupDatabase } from "@/lib/tessera/db/backups";
import { MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

function parseArgs(argv: string[]): { from: string; yes: boolean } {
  let from: string | undefined;
  let yes = false;
  for (const arg of argv) {
    if (arg === "--yes") yes = true;
    else if (!from) from = arg;
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!from) throw new Error("Usage: npm run db:restore -- <backup.db> [--yes]");
  return { from: path.isAbsolute(from) ? from : path.resolve(process.cwd(), from), yes };
}

function main(): number {
  const { from, yes } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath();
  if (dbPath === MEMORY_DB) {
    console.error("TESSERA_DB_PATH is :memory:; there is no file to restore.");
    return 1;
  }
  if (!fs.existsSync(from)) {
    console.error(`No backup at ${from}`);
    return 1;
  }
  if (!yes) {
    console.error("Stop the server first, then re-run with --yes to restore.");
    return 1;
  }
  const lockPath = `${dbPath}.migrate.lock`;
  if (fs.existsSync(lockPath)) {
    console.error(`Migration lock exists at ${lockPath}; remove it if no migration is running.`);
    return 1;
  }
  if (fs.existsSync(dbPath)) {
    try {
      const probe = new Database(dbPath);
      probe.exec("BEGIN IMMEDIATE");
      probe.exec("ROLLBACK");
      probe.close();
    } catch {
      console.error("The database has a live writer; stop the server first.");
      return 1;
    }
    const pre = backupDatabase(dbPath, "pre-restore");
    console.log(`Pre-restore backup: ${pre.path}`);
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(from, dbPath);
  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  console.log(`Restored ${from} → ${dbPath}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
