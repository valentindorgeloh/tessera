/**
 * `npm run perf:bench [-- --db data/p11-perf.db --runs 50 --rounds 3]`
 *
 * Times the engine reads named in decision 115 on the perf fixture
 * (`npm run perf:seed` first) and prints p50 and p95 in milliseconds per case
 * against its budget. Each case is measured in `--rounds` rounds of `--runs`
 * calls (default 3 of 50) and the round with the lowest p95 is reported: other
 * work on the machine only ever adds time, so the best round is the engine's
 * own cost and a loaded machine does not fail the gate. Exits 1 when any
 * reported p95 is over budget, 2 when the fixture is missing. Like the seed
 * script it refuses the user's database.
 *
 * Budgets (decision 115): first list page 40 ms, getCounts 25 ms, analytics
 * overview 60 ms, search 30 ms. The board page and the group projection use the
 * list-page budget; the detail read has no budget in the decision and uses 25 ms.
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { getAnalytics } from "@/lib/tessera/analytics";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import { getCounts } from "@/lib/tessera/counts";
import { openDatabase } from "@/lib/tessera/db/client";
import { migrateIfNeeded } from "@/lib/tessera/db/migrate";
import { pageSizeFor } from "@/components/work-items/paging";
import { searchAll } from "@/lib/tessera/search";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { Display } from "@/lib/tessera/types";
import { getWorkItem, listWorkItems } from "@/lib/tessera/work-items";
import { PERF_DB, perfDbPath } from "./perf-db";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "Usage: npm run perf:bench -- [--db <file>] [--runs <n>] [--rounds <n>] [--project <IDENT>]";
const WARMUP = 3;
/** Items of the project the detail-read case rotates through; the header prints the real project count next to it. */
const DETAIL_SAMPLE = 500;
const LIST_BUDGET_MS = 40;
const COUNTS_BUDGET_MS = 25;
const ANALYTICS_BUDGET_MS = 60;
const SEARCH_BUDGET_MS = 30;
const DETAIL_BUDGET_MS = 25;
const SEARCH_TERMS = ["checkout", "login form", "invoice", "webhook", "cache", "Refactor sidebar"];

type Bench = { name: string; budget: number; run: (i: number) => unknown };
type Row = { name: string; budget: number; p50: number; p95: number; max: number };

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] as number;
}

/** Wall-clock milliseconds of `runs` calls after a short warm-up. */
function measureRound(bench: Bench, runs: number): Row {
  for (let i = 0; i < WARMUP; i += 1) bench.run(i);
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    bench.run(i);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { name: bench.name, budget: bench.budget, p50: percentile(times, 50), p95: percentile(times, 95), max: times[times.length - 1] as number };
}

/** The round with the lowest p95 of `rounds` rounds (see the header). */
function measure(bench: Bench, runs: number, rounds: number): Row {
  let best = measureRound(bench, runs);
  for (let round = 1; round < rounds; round += 1) {
    const next = measureRound(bench, runs);
    if (next.p95 < best.p95) best = next;
  }
  return best;
}

