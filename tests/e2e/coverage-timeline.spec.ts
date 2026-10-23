import type { Page } from "@playwright/test";
import { createProjectViaMcp, expect, isoDay, mcp, openLayout, test, waitForDialog } from "./fixtures";
import { createItem, getItem, getWeekStart, setWeekStart, stateId, weekdayOf } from "./helpers-a";

/**
 * Planning and timeline coverage from the visual round, on HEAD:
 * - Transfer open items of a completed cycle (decision 16: a completed cycle is
 *   read-only, its progress snapshot freezes on the first transfer).
 * - The gantt at tablet width: dependency connectors between blocked_by items
 *   and the Today button centring the today line (decisions 90 to 92).
 * - The workspace week start (Sunday) in the gantt's week bands and the
 *   calendar's weekday heads.
 * - Board and table without a peek: no horizontal overflow of the page.
 */

type Listed<T> = { items?: T[]; result?: T[] };
type CycleRow = { id: string; name: string; status: string; open_count: number; progress_snapshot: unknown };

async function cycleByName(projectId: string, name: string): Promise<CycleRow> {
  const listed = await mcp<Listed<CycleRow>>("list_cycles", { project_id: projectId });
  const found = (listed.items ?? listed.result ?? []).find((row) => row.name === name);
  expect(found, `cycle ${name}`).toBeTruthy();
  return found!;
}

test.describe("cycles", () => {
  test("Transfer open items moves the open items, keeps the done ones and keeps the progress snapshot", async ({ page }) => {
    const project = await createProjectViaMcp();
    const done = await stateId(project.id, "Done");
    const todo = await stateId(project.id, "Todo");

    // A cycle only takes items while it runs, so it is created as the current one and its end date is moved to yesterday
    // afterwards (updateCycle refuses only cycles that are already completed).
    const past = await mcp<{ id: string }>("create_cycle", { project_id: project.id, name: "Sprint past", start_date: isoDay(-10), end_date: isoDay(0) });
    const open1 = await createItem(project.id, "Open one", { cycle_id: past.id });
    const open2 = await createItem(project.id, "Open two", { cycle_id: past.id, state_id: todo });
    const closed = await createItem(project.id, "Closed one", { cycle_id: past.id });
    await mcp("update_work_item", { work_item_id: closed.id, state_id: done });
    await mcp("update_cycle", { cycle_id: past.id, end_date: isoDay(-1) });
    const upcoming = await mcp<{ id: string }>("create_cycle", { project_id: project.id, name: "Sprint next", start_date: isoDay(2), end_date: isoDay(15) });
    await mcp("create_cycle", { project_id: project.id, name: "Sprint idea" });

    const before = await cycleByName(project.id, "Sprint past");
    expect(before.status).toBe("completed");
    expect(before.open_count).toBe(2);
    expect(before.progress_snapshot).toBeNull();

    await page.goto(`/projects/${project.id}/cycles`);
    const row = page.getByRole("listitem").filter({ hasText: "Sprint past" });
    await expect(row).toHaveCount(1);
    // 1 of 3 done, and the "2 open" badge of a completed cycle.
    await expect(row.getByText("1/3", { exact: true })).toBeVisible();
    await expect(row.getByText("2 open", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Actions for Sprint past" }).click();
    await page.getByRole("menuitem", { name: "Transfer open items…" }).click();
    const dialog = await waitForDialog(page, "Transfer open items");
    await expect(dialog.getByText("Its progress is frozen as it is now.")).toBeVisible();
    await dialog.getByRole("combobox", { name: "Move to" }).click();
    await page.getByRole("option", { name: /Sprint next/ }).click();
    await dialog.getByRole("button", { name: "Transfer 2 work items" }).click();
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("Moved 2 work items to Sprint next")).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toBeHidden();

    // The open items moved, the done one stayed.
    await expect.poll(async () => (await getItem(open1.id)).cycle_id, { timeout: 15_000 }).toBe(upcoming.id);
    expect((await getItem(open2.id)).cycle_id).toBe(upcoming.id);
    expect((await getItem(closed.id)).cycle_id).toBe(past.id);

    // The completed cycle keeps the totals it had before the transfer (decision 16).
    const after = await cycleByName(project.id, "Sprint past");
    expect(after.open_count).toBe(0);
    expect(after.progress_snapshot, "the first transfer freezes the progress").not.toBeNull();
    await page.reload();
    const reloaded = page.getByRole("listitem").filter({ hasText: "Sprint past" });
    await expect(reloaded).toHaveCount(1);
    await expect(reloaded.getByText("1/3", { exact: true })).toBeVisible();
    await expect(reloaded.getByText("2 open", { exact: true })).toHaveCount(0);
    const progress = await mcp<{ totals?: unknown; progress?: unknown }>("get_cycle_progress", { cycle_id: past.id });
    expect(JSON.stringify(progress)).toContain('"completed":1');
  });
});

/** Two dated items with a blocked_by relation between them: B waits for A. */
async function dependencyProject() {
  const project = await createProjectViaMcp();
  const a = await createItem(project.id, "Dep first", { start_date: isoDay(1), target_date: isoDay(3) });
  const b = await createItem(project.id, "Dep second", { start_date: isoDay(6), target_date: isoDay(8) });
  await mcp("add_relation", { work_item_id: b.id, related_work_item_id: a.id, relation_type: "blocked_by" });
  return { project, a, b };
}

/** The gantt's horizontal scroller: the nearest scrolling ancestor, else the page (gantt-scroll.ts). */
async function todayLineOffsets(page: Page): Promise<{ lineCentre: number; areaCentre: number; scrollLeft: number }> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".tessera-gantt")!;
    let scroller: HTMLElement | null = null;
    for (let node = root.parentElement; node; node = node.parentElement) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") {
        scroller = node;
        break;
      }
    }
    scroller ??= document.scrollingElement as HTMLElement;
    const isPage = scroller === document.scrollingElement;
    const left = isPage ? 0 : scroller.getBoundingClientRect().left;
    const labelWidth = root.querySelector<HTMLElement>(".tessera-gantt-label")!.getBoundingClientRect().width;
    const line = root.querySelector<HTMLElement>(".tessera-gantt-today")!.getBoundingClientRect();
    return {
      lineCentre: line.left + line.width / 2,
      areaCentre: left + labelWidth + (scroller.clientWidth - labelWidth) / 2,
      scrollLeft: scroller.scrollLeft,
    };
  });
}

