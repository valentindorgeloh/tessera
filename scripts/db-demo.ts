/**
 * `npm run db:demo`: migrates the configured database (TESSERA_DB_PATH from .env.local, default
 * data/tessera.db) under the lock, then fills it with the showcase demo (see scripts/demo/index.ts).
 * Idempotent: when a project MOB already exists nothing is written and the script says so.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_DB, openDatabase, resolveDbPath } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";
import { seedShowcase } from "./demo";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

async function main(): Promise<number> {
  const dbPath = resolveDbPath();
  if (dbPath === MEMORY_DB) {
    console.error("TESSERA_DB_PATH is :memory:; there is no file to seed.");
    return 1;
  }

  const migration = migrateIfNeeded(dbPath);
  console.log(`Database: ${dbPath}`);
  if (migration.applied > 0) {
    console.log(`Applied ${migration.applied} migration(s)${migration.backup ? ` after backing up to ${migration.backup}` : ""}.`);
  }

  const handles = openDatabase(dbPath);
  try {
    const started = Date.now();
    const result = await seedShowcase(handles);
    if (!result.created) {
      console.log("A project MOB already exists; nothing written.");
      return 0;
    }
    console.log(`Seeded the showcase demo in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    for (const [part, counts] of Object.entries(result.counts)) {
      console.log(`  ${part}: ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(", ")}`);
    }
    return 0;
  } finally {
    handles.sqlite.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
