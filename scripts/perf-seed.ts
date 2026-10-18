/**
 * `npm run perf:seed [-- --db data/p11-perf.db --items 10000]`
 *
 * Builds the decision 115 fixture (docs/PLAN.md): a big project plus four small
 * ones with labels, actors, cycles, modules, relations, comments and activity,
 * deterministically (mulberry32), through the service functions in batched
 * transactions. The default and the only database it touches without `--db` is
 * data/p11-perf.db. It always refuses the user's database (data/tessera.db and
 * whatever TESSERA_DB_PATH resolves to) and `:memory:`. Idempotent: when the
 * project (`--project`, default PERF) exists, nothing is written.
 *
 * Options: --db <file>, --items <n> (big project, default 10000),
 * --projects <n> (small projects, default 4), --other-items <n> (default a
 * fifth of --items), --seed <n> (default 11), --project <IDENTIFIER>.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { openDatabase } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";
import { seedPerf } from "@/lib/tessera/seed-perf";
import { PERF_DB, perfDbPath } from "./perf-db";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "Usage: npm run perf:seed -- [--db <file>] [--items <n>] [--projects <n>] [--other-items <n>] [--seed <n>] [--project <IDENT>]";

type Args = { db: string; items: number; projects: number; otherItems: number | undefined; seed: number; project: string };

function number(raw: string | undefined, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} needs a non-negative integer (got ${raw ?? "nothing"})`);
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { db: PERF_DB, items: 10_000, projects: 4, otherItems: undefined, seed: 11, project: "PERF" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag ?? ""} needs a value`);
    if (flag === "--db") args.db = value;
    else if (flag === "--items") args.items = number(value, flag);
    else if (flag === "--projects") args.projects = number(value, flag);
    else if (flag === "--other-items") args.otherItems = number(value, flag);
    else if (flag === "--seed") args.seed = number(value, flag);
    else if (flag === "--project") args.project = value;
    else throw new Error(`unknown option ${flag ?? ""}`);
  }
  return args;
}

function main(): number {
  loadEnvConfig(REPO_ROOT);
  let args: Args;
  let dbPath: string;
  try {
    args = parseArgs(process.argv.slice(2));
    dbPath = perfDbPath(args.db);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return 1;
  }
  const started = performance.now();
  migrateIfNeeded(dbPath);
  const handles = openDatabase(dbPath);
  try {
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    console.log(`Database: ${dbPath}`);
    const result = seedPerf(ctx, {
      items: args.items,
      projects: args.projects,
      ...(args.otherItems !== undefined ? { other_items: args.otherItems } : {}),
      seed: args.seed,
      identifier: args.project,
      onProgress: (message) => console.log(`  ${message}`),
    });
    handles.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    if (!result.created) {
      console.log(`Project ${args.project} already exists; nothing written.`);
    } else {
      console.log(`Seeded in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
    }
    console.log(`Rows: ${Object.entries(result.counts).map(([key, n]) => `${n} ${key}`).join(", ")}`);
    return 0;
  } finally {
    handles.sqlite.close();
  }
}

process.exitCode = main();
