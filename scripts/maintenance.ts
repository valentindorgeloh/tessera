/**
 * `npm run maintenance`: runs retention and optional auto backup on the
 * configured database. `--dry-run` reports without writing; `--now <ISO>`
 * sets the clock for due checks.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { closeDb, getDb, MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";
import { runMaintenance } from "@/lib/tessera/maintenance";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

function parseArgs(argv: string[]): { dryRun: boolean; now?: string } {
  let dryRun = false;
  let now: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--now") {
      now = argv[i + 1];
      if (!now) throw new Error("--now needs an ISO timestamp");
      i += 1;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return { dryRun, now };
}

function main(): number {
  const { dryRun, now } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath();
  if (dbPath === MEMORY_DB) {
    console.error("TESSERA_DB_PATH is :memory:; maintenance needs a file database.");
    return 1;
  }
  const { db, sqlite } = getDb();
  try {
    const summary = runMaintenance(createContext({ db, sqlite, actorId: SYSTEM_ACTOR_ID }), {
      dry_run: dryRun,
      now,
    });
    console.log(JSON.stringify(summary, null, 2));
    return summary.lease_held ? 2 : 0;
  } finally {
    closeDb();
  }
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
