import fs from "node:fs";
import os from "node:os";
import { expect, test } from "./fixtures";

/**
 * Decision 115 browser budget (docs/PLAN.md; docs/as-built/hardening.md): on
 * the 10 000-item PERF project of data/p11-perf.db (scripts/perf-seed.ts,
 * `npm run perf:seed`), on `next start`, the p95 of 20 runs from navigation
 * start to the first rendered group of the list (`[data-list-ready]`) stays at
 * or under 300 ms for list, board and table grouped by state, and for list and
 * table without grouping (decision 138). List grouped by labels is measured and
 * reported, not gated.
 *
 * Runs only under its own config (playwright.perf.config.ts at the repository
 * root sets TESSERA_PERF=1 and points `next start` at the perf database); the
 * e2e suite (playwright.config.ts on data/e2e.db) has no PERF project, so the
 * spec skips itself there.
 *
 * Each run is a hard navigation (`page.goto`) in one page, so the browser
 * cache is warm after the first visit, as for a user who reopens the list.
 * The scenarios are interleaved (list, board, table, list, ...) so machine
 * noise spreads evenly; two warm-up rounds are discarded. The time is read in
 * the page: a requestAnimationFrame poll records `performance.now()` (whose
 * origin is the navigation start) on the first frame where a
 * `[data-list-ready]` element passes `checkVisibility()`. A hidden copy left
 * by a streaming swap does not count. After each run the spec waits for the
 * load event and for an idle main thread (hydration done) before the next
 * navigation, so runs never overlap; each run is printed and written to
 * `perf-runs.json` in the test output folder (under test-results/perf/) as it
 * lands, so a timeout still leaves the data. The load average before and
 * after the runs goes into the attached summary, because the numbers move
 * with machine load. PERF_RUNS, PERF_WARMUP and PERF_TIMEOUT_MIN override 20,
 * 2 and 60.
 */

const BUDGET_MS = 300;
const RUNS = Number(process.env.PERF_RUNS ?? 20);
const WARMUP = Number(process.env.PERF_WARMUP ?? 2);
const TIMEOUT_MIN = Number(process.env.PERF_TIMEOUT_MIN ?? 60);
type Scenario = { name: string; layout: "list" | "board" | "table"; group_by: "state" | "labels" | null; gated: boolean };
/** Decision 138: grouped by state (decision 115's scenarios) and flat are gated; list grouped by labels is reported only. */
const SCENARIOS: readonly Scenario[] = [
  { name: "list", layout: "list", group_by: "state", gated: true },
  { name: "board", layout: "board", group_by: "state", gated: true },
  { name: "table", layout: "table", group_by: "state", gated: true },
  { name: "list flat", layout: "list", group_by: null, gated: true },
  { name: "table flat", layout: "table", group_by: null, gated: true },
  { name: "list by labels", layout: "list", group_by: "labels", gated: false },
];

test.skip(process.env.TESSERA_PERF !== "1", "decision 115 perf spec: run with playwright.perf.config.ts on data/p11-perf.db");

/** `/projects/<id>/work-items` with the scenario's layout and grouping in `q`, as `workItemsUrl` builds it (tests/e2e/fixtures.ts). */
function layoutUrl(projectId: string, scenario: Scenario): string {
  const q = Buffer.from(JSON.stringify({ display: { layout: scenario.layout, group_by: scenario.group_by } })).toString("base64url");
  return `/projects/${projectId}/work-items?q=${q}`;
}

/** Nearest-rank percentile. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

test("list, board and table, grouped and flat, reach [data-list-ready] within 300 ms at p95 on 10 000 items", async ({ page }, testInfo) => {
  test.setTimeout(TIMEOUT_MIN * 60_000);
  const loadBefore = os.loadavg();
  const runsFile = testInfo.outputPath("perf-runs.json");
  await page.addInitScript(() => {
    const w = window as Window & { __listReady?: number };
    const tick = () => {
      const ready = [...document.querySelectorAll("[data-list-ready]")].some((el) => el.checkVisibility());
      if (ready) w.__listReady = performance.now();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // The PERF project's identifier resolves to its id through the project index redirect.
  await page.goto("/projects/PERF");
  await page.waitForURL(/\/projects\/[0-9a-f-]{20,}\/work-items/, { timeout: 60_000 });
  const projectId = page.url().match(/\/projects\/([0-9a-f-]{20,})/)![1]!;

  const times: Record<string, number[]> = Object.fromEntries(SCENARIOS.map((scenario) => [scenario.name, []]));
  for (let round = 0; round < WARMUP + RUNS; round++) {
    for (const scenario of SCENARIOS) {
      await page.goto(layoutUrl(projectId, scenario), { waitUntil: "commit" });
      const handle = await page.waitForFunction(() => (window as Window & { __listReady?: number }).__listReady, null, { timeout: 120_000, polling: 50 });
      const ms = (await handle.jsonValue()) as number;
      // Let the page finish loading and hydrating so the next navigation does not race this one's work.
      await page.waitForLoadState("load", { timeout: 300_000 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let last = performance.now();
            let quiet = 0;
            const ping = () => {
              const now = performance.now();
              quiet = now - last < 100 ? quiet + (now - last) : 0;
              last = now;
              if (quiet >= 500) resolve();
              else setTimeout(ping, 50);
            };
            setTimeout(ping, 50);
          }),
      );
      if (round >= WARMUP) times[scenario.name]!.push(Math.round(ms));
      console.log(`[perf] round ${round}${round < WARMUP ? " (warm-up)" : ""} ${scenario.name} ${Math.round(ms)} ms`);
      fs.writeFileSync(runsFile, JSON.stringify(times));
    }
  }

  const loadAfter = os.loadavg();
  const summary = Object.fromEntries(
    SCENARIOS.map(({ name, gated }) => {
      const runs = times[name]!;
      return [name, { gated, p50: percentile(runs, 50), p95: percentile(runs, 95), max: Math.max(...runs), runs }];
    }),
  );
  await testInfo.attach("decision-115-list-ready.json", { body: JSON.stringify({ loadavg: { before: loadBefore, after: loadAfter }, scenarios: summary }, null, 2), contentType: "application/json" });
  console.log(
    `decision 115 [data-list-ready] (ms): ${SCENARIOS.map(({ name, gated }) => `${name}${gated ? "" : " (report only)"} p50 ${summary[name]!.p50} p95 ${summary[name]!.p95}`).join("; ")}; load average ${loadBefore.map((v) => v.toFixed(2)).join("/")} before, ${loadAfter.map((v) => v.toFixed(2)).join("/")} after`,
  );

  for (const { name, gated } of SCENARIOS) {
    if (!gated) continue;
    expect.soft(summary[name]!.p95, `${name}: p95 of ${RUNS} runs to [data-list-ready] (runs: ${times[name]!.join(", ")})`).toBeLessThanOrEqual(BUDGET_MS);
  }
});
