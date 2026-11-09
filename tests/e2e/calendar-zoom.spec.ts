import type { Locator, Page } from "@playwright/test";
import { createProjectViaMcp, dragByPointer, expect, isoDay, mcp, test, workItemsUrl, type CreatedProject } from "./fixtures";
import { createItem, getItem, getWeekStart } from "./helpers-a";
import { waitForAppHydrated } from "./helpers-d";

/**
 * Calendar zoom (decision 139): Week, Month and Quarter in the display menu,
 * the quarter grid of whole weeks (13 or 14 rows), `[` / `]` / `t`, drags across
 * a month boundary, two chips per quarter cell, count-only cells when the
 * calendar is narrower than 600 px (a phone, or a side peek beside it), the
 * saved zoom, and the MCP description. Items carry fixed 2026 target dates.
 */

const ANCHOR = "2026-11-10";

const calendar = (page: Page) => page.locator(".tessera-cal:visible");

/** The day cell of an ISO day, found by its "Add on <day>" button. */
function dayCell(page: Page, day: string): Locator {
  return calendar(page)
    .locator(".tessera-cal-day")
    .filter({ has: page.getByRole("button", { name: `Add on ${day}`, exact: true }) });
}

async function openCalendar(page: Page, project: CreatedProject, layout: "week" | "month" | "quarter" | null = null, cal = ANCHOR): Promise<void> {
  const display: Record<string, unknown> = { layout: "calendar" };
  if (layout !== null) display.calendar = { layout, show_weekends: true };
  await page.goto(workItemsUrl(project.id, display, { cal }));
  await expect(calendar(page)).toBeVisible({ timeout: 30_000 });
  await waitForAppHydrated(page);
}

async function openDisplay(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  const zoom = page.getByRole("radiogroup", { name: "Zoom" });
  await expect(zoom).toBeVisible();
  return zoom;
}

