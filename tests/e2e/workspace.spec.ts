import { createProjectViaUi, expect, openWorkItems, quickAddItems, test, waitForDialog } from "./fixtures";

/** P9: Home (quick links, recents), favourites in the sidebar, and analytics that equal the sidebar counts. */

test("a quick link added on Home stays after a reload, and opened items show under Recent", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Recent me"]);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Work item" }).getByRole("heading", { name: "Recent me" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Add link" }).first().click();
  const dialog = await waitForDialog(page, "Add link");
  await dialog.getByRole("textbox", { name: /^URL/ }).fill("/analytics");
  await dialog.getByRole("textbox", { name: /^Title/ }).fill(`Shortcut ${project.identifier}`);
  await dialog.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByRole("link", { name: `Shortcut ${project.identifier}` })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: `Shortcut ${project.identifier}` })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recent" })).toContainText(`${project.identifier}-1`);
});

test("a favourited project shows in the sidebar Favorites group and leaves it again", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  const sidebar = page.getByRole("navigation", { name: "Work" });
  await page.getByRole("button", { name: "Add to favorites" }).first().click();
  await expect(page.getByRole("button", { name: "Remove from favorites" }).first()).toBeVisible();
  const group = sidebar.getByRole("group", { name: "Favorites" });
  await expect(group.getByRole("link", { name: new RegExp(project.name) })).toBeVisible();

  await page.getByRole("button", { name: "Remove from favorites" }).first().click();
  await expect(group.getByRole("link", { name: new RegExp(project.name) })).toHaveCount(0);
});

test("the analytics work item total equals the sum of the sidebar project counts", async ({ page }) => {
  await page.goto("/analytics");
  const total = page.getByRole("link", { name: /^\d+ Work items$/ });
  await expect(total).toBeVisible({ timeout: 20_000 });
  const label = await total.evaluate((element) => element.getAttribute("aria-label") ?? element.textContent ?? "");
  const analyticsTotal = Number(label.match(/\d+/)?.[0]);

  const sidebar = page.getByRole("navigation", { name: "Work" });
  const links = sidebar.getByRole("group", { name: "Projects" }).getByRole("link", { name: /\s\d+$/ });
  // The sidebar streams in its own Suspense boundary, so poll until its rows are in.
  await expect(links.first()).toBeVisible();
  await expect
    .poll(async () => {
      const names = await links.allTextContents();
      return names.reduce((sum, text) => sum + Number(text.match(/(\d+)\s*$/)?.[1] ?? 0), 0);
    })
    .toBe(analyticsTotal);
});