test.describe("gantt at tablet width", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("draws a connector between blocked_by items, from the end of one bar to the start of the other", async ({ page }) => {
    const { project, a, b } = await dependencyProject();
    await openLayout(page, project.id, "gantt");
    // Role locators plus a count wait: while the route streams in, a hidden copy of a bar can sit beside the live one.
    const barA = page.getByRole("button", { name: new RegExp(`^${a.key} `) });
    const barB = page.getByRole("button", { name: new RegExp(`^${b.key} `) });
    await expect(barA).toHaveCount(1);
    await expect(barB).toHaveCount(1);
    await expect(barA).toBeVisible();
    await expect(barB).toBeVisible();

    const connector = page.locator(".tessera-gantt-connectors .tessera-gantt-edge");
    await expect(connector).toHaveCount(1);
    await page.waitForTimeout(1800);
    const [path, boxA, boxB] = await Promise.all([connector.boundingBox(), barA.boundingBox(), barB.boundingBox()]);
    expect(path && boxA && boxB, "connector and both bars are laid out").toBeTruthy();
    expect(path!.width, "the connector spans the gap between the bars").toBeGreaterThan(8);
    expect(path!.height, "the connector spans the rows between the bars").toBeGreaterThan(8);
    // It leaves the end of the blocker (A) and arrives at the start of the blocked item (B), within a few pixels.
    expect(path!.x).toBeGreaterThanOrEqual(boxA!.x + boxA!.width - 12);
    expect(path!.x + path!.width).toBeLessThanOrEqual(boxB!.x + 12);
    expect(path!.y).toBeLessThanOrEqual(boxB!.y + 12);
    expect(path!.y + path!.height).toBeGreaterThanOrEqual(boxA!.y);
    // Not a conflict: A ends before B starts.
    await expect(connector).not.toHaveAttribute("data-conflict", "");
  });

  test("Today centres the today line in the bar area", async ({ page }) => {
    const { project } = await dependencyProject();
    await openLayout(page, project.id, "gantt");
    await expect(page.locator(".tessera-gantt-bar").first()).toBeVisible();
    await page.waitForTimeout(1800);

    // Scroll the timeline away from Today first, so the button has something to undo.
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".tessera-gantt")!;
      for (let node: HTMLElement | null = root.parentElement; node; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") {
          node.scrollLeft = 0;
          return;
        }
      }
      document.scrollingElement!.scrollLeft = 0;
    });
    const away = await todayLineOffsets(page);
    expect(Math.abs(away.lineCentre - away.areaCentre), "scrolled to the start, the line is off centre").toBeGreaterThan(100);

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect
      .poll(async () => {
        const offsets = await todayLineOffsets(page);
        return Math.abs(offsets.lineCentre - offsets.areaCentre);
      })
      .toBeLessThanOrEqual(20);
  });
});

