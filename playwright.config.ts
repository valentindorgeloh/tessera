import { defineConfig, devices } from "@playwright/test";

/**
 * Chromium smoke runner. Not part of `npm run check`.
 *
 * The Playwright browser build is not downloaded into this repo. `channel`
 * is the installed Google Chrome, and `npx playwright install` was not run.
 * There is no `webServer` here, so a run cannot open data/tessera.db on its own.
 * Start the app yourself against a scratch database, then `npm run test:e2e`.
 */
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
    channel: "chrome",
  },
});
