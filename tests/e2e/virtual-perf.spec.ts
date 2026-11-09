import os from "node:os";
import type { Locator, Page } from "@playwright/test";
import { expect, test, workItemsUrl } from "./fixtures";
import { BOARD_GROUP_PAGE, MAX_RENDERED, ROW_PAGE, visibleScroller } from "./helpers-p12";

/**
 * Decision 138's scroll budget for the virtual windows (docs/PLAN.md), on the
 * 10 000-item PERF project of data/p11-perf.db that playwright.perf.config.ts
 * seeds and serves. Scenarios: the list, the table and the gantt without
 * grouping, and the first column of the board grouped by state.
 *
 * Each scenario starts from a fresh document (`page.goto`), loads at least
 * 2 000 rows (the board column 300 cards) with "Show more", scrolls its
 * scroller back to the top, and then scrolls it for 5 s by 120 px per
 * animation frame, down and back up, while a PerformanceObserver collects long
 * tasks. Gated: no long task at all; the median and 95th percentile of the
 * frame intervals (list and gantt 17.5 / 34 ms, table and board 34 / 50 ms);
 * the rendered rows at the end (`MAX_RENDERED`). Reported, not gated: each
 * Show more click's longest task, one End-key jump in the list and the table,
 * and the server HTML size of the grouped list. Every number and the load
 * average go into the attached `virtual-perf.json`.
 *
 * It runs on the full Chromium build in new headless mode (`channel:
 * "chromium"`): the default headless shell does not paint like the browser, so
 * its frame times would not mean anything. perf.spec.ts keeps the default
 * browser. Skipped unless TESSERA_PERF=1 (the perf config sets it).
 */

test.use({ channel: "chromium" });
test.skip(process.env.TESSERA_PERF !== "1", "decision 138 scroll spec: run with playwright.perf.config.ts on data/p11-perf.db");

type Kind = "list" | "table" | "gantt" | "board";
type Scenario = { name: string; kind: Kind; display: Record<string, unknown>; target: number };

const SCENARIOS: readonly Scenario[] = [
  { name: "list flat", kind: "list", display: { layout: "list", group_by: null }, target: 2000 },
  { name: "table flat", kind: "table", display: { layout: "table", group_by: null }, target: 2000 },
  { name: "gantt flat", kind: "gantt", display: { layout: "gantt", group_by: null }, target: 2000 },
  { name: "board first column, grouped by state", kind: "board", display: { layout: "board", group_by: "state" }, target: 300 },
];

/** Decision 138's frame budgets in ms. */
const BUDGET: Record<Kind, { median: number; p95: number }> = {
  list: { median: 17.5, p95: 34 },
  gantt: { median: 17.5, p95: 34 },
  table: { median: 34, p95: 50 },
  board: { median: 34, p95: 50 },
};

/** The rendered rows counted at the end, inside the visible scroller (the board: inside the first column). */
const ROW_SELECTOR: Record<Kind, string> = {
  list: ".tessera-wi-row",
  table: "tbody tr:not(.tessera-table-spacer)",
  gantt: ".tessera-gantt-row",
  board: ".tessera-board-card",
};

/** The element the spec scrolls: the work-items scroller, or the first board column's body. */
const SCROLLER_SELECTOR: Record<Kind, string> = {
  list: ".tessera-wi-scroller",
  table: ".tessera-wi-scroller",
  gantt: ".tessera-wi-scroller",
  board: ".tessera-board-column-body",
};

/** Nearest-rank percentile, as perf.spec.ts. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

const round = (value: number) => Math.round(value * 10) / 10;

async function perfProjectId(page: Page): Promise<string> {
  await page.goto("/projects/PERF");
  await page.waitForURL(/\/projects\/[0-9a-f-]{20,}\/work-items/, { timeout: 120_000 });
  return page.url().match(/\/projects\/([0-9a-f-]{20,})/)![1]!;
}

/** Starts collecting long tasks into `window.__longTasks`; `stopLongTasks` returns them. */
async function startLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as unknown as { __longTasks: number[]; __longTaskObserver?: PerformanceObserver };
    host.__longTaskObserver?.disconnect();
    host.__longTasks = [];
    host.__longTaskObserver = new PerformanceObserver((list) => list.getEntries().forEach((entry) => host.__longTasks.push(entry.duration)));
    host.__longTaskObserver.observe({ type: "longtask" });
  });
}

