/**
 * Automation lease across processes (decision 28): N real processes call
 * runAutomations on one file database with due items at the same moment.
 * Exactly one applies the changes, the others report lease_held (or run after
 * the release and find nothing due), and none crashes. The sequential case lives
 * in tests/automations.test.ts.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { openDatabase } from "@/lib/tessera/db/client";
import { REPO_ROOT } from "@/lib/tessera/db/migrate";
import { activity, work_item } from "@/lib/tessera/db/schema";
import { createProject, updateProject } from "@/lib/tessera/projects";
import { createWorkItem } from "@/lib/tessera/work-items";
import { withTempFileDb } from "./helpers/db";
import type { AutomationRunnerResult } from "./helpers/automation-runner";

const execFileAsync = promisify(execFile);
const RUNNERS = 5;
/** Enough due items that the winning run outlasts the losers' start skew. */
const ITEMS = 300;
const NOW = "2026-10-18T12:00:00.000Z";
const OLD = "2026-01-15T12:00:00.000Z";
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const CHILD = path.join(REPO_ROOT, "tests", "helpers", "automation-runner.ts");

async function runChild(dbPath: string, startAt: number, projectId: string): Promise<AutomationRunnerResult> {
  try {
    const { stdout } = await execFileAsync(TSX, [CHILD, dbPath, String(startAt), NOW, projectId], {
      cwd: REPO_ROOT,
      env: { ...process.env, TZ: "UTC" },
      timeout: 90_000,
    });
    return JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as AutomationRunnerResult;
  } catch (err) {
    const line = ((err as { stdout?: string }).stdout ?? "").trim().split("\n").pop();
    if (line) return JSON.parse(line) as AutomationRunnerResult;
    return { ok: false, error: String(err) };
  }
}

describe("automation lease across processes", () => {
  it("lets exactly one of several simultaneous runners apply the changes", async () => {
    await withTempFileDb(async (filePath) => {
      const handles = openDatabase(filePath);
      let projectId: string;
      try {
        const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID, now: () => NOW, today: () => "2026-10-18" });
        const project = createProject(ctx, { name: "Web", identifier: "WEB" });
        projectId = project.id;
        updateProject(ctx, project.id, { close_in_months: 1 });
        for (let i = 0; i < ITEMS; i += 1) {
          const item = createWorkItem(ctx, { project_id: project.id, name: `Stale ${i}` });
          handles.db.update(work_item).set({ updated_at: OLD }).where(eq(work_item.id, item.id)).run();
        }
      } finally {
        handles.sqlite.close();
      }

      // tsx needs about a second to boot; the shared start time lines the lease attempts up.
      const startAt = Date.now() + 5000;
      const results = await Promise.all(Array.from({ length: RUNNERS }, () => runChild(filePath, startAt, projectId)));
      expect(results.filter((result) => !result.ok)).toEqual([]);
      const ok = results.filter((result): result is Extract<AutomationRunnerResult, { ok: true }> => result.ok);
      // A runner that queued behind the winner's write transactions may take the lease only after the
      // winner released it. It then finds nothing due, which is correct, so "applied" is what counts.
      const appliers = ok.filter((result) => result.closed + result.archived > 0);
      const heldOut = ok.filter((result) => result.lease_held);
      expect(appliers, JSON.stringify(results)).toHaveLength(1);
      expect(appliers[0]).toMatchObject({ lease_held: false, closed: ITEMS, archived: 0, error: null });
      expect(heldOut.length, JSON.stringify(results)).toBeGreaterThanOrEqual(1);
      for (const result of ok) {
        if (result.lease_held) expect(result).toMatchObject({ closed: 0, archived: 0 });
        expect(result.error).toBeNull();
      }

      const check = openDatabase(filePath);
      try {
        const rows = check.db.select().from(activity).where(eq(activity.actor_id, "00000000-0000-7000-8000-000000000003")).all();
        // One system activity row per closed item: a second applier would have doubled it.
        expect(rows.filter((row) => row.field === "state_id")).toHaveLength(ITEMS);
      } finally {
        check.sqlite.close();
      }
    });
  }, 180_000);
});
