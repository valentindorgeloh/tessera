import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Decision 115 perf spec (tests/e2e/perf.spec.ts) on its own server: `next
 * start` over the 10 000-item fixture instead of data/e2e.db. Run from the
 * repository root after `next build`:
 *
 *   npx playwright test -c playwright.perf.config.ts
 *
 * The webServer command seeds the fixture first (`scripts/perf-seed.ts` is
 * idempotent: it writes nothing when the PERF project exists) and then starts
 * the server. perf-seed (through `scripts/perf-db.ts`) refuses whatever
 * TESSERA_DB_PATH names, so the seed step runs with the variable removed and
 * gets the path as `--db`. Never points at data/tessera.db. TESSERA_PERF=1
 * lets the spec run (it skips itself in the normal e2e suite,
 * playwright.config.ts). Results land in test-results/perf/ (results.json from
 * the JSON reporter, perf-runs.json from the spec). PERF_PORT defaults to 3110
 * (not the dev server's 3000 or the e2e suite's 3100); PERF_DB to
 * data/p11-perf.db; PERF_REPO to the current directory. The HEAD baseline is
 * in docs/as-built/hardening.md (section 7).
 */
const REPO = path.resolve(process.env.PERF_REPO ?? process.cwd());
const PORT = Number(process.env.PERF_PORT ?? 3110);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PERF_DB = path.resolve(REPO, process.env.PERF_DB ?? "data/p11-perf.db");
if (path.basename(PERF_DB) === "tessera.db") throw new Error(`Refusing ${PERF_DB}: the perf spec never uses the real database.`);
process.env.TESSERA_PERF = "1";

export default defineConfig({
  testDir: path.join(REPO, "tests/e2e"),
  testMatch: /perf\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90 * 60_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(REPO, "test-results/perf"),
  reporter: [["list"], ["json", { outputFile: path.join(REPO, "test-results/perf/results.json") }]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    actionTimeout: 15_000,
    navigationTimeout: 120_000,
    ...devices["Desktop Chrome"],
    // Explicit, and the same as playwright.config.ts: no animation runs during a measurement, so the
    // budgets (docs/as-built/hardening.md section 7) stay comparable with the runs before motion existed.
    reducedMotion: "reduce",
  },
  webServer: {
    command: `env -u TESSERA_DB_PATH npx tsx scripts/perf-seed.ts --db ${JSON.stringify(PERF_DB)} && npx next start -H 127.0.0.1 -p ${PORT}`,
    cwd: REPO,
    url: BASE_URL,
    reuseExistingServer: process.env.PERF_REUSE === "1",
    timeout: 300_000,
    env: {
      ...process.env,
      TESSERA_DB_PATH: PERF_DB,
      TESSERA_AUTOMATIONS: "off",
      TESSERA_WEBHOOKS: "off",
      TESSERA_PERF: "1",
      PORT: String(PORT),
    } as Record<string, string>,
  },
});
