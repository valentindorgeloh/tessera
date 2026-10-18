import { expect, test } from "@playwright/test";

/**
 * One smoke check. The browser install was not run; this spec is not part of
 * `npm run check`. Point a server at http://127.0.0.1:3100 before running it,
 * and do not use data/tessera.db.
 */
test("home shell renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
