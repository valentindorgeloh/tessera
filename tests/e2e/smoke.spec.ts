import { expect, openWebWorkItems, test } from "./fixtures";


/**
 * Thin Chromium smoke (decision 123): critical shells render; the fixtures' page
 * fails a test on non-tolerated console errors. Needs `data/e2e.db` seeded by webServer.
 *
 * Prefer landmarks inside `main` — sidebar labels stay in a closed drawer and
 * count as hidden to Playwright.
 */

test("home shell renders", async ({ page }) => {
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Home", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("inbox shell renders", async ({ page }) => {
  await page.goto("/inbox");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Inbox", { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/inbox/);
});

test("project work-items view renders", async ({ page }) => {
  const projectId = await openWebWorkItems(page);
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-list-ready]")).toBeVisible({ timeout: 20_000 });
  await expect(main.getByText("Website").first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/work-items`));
});

test("intake surface renders or shows feature-off", async ({ page }) => {
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
});

test("workspace settings general renders", async ({ page }) => {
  await page.goto("/settings/general");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Settings", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("Workspace name")).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/general/);
});
