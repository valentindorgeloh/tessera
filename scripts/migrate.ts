/**
 * `npm run db:migrate`: applies pending migrations to the configured database
 * (TESSERA_DB_PATH from .env.local, default data/tessera.db) under the lock,
 * with a VACUUM INTO backup first when the file already exists.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

const dbPath = resolveDbPath();
if (dbPath === MEMORY_DB) {
  console.error("TESSERA_DB_PATH is :memory:; nothing to migrate.");
  process.exit(1);
}

const result = migrateIfNeeded(dbPath);
console.log(`Database: ${dbPath}`);
console.log(`Applied ${result.applied} migration(s).`);
if (result.backup) console.log(`Backup: ${result.backup}`);
if (result.pruned.length > 0) console.log(`Pruned ${result.pruned.length} old backup(s).`);
