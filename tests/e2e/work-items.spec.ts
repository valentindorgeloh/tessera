import { boardColumn, createProjectViaUi, dragByPointer, expect, openLayout, openWorkItems, quickAddItems, test } from "./fixtures";

/**
 * docs/PLAN.md §12 browser checks 1 to 4: a project in the sidebar with counts,
 * a work item at the bottom of Backlog with its key, a board drag with counts
 * and a reload, and priority and due date from the peek.
 */

test.describe.configure({ mode: "serial" });

test("a new project shows in the sidebar with its counts, and a created item gets key 1 at the bottom of Backlog", async ({ page }) => {
  const project = await createProjectViaUi(page);
  const sidebar = page.getByRole("navigation", { name: "Work" });
  const projectLink = sidebar.getByRole("link", { name: new RegExp(`^${project.name}`) });
  await expect(projectLink).toBeVisible();

  await openWorkItems(page, project.id);
  await page.getByRole("button", { name: "New work item" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New work item" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("First item");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  const first = page.getByRole("listitem").filter({ hasText: `${project.identifier}-1` });
  await expect(first).toBeVisible();
  // A row draws its controls as chips until the pointer enters it (arming.tsx): point at it first, as a person would.
  await first.hover();
  await expect(first.getByRole("combobox", { name: "State" })).toContainText("Backlog");
  // The count sits beside the link (S9); the link's accessible name ends with it.
  await expect(projectLink).toHaveAccessibleName(/\s1$/);

  // Quick-add appends below the first item, still in Backlog.
  await page.getByRole("button", { name: "New work item" }).last().click();
  await page.getByRole("textbox", { name: "New work item" }).fill("Second item");
  await page.keyboard.press("Enter");
  const second = page.getByRole("listitem").filter({ hasText: `${project.identifier}-2` });
  await expect(second).toBeVisible();
  const rows = page.getByRole("listitem").filter({ has: page.getByRole("checkbox") });
  await expect(rows.nth(1)).toContainText(`${project.identifier}-2`);
  await second.hover();
  await expect(second.getByRole("combobox", { name: "State" })).toContainText("Backlog");
  await expect(projectLink).toHaveAccessibleName(/\s2$/);
});

test("dragging a board card to In Progress updates the counts and survives a reload", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Drag me", "Stay put"]);
  await openLayout(page, project.id, "board");

  const backlog = boardColumn(page, "Backlog");
  const progress = boardColumn(page, "In Progress");
  await expect(backlog.getByRole("button", { name: new RegExp(`${project.identifier}-1 `) })).toBeVisible();
  const card = backlog.getByRole("button", { name: new RegExp(`${project.identifier}-1 `) });
  await dragByPointer(page, card, progress.locator(".tessera-board-column-body"));

  await expect(progress.getByRole("button", { name: new RegExp(`${project.identifier}-1 `) })).toBeVisible();
  await expect(backlog.getByRole("button", { name: new RegExp(`${project.identifier}-1 `) })).toHaveCount(0);
  await expect(backlog.getByRole("button", { name: new RegExp(`${project.identifier}-2 `) })).toBeVisible();
  await expect(progress).toContainText(/In Progress\s*1/);
  await expect(backlog).toContainText(/Backlog\s*1/);

  await page.reload();
  await expect(page.locator("[data-list-ready]").first()).toBeVisible();
  await expect(boardColumn(page, "In Progress").getByRole("button", { name: new RegExp(`${project.identifier}-1 `) })).toBeVisible();
  await expect(boardColumn(page, "Backlog").getByRole("button", { name: new RegExp(`${project.identifier}-2 `) })).toBeVisible();
});

test("priority and due date set in the peek survive a reload", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Peek me"]);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Peek me" })).toBeVisible();

  await peek.getByRole("combobox", { name: "Priority" }).click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(peek.getByRole("combobox", { name: "Priority" })).toContainText("High");
  const target = peek.getByRole("combobox", { name: "Target date" });
  await target.fill("12/24/2026");
  await target.press("Enter");
  await expect(target).toHaveValue("Dec 24, 2026");
  // The write is a server action; wait for its activity row before the reload.
  await expect(peek.getByRole("list", { name: "Activity" })).toContainText(/priority/i);

  await page.reload();
  const reloaded = page.getByRole("complementary", { name: "Work item" });
  await expect(reloaded.getByRole("combobox", { name: "Priority" })).toContainText("High");
  await expect(reloaded.getByRole("combobox", { name: "Target date" })).toHaveValue("Dec 24, 2026");
});
