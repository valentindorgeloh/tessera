import { createProjectViaMcp, createProjectViaUi, expect, mcp, openWorkItems, quickAddItems, test, waitForDialog } from "./fixtures";

/**
 * docs/PLAN.md §12 browser check 9 (agent intake required: an MCP-created item
 * lands in Intake, not on the board, and Accept moves it to Backlog) plus the P8
 * drafts, estimates and bulk edit flows.
 */

test("an MCP-created item lands in Intake when agent intake is required, and Accept moves it to Backlog", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("update_project_features", { project_id: project.id, intake_enabled: true, agent_intake_required: true });
  await mcp("create_work_item", { project_id: project.id, name: "Agent request" });

  await page.goto(`/projects/${project.id}/work-items`);
  await expect(page.getByRole("heading", { name: "No work items yet" })).toBeVisible();

  await page.goto(`/projects/${project.id}/intake`);
  const list = page.getByRole("list", { name: "Intake items" });
  const entry = list.getByRole("link", { name: /Agent request/ });
  await expect(entry).toBeVisible();
  await entry.click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(list.getByRole("link", { name: /Agent request/ })).toHaveCount(0);

  await page.goto(`/projects/${project.id}/work-items`);
  const row = page.getByRole("listitem").filter({ hasText: `${project.identifier}-1` });
  await expect(row).toBeVisible();
  // The row's State control is a chip until the pointer enters the row (arming.tsx).
  await row.hover();
  await expect(row.getByRole("combobox", { name: "State" })).toContainText("Backlog");
});

test("a closed create dialog saves a draft, and the draft becomes a work item", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await page.getByRole("button", { name: "New work item" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New work item" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Half-written idea");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const save = page.getByRole("dialog", { name: "Save this draft?" });
  await expect(save).toBeVisible();
  await page.waitForTimeout(700);
  await save.getByRole("button", { name: "Save draft" }).click();
  await expect(save).toBeHidden();

  await page.goto("/drafts");
  const drafts = page.getByRole("list", { name: "Drafts" });
  const entry = drafts.getByText("Half-written idea");
  await expect(entry).toBeVisible();
  await entry.click();
  const editor = page.getByRole("dialog", { name: "Edit draft" });
  await expect(editor).toBeVisible();
  await page.waitForTimeout(700);
  await editor.getByRole("button", { name: "Create work item" }).click();
  await expect(drafts.getByText("Half-written idea")).toHaveCount(0);

  await openWorkItems(page, project.id);
  await expect(page.getByRole("listitem").filter({ hasText: `${project.identifier}-1` })).toContainText("Half-written idea");
});

test("bulk edit sets the priority of two selected rows", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Bulk one", "Bulk two", "Bulk three"]);

  await page.getByRole("checkbox", { name: `Select ${project.identifier}-1` }).check();
  await page.getByRole("checkbox", { name: `Select ${project.identifier}-2` }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("combobox", { name: "Priority" }).click();
  await page.getByRole("option", { name: "Urgent" }).click();

  for (const key of [1, 2]) {
    await expect(page.getByRole("listitem").filter({ hasText: `${project.identifier}-${key}` }).getByRole("img", { name: "Urgent", exact: true })).toBeVisible();
  }
  await expect(page.getByRole("listitem").filter({ hasText: `${project.identifier}-3` }).getByRole("img", { name: "Urgent", exact: true })).toHaveCount(0);

  // A finished bulk edit clears the selection.
  await expect(bar).toBeHidden();

  await page.getByRole("checkbox", { name: `Select ${project.identifier}-3` }).check();
  await expect(bar).toContainText("1 selected");
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar).toBeHidden();
});

test("an estimate system turns on estimates and a point can be set on an item", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Size me"]);

  await page.goto(`/projects/${project.id}/settings/features`);
  await page.getByRole("switch", { name: /Estimates/ }).click();
  await page.goto(`/projects/${project.id}/settings/estimates`);
  await page.getByRole("button", { name: "Create estimate system" }).first().click();
  const dialog = await waitForDialog(page, "Estimate system");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit values" })).toBeVisible();

  await page.goto(`/projects/${project.id}/work-items?peek=${await peekIdOf(project.identifier)}`);
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Size me" })).toBeVisible();
  await peek.getByRole("combobox", { name: "Estimate" }).click();
  await page.getByRole("option").nth(1).click();
  await expect(peek.getByRole("list", { name: "Activity" })).toContainText(/estimate/i);
});

async function peekIdOf(identifier: string): Promise<string> {
  const item = await mcp<{ id: string }>("get_work_item_by_key", { key: `${identifier}-1` });
  return item.id;
}
