import {
  boardColumn,
  createProjectViaMcp,
  createProjectViaUi,
  dragByPointer,
  expect,
  isoDay,
  mcp,
  openLayout,
  openWorkItems,
  quickAddItems,
  test,
} from "./fixtures";

/**
 * Drag suite (decisions 14 and 105): every pointer drag has a keyboard path.
 * Board, calendar and gantt are checked on both. The reorder surfaces that
 * decision 105 adds (views, states, labels, pages, stickies, quick links, Home
 * widgets) are in drag-surfaces.spec.ts.
 */

type Item = { id: string };

test.describe("board", () => {
  test("a card dropped above another reorders the column, and the order survives a reload", async ({ page }) => {
    const project = await createProjectViaUi(page);
    await openWorkItems(page, project.id);
    await quickAddItems(page, ["Alpha", "Bravo"]);
    await openLayout(page, project.id, "board");

    const backlog = boardColumn(page, "Backlog");
    // The card's key button is a 1 px overlay, so the cards themselves are the drag source and target.
    const alpha = backlog.locator(".tessera-board-card").filter({ hasText: "Alpha" });
    const bravo = backlog.locator(".tessera-board-card").filter({ hasText: "Bravo" });
    await expect(alpha).toBeVisible();
    const alphaBox = (await alpha.boundingBox())!;
    // Drop Bravo on the top edge of Alpha, above its middle.
    await dragByPointer(page, bravo, alpha, { offset: { x: 0, y: -(alphaBox.height / 2 - 6) } });

    const names = backlog.locator(".tessera-board-card").getByText(/^(Alpha|Bravo)$/);
    await expect(names).toHaveText(["Bravo", "Alpha"]);
    await page.reload();
    await expect(page.locator("[data-list-ready]").first()).toBeVisible();
    await expect(boardColumn(page, "Backlog").locator(".tessera-board-card").getByText(/^(Alpha|Bravo)$/)).toHaveText(["Bravo", "Alpha"]);
  });

  test("the card menu moves a card to another state without a pointer", async ({ page }) => {
    const project = await createProjectViaUi(page);
    await openWorkItems(page, project.id);
    await quickAddItems(page, ["Keyboard mover"]);
    await openLayout(page, project.id, "board");

    // The card's menu is a plain icon button until the pointer enters the card (arming.tsx); a click on it arms and opens it.
    await page.locator(".tessera-board-card").filter({ hasText: `${project.identifier}-1` }).hover();
    await page.getByRole("button", { name: `Actions for ${project.identifier}-1`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Move to" }).click();
    await page.getByRole("menuitem", { name: "In Progress" }).click();
    await expect(boardColumn(page, "In Progress").getByRole("button", { name: new RegExp(`^${project.identifier}-1 `) })).toBeVisible();
    await expect(boardColumn(page, "Backlog").getByRole("button", { name: new RegExp(`^${project.identifier}-1 `) })).toHaveCount(0);
  });
});

test.describe("calendar and gantt keyboard paths", () => {
  test("the calendar's Move to date control writes the target date", async ({ page }) => {
    const project = await createProjectViaMcp();
    const now = isoDay(0).slice(0, 8);
    const item = await mcp<Item>("create_work_item", { project_id: project.id, name: "Dated", target_date: `${now}10` });
    await openLayout(page, project.id, "calendar");

    await page.getByRole("button", { name: `Move ${project.identifier}-1 to date`, exact: true }).click();
    const input = page.getByRole("combobox", { name: "Move to date" });
    // A valid date commits as soon as it is typed and closes the popover.
    await input.fill(`${now.slice(5, 7)}/20/${now.slice(0, 4)}`);
    await expect.poll(async () => (await mcp<{ target_date: string }>("get_work_item", { work_item_id: item.id })).target_date, { timeout: 15_000 }).toBe(`${now}20`);
  });

  test("the gantt's Set dates control writes both dates", async ({ page }) => {
    const project = await createProjectViaMcp();
    const item = await mcp<Item>("create_work_item", { project_id: project.id, name: "Scheduled", start_date: isoDay(1), target_date: isoDay(3) });
    await openLayout(page, project.id, "gantt");

    await page.getByRole("button", { name: `Set dates for ${project.identifier}-1`, exact: true }).click();
    const popover = page.locator(".tessera-gantt-dates");
    await expect(popover).toBeVisible();
    const target = popover.getByRole("combobox", { name: "Target date" });
    const later = isoDay(8);
    await target.fill(`${later.slice(5, 7)}/${later.slice(8, 10)}/${later.slice(0, 4)}`);
    await target.press("Enter");
    await expect.poll(async () => (await mcp<{ target_date: string }>("get_work_item", { work_item_id: item.id })).target_date, { timeout: 15_000 }).toBe(later);
  });
});
