/**
 * `npm run import:handbook`: reads handbook markdown into wiki pages as the
 * user actor, in one transaction. Prints the absolute database path.
 * `--dir <path>` reads that directory instead of `content/`. `--dry-run`
 * prints the plan and writes nothing. Exits 1 when a file cannot be parsed.
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { MEMORY_DB, openDatabase, resolveDbPath } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";
import { importHandbook, importedHandbookSlugs, parseHandbookFile, planHandbookImport, type HandbookEntry } from "@/lib/tessera/import-handbook";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

function parseArgs(argv: string[]): { dir: string; dryRun: boolean } | { error: string } {
  let dir = path.join(REPO_ROOT, "content");
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--dir") {
      const next = argv[i + 1];
      if (!next) return { error: "--dir needs a path" };
      i += 1;
      dir = path.resolve(next);
      continue;
    }
    return { error: `Unknown argument ${arg}` };
  }
  return { dir, dryRun };
}

function readEntries(dir: string): { entries: HandbookEntry[] } | { errors: string[] } {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { errors: [`Not a directory: ${dir}`] };
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
  const entries: HandbookEntry[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const parsed = parseHandbookFile(file, fs.readFileSync(path.join(dir, file), "utf8"));
    if ("error" in parsed) errors.push(parsed.error);
    else entries.push(parsed);
  }
  if (errors.length > 0) return { errors };
  return { entries };
}

function main(): number {
  const dbPath = resolveDbPath();
  console.log(`Database: ${dbPath}`);

  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    return 1;
  }

  const read = readEntries(args.dir);
  if ("errors" in read) {
    for (const error of read.errors) console.error(error);
    return 1;
  }

  if (dbPath === MEMORY_DB) {
    console.error("TESSERA_DB_PATH is :memory:; there is no file to import into.");
    return 1;
  }

  const migration = migrateIfNeeded(dbPath);
  if (migration.applied > 0) {
    console.log(`Applied ${migration.applied} migration(s)${migration.backup ? ` after backing up to ${migration.backup}` : ""}.`);
  }

  const handles = openDatabase(dbPath);
  try {
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    if (args.dryRun) {
      const plan = planHandbookImport(read.entries, importedHandbookSlugs(ctx, read.entries));
      console.log(`Dry run: import ${plan.create.length} pages, skip ${plan.skipped.length}`);
      for (const entry of plan.create) console.log(`create ${entry.slug}\t${entry.title}`);
      for (const slug of plan.skipped) console.log(`skip ${slug}`);
      for (const warning of plan.warnings) console.log(warning);
      return 0;
    }
    const result = importHandbook(ctx, read.entries);
    console.log(`Imported ${result.created.length} pages, skipped ${result.skipped.length}`);
    for (const warning of result.warnings) console.log(warning);
    return 0;
  } finally {
    handles.sqlite.close();
  }
}

process.exitCode = main();
