/**
 * A "process" of tests/automations-lease-race.test.ts. Run with tsx:
 *
 *   tsx tests/helpers/automation-runner.ts <db path> <start-at epoch ms> <now ISO> <project id>
 *
 * Spins until the shared start time so every runner reaches the lease at the
 * same moment, runs the automations once and prints one JSON line.
 */
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { runAutomations } from "@/lib/tessera/automations";
import { createContext } from "@/lib/tessera/core/context";
import { localDateOf } from "@/lib/tessera/core/time";
import { openDatabase } from "@/lib/tessera/db/client";

export type AutomationRunnerResult =
  | { ok: true; pid: number; lease_held: boolean; closed: number; archived: number; error: string | null }
  | { ok: false; error: string };

function main(argv: string[]): number {
  const [dbPath, startAt, now, projectId] = argv;
  if (!dbPath || !startAt || !now || !projectId) {
    console.error("usage: automation-runner.ts <db path> <start-at epoch ms> <now ISO> <project id>");
    return 2;
  }
  const handles = openDatabase(dbPath);
  try {
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => now, today: () => localDateOf(now) });
    const start = Number(startAt);
    while (Date.now() < start) {
      // Spin: setTimeout granularity is too coarse for a race.
    }
    const summary = runAutomations(ctx, { project_id: projectId });
    const project = summary.projects[0];
    const result: AutomationRunnerResult = {
      ok: true,
      pid: process.pid,
      lease_held: summary.lease_held,
      closed: project?.closed ?? 0,
      archived: project?.archived ?? 0,
      error: project?.error ?? null,
    };
    console.log(JSON.stringify(result));
    return 0;
  } catch (err) {
    const result: AutomationRunnerResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    console.log(JSON.stringify(result));
    return 1;
  } finally {
    handles.sqlite.close();
  }
}

process.exitCode = main(process.argv.slice(2));
