/**
 * `npm run db:fts-rebuild`: drops every row of work_item_fts and page_fts and
 * re-indexes the non-deleted work items and pages of the configured database
 * (TESSERA_DB_PATH from .env.local, default data/tessera.db). Run it after a
 * migration that recreates work_item or page. The script opens the raw handle
 * instead of openDatabase() so it never applies migrations itself: only the
 * Next server and `npm run db:migrate` migrate (docs/contracts/schema.md).
 */
import { loadEnvConfig } from "@next/env";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";
import { rebuildFts } from "@/lib/tessera/db/fts";
import { pendingMigrations } from "@/lib/tessera/db/migrate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

const FTS_TABLES = ["work_item_fts", "page_fts"] as const;

function countRows(sqlite: SqliteDatabase, table: (typeof FTS_TABLES)[number]): number {
  const row = sqlite.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}

function main(): number {
  const dbPath = resolveDbPath();
  if (dbPath === MEMORY_DB) {
    console.error("TESSERA_DB_PATH is :memory:; there is no file to rebuild.");
    return 1;
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`No database at ${dbPath}; run npm run db:migrate first.`);
    return 1;
  }

  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("busy_timeout = 5000");
    const pending = pendingMigrations(sqlite);
    if (pending > 0) {
      console.error(`${pending} migration(s) pending for ${dbPath}; run npm run db:migrate first.`);
      return 1;
    }
    const indexed = rebuildFts(sqlite);
    console.log(`Database: ${dbPath}`);
    console.log(`Rebuilt FTS: indexed ${indexed.work_items} work item(s) and ${indexed.pages} page(s).`);
    for (const table of FTS_TABLES) console.log(`${table}: ${countRows(sqlite, table)} row(s)`);
    return 0;
  } finally {
    sqlite.close();
  }
}

process.exitCode = main();
