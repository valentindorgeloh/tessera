import { boardColumn, createProjectViaMcp, dragBy, dragByPointer, expect, isoDay, mcp, openLayout, test, uniqueIdentifier, type CreatedProject } from "./fixtures";
import { addIsoDays, createItem, diffIsoDays, ganttDayWidth, getItem, stateId } from "./helpers-a";

/**
 * Committed pointer drops that still hold after a reload (decisions 14 and 105,
 * mouse, desktop width). The older drag specs read the saved order back over
 * MCP; here the check is the page itself after `page.reload()` plus the saved
 * fields, so an optimistic UI that never reached the engine, or a write that the
 * next render undoes, fails. `dragBy` and `dragByPointer` move in small steps
 * past the drag threshold, because the pointer-drag hooks read real move events.
 */

type Listed<T> = { items?: T[]; result?: T[] };
type Named = { id: string; name: string; state_group?: string };

async function names(tool: string, input: Record<string, unknown>, only?: (row: Named) => boolean): Promise<string[]> {
  const listed = await mcp<Listed<Named>>(tool, input);
  return (listed.items ?? listed.result ?? []).filter((row) => (only ? only(row) : true)).map((row) => row.name);
}

test.describe("board", () => {
  test("a card dropped into another column changes its state and stays there after a reload", async ({ page }) => {
    const project = await createProjectViaMcp();
    const moved = await createItem(project.id, "Board mover");
    await createItem(project.id, "Board stayer");
    const backlog = await stateId(project.id, "Backlog");
    const todo = await stateId(project.id, "Todo");
    expect((await getItem(moved.id)).state_id).toBe(backlog);

    await openLayout(page, project.id, "board");
    const source = boardColumn(page, "Backlog").locator(".tessera-board-card").filter({ hasText: "Board mover" });
    const target = boardColumn(page, "Todo").locator(".tessera-board-column-body");
    await expect(source).toBeVisible();
    await dragByPointer(page, source, target);

    const inTodo = boardColumn(page, "Todo").locator(".tessera-board-card").filter({ hasText: "Board mover" });
    await expect(inTodo).toBeVisible();
    await expect(boardColumn(page, "Backlog").locator(".tessera-board-card").filter({ hasText: "Board mover" })).toHaveCount(0);
    await expect.poll(async () => (await getItem(moved.id)).state_id, { timeout: 15_000 }).toBe(todo);

    await page.reload();
    await expect(page.locator("[data-list-ready]").first()).toBeVisible();
    await expect(boardColumn(page, "Todo").locator(".tessera-board-card").filter({ hasText: "Board mover" })).toBeVisible();
    await expect(boardColumn(page, "Backlog").locator(".tessera-board-card").filter({ hasText: "Board mover" })).toHaveCount(0);
    await expect(boardColumn(page, "Backlog").locator(".tessera-board-card").filter({ hasText: "Board stayer" })).toBeVisible();
  });
});

test.describe("gantt", () => {
  test("dragging a bar moves both dates by the same days, and the dates survive a reload", async ({ page }) => {
    const project = await createProjectViaMcp();
    const start = isoDay(3);
    const target = isoDay(6);
    const item = await createItem(project.id, "Gantt body", { start_date: start, target_date: target });

    await openLayout(page, project.id, "gantt");
    const bar = page.locator(".tessera-gantt-bar").first();
    await expect(bar).toBeVisible();
    // The Today scroll settles for 1.5 s after the first paint; a drag during it would start from a bar that moves.
    await page.waitForTimeout(1800);
    const dayWidth = await ganttDayWidth(bar, diffIsoDays(start, target) + 1);
    expect(dayWidth, "a month-zoom day column is 32 px").toBeGreaterThan(20);

    await dragBy(page, bar, Math.round(dayWidth * 3));
    const moved = { start: addIsoDays(start, 3), target: addIsoDays(target, 3) };
    await expect(bar).toHaveAccessibleName(`${item.key} Gantt body, ${moved.start} to ${moved.target}`);
    await expect.poll(async () => (({ start_date, target_date }) => ({ start_date, target_date }))(await getItem(item.id)), { timeout: 15_000 }).toEqual({
      start_date: moved.start,
      target_date: moved.target,
    });

    await page.reload();
    await expect(page.locator(".tessera-gantt").first()).toBeVisible();
    await expect(page.locator(".tessera-gantt-bar").first()).toHaveAccessibleName(`${item.key} Gantt body, ${moved.start} to ${moved.target}`);
  });

  test("dragging an edge moves one date and leaves the other", async ({ page }) => {
    const project = await createProjectViaMcp();
    const start = isoDay(2);
    const target = isoDay(7);
    const item = await createItem(project.id, "Gantt edge", { start_date: start, target_date: target });

    await openLayout(page, project.id, "gantt");
    const bar = page.locator(".tessera-gantt-bar").first();
    await expect(bar).toBeVisible();
    await page.waitForTimeout(1800);
    const dayWidth = await ganttDayWidth(bar, diffIsoDays(start, target) + 1);

    // The end handle: two days shorter. Only the target date changes.
    await dragBy(page, bar, -Math.round(dayWidth * 2), 0, { from: "right" });
    const shorter = addIsoDays(target, -2);
    await expect.poll(async () => (await getItem(item.id)).target_date, { timeout: 15_000 }).toBe(shorter);
    expect((await getItem(item.id)).start_date).toBe(start);

    // The start handle: one day later. Only the start date changes.
    await expect(bar).toHaveAccessibleName(`${item.key} Gantt edge, ${start} to ${shorter}`);
    await dragBy(page, bar, Math.round(dayWidth), 0, { from: "left" });
    const later = addIsoDays(start, 1);
    await expect.poll(async () => (await getItem(item.id)).start_date, { timeout: 15_000 }).toBe(later);
    expect((await getItem(item.id)).target_date).toBe(shorter);

    await page.reload();
    await expect(page.locator(".tessera-gantt-bar").first()).toHaveAccessibleName(`${item.key} Gantt edge, ${later} to ${shorter}`);
  });
});

