/**
 * The "other process" of tests/concurrency.test.ts. Run with tsx:
 *
 *   tsx tests/helpers/second-writer.ts <db path> <project id> <marker path> [name]
 *
 * Writes the marker file (its start time in ms) right before opening the
 * database, so the test can hold its own BEGIN IMMEDIATE until the marker
 * exists and be sure this write really waits on the lock. Then creates one
 * work item as the user actor and prints one JSON line with the result.
 */
import fs from "node:fs";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { latestSeq } from "@/lib/tessera/activity";
import { createContext } from "@/lib/tessera/core/context";
import { openDatabase } from "@/lib/tessera/db/client";
import { createWorkItem } from "@/lib/tessera/work-items";

export type SecondWriterResult = {
  pid: number;
  id: string;
  key: string;
  sequence_id: number;
  /** latestSeq() right after the create committed. */
  seq: number;
  /** Date.now() before the database was opened. */
  started_at: number;
  /** Date.now() after the create committed. */
  done_at: number;
};

function main(argv: string[]): number {
  const [dbPath, projectId, markerPath, name] = argv;
  if (!dbPath || !projectId || !markerPath) {
    console.error("usage: second-writer.ts <db path> <project id> <marker path> [name]");
    return 2;
  }
  const started_at = Date.now();
  fs.writeFileSync(markerPath, String(started_at));
  const handles = openDatabase(dbPath);
  try {
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    const item = createWorkItem(ctx, { project_id: projectId, name: name ?? "Written by the second process" });
    const result: SecondWriterResult = {
      pid: process.pid,
      id: item.id,
      key: item.key,
      sequence_id: item.sequence_id,
      seq: latestSeq(ctx),
      started_at,
      done_at: Date.now(),
    };
    console.log(JSON.stringify(result));
    return 0;
  } finally {
    handles.sqlite.close();
  }
}

process.exitCode = main(process.argv.slice(2));