async function stopLongTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const host = window as unknown as { __longTasks?: number[]; __longTaskObserver?: PerformanceObserver };
    host.__longTaskObserver?.disconnect();
    return host.__longTasks ?? [];
  });
}

/** "Show 200 more (9800 hidden)" → 9800; null when the button is gone. */
async function hiddenCount(footer: Locator): Promise<number | null> {
  if ((await footer.count()) === 0) return null;
  const text = (await footer.innerText()).trim();
  const match = text.match(/\((\d+) hidden\)/);
  return match ? Number(match[1]) : null;
}

/** Clicks "Show … more" until `target` rows are loaded or the button is gone; returns the loaded count and each click's longest task. */
async function loadRows(page: Page, footer: Locator, firstPage: number, target: number): Promise<{ loaded: number; total: number; clicks: { loaded: number; longestTaskMs: number }[] }> {
  await expect(footer).toBeVisible({ timeout: 60_000 });
  const firstHidden = await hiddenCount(footer);
  expect(firstHidden, "the first page leaves rows on the server").not.toBeNull();
  const total = firstPage + firstHidden!;
  let hidden: number | null = firstHidden;
  const clicks: { loaded: number; longestTaskMs: number }[] = [];
  while (hidden !== null && total - hidden < target) {
    const before: number = hidden;
    await startLongTasks(page);
    await footer.click();
    await expect.poll(async () => {
      const now = await hiddenCount(footer);
      return now === null || now < before;
    }, { timeout: 120_000, message: "Show more loaded the next page" }).toBe(true);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 120_000 });
    await page.waitForTimeout(300);
    const tasks = await stopLongTasks(page);
    hidden = await hiddenCount(footer);
    clicks.push({ loaded: hidden === null ? total : total - hidden, longestTaskMs: round(Math.max(0, ...tasks)) });
  }
  return { loaded: hidden === null ? total : total - hidden, total, clicks };
}

/** Decision 138's measuring run, as written in the contract (§10): 5 s at +120 px per frame, down and back up. */
async function scrollRun(page: Page, selector: string): Promise<{ frames: number[]; longTasks: number[] }> {
  return page.evaluate(async (sel) => {
    const longTasks: number[] = [];
    const frames: number[] = [];
    const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration)));
    po.observe({ type: "longtask" });
    const visible = (s: string) => [...document.querySelectorAll<HTMLElement>(s)].find((el) => el.offsetParent !== null);
    const scroller = visible(sel)!;
    let dir = 1;
    const end = performance.now() + 5000;
    await new Promise<void>((done) => {
      const step = (t: number) => {
        frames.push(t);
        scroller.scrollTop += 120 * dir;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) dir = -1;
        if (scroller.scrollTop <= 0) dir = 1;
        if (t < end) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    po.disconnect();
    return { frames, longTasks };
  }, selector);
}

/** One End-key jump from the first row's key (report only): the long tasks it caused. */
async function endJump(page: Page, keySelector: string): Promise<{ longTasks: number; longestTaskMs: number }> {
  const scroller = visibleScroller(page);
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  await scroller.locator(keySelector).first().focus();
  await page.waitForTimeout(300);
  await startLongTasks(page);
  await page.keyboard.press("End");
  await page.waitForTimeout(2000);
  const tasks = await stopLongTasks(page);
  return { longTasks: tasks.length, longestTaskMs: round(Math.max(0, ...tasks)) };
}

