import { createProjectViaMcp, expect, mcp, openLayout, openWorkItems, test } from "./fixtures";

/**
 * docs/PLAN.md §12 browser check 6: a state change written by another process
 * (an MCP client) shows up in an open tab within about 5 s, through the changes
 * poller, with no reload.
 */

test("an MCP state change refreshes an open list without a reload", async ({ page }) => {
  const project = await createProjectViaMcp();
  const item = await mcp<{ id: string }>("create_work_item", { project_id: project.id, name: "Moved by an agent" });
  const states = await mcp<{ items: { id: string; name: string }[] }>("list_states", { project_id: project.id });
  const progress = states.items.find((state) => state.name === "In Progress");
  expect(progress).toBeTruthy();

  await openWorkItems(page, project.id);
  const row = page.getByRole("listitem").filter({ hasText: `${project.identifier}-1` });
  await expect(row.getByRole("combobox", { name: "State" })).toContainText("Backlog");

  await mcp("update_work_item", { work_item_id: item.id, state_id: progress!.id });
  await expect(row.getByRole("combobox", { name: "State" })).toContainText("In Progress", { timeout: 15_000 });
});

test("an MCP-created item appears on an open board", async ({ page }) => {
  const project = await createProjectViaMcp();
  await openLayout(page, project.id, "board");
  await mcp("create_work_item", { project_id: project.id, name: "Appears by itself" });
  await expect(page.getByRole("button", { name: new RegExp(`${project.identifier}-1 Appears by itself`) })).toBeVisible({ timeout: 15_000 });
});
