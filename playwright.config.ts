import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Chromium smoke suite (decision 123). Not part of `npm run check`.
 * `npm run test:e2e` builds nothing; start against a scratch database via
 * webServer. Never points at data/tessera.db.
 */
const E2E_DB = path.resolve("data/e2e.db");

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npx tsx scripts/migrate.ts && npx next dev -H 127.0.0.1 -p 3100`,
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      TESSERA_DB_PATH: E2E_DB,
      TESSERA_AUTOMATIONS: "off",
      TESSERA_WEBHOOKS: "off",
      PORT: "3100",
    },
  },
});
