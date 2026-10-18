/**
 * Export files live next to the database: `<directory of the db file>/exports/`.
 * An in-memory database has nowhere to put them.
 */
import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import { rule } from "../core/errors";
import type { ExportFormat } from "../types";

export function exportsDir(sqlite: Database): string {
  if (sqlite.name === "" || sqlite.name === ":memory:") {
    throw rule("export_needs_file", "Exports need a database file, not an in-memory database");
  }
  const dir = path.join(path.dirname(sqlite.name), "exports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** `yyyymmdd-hhmmss-<slug>-<6 id chars>.<csv|json>`. */
export function exportFileName(job: { created_at: string; name: string; id: string }, format: ExportFormat): string {
  const stamp = job.created_at.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const slug = job.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "export";
  const id = job.id.replace(/-/g, "").slice(0, 6);
  return `${stamp}-${slug}-${id}.${format}`;
}
