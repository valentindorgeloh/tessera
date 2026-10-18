/**
 * Shared guard for the perf scripts (decision 115): they only ever open a
 * scratch database, never the user's. Refuses `:memory:`, data/tessera.db and
 * whatever TESSERA_DB_PATH resolves to.
 */
import { DEFAULT_DB_PATH, MEMORY_DB, resolveDbPath } from "@/lib/tessera/db/client";

export const PERF_DB = "data/p11-perf.db";

/** Absolute path of the perf database for `raw`; throws an Error naming why a path is refused. */
export function perfDbPath(raw: string): string {
  if (raw === MEMORY_DB) throw new Error("the perf scripts need a database file, not :memory:");
  const target = resolveDbPath(raw);
  const protectedPaths = new Set([resolveDbPath(DEFAULT_DB_PATH), resolveDbPath()]);
  if (protectedPaths.has(target)) throw new Error(`refusing to use ${target}: that is the Tessera database. Use ${PERF_DB} or another file.`);
  return target;
}