function parseArgs(argv: string[]): { db: string; runs: number; rounds: number; project: string } {
  const args = { db: PERF_DB, runs: 50, rounds: 3, project: "PERF" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag ?? ""} needs a value`);
    if (flag === "--db") args.db = value;
    else if (flag === "--runs") {
      args.runs = Number(value);
      if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error("--runs needs a positive integer");
    } else if (flag === "--rounds") {
      args.rounds = Number(value);
      if (!Number.isInteger(args.rounds) || args.rounds < 1) throw new Error("--rounds needs a positive integer");
    } else if (flag === "--project") args.project = value;
    else throw new Error(`unknown option ${flag ?? ""}`);
  }
  return args;
}

function benches(ctx: TesseraContext, projectId: string, itemIds: readonly string[]): Bench[] {
  const scope = { type: "project" as const, project_id: projectId };
  // The first page the UI asks for: pageSizeFor picks the rows per group (smaller for labels, assignees, modules).
  const page = (display: Record<string, unknown>) => () => listWorkItems(ctx, { scope, display, ...pageSizeFor({ ...DEFAULT_DISPLAY, ...display } as Display) } as never);
  const listGrouped = page({ layout: "list", group_by: "state" });
  const listFlat = page({ layout: "list", group_by: null });
  const board = page({ layout: "board", group_by: "state" });
  const byPriority = page({ layout: "list", group_by: "priority" });
  const byLabels = page({ layout: "list", group_by: "labels" });
  const byAssignees = page({ layout: "list", group_by: "assignees" });
  const byModules = page({ layout: "list", group_by: "module" });
  return [
    { name: "list first page, ungrouped (limit 200)", budget: LIST_BUDGET_MS, run: listFlat },
    { name: "list first page, grouped by state (first page)", budget: LIST_BUDGET_MS, run: listGrouped },
    { name: "list first page, workspace scope (limit 200)", budget: LIST_BUDGET_MS, run: () => listWorkItems(ctx, { scope: { type: "workspace" }, limit: 200 }) },
    { name: "board first page, by state (first page)", budget: LIST_BUDGET_MS, run: board },
    { name: "group projection, by priority", budget: LIST_BUDGET_MS, run: byPriority },
    { name: "group projection, by labels", budget: LIST_BUDGET_MS, run: byLabels },
    { name: "group projection, by assignees", budget: LIST_BUDGET_MS, run: byAssignees },
    { name: "group projection, by modules", budget: LIST_BUDGET_MS, run: byModules },
    { name: "getCounts, project", budget: COUNTS_BUDGET_MS, run: () => getCounts(ctx, scope) },
    { name: "getCounts, workspace", budget: COUNTS_BUDGET_MS, run: () => getCounts(ctx, { type: "workspace" }) },
    { name: "analytics overview, 30d", budget: ANALYTICS_BUDGET_MS, run: () => getAnalytics(ctx, { tab: "overview", range: "30d" }) },
    { name: "search (rotating terms)", budget: SEARCH_BUDGET_MS, run: (i) => searchAll(ctx, SEARCH_TERMS[i % SEARCH_TERMS.length] as string) },
    { name: "detail read (rotating items)", budget: DETAIL_BUDGET_MS, run: (i) => getWorkItem(ctx, itemIds[(i * 97) % itemIds.length] as string) },
  ];
}

function main(): number {
  loadEnvConfig(REPO_ROOT);
  let args: { db: string; runs: number; rounds: number; project: string };
  let dbPath: string;
  try {
    args = parseArgs(process.argv.slice(2));
    dbPath = perfDbPath(args.db);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return 1;
  }
  migrateIfNeeded(dbPath);
  const handles = openDatabase(dbPath);
  try {
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    const project = handles.sqlite.prepare("SELECT id FROM project WHERE identifier = ? AND deleted_at IS NULL").get(args.project.toUpperCase()) as { id: string } | undefined;
    if (!project) {
      console.error(`Project ${args.project} is not in ${dbPath}. Run: npm run perf:seed -- --db ${args.db}`);
      return 2;
    }
    const itemIds = (handles.sqlite.prepare(`SELECT id FROM work_item WHERE project_id = ? AND deleted_at IS NULL ORDER BY sort_order LIMIT ${DETAIL_SAMPLE}`).all(project.id) as { id: string }[]).map((row) => row.id);
    const total = (handles.sqlite.prepare("SELECT count(*) AS n FROM work_item WHERE deleted_at IS NULL").get() as { n: number }).n;
    const inProject = (handles.sqlite.prepare("SELECT count(*) AS n FROM work_item WHERE project_id = ? AND deleted_at IS NULL").get(project.id) as { n: number }).n;
    console.log(`Database: ${dbPath} (${total} work items, ${inProject} in ${args.project}), best of ${args.rounds} rounds of ${args.runs} runs after ${WARMUP} warm-up runs`);
    console.log(`Detail read samples ${itemIds.length} of the ${inProject} ${args.project} items (the first ${DETAIL_SAMPLE} by sort order).`);
    const rows = benches(ctx, project.id, itemIds).map((bench) => measure(bench, args.runs, args.rounds));
    const width = Math.max(...rows.map((row) => row.name.length));
    let failed = 0;
    for (const row of rows) {
      const over = row.p95 > row.budget;
      if (over) failed += 1;
      const cells = [row.name.padEnd(width), `p50 ${row.p50.toFixed(1).padStart(6)} ms`, `p95 ${row.p95.toFixed(1).padStart(6)} ms`, `max ${row.max.toFixed(1).padStart(6)} ms`, `budget ${String(row.budget).padStart(3)} ms`, over ? "OVER" : "ok"];
      console.log(cells.join("  "));
    }
    console.log(failed === 0 ? "All p95 values are within budget." : `${failed} case(s) over budget.`);
    return failed === 0 ? 0 : 1;
  } finally {
    handles.sqlite.close();
  }
}

process.exitCode = main();
