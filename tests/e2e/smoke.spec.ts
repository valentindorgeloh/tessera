import { expect, test } from "@playwright/test";
import { attachConsoleGuard, openWebWorkItems } from "./helpers";

/**
 * Thin Chromium smoke (decision 123): critical shells render without
 * non-tolerated console errors. Needs `data/e2e.db` seeded by webServer.
 *
 * Prefer landmarks inside `main` — sidebar labels stay in a closed drawer and
 * count as hidden to Playwright.
 */

test("home shell renders", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Home", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  guard.assertClean();
});

test("inbox shell renders", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/inbox");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Inbox", { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/inbox/);
  guard.assertClean();
});

test("project work-items view renders", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  const projectId = await openWebWorkItems(page);
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-list-ready]")).toBeVisible({ timeout: 20_000 });
  await expect(main.getByText("Website").first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/work-items`));
  guard.assertClean();
});

test("intake surface renders or shows feature-off", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  const projectId = await openWebWorkItems(page);
  await page.goto(`/projects/${projectId}/intake`);
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  const off = main.getByText("Intake is turned off for this project");
  const on = main.getByText("Intake", { exact: true }).first();
  await expect(off.or(on)).toBeVisible({ timeout: 15_000 });
  // Demo seed leaves intake disabled; feature-off is the expected smoke path.
  if (await off.isVisible()) {
    await expect(main.getByRole("link", { name: /Open Features settings/i })).toBeVisible();
  }
  guard.assertClean();
});

test("workspace settings general renders", async ({ page }) => {
  const guard = attachConsoleGuard(page);
  await page.goto("/settings/general");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Settings", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("Workspace name")).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/general/);
  guard.assertClean();
});
