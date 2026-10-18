/**
 * `npm run automations`: runs auto-close and auto-archive once against the
 * configured database (decision 28). `--dry-run` counts without writing.
 * `--project <id>` limits the run. `--now <ISO>` freezes the clock and is
 * refused on the default data/tessera.db unless the run is a dry run.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { runAutomations } from "@/lib/tessera/automations";
import { createContext } from "@/lib/tessera/core/context";
import { isTrackerError } from "@/lib/tessera/core/errors";
import { localDateOf } from "@/lib/tessera/core/time";
import { DEFAULT_DB_PATH, MEMORY_DB, openDatabase, resolveDbPath } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

type Args = { dryRun: boolean; projectId?: string; now?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--project" || token === "--now") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${token} needs a value`);
      i += 1;
      if (token === "--project") args.projectId = value;
      else args.now = value;
      continue;
    }
    throw new Error(`Unknown argument ${token}`);
  }
  return args;
}

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Invalid arguments");
    return 1;
  }

  const dbPath = resolveDbPath();
  const defaultPath = resolveDbPath(DEFAULT_DB_PATH);
  if (args.now !== undefined && !args.dryRun && dbPath === defaultPath) {
    console.error("--now is refused on data/tessera.db unless --dry-run is set.");
    return 1;
  }

  let clock: string | undefined;
  if (args.now !== undefined) {
    const parsed = Date.parse(args.now);
    if (Number.isNaN(parsed)) {
      console.error("--now must be an ISO-8601 timestamp");
      return 1;
    }
    clock = new Date(parsed).toISOString();
  }

  console.log(`Database: ${dbPath}`);
  if (dbPath !== MEMORY_DB) {
    const migration = migrateIfNeeded(dbPath);
    if (migration.applied > 0) console.log(`Applied ${migration.applied} migration(s).`);
  }

  const handles = openDatabase(dbPath);
  try {
    const frozen = clock;
    const ctx = createContext({
      db: handles.db,
      sqlite: handles.sqlite,
      actorId: USER_ACTOR_ID,
      now: frozen === undefined ? undefined : () => frozen,
      today: frozen === undefined ? undefined : () => localDateOf(frozen),
    });
    const summary = runAutomations(ctx, {
      ...(args.projectId === undefined ? {} : { project_id: args.projectId }),
      ...(args.dryRun ? { dry_run: true } : {}),
    });
    if (summary.lease_held) {
      console.log("Lease held by another run; nothing applied.");
      return 0;
    }
    let closed = 0;
    let archived = 0;
    let failed = false;
    for (const project of summary.projects) {
      closed += project.closed;
      archived += project.archived;
      if (project.error) {
        failed = true;
        console.error(`${project.project_id}: ${project.error}`);
      }
    }
    console.log(`${summary.dry_run ? "Dry run" : "Ran"}: closed ${closed}, archived ${archived}.`);
    return failed ? 1 : 0;
  } catch (err) {
    if (isTrackerError(err)) console.error(err.message);
    else console.error(err instanceof Error ? err.message : "Automation run failed");
    return 1;
  } finally {
    handles.sqlite.close();
  }
}

process.exitCode = main();
