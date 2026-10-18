/**
 * Query plans are tested (decision 126). The engine reads the perf budgets
 * depend on (list page, group projection, counts, search, the revision probes)
 * run on a 2 000-item fixture; every SELECT they issue is replayed under
 * EXPLAIN QUERY PLAN, and the test fails when a plan reads work_item or
 * activity with a full table SCAN (a scan through an index is fine: the
 * workspace-wide counts have to visit every row).
 */
import type { Database } from "better-sqlite3";
import { beforeAll, describe, expect, it, test } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { getCounts } from "@/lib/tessera/counts";
import { latestSeq } from "@/lib/tessera/activity";
import { searchAll } from "@/lib/tessera/search";
import { seedPerf } from "@/lib/tessera/seed-perf";
import { listWorkItems } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb, type TesseraContext } from "../helpers/db";

const FIXTURE_ITEMS = 1600;
const OTHER_ITEMS = 400;
/** Tables whose full scan fails the test; the others (label, state, ...) are tiny. */
const GUARDED_TABLES = ["work_item", "activity"];

type Captured = { sql: string; args: unknown[] };

const STATEMENT_METHODS = ["all", "get", "run", "iterate"] as const;

/** Runs `fn` and returns every statement it executed with its bound arguments. */
function capture(sqlite: Database, fn: () => unknown): Captured[] {
  const seen: Captured[] = [];
  const original = sqlite.prepare.bind(sqlite);
  (sqlite as { prepare: unknown }).prepare = (source: string) => {
    const statement = original(source);
    const proto = Object.getPrototypeOf(statement) as Record<string, (...args: unknown[]) => unknown>;
    for (const method of STATEMENT_METHODS) {
      const run = proto[method] as (...args: unknown[]) => unknown;
      (statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        seen.push({ sql: source, args });
        return run.apply(statement, args);
      };
    }
    return statement;
  };
  try {
    fn();
  } finally {
    delete (sqlite as { prepare?: unknown }).prepare;
  }
  return seen;
}

/** Bound arguments as better-sqlite3 takes them: a flat list, or one array or object. */
function bindings(args: unknown[]): unknown[] {
  return args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
}

