/**
 * Shared guard for the perf scripts (decision 115): they only ever open a
 * scratch database, never the user's. Refuses `:memory:`, data/tessera.db and
 * whatever TESSERA_DB_PATH resolves to, however the path is spelled: another
 * letter case (the macOS file system ignores case), a symlink, a hard link, or
 * the -wal / -shm / -journal files next to it.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DB_PATH, MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";

export const PERF_DB = "data/p11-perf.db";

const SIDE_FILES = ["", "-wal", "-shm", "-journal"] as const;

/** The path with its existing directory part resolved through symlinks and its name lower-cased, so case and links do not hide a match. */
function canonical(file: string): string {
  const dir = path.dirname(file);
  let real = dir;
  try {
    real = fs.realpathSync.native(dir);
  } catch {
    // A directory that does not exist yet cannot be a link to anything.
  }
  return path.join(real, path.basename(file)).toLowerCase();
}

function identity(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

/** Whether `target` is, or is a side file of, one of the `protectedPaths`. */
export function isProtectedDb(target: string, protectedPaths: readonly string[]): boolean {
  const spelled = canonical(target);
  const targetId = identity(target);
  for (const base of protectedPaths) {
    for (const suffix of SIDE_FILES) {
      const file = `${base}${suffix}`;
      if (canonical(file) === spelled) return true;
      const protectedId = identity(file);
      if (targetId !== null && protectedId !== null && targetId === protectedId) return true;
    }
  }
  return false;
}

/** Absolute path of the perf database for `raw`; throws an Error naming why a path is refused. */
export function perfDbPath(raw: string, protectedPaths?: readonly string[]): string {
  if (raw === MEMORY_DB) throw new Error("the perf scripts need a database file, not :memory:");
  const target = resolveDbPath(raw);
  const guarded = protectedPaths ?? [resolveDbPath(DEFAULT_DB_PATH), resolveDbPath()].filter((entry) => entry !== MEMORY_DB);
  if (isProtectedDb(target, guarded)) throw new Error(`refusing to use ${target}: that is the Tessera database. Use ${PERF_DB} or another file.`);
  return target;
}
