import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Chromium suite (decisions 123 and 124). Not part of `npm run check`: it runs
 * against a production build, so `npm run check:e2e` builds first. Never points
 * at data/tessera.db.
 *
 * The web server is `next start -H 127.0.0.1` on E2E_PORT (default 3100) with
 * TESSERA_DB_PATH=data/e2e.db, automations and webhook delivery off, and
 * TESSERA_AI_FAKE replaying tests/e2e/fixtures/ai/*.json. Before it starts,
 * tests/e2e/prepare-db.ts moves an existing e2e database aside (never deletes
 * it), migrates and seeds the deterministic fixture. That runs in the command,
 * not in `globalSetup`: Playwright starts the web server first and probes its
 * URL, and the probe would open the database before a later setup replaced it.
 *
 * Specs isolate by creating projects with unique identifiers. One worker.
 * Install the browser once: `npx playwright install chromium`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const E2E_DB = path.resolve(process.env.TESSERA_DB_PATH ?? "data/e2e.db");

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ...devices["Desktop Chrome"],
    // Motion is off for the suite: with a mouse Astryx's own primitives (the rail, the
    // animators, entry animations) land at once and every Tessera keyframe is
    // `animation: none` (src/components/styles/motion.css), so fixed waits and
    // position probes stay valid. A tests/e2e/motion-*.spec.ts opts back in with
    // test.use({ reducedMotion: "no-preference" }).
    reducedMotion: "reduce",
  },
  webServer: {
    command: `npx tsx tests/e2e/prepare-db.ts && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    // A reused server keeps its database; only for local debugging (E2E_REUSE=1).
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 180_000,
    env: {
      ...process.env,
      TESSERA_DB_PATH: E2E_DB,
      TESSERA_AUTOMATIONS: "off",
      TESSERA_WEBHOOKS: "off",
      TESSERA_AI_FAKE: path.resolve("tests/e2e/fixtures/ai"),
      PORT: String(PORT),
    } as Record<string, string>,
  },
});
