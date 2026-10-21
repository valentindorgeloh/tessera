import { createProjectViaMcp, dragBy, expect, isoDay, mcp, openLayout, test, waitForDialog } from "./fixtures";

/**
 * docs/PLAN.md §12 browser check 10 and the P10 layouts: gantt bar drags write
 * dates, a blocked_by connector turns into a conflict when the dates clash,
 * calendar drops, rich filters, exports and the webhooks settings.
 */

type Item = { id: string };

async function twoLinkedItems(identifier?: string) {
  const project = await createProjectViaMcp(identifier);
  const first = await mcp<Item>("create_work_item", { project_id: project.id, name: "Blocker", start_date: isoDay(1), target_date: isoDay(4) });
  const second = await mcp<Item>("create_work_item", { project_id: project.id, name: "Blocked", start_date: isoDay(6), target_date: isoDay(9) });
  await mcp("add_relation", { work_item_id: second.id, related_work_item_id: first.id, relation_type: "blocked_by" });
  return { project, first, second };
}

test("dragging a gantt bar moves both dates, and a blocked_by connector turns into a conflict", async ({ page }) => {
  const { project, first } = await twoLinkedItems();
  await openLayout(page, project.id, "gantt");
  const blocker = page.getByRole("button", { name: new RegExp(`^${project.identifier}-1 Blocker`) });
  await expect(blocker).toBeVisible();
  await expect(page.locator(".tessera-gantt-edge")).toHaveCount(1);
  await expect(page.locator(".tessera-gantt-edge[data-conflict]")).toHaveCount(0);

  const dayWidth = (await page.locator(".tessera-gantt-head-day").first().boundingBox())!.width;
  expect(dayWidth).toBeGreaterThan(0);
  // Five days later: the blocker now ends after the blocked item starts.
  await dragBy(page, blocker, dayWidth * 5);
  await expect.poll(async () => (await mcp<{ start_date: string; target_date: string }>("get_work_item", { work_item_id: first.id })).start_date, { timeout: 15_000 }).toBe(isoDay(6));
  const moved = await mcp<{ start_date: string; target_date: string }>("get_work_item", { work_item_id: first.id });
  expect(moved.target_date).toBe(isoDay(9));
  await expect(page.locator(".tessera-gantt-edge[data-conflict]")).toHaveCount(1);
  await expect(page.locator(".tessera-gantt-bar[data-conflict]")).toHaveCount(2);
});

test("dragging the end handle of a gantt bar changes only the target date", async ({ page }) => {
  const { project, first } = await twoLinkedItems();
  await openLayout(page, project.id, "gantt");
  const blocker = page.getByRole("button", { name: new RegExp(`^${project.identifier}-1 Blocker`) });
  await expect(blocker).toBeVisible();
  const dayWidth = (await page.locator(".tessera-gantt-head-day").first().boundingBox())!.width;
  await dragBy(page, blocker.locator(".tessera-gantt-handle[data-edge=end]"), dayWidth * 1);
  await expect.poll(async () => (await mcp<{ target_date: string }>("get_work_item", { work_item_id: first.id })).target_date, { timeout: 15_000 }).toBe(isoDay(5));
  const after = await mcp<{ start_date: string }>("get_work_item", { work_item_id: first.id });
  expect(after.start_date).toBe(isoDay(1));
});

test("dragging a calendar item to another day writes its target date", async ({ page }) => {
  const project = await createProjectViaMcp();
  // The 10th and 15th of the current month, so both cells are inside the month grid whatever today is.
  const now = isoDay(0).slice(0, 8);
  const item = await mcp<Item>("create_work_item", { project_id: project.id, name: "On the move", target_date: `${now}10` });
  await openLayout(page, project.id, "calendar");

  const days = page.locator(".tessera-cal-day:not([data-outside])");
  await expect(days.nth(9).getByRole("button", { name: new RegExp(`^${project.identifier}-1 On the move`) })).toBeVisible();
  await dragBy(page, days.nth(9).getByRole("button", { name: new RegExp(`^${project.identifier}-1`) }), 0, 0, { steps: 2 });
  const card = days.nth(9).getByRole("button", { name: new RegExp(`^${project.identifier}-1`) });
  const from = (await card.boundingBox())!;
  const to = (await days.nth(14).boundingBox())!;
  await dragBy(page, card, to.x + to.width / 2 - (from.x + from.width / 2), to.y + to.height / 2 - (from.y + from.height / 2));
  await expect.poll(async () => (await mcp<{ target_date: string }>("get_work_item", { work_item_id: item.id })).target_date, { timeout: 15_000 }).toBe(`${now}15`);
});

test("an advanced filter narrows the list to its condition and shows the count", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "Calm one", priority: "low" });
  await mcp("create_work_item", { project_id: project.id, name: "Hot one", priority: "urgent" });
  await openLayout(page, project.id, "list");
  await expect(page.getByRole("listitem").filter({ hasText: "Calm one" })).toBeVisible();

  await page.getByRole("button", { name: /^Advanced/ }).click();
  const dialog = await waitForDialog(page, "Advanced filters");
  // The first condition is Priority is Urgent.
  await expect(dialog.getByRole("combobox", { name: "Field" })).toContainText("Priority");
  await dialog.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: "Hot one" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Calm one" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Filter work items" })).toContainText("1 result");

  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Hot one" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Calm one" })).toHaveCount(0);
});

test("exporting a list writes a CSV that downloads and shows under Settings, Exports", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "Exported row" });
  await openLayout(page, project.id, "list");

  await page.getByRole("button", { name: "Export…" }).click();
  const dialog = await waitForDialog(page, "Export work items");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const link = dialog.getByRole("link", { name: "Download" });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain(`${project.identifier}-1`);
  expect(csv).toContain("Exported row");

  await page.goto("/settings/exports");
  await expect(page.getByText("No exports yet")).toHaveCount(0);
});

test("a webhook can be created, deactivated and deleted in workspace settings", async ({ page }) => {
  await page.goto("/settings/webhooks");
  await page.getByRole("button", { name: "New webhook" }).first().click();
  const dialog = await waitForDialog(page, "New webhook");
  const name = `Hook ${isoDay(0)} ${Math.random().toString(36).slice(2, 6)}`;
  await dialog.getByRole("textbox", { name: /^Name/ }).fill(name);
  await dialog.getByRole("textbox", { name: /^URL/ }).fill("http://127.0.0.1:9/hook");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  // Creating a webhook opens its own screen.
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Send test" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Signing secret" })).toBeVisible();
  await page.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("button", { name: "Activate" })).toBeVisible();
  await page.getByRole("button", { name: "Delete…" }).click();
  const confirm = await waitForDialog(page, "Delete webhook");
  await confirm.getByRole("button", { name: /^Delete/ }).click();
  await page.waitForURL(/\/settings\/webhooks$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
});
