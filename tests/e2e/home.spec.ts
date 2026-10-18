import { expect, test } from "@playwright/test";

/**
 * Smoke: the home shell renders. Tolerates only the field-guide Astryx Table
 * ContextMenu warnings when a table is present (none on Home).
 */
test("home shell renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  // Sidebar "Home" can sit in a closed mobile drawer; the main landmark is enough.
  await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/$/);
  const blocked = errors.filter((text) => !text.includes("moveTo") && !text.includes("start") && !text.includes("cancel"));
  expect(blocked).toEqual([]);
});