for (const scenario of SCENARIOS) {
  test(`${scenario.name}: scrolling ${scenario.target} loaded rows stays within decision 138's frame budget with no long task`, async ({ page }, testInfo) => {
    test.setTimeout(30 * 60_000);
    const loadBefore = os.loadavg();
    const projectId = await perfProjectId(page);

    // A fresh document per scenario: no hidden route copy is in the DOM.
    await page.goto(workItemsUrl(projectId, scenario.display));
    const scroller = visibleScroller(page);
    await expect(scroller.locator(scenario.kind === "gantt" ? ".tessera-gantt" : "[data-list-ready]").first()).toBeVisible({ timeout: 120_000 });
    const root = scenario.kind === "board" ? scroller.locator(".tessera-board-column").first() : scroller;
    const footer = root.locator(".tessera-paging-footer button");

    const loading = await loadRows(page, footer, scenario.kind === "board" ? BOARD_GROUP_PAGE : ROW_PAGE, scenario.target);
    expect(loading.loaded, "rows loaded before the scroll run").toBeGreaterThanOrEqual(Math.min(scenario.target, loading.total));

    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 120_000 });
    // The run starts at the top, so 5 s at 120 px per frame never reaches the end of 2 000 rows (§10).
    await page.evaluate((sel) => {
      const target = [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.offsetParent !== null);
      if (target) target.scrollTop = 0;
    }, SCROLLER_SELECTOR[scenario.kind]);
    await page.waitForTimeout(1000);

    const run = await scrollRun(page, SCROLLER_SELECTOR[scenario.kind]);
    const intervals = run.frames.slice(1).map((t, i) => t - run.frames[i]!);
    const rendered = await root.locator(ROW_SELECTOR[scenario.kind]).count();
    const result = {
      scenario: scenario.name,
      kind: scenario.kind,
      loaded: loading.loaded,
      showMoreClicks: loading.clicks,
      frames: run.frames.length,
      medianMs: round(percentile(intervals, 50)),
      p95Ms: round(percentile(intervals, 95)),
      maxFrameMs: round(Math.max(0, ...intervals)),
      longTasks: run.longTasks.length,
      longestTaskMs: round(Math.max(0, ...run.longTasks)),
      longTaskDurations: run.longTasks.map(round),
      rendered,
      budget: { ...BUDGET[scenario.kind], longTasks: 0, rendered: MAX_RENDERED[scenario.kind] },
      reportOnly: {} as Record<string, unknown>,
      loadavg: { before: loadBefore, after: [] as number[] },
    };

    if (scenario.kind === "list" || scenario.kind === "table") {
      result.reportOnly.endKeyJump = await endJump(page, scenario.kind === "list" ? ".tessera-wi-open" : ".tessera-table-open");
    }
    if (scenario.kind === "list") {
      const grouped = await page.request.get(workItemsUrl(projectId, { layout: "list", group_by: "state" }));
      result.reportOnly.groupedListHtmlBytes = (await grouped.body()).length;
    }
    result.loadavg.after = os.loadavg();

    await testInfo.attach("virtual-perf.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    console.log(
      `decision 138 ${scenario.name}: median ${result.medianMs} ms, p95 ${result.p95Ms} ms, long tasks ${result.longTasks} (longest ${result.longestTaskMs} ms), rendered ${rendered}, loaded ${loading.loaded}; ` +
        `Show more longest tasks ${loading.clicks.map((click) => click.longestTaskMs).join("/")} ms; report only ${JSON.stringify(result.reportOnly)}; ` +
        `load average ${loadBefore.map((v) => v.toFixed(2)).join("/")} before, ${result.loadavg.after.map((v) => v.toFixed(2)).join("/")} after`,
    );

    expect.soft(result.longTasks, `${scenario.name}: long tasks during the scroll (${result.longTaskDurations.join(", ")} ms)`).toBe(0);
    expect.soft(result.medianMs, `${scenario.name}: median frame interval`).toBeLessThanOrEqual(BUDGET[scenario.kind].median);
    expect.soft(result.p95Ms, `${scenario.name}: 95th percentile frame interval`).toBeLessThanOrEqual(BUDGET[scenario.kind].p95);
    expect.soft(rendered, `${scenario.name}: rendered rows at the end`).toBeLessThanOrEqual(MAX_RENDERED[scenario.kind]);
  });
}
