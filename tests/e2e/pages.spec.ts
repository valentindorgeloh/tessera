import { createProjectViaUi, expect, waitForSaved, openWorkItems, quickAddItems, test } from "./fixtures";

/**
 * docs/PLAN.md §12 browser check 7 (a page embeds a work item with `#`) and the
 * P6 page lifecycle: lock and archive.
 */

test.describe.configure({ mode: "serial" });

test("a page embeds a work item with # and the embed survives a reload", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Embedded item"]);

  await page.goto(`/projects/${project.id}/pages`);
  await page.getByRole("button", { name: "New page" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled" })).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Untitled" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Launch notes");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");

  const editor = page.getByRole("textbox").last();
  await editor.click();
  await page.keyboard.type(`See #${project.identifier}-1`);
  const options = page.getByRole("listbox", { name: "Work items" });
  await expect(options.getByRole("option", { name: new RegExp(`${project.identifier}-1 Embedded item`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor.locator(`a[href="work:${project.identifier}-1"]`)).toBeVisible();
  await waitForSaved(page);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Launch notes" }).first()).toBeVisible();
  await expect(page.getByRole("textbox").last().locator(`a[href="work:${project.identifier}-1"]`)).toBeVisible();
});

test("the embedded work item shows Mentioned in with the page", async ({ page }) => {
  // docs/PLAN.md section 12 step 7: the work item detail lists the pages that embed it.
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Mentioned item"]);

  await page.goto(`/projects/${project.id}/pages`);
  await page.getByRole("button", { name: "New page" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled" })).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Untitled" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Backlink page");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");

  const editor = page.getByRole("textbox").last();
  await editor.click();
  await page.keyboard.type(`See #${project.identifier}-1`);
  await expect(page.getByRole("listbox", { name: "Work items" }).getByRole("option", { name: new RegExp(`${project.identifier}-1 Mentioned item`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor.locator(`a[href="work:${project.identifier}-1"]`)).toBeVisible();
  await waitForSaved(page);

  await openWorkItems(page, project.id);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Mentioned item" })).toBeVisible();
  await expect(peek.getByText("Mentioned in")).toBeVisible();
  await expect(peek.getByRole("link", { name: "Backlink page" })).toBeVisible();
});

test("a page locks, refuses edits, and unlocks; an archived page restores", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await page.goto(`/projects/${project.id}/pages`);
  await page.getByRole("button", { name: "New page" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled" }).first()).toBeVisible();
  const editor = page.getByRole("textbox").last();
  await editor.click();
  await page.keyboard.type("Editable body");
  await waitForSaved(page);

  await page.getByRole("button", { name: "Lock page" }).click();
  await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox").last()).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox").last()).toHaveAttribute("contenteditable", "true");

  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toHaveCount(0);
});
