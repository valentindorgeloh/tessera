/**
 * A "process" of tests/first-open-race.test.ts. Run with tsx:
 *
 *   tsx tests/helpers/first-open.ts <db path> <start-at epoch ms>
 *
 * Busy-waits until the shared start time so every child opens the one fresh
 * database file at the same moment, then prints one JSON line.
 */
import { openDatabase } from "@/lib/tessera/db/client";

function main(argv: string[]): number {
  const [dbPath, startAt] = argv;
  if (!dbPath || !startAt) {
    console.error("usage: first-open.ts <db path> <start-at epoch ms>");
    return 2;
  }
  const start = Number(startAt);
  while (Date.now() < start) {
    // Spin: setTimeout granularity is too coarse for a race.
  }
  try {
    const handles = openDatabase(dbPath);
    const row = handles.sqlite.prepare("SELECT COUNT(*) AS n FROM workspace_settings").get() as { n: number };
    const actors = handles.sqlite.prepare("SELECT COUNT(*) AS n FROM actor").get() as { n: number };
    handles.sqlite.close();
    console.log(JSON.stringify({ ok: true, settings: row.n, actors: actors.n }));
    return 0;
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) }));
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