/** The plan lines of one SELECT, or null for anything else. */
function plan(sqlite: Database, captured: Captured): string[] | null {
  if (!/^\s*(with|select)\b/i.test(captured.sql)) return null;
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${captured.sql}`).all(...bindings(captured.args)) as { detail: string }[];
  return rows.map((row) => row.detail);
}

/** Plan lines that scan a guarded table without an index. */
export function bareScans(lines: readonly string[]): string[] {
  return lines.filter((line) => GUARDED_TABLES.some((table) => new RegExp(`^SCAN (${table})( |$)`).test(line) && !/USING (COVERING )?INDEX/.test(line)));
}

function plansOf(sqlite: Database, run: () => unknown): { sql: string; lines: string[] }[] {
  const statements = capture(sqlite, run);
  const out: { sql: string; lines: string[] }[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    if (seen.has(statement.sql)) continue;
    seen.add(statement.sql);
    const lines = plan(sqlite, statement);
    if (lines) out.push({ sql: statement.sql, lines });
  }
  return out;
}

describe("query plans (decision 126)", () => {
  let ctx: TesseraContext;
  let sqlite: Database;
  let projectId: string;
  let itemId: string;
  let labelId: string;
  let cycleId: string;

  beforeAll(() => {
    const handles = createTestDb();
    sqlite = handles.sqlite;
    ctx = createTestContext(handles);
    const result = seedPerf(ctx, { items: FIXTURE_ITEMS, other_items: OTHER_ITEMS });
    projectId = result.project_id;
    expect(result.counts.work_items).toBe(FIXTURE_ITEMS + OTHER_ITEMS);
    labelId = (sqlite.prepare("SELECT id FROM label WHERE project_id = ? LIMIT 1").get(projectId) as { id: string }).id;
    cycleId = (sqlite.prepare("SELECT id FROM cycle WHERE project_id = ? LIMIT 1").get(projectId) as { id: string }).id;
    itemId = (sqlite.prepare("SELECT id FROM work_item WHERE project_id = ? LIMIT 1").get(projectId) as { id: string }).id;
  }, 120_000);

  const scope = () => ({ type: "project" as const, project_id: projectId });
  /**
   * Cases and the full scans of work_item they may keep. The workspace list has
   * no project predicate, so it must visit every row once for the total and once
   * for the page: no index can change that (a partial index on the live rows
   * still scans all of them), so the plan is pinned at two instead of zero.
   * The cycle scope names the cycle's project as well as `cycle_id`, so it uses
   * the `(project_id, cycle_id)` index and allows no scan.
   */
  const cases: [string, () => unknown, number][] = [
    ["list page, ungrouped", () => listWorkItems(ctx, { scope: scope(), limit: 200 }), 0],
    ["list page, workspace scope", () => listWorkItems(ctx, { scope: { type: "workspace" }, limit: 200 }), 2],
    ["list page, filtered by priority", () => listWorkItems(ctx, { scope: scope(), filters: { priority: ["high"] }, limit: 200 }), 0],
    ["list page, filtered by label", () => listWorkItems(ctx, { scope: scope(), filters: { labels: [labelId] }, limit: 200 }), 0],
    ["list page, filtered by assignee", () => listWorkItems(ctx, { scope: scope(), filters: { assignees: [USER_ACTOR_ID] }, limit: 200 }), 0],
    ["list page, cycle scope", () => listWorkItems(ctx, { scope: { type: "cycle", cycle_id: cycleId }, limit: 200 }), 0],
    ["list page, grouped by state", () => listWorkItems(ctx, { scope: scope(), display: { group_by: "state" }, per_group_limit: 50 }), 0],
    ["group projection, priority", () => listWorkItems(ctx, { scope: scope(), display: { group_by: "priority" }, per_group_limit: 50 }), 0],
    ["group projection, labels", () => listWorkItems(ctx, { scope: scope(), display: { group_by: "labels" }, per_group_limit: 50 }), 0],
    ["group projection, assignees", () => listWorkItems(ctx, { scope: scope(), display: { group_by: "assignees" }, per_group_limit: 50 }), 0],
    ["group projection, modules", () => listWorkItems(ctx, { scope: scope(), display: { group_by: "module" }, per_group_limit: 50 }), 0],
    ["counts, project", () => getCounts(ctx, scope()), 0],
    ["counts, workspace", () => getCounts(ctx, { type: "workspace" }), 0],
    ["search, free text", () => searchAll(ctx, "checkout"), 0],
    ["search, by key", () => searchAll(ctx, "PERF-12"), 0],
    ["revision probe, latestSeq", () => latestSeq(ctx), 0],
  ];

  it.each(cases)("%s reads work_item and activity through an index", (_name, run, allowedScans) => {
    const plans = plansOf(sqlite, run);
    expect(plans.length).toBeGreaterThan(0);
    if (process.env.QP_DEBUG) for (const entry of plans) console.log(`${_name}\n${entry.sql}\n  ${entry.lines.join("\n  ")}`);
    const scans = plans.flatMap((entry) => bareScans(entry.lines));
    expect(scans.length, plans.find((entry) => bareScans(entry.lines).length > 0)?.sql).toBeLessThanOrEqual(allowedScans);
  });

  it("cycle scope searches work_item through the project and cycle index", () => {
    const plans = plansOf(sqlite, () => listWorkItems(ctx, { scope: { type: "cycle", cycle_id: cycleId }, limit: 200 }));
    expect(plans.flatMap((entry) => bareScans(entry.lines))).toEqual([]);
    expect(plans.flatMap((entry) => entry.lines).join("\n")).toMatch(/work_item_project_cycle_idx/);
  });

  // Not needed by the list any more. Cycle detail and progress (cycles.ts) still read by cycle_id alone; a migration owner may add:
  // CREATE INDEX work_item_cycle_idx ON work_item(cycle_id) WHERE cycle_id IS NOT NULL;

  it("revision probes use their activity indexes", () => {
    const probes: [string, unknown[], RegExp][] = [
      ["SELECT max(seq) AS seq FROM activity WHERE project_id = ?", [projectId], /activity_project_seq_idx/],
      ["SELECT max(seq) AS seq FROM activity WHERE project_id IS NULL", [], /activity_project_seq_idx/],
      ["SELECT max(seq) AS seq FROM activity WHERE work_item_id = ?", [itemId], /activity_work_item_seq_idx/],
    ];
    for (const [sql, args, index] of probes) {
      const lines = (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((row) => row.detail);
      expect(lines.join("\n"), sql).toMatch(index);
      expect(bareScans(lines), sql).toEqual([]);
    }
  });

  test("the scanner flags a bare scan and accepts an index scan", () => {
    expect(bareScans(["SCAN work_item"])).toEqual(["SCAN work_item"]);
    expect(bareScans(["SCAN activity"])).toEqual(["SCAN activity"]);
    expect(bareScans(["SCAN work_item USING COVERING INDEX work_item_project_state_idx"])).toEqual([]);
    expect(bareScans(["SEARCH work_item USING INDEX work_item_project_sort_idx (project_id=?)"])).toEqual([]);
    expect(bareScans(["SCAN label"])).toEqual([]);
  });
});
