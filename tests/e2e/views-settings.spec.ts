import { boardColumn, createProjectViaUi, expect, openLayout, openWorkItems, quickAddItems, test, waitForDialog, workItemsUrl } from "./fixtures";

/**
 * P4: saved views (save from the list, lock, duplicate) and project settings
 * (states, labels) as a browser flow.
 */

test("a list saved as a view opens from the views list, locks, and a locked view refuses edits", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["In the view"]);

  await page.goto(workItemsUrl(project.id, { layout: "board", group_by: "state" }));
  await expect(page.locator("[data-list-ready]").first()).toBeVisible();
  await page.getByRole("button", { name: "Save view" }).click();
  const dialog = await waitForDialog(page, "Save view");
  await dialog.getByLabel("Name").fill("Board of everything");
  await dialog.getByRole("button", { name: "Create view" }).click();

  await page.waitForURL(new RegExp(`/projects/${project.id}/views/[0-9a-f-]{20,}`));
  await expect(page.getByRole("button", { name: new RegExp(`${project.identifier}-1 In the view`) })).toBeVisible();

  await page.goto(`/projects/${project.id}/views`);
  const row = page.getByRole("link", { name: /Board of everything/ });
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(new RegExp(`/projects/${project.id}/views/[0-9a-f-]{20,}`));

  await page.getByRole("button", { name: "View actions" }).click();
  await page.getByRole("menuitem", { name: "Lock view" }).click();
  await page.getByRole("button", { name: "View actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Unlock view" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Edit/ })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Unlock view" }).click();
  await page.getByRole("button", { name: "View actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Lock view" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("project settings add a state and a label that the work items screen then offers", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Label me"]);

  await page.goto(`/projects/${project.id}/settings/states`);
  await page.getByRole("button", { name: "Add Started state" }).click();
  const stateDialog = await waitForDialog(page, "New Started state");
  await stateDialog.getByRole("textbox", { name: /^Name/ }).fill("In Review");
  await stateDialog.getByRole("button", { name: "Create state" }).click();
  await expect(page.getByRole("list", { name: /^Started/ }).getByText("In Review")).toBeVisible();

  await page.goto(`/projects/${project.id}/settings/labels`);
  await page.getByRole("button", { name: "New label" }).first().click();
  const labelDialog = await waitForDialog(page, "New label");
  await labelDialog.getByRole("textbox", { name: /^Name/ }).fill("Needs design");
  await labelDialog.getByRole("button", { name: "Create label" }).click();
  await expect(page.getByText("Needs design").first()).toBeVisible();

  await openLayout(page, project.id, "board");
  await expect(boardColumn(page, "In Review")).toBeVisible();
  await boardColumn(page, "Backlog").getByText("Label me", { exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await peek.getByRole("combobox", { name: "Labels" }).click();
  await page.getByRole("option", { name: "Needs design" }).click();
  await page.keyboard.press("Escape");
  await expect(peek.getByRole("list", { name: "Activity" })).toContainText("Needs design");
});
