/**
 * Test database helpers. Every test opens its own in-memory database so suites
 * run in parallel without sharing state; `withTempFileDb` covers the few cases
 * that need a real file (WAL, locks, backups, a second connection).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { openDatabase, type DbHandles } from "@/lib/tessera/db/client";

export type { DbHandles, TesseraContext };

/** In-memory database with every migration applied and the built-in actors seeded. */
export function createTestDb(): DbHandles {
  return openDatabase(":memory:");
}

export function createTestContext(handles: DbHandles, actorId: string = USER_ACTOR_ID): TesseraContext {
  return createContext({ db: handles.db, sqlite: handles.sqlite, actorId });
}

/**
 * Creates a migrated file database in a fresh temp directory, hands its path
 * to `fn` and removes the directory afterwards (including WAL, lock and backup files).
 */
export async function withTempFileDb<T>(fn: (filePath: string) => T | Promise<T>): Promise<T> {
  // realpath: macOS reports /private/var for the symlinked /var tmp dir, and SQLite echoes the real path.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tessera-test-"));
  const filePath = path.join(dir, "tessera.db");
  const handles = openDatabase(filePath);
  handles.sqlite.close();
  try {
    return await fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
