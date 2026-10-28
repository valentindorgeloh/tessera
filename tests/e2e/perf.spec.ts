import fs from "node:fs";
import { expect, test } from "./fixtures";

/**
 * Decision 115 browser budget (docs/PLAN.md; docs/as-built/hardening.md): on
 * the 10 000-item PERF project of data/p11-perf.db (scripts/perf-seed.ts,
 * `npm run perf:seed`), on `next start`, the p95 of 20 runs from navigation
 * start to the first rendered group of the list (`[data-list-ready]`) stays at
 * or under 300 ms for list, board and table.
 *
 * Runs only under its own config (playwright.perf.config.ts at the repository
 * root sets TESSERA_PERF=1 and points `next start` at the perf database); the
 * e2e suite (playwright.config.ts on data/e2e.db) has no PERF project, so the
 * spec skips itself there.
 *
 * Each run is a hard navigation (`page.goto`) in one page, so the browser
 * cache is warm after the first visit, as for a user who reopens the list.
 * The layouts are interleaved (list, board, table, list, ...) so machine
 * noise spreads evenly; two warm-up rounds are discarded. The time is read in
 * the page: a requestAnimationFrame poll records `performance.now()` (whose
 * origin is the navigation start) on the first frame where a
 * `[data-list-ready]` element passes `checkVisibility()`. A hidden copy left
 * by a streaming swap does not count. After each run the spec waits for the
 * load event and for an idle main thread (hydration done) before the next
 * navigation, so runs never overlap; each run is printed and written to
 * `perf-runs.json` in the test output folder (under test-results/perf/) as it
 * lands, so a timeout still leaves the data. PERF_RUNS, PERF_WARMUP and
 * PERF_TIMEOUT_MIN override 20, 2 and 60.
 */

const BUDGET_MS = 300;
const RUNS = Number(process.env.PERF_RUNS ?? 20);
const WARMUP = Number(process.env.PERF_WARMUP ?? 2);
const TIMEOUT_MIN = Number(process.env.PERF_TIMEOUT_MIN ?? 60);
const LAYOUTS = ["list", "board", "table"] as const;
type Layout = (typeof LAYOUTS)[number];

test.skip(process.env.TESSERA_PERF !== "1", "decision 115 perf spec: run with playwright.perf.config.ts on data/p11-perf.db");

/** `/projects/<id>/work-items` with the layout grouped by state, as `openLayout` opens it (tests/e2e/fixtures.ts). */
function layoutUrl(projectId: string, layout: Layout): string {
  const q = Buffer.from(JSON.stringify({ display: { layout, group_by: "state" } })).toString("base64url");
  return `/projects/${projectId}/work-items?q=${q}`;
}

/** Nearest-rank percentile. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

test("list, board and table reach [data-list-ready] within 300 ms at p95 on 10 000 items", async ({ page }, testInfo) => {
  test.setTimeout(TIMEOUT_MIN * 60_000);
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

  const times: Record<Layout, number[]> = { list: [], board: [], table: [] };
  for (let round = 0; round < WARMUP + RUNS; round++) {
    for (const layout of LAYOUTS) {
      await page.goto(layoutUrl(projectId, layout), { waitUntil: "commit" });
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
      if (round >= WARMUP) times[layout].push(Math.round(ms));
      console.log(`[perf] round ${round}${round < WARMUP ? " (warm-up)" : ""} ${layout} ${Math.round(ms)} ms`);
      fs.writeFileSync(runsFile, JSON.stringify(times));
    }
  }

  const summary = Object.fromEntries(
    LAYOUTS.map((layout) => [layout, { p50: percentile(times[layout], 50), p95: percentile(times[layout], 95), max: Math.max(...times[layout]), runs: times[layout] }]),
  );
  await testInfo.attach("decision-115-list-ready.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  console.log(`decision 115 [data-list-ready] (ms): ${LAYOUTS.map((l) => `${l} p50 ${summary[l]!.p50} p95 ${summary[l]!.p95}`).join("; ")}`);

  for (const layout of LAYOUTS) {
    expect.soft(summary[layout]!.p95, `${layout}: p95 of ${RUNS} runs to [data-list-ready] (runs: ${times[layout].join(", ")})`).toBeLessThanOrEqual(BUDGET_MS);
  }
});
