/**
 * `npm run db:seed`: migrates the configured database (TESSERA_DB_PATH from
 * .env.local, default data/tessera.db) under the lock, then creates the demo
 * project as the user actor. Idempotent: when WEB already exists nothing is
 * written and the script says so.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { MEMORY_DB, openDatabase, resolveDbPath } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";
import { SEED_SUMMARY, seedDemo } from "@/lib/tessera/seed";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(REPO_ROOT);

function main(): number {
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
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    const result = seedDemo(ctx);
    const label = `${result.project.identifier} (${result.project.name})`;
    if (result.created) {
      console.log(`Seeded demo project ${label} as actor "${ctx.actor.name}".`);
    } else {
      console.log(`Demo project ${label} already exists; nothing written.`);
    }
    console.log(SEED_SUMMARY.description);
    console.log(
      `Summary: ${SEED_SUMMARY.labels} labels (${SEED_SUMMARY.child_labels} nested), ${SEED_SUMMARY.work_items} work items, ` +
        `${SEED_SUMMARY.cycles} cycles, ${SEED_SUMMARY.modules} modules (${SEED_SUMMARY.module_links} link), ${SEED_SUMMARY.views} views.`,
    );
    return 0;
  } finally {
    handles.sqlite.close();
  }
}

process.exitCode = main();
