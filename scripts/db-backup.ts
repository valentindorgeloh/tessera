/**
 * `npm run db:backup`: copies the configured database with VACUUM INTO into
 * data/backups/ next to it. Default kind is manual. `--plan` prints the
 * rotation keep/remove split without deleting. Safe while the Next server
 * runs: VACUUM INTO is a read of the live file.
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";
import {
  backupDatabase,
  backupDir,
  listBackups,
  planRotation,
  rotateBackups,
  type BackupKind,
} from "@/lib/tessera/db/backups";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

const KINDS = new Set<BackupKind>(["auto", "manual", "migration", "pre-restore"]);

function parseArgs(argv: string[]): { kind: BackupKind; plan: boolean } {
  let kind: BackupKind = "manual";
  let plan = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan") plan = true;
    else if (arg === "--kind") {
      const value = argv[i + 1];
      if (!value || !KINDS.has(value as BackupKind)) {
        throw new Error(`--kind must be one of ${[...KINDS].join(", ")}`);
      }
      kind = value as BackupKind;
      i += 1;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return { kind, plan };
}

function main(): number {
  const { kind, plan } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath();
  if (dbPath === MEMORY_DB) {
    console.error("TESSERA_DB_PATH is :memory:; there is no file to back up.");
    return 1;
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`No database at ${dbPath}; run npm run db:migrate first.`);
    return 1;
  }

  if (plan) {
    const files = listBackups(dbPath);
    const split = planRotation(files);
    console.log(`Database: ${dbPath}`);
    console.log(`Keep ${split.keep.length}:`);
    for (const file of split.keep) console.log(`  ${file.name}`);
    console.log(`Remove ${split.remove.length}:`);
    for (const file of split.remove) console.log(`  ${file.name}`);
    return 0;
  }

  const backup = backupDatabase(dbPath, kind);
  const pruned = rotateBackups(dbPath);
  const size = fs.statSync(backup.path).size;

  console.log(`Database: ${dbPath}`);
  console.log(`Backup: ${backup.path} (${size} bytes, check ${backup.check})`);
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} old backup(s) in ${backupDir(dbPath)}:`);
    for (const file of pruned) console.log(`  removed ${file}`);
  } else {
    console.log(`Kept every backup in ${backupDir(dbPath)}.`);
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
