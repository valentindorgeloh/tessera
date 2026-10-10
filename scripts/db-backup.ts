/**
 * `npm run db:backup`: copies the configured database (TESSERA_DB_PATH from
 * .env.local, default data/tessera.db) with VACUUM INTO into data/backups/
 * next to it and prunes that folder to the newest BACKUP_KEEP copies. Safe
 * while the Next server runs: VACUUM INTO is a read of the live file.
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";
import { BACKUP_KEEP, backupDatabase, backupDir, pruneBackups } from "@/lib/tessera/db/migrate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

function main(): number {
  const dbPath = resolveDbPath();
  if (dbPath === MEMORY_DB) {
    console.error("TESSERA_DB_PATH is :memory:; there is no file to back up.");
    return 1;
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`No database at ${dbPath}; run npm run db:migrate first.`);
    return 1;
  }

  const backup = backupDatabase(dbPath);
  const pruned = pruneBackups(backupDir(dbPath));
  const size = fs.statSync(backup).size;

  console.log(`Database: ${dbPath}`);
  console.log(`Backup: ${backup} (${size} bytes)`);
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} old backup(s), keeping the newest ${BACKUP_KEEP}:`);
    for (const file of pruned) console.log(`  removed ${file}`);
  } else {
    console.log(`Kept every backup in ${backupDir(dbPath)} (limit ${BACKUP_KEEP}).`);
  }
  return 0;
}

process.exitCode = main();
