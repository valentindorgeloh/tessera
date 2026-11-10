import type { Page } from "@playwright/test";
import { expect, openWebWorkItems, test } from "./fixtures";

/**
 * The first-visit hold (decision 156): a client navigation to a page that has
 * not been visited keeps the old page on screen until the new one is ready, so
 * no loading skeleton is ever committed (React would hold the content for
 * 300 ms after it). A full load sends the page in the first HTML flush, not in
 * a streamed segment that React reveals 300 ms after the first paint.
 * A MutationObserver records whether a "Loading …" skeleton entered the page
 * area during the navigation.
 */

const SKELETON = '[aria-busy="true"][aria-label^="Loading"]';
const MAIN = '[role="main"], main';

async function watchSkeleton(page: Page): Promise<void> {
  await page.evaluate(
    ({ skeleton, main }) => {
      const w = window as unknown as { __skeletonSeen: string | null };
      w.__skeletonSeen = null;
      const area = document.querySelector(main);
      if (area === null) throw new Error("no main landmark");
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            const hit = node.matches(skeleton) ? node : node.querySelector(skeleton);
            if (hit !== null) w.__skeletonSeen ??= hit.getAttribute("aria-label");
          }
      }).observe(area, { childList: true, subtree: true });
    },
    { skeleton: SKELETON, main: MAIN },
  );
}

async function skeletonSeen(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as { __skeletonSeen: string | null }).__skeletonSeen);
}

/** Clicks the first visible link with this href, then waits for the URL and the page's heading area. */
async function clickThrough(page: Page, href: string, urlPattern: RegExp): Promise<void> {
  await watchSkeleton(page);
  const link = page.locator(`a[href="${href}"]`).locator("visible=true").first();
  await link.click();
  await page.waitForURL(urlPattern, { timeout: 30_000 });
  await expect(page.getByRole("main")).toBeVisible();
  // Let the new page finish committing before reading the flag.
  await page.waitForTimeout(500);
  expect(await skeletonSeen(page), `a loading skeleton appeared on the way to ${href}`).toBeNull();
}

test("first client visits to the covered routes never commit a skeleton", async ({ page }) => {
  const projectId = await openWebWorkItems(page);
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 });

  await clickThrough(page, "/inbox", /\/inbox/);
  await clickThrough(page, "/analytics/overview", /\/analytics\//);
  await clickThrough(page, "/wiki", /\/wiki/);

  // Project routes: the project's own row from home, then its tabs.
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible({ timeout: 15_000 });
  await clickThrough(page, `/projects/${projectId}/work-items`, new RegExp(`/projects/${projectId}/work-items`));
  await clickThrough(page, `/projects/${projectId}/cycles`, new RegExp(`/projects/${projectId}/cycles$`));
  await clickThrough(page, await firstCycleHref(page, projectId), new RegExp(`/projects/${projectId}/cycles/[^/]+$`));
});

async function firstCycleHref(page: Page, projectId: string): Promise<string> {
  const link = page.locator(`a[href^="/projects/${projectId}/cycles/"]`).first();
  await expect(link, "the demo project's cycle (Sprint 12)").toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute("href");
  if (href === null) throw new Error("cycle link without href");
  return href;
}

/**
 * The page's own markup comes before the first streamed segment
 * (`<div hidden id="S:…">`, which React moves in with `$RC`): it is part of
 * the first flush and paints with the frame.
 */
async function expectInFirstFlush(page: Page, url: string, marker: string): Promise<void> {
  const html = await (await page.request.get(url)).text();
  const at = html.indexOf(marker);
  const segment = html.indexOf('<div hidden id="S:');
  expect(at, `${marker} in the HTML of ${url}`).toBeGreaterThan(-1);
  expect(segment === -1 || at < segment, `${marker} before the first streamed segment of ${url}`).toBe(true);
}

test("a full load of a covered route sends its content in the first flush", async ({ page }) => {
  const projectId = await openWebWorkItems(page);
  await expectInFirstFlush(page, "/inbox", "tessera-inbox-tabs");
  await expectInFirstFlush(page, "/wiki", "tessera-pages-actions");
  await expectInFirstFlush(page, "/analytics/overview", "tessera-analytics-tabs");
  await expectInFirstFlush(page, `/projects/${projectId}/work-items`, "data-list-ready");

  await page.goto("/inbox");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Inbox", { exact: true }).first()).toBeVisible();
  await expect(main.locator(SKELETON)).toHaveCount(0);

  await page.goto("/wiki");
  await expect(page.getByRole("main").getByText("Wiki", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main").locator(SKELETON)).toHaveCount(0);
});