async function pickZoom(page: Page, label: "Week" | "Month" | "Quarter"): Promise<void> {
  const zoom = await openDisplay(page);
  await zoom.getByRole("radio", { name: label }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const heading = (page: Page) => calendar(page).getByRole("heading", { level: 3 });

/** "Q4 2026 (Oct – Dec)" for an ISO day. */
function quarterLabel(day: string): string {
  const [year, month] = day.split("-").map(Number);
  const q = Math.floor((month! - 1) / 3);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Q${q + 1} ${year} (${names[q * 3]} – ${names[q * 3 + 2]})`;
}

test("Display → Zoom offers Week, Month and Quarter, and Quarter draws Q4 2026 as whole weeks", async ({ page }) => {
  const project = await createProjectViaMcp();
  await openCalendar(page, project);
  const zoom = await openDisplay(page);
  expect(await zoom.getByRole("radio").allTextContents()).toEqual(["Week", "Month", "Quarter"]);
  await zoom.getByRole("radio", { name: "Quarter" }).click();
  await page.keyboard.press("Escape");

  await expect(calendar(page)).toHaveAttribute("data-view", "quarter");
  await expect(heading(page)).toHaveText("Q4 2026 (Oct – Dec)");
  const weekStart = await getWeekStart();
  const rows = await calendar(page).locator(".tessera-cal-week").count();
  if (weekStart === 1) expect(rows, "week rows with the Monday start (Sep 28 to Jan 3)").toBe(14);
  else expect([13, 14], `week rows with week start ${weekStart}`).toContain(rows);
  await expect(dayCell(page, "2026-11-01").locator(".tessera-cal-num")).toHaveText("Nov 1");
  await expect(dayCell(page, "2026-12-01").locator(".tessera-cal-num")).toHaveText("Dec 1");
  await expect(dayCell(page, "2026-10-15").locator(".tessera-cal-num")).toHaveText("15");
  if (weekStart === 1) {
    await expect(dayCell(page, "2026-09-28")).toHaveAttribute("data-outside", "");
    await expect(dayCell(page, "2027-01-03")).toHaveAttribute("data-outside", "");
  }
  await expect(dayCell(page, "2026-10-01")).not.toHaveAttribute("data-outside", /.*/);
});

test("] goes to the next quarter, [ comes back and t goes to today's quarter", async ({ page }) => {
  const project = await createProjectViaMcp();
  await openCalendar(page, project, "quarter");
  await expect(page.getByRole("button", { name: "Previous quarter", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next quarter", exact: true })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("]");
  await expect(heading(page)).toHaveText("Q1 2027 (Jan – Mar)");
  await page.keyboard.press("[");
  await expect(heading(page)).toHaveText("Q4 2026 (Oct – Dec)");
  await page.keyboard.press("[");
  await expect(heading(page)).toHaveText("Q3 2026 (Jul – Sep)");
  await page.keyboard.press("t");
  await expect(heading(page)).toHaveText(quarterLabel(isoDay(0)));
});

test("dragging the Oct 5 item to Nov 2 sets its target date across the month boundary", async ({ page }) => {
  const project = await createProjectViaMcp();
  const item = await createItem(project.id, "Quarter mover", { target_date: "2026-10-05" });
  await openCalendar(page, project, "quarter");
  const chip = dayCell(page, "2026-10-05").getByRole("button", { name: new RegExp(`^${item.key} Quarter mover`) });
  await expect(chip).toBeVisible();
  await dragByPointer(page, chip, dayCell(page, "2026-11-02"));
  await expect.poll(async () => (await getItem(item.id)).target_date, { timeout: 15_000 }).toBe("2026-11-02");
});

test("three items on one day show two chips and a +1 more button that opens the list", async ({ page }) => {
  const project = await createProjectViaMcp();
  for (const name of ["Busy one", "Busy two", "Busy three"]) await createItem(project.id, name, { target_date: "2026-11-18" });
  await openCalendar(page, project, "quarter");
  const cell = dayCell(page, "2026-11-18");
  await expect(cell.locator(".tessera-cal-item")).toHaveCount(2);
  const more = cell.getByRole("button", { name: "+1 more", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  const list = page.locator(".tessera-cal-more:visible");
  await expect(list.locator(".tessera-cal-item")).toHaveCount(1);
});

test("with weekends off the quarter has five columns", async ({ page }) => {
  const project = await createProjectViaMcp();
  await openCalendar(page, project, "quarter");
  await expect(calendar(page).locator(".tessera-cal-head")).toHaveCount(7);
  await openDisplay(page);
  await page.getByRole("switch", { name: "Show weekends" }).click();
  await page.keyboard.press("Escape");
  await expect(calendar(page).locator(".tessera-cal-head")).toHaveCount(5);
});

test("at 375 × 812 quarter cells hold no item rows, only a count named after the day", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const project = await createProjectViaMcp();
  await createItem(project.id, "Phone item", { target_date: "2026-11-02" });
  await openCalendar(page, project, "quarter");
  await expect(calendar(page).locator(".tessera-cal-item")).toHaveCount(0);
  await expect(calendar(page).getByRole("button", { name: "1 work item on 2026-11-02", exact: true })).toBeVisible();
});

test("at 1280 × 720 a side peek narrows the quarter to counts, and Escape brings the item rows back", async ({ page }) => {
  const project = await createProjectViaMcp();
  const item = await createItem(project.id, "Peek from chip", { target_date: "2026-11-04" });
  await createItem(project.id, "Second chip", { target_date: "2026-11-05" });
  await openCalendar(page, project, "quarter");
  await expect(calendar(page).locator(".tessera-cal-item")).toHaveCount(2);
  await calendar(page).getByRole("button", { name: new RegExp(`^${item.key} Peek from chip`) }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Peek from chip" })).toBeVisible({ timeout: 15_000 });
  const contentWidth = await calendar(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return el.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  expect(contentWidth, "the calendar's content box beside the peek").toBeLessThan(600);
  await expect(calendar(page).locator(".tessera-cal-item")).toHaveCount(0);
  await expect(calendar(page).getByRole("button", { name: "1 work item on 2026-11-04", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(peek).toBeHidden();
  await expect(calendar(page).locator(".tessera-cal-item")).toHaveCount(2);
});

test("the quarter zoom is saved: a reload and a URL-less reopen keep it", async ({ page }) => {
  const project = await createProjectViaMcp();
  // The layout switch and the zoom each save their own field to the project's view settings (useDisplayWriter).
  await page.goto(`/projects/${project.id}/work-items`);
  await expect(page.locator("[data-list-ready]").first()).toBeVisible({ timeout: 30_000 });
  await waitForAppHydrated(page);
  await page.getByRole("radio", { name: "Calendar" }).click();
  await expect(calendar(page)).toBeVisible();
  await pickZoom(page, "Quarter");
  await expect(calendar(page)).toHaveAttribute("data-view", "quarter");
  // The view settings are written through a Server Action; give it time to land before the reload.
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(calendar(page)).toHaveAttribute("data-view", "quarter", { timeout: 30_000 });
  await page.goto(`/projects/${project.id}/work-items`);
  await expect(calendar(page)).toHaveAttribute("data-view", "quarter", { timeout: 30_000 });
  await expect(heading(page)).toHaveText(quarterLabel(isoDay(0)));
});

test("week and month draw as before: month 5 or 6 rows, week 1 row", async ({ page }) => {
  const project = await createProjectViaMcp();
  await openCalendar(page, project, "month");
  await expect(calendar(page)).toHaveAttribute("data-view", "month");
  expect([5, 6]).toContain(await calendar(page).locator(".tessera-cal-week").count());
  await pickZoom(page, "Week");
  await expect(calendar(page)).toHaveAttribute("data-view", "week");
  await expect(calendar(page).locator(".tessera-cal-week")).toHaveCount(1);
});

test("describe_filters lists quarter under display.calendar.layout", async () => {
  const described = await mcp<{ display: { calendar: { layout: string[] } } }>("describe_filters");
  expect(described.display.calendar.layout).toEqual(["week", "month", "quarter"]);
});