test.describe("week start Sunday", () => {
  /** "Apr 5"-style labels of the Sundays (or Mondays) around today, as the gantt prints week bands. */
  function weekdayLabels(weekday: number): Set<string> {
    const labels = new Set<string>();
    for (let offset = -120; offset <= 120; offset += 1) {
      const day = isoDay(offset);
      if (weekdayOf(day) !== weekday) continue;
      const [year, month, date] = day.split("-").map(Number);
      labels.add(new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));
    }
    return labels;
  }

  test("the gantt's week bands and the calendar's weekday heads follow the workspace setting", async ({ page }) => {
    const original = await getWeekStart();
    const project = await createProjectViaMcp();
    await createItem(project.id, "Week item", { start_date: isoDay(1), target_date: isoDay(2) });
    try {
      // Monday first: the baseline the Sunday run is measured against.
      await setWeekStart(1);
      await openLayout(page, project.id, "gantt", { gantt: { zoom: "month" } });
      await expect(page.locator(".tessera-gantt-month-label").first()).toBeVisible();
      const mondays = weekdayLabels(1);
      const mondayBands = await page.locator(".tessera-gantt-month-label").allTextContents();
      expect(mondayBands.length).toBeGreaterThan(4);
      for (const label of mondayBands) expect(mondays.has(label.trim()), `Monday band ${label}`).toBe(true);

      await setWeekStart(0);
      await openLayout(page, project.id, "gantt", { gantt: { zoom: "month" } });
      await expect(page.locator(".tessera-gantt-month-label").first()).toBeVisible();
      const sundays = weekdayLabels(0);
      const sundayBands = await page.locator(".tessera-gantt-month-label").allTextContents();
      expect(sundayBands.length).toBeGreaterThan(4);
      for (const label of sundayBands) expect(sundays.has(label.trim()), `Sunday band ${label}`).toBe(true);

      await openLayout(page, project.id, "calendar");
      const heads = await page.locator(".tessera-cal-head").allTextContents();
      expect(heads[0]?.trim()).toBe("Sun");
      expect(heads.at(-1)?.trim()).toBe("Sat");
      // The first cell of a week row is a Sunday: its day number is the date of a Sunday.
      const firstWeek = page.locator(".tessera-cal-week").first();
      const addLabel = await firstWeek.getByRole("button", { name: /^Add on / }).first().getAttribute("aria-label");
      expect(weekdayOf(addLabel!.replace("Add on ", ""))).toBe(0);
    } finally {
      await setWeekStart(original);
    }
    expect(await getWeekStart()).toBe(original);
  });
});

test.describe("no horizontal page overflow without a peek", () => {
  for (const width of [768, 1100]) {
    for (const layout of ["board", "table"] as const) {
      test(`${layout} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const project = await createProjectViaMcp();
        const todo = await stateId(project.id, "Todo");
        await createItem(project.id, "A work item with a deliberately long name that has to wrap or truncate instead of widening the page at tablet width");
        await createItem(project.id, "Short", { state_id: todo });
        await createItem(project.id, "Dated", { start_date: isoDay(1), target_date: isoDay(5), state_id: todo });
        await openLayout(page, project.id, layout);
        await page.waitForTimeout(800);

        const overflow = await page.evaluate(() => ({
          viewport: window.innerWidth,
          root: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        expect(overflow.root, `document scrollWidth at ${width}`).toBeLessThanOrEqual(overflow.viewport);
        expect(overflow.body, `body scrollWidth at ${width}`).toBeLessThanOrEqual(overflow.viewport);
      });
    }
  }
});
