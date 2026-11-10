import type { Page } from "@playwright/test";
import { expect, openWebWorkItems, test } from "./fixtures";

/**
 * The first-visit hold (decision 155): a client navigation to a page that has
 * not been visited keeps the old page on screen until the new one is ready, so
 * the frame's "Loading page" skeleton is never committed (React would hold the
 * content for 300 ms after it). A cold load still streams through it.
 * A MutationObserver records whether the skeleton ever entered the DOM.
 */

const SKELETON = '[aria-label="Loading page"]';

async function watchSkeleton(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as unknown as { __skeletonSeen: boolean };
    w.__skeletonSeen = false;
    const check = () => {
      if (document.querySelector(selector) !== null) w.__skeletonSeen = true;
    };
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
    check();
  }, SKELETON);
}

async function skeletonSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __skeletonSeen: boolean }).__skeletonSeen);
}

/** Clicks the first visible link with this href, then waits for the URL and the page's heading area. */
async function clickThrough(page: Page, href: string, urlPattern: RegExp): Promise<void> {
  await watchSkeleton(page);
  const link = page.locator(`a[href="${href}"]`).locator("visible=true").first();
  await link.click();
  await page.waitForURL(urlPattern, { timeout: 30_000 });
  await expect(page.getByRole("main")).toBeVisible();
  // Let the new page finish committing before reading the flag.
  await expect(page.locator(SKELETON)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await skeletonSeen(page), `"Loading page" appeared on the way to ${href}`).toBe(false);
}

test("first client visits to the covered routes never commit the page skeleton", async ({ page }) => {
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
  const link = page.locator(`main a[href^="/projects/${projectId}/cycles/"]`).first();
  await expect(link, "the demo project has a cycle").toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute("href");
  if (href === null) throw new Error("cycle link without href");
  return href;
}

test("a cold load of a covered route still shows its content", async ({ page }) => {
  await page.goto("/inbox");
  const main = page.getByRole("main");
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(main.getByText("Inbox", { exact: true }).first()).toBeVisible();
  await expect(page.locator(SKELETON)).toHaveCount(0);

  await page.goto("/wiki");
  await expect(page.getByRole("main").getByText("Wiki", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(SKELETON)).toHaveCount(0);
});
