import { createProjectViaMcp, expect, mcp, test } from "./fixtures";

/**
 * 375 px smoke (decision 123): home, work items and a page fit a phone-width
 * viewport. The page must not scroll sideways and the main heading shows.
 */

test.use({ viewport: { width: 375, height: 812 } });

async function expectNoSidewaysScroll(page: import("@playwright/test").Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

test("home, work items and a page have no horizontal page scroll at 375 px", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "Phone item" });
  const created = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Phone page" });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.goto(`/projects/${project.id}/work-items`);
  await expect(page.locator("[data-list-ready]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Phone item").first()).toBeVisible();
  await expectNoSidewaysScroll(page);

  await page.goto(`/projects/${project.id}/pages/${created.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Phone page" })).toBeVisible();
  await expectNoSidewaysScroll(page);
});
