/**
 * Playwright database prepare step (decision 123), run by the webServer command
 * before `next start`: `npx tsx tests/e2e/prepare-db.ts`. Never touches
 * data/tessera.db. An existing e2e database (and its -wal/-shm/-lock files) is
 * moved, not deleted, to E2E_BACKUP_DIR (default: <tmpdir>/tessera-e2e-previous);
 * a fresh one is migrated and seeded with the deterministic e2e fixture, the
 * demo WEB project (src/lib/tessera/seed.ts, dates relative to today).
 *
 * It runs inside the webServer command rather than `globalSetup` because
 * Playwright starts the web server first and probes its URL, and that probe
 * would open the database before a later global setup could replace it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { openDatabase } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";
import { seedDemo } from "@/lib/tessera/seed";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_E2E_DB = path.join(REPO_ROOT, "data", "e2e.db");
const SIDE_CARS = ["", "-wal", "-shm", "-lock"];

function main(): number {
  const dbPath = path.resolve(process.env.TESSERA_DB_PATH ?? DEFAULT_E2E_DB);
  if (path.basename(dbPath) === "tessera.db") {
    console.error(`Refusing to prepare ${dbPath}: the e2e suite never uses the real database.`);
    return 1;
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const backupDir = process.env.E2E_BACKUP_DIR ?? path.join(os.tmpdir(), "tessera-e2e-previous");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const suffix of SIDE_CARS) {
    const file = `${dbPath}${suffix}`;
    if (!fs.existsSync(file)) continue;
    fs.mkdirSync(backupDir, { recursive: true });
    const target = path.join(backupDir, `${path.basename(file)}.${stamp}`);
    try {
      fs.renameSync(file, target);
    } catch {
      fs.copyFileSync(file, target);
      fs.rmSync(file, { force: true });
    }
    console.log(`Moved ${file} to ${target}`);
  }

  migrateIfNeeded(dbPath);
  const handles = openDatabase(dbPath);
  try {
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    const result = seedDemo(ctx);
    console.log(`e2e database ${dbPath}: demo project ${result.project.identifier} ${result.created ? "seeded" : "present"}.`);
  } finally {
    handles.sqlite.close();
  }
  return 0;
}

process.exitCode = main();