test.describe("calendar", () => {
  test("a chip dropped on another day writes that day and keeps it after a reload", async ({ page }) => {
    // Tall enough for a six-week month, so the source and the target cell are both on screen.
    await page.setViewportSize({ width: 1440, height: 1200 });
    const project = await createProjectViaMcp();
    const month = isoDay(0).slice(0, 8);
    const item = await createItem(project.id, "Calendar chip", { target_date: `${month}10` });
    await openLayout(page, project.id, "calendar");

    const chip = page.getByRole("button", { name: `${item.key} Calendar chip`, exact: true });
    await expect(chip).toBeVisible();
    const targetCell = page.locator(".tessera-cal-day").filter({ has: page.getByRole("button", { name: `Add on ${month}20`, exact: true }) });
    await expect(targetCell).toHaveCount(1);
    await dragByPointer(page, chip, targetCell);

    await expect(targetCell.getByRole("button", { name: `${item.key} Calendar chip`, exact: true })).toBeVisible();
    await expect.poll(async () => (await getItem(item.id)).target_date, { timeout: 15_000 }).toBe(`${month}20`);

    await page.reload();
    await expect(page.locator(".tessera-cal").first()).toBeVisible();
    const afterReload = page.locator(".tessera-cal-day").filter({ has: page.getByRole("button", { name: `Add on ${month}20`, exact: true }) });
    await expect(afterReload.getByRole("button", { name: `${item.key} Calendar chip`, exact: true })).toBeVisible();
  });
});

test.describe("reorder surfaces", () => {
  const suffix = uniqueIdentifier("R");
  let project: CreatedProject;

  test.beforeAll(async () => {
    project = await createProjectViaMcp();
    for (const name of ["Review", "QA"]) await mcp("create_state", { project_id: project.id, name, state_group: "started" });
  });

  test("workspace views: a row dragged above another keeps the new order after a reload", async ({ page }) => {
    const [a, b, c] = [`WV A ${suffix}`, `WV B ${suffix}`, `WV C ${suffix}`];
    for (const name of [a, b, c]) await mcp("create_view", { project_id: null, name });
    const mine = (all: string[]) => all.filter((name) => name === a || name === b || name === c);
    expect(mine(await names("list_views", { project_id: null }))).toEqual([a, b, c]);

    await page.goto("/workspace-views");
    const row = (name: string) => page.getByRole("listitem").filter({ hasText: name });
    await expect(row(c)).toHaveCount(1);
    await expect(row(a)).toHaveCount(1);
    await dragByPointer(page, row(c), row(a), { offset: { x: 0, y: -8 } });
    await expect.poll(async () => mine(await names("list_views", { project_id: null })), { timeout: 15_000 }).toEqual([c, a, b]);

    await page.reload();
    await expect(row(c)).toHaveCount(1);
    const order = await page.getByRole("listitem").filter({ hasText: suffix }).allTextContents();
    expect(order.map((text) => text.replace(/\s+/g, " ").trim().slice(0, `WV C ${suffix}`.length))).toEqual([c, a, b]);
  });

  test("states: a row dragged above another in its group keeps the new order after a reload", async ({ page }) => {
    const started = (row: Named) => row.state_group === "started";
    expect(await names("list_states", { project_id: project.id }, started)).toEqual(["In Progress", "Review", "QA"]);

    await page.goto(`/projects/${project.id}/settings/states`);
    const row = (name: string) => page.getByRole("listitem").filter({ hasText: name });
    await expect(row("QA")).toHaveCount(1);
    await dragByPointer(page, row("QA"), row("Review"), { offset: { x: 0, y: -8 } });
    await expect.poll(() => names("list_states", { project_id: project.id }, started), { timeout: 15_000 }).toEqual(["In Progress", "QA", "Review"]);

    await page.reload();
    const labels = await page.getByRole("listitem").allTextContents();
    const position = (name: string) => labels.findIndex((text) => text.includes(name));
    expect(position("In Progress")).toBeGreaterThanOrEqual(0);
    expect(position("QA")).toBeGreaterThan(position("In Progress"));
    expect(position("Review")).toBeGreaterThan(position("QA"));
  });

  test("stickies: a card dragged before another keeps the new order after a reload", async ({ page }) => {
    const older = `CovOlder ${suffix}`;
    const newer = `CovNewer ${suffix}`;
    await mcp("create_sticky", { name: older });
    await mcp("create_sticky", { name: newer });
    const order = async () => {
      const listed = await mcp<Listed<{ name: string }>>("list_stickies");
      return (listed.items ?? listed.result ?? []).map((sticky) => sticky.name).filter((name) => name === older || name === newer);
    };
    expect(await order()).toEqual([newer, older]);

    await page.goto("/stickies");
    const grip = (name: string) => page.getByRole("button", { name: `Reorder ${name}` });
    await expect(grip(older)).toHaveCount(1);
    await expect(grip(newer)).toHaveCount(1);
    await dragByPointer(page, grip(older), grip(newer), { offset: { x: -8, y: 0 } });
    await expect.poll(order, { timeout: 15_000 }).toEqual([older, newer]);

    await page.reload();
    await expect(grip(older)).toHaveCount(1);
    const labels = await page.getByRole("button", { name: /^Reorder / }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
    expect(labels.indexOf(`Reorder ${older}`)).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf(`Reorder ${older}`)).toBeLessThan(labels.indexOf(`Reorder ${newer}`));
  });
});
