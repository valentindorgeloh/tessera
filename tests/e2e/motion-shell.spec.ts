import type { Page } from "@playwright/test";
import { createProjectViaMcp, expect, mcp, openWorkItems, test } from "./fixtures";
import { waitForAppHydrated } from "./helpers-d";

/**
 * Shell motion (docs/contracts/ui.md "Motion"), with motion ON: the suite runs
 * with reducedMotion "reduce" (playwright.config.ts), and this file opts back in.
 *
 * The page change fade (src/components/shell/PageFade.tsx) dips the content
 * panel to 0.4 and fades it back to 1 on a client navigation. It must end at
 * opacity 1 with no inline style left behind, and it must not run on first
 * load, on Back or Forward, or on the agent refresh (a data refresh keeps the
 * pathname). An in-page sampler records the content panel's computed opacity
 * on every animation frame, so a dip that lasted a single frame still shows.
 */
test.use({ reducedMotion: "no-preference" });

const CONTENT = ".tessera-panel .astryx-layout-content";

type Sampled = { min: number; frames: number };

/** Starts recording the shell content's opacity at every frame, from before the first script of each document. */
async function recordOpacity(page: Page): Promise<void> {
  await page.addInitScript((selector: string) => {
    const state = { min: 1, frames: 0 };
    (window as unknown as { __fade: typeof state }).__fade = state;
    const tick = () => {
      const content = document.querySelector(selector);
      if (content) {
        state.frames += 1;
        state.min = Math.min(state.min, parseFloat(getComputedStyle(content).opacity));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, CONTENT);
}

async function sampled(page: Page): Promise<Sampled> {
  return page.evaluate(() => ({ ...(window as unknown as { __fade: Sampled }).__fade }));
}

async function resetSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as { __fade: Sampled }).__fade;
    state.min = 1;
    state.frames = 0;
  });
}

/** The fade is over: computed opacity 1 and no inline opacity left on the element (a stacking context must not outlive it). */
async function expectSettled(page: Page): Promise<void> {
  const content = page.locator(CONTENT).first();
  await expect(content).toHaveCSS("opacity", "1");
  await expect.poll(() => content.evaluate((element) => (element as HTMLElement).style.opacity)).toBe("");
}

/**
 * A link of the live sidebar (Astryx keeps an aria-hidden copy beside it while the rail animates).
 * The accessible name carries the count when there is one ("Inbox 5" after other specs wrote
 * notifications), so it matches the label followed by a word boundary.
 */
function sidebarLink(page: Page, label: string) {
  return page.locator('nav[aria-label="Work"]:not([aria-hidden="true"] *)').getByRole("link", { name: new RegExp(`^${label}\\b`) });
}

test("a client navigation dips the content and fades it back to opacity 1", async ({ page }) => {
  await recordOpacity(page);
  await page.goto("/");
  await waitForAppHydrated(page);
  await expectSettled(page);
  await resetSamples(page);

  await sidebarLink(page, "Inbox").click();
  await expect(page).toHaveURL(/\/inbox$/);

  // The dip is applied in the commit that shows the page (a layout effect), so a frame caught it below full opacity.
  await expect.poll(async () => (await sampled(page)).min).toBeLessThan(1);
  expect((await sampled(page)).min).toBeGreaterThanOrEqual(0.3);
  await expectSettled(page);
  await expect(page.getByRole("main")).toBeVisible();

  // And again the other way: every pathname change fades, each ending at full opacity.
  await resetSamples(page);
  await sidebarLink(page, "Home").click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await sampled(page)).min).toBeLessThan(1);
  await expectSettled(page);
});

test("nothing fades on first load", async ({ page }) => {
  await recordOpacity(page);
  await page.goto("/inbox");
  await waitForAppHydrated(page);
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForTimeout(1_000);
  const first = await sampled(page);
  expect(first.frames).toBeGreaterThan(10);
  expect(first.min).toBe(1);
  await expectSettled(page);
});

test("nothing fades on Back or Forward", async ({ page }) => {
  await recordOpacity(page);
  await page.goto("/inbox");
  await waitForAppHydrated(page);
  await sidebarLink(page, "Home").click();
  await expect(page).toHaveURL(/\/$/);
  await expectSettled(page); // the click above fades; wait for it to end before measuring Back

  await resetSamples(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/inbox$/);
  await page.waitForTimeout(1_000);
  expect((await sampled(page)).frames).toBeGreaterThan(10);
  expect((await sampled(page)).min).toBe(1);

  await resetSamples(page);
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(1_000);
  expect((await sampled(page)).frames).toBeGreaterThan(10);
  expect((await sampled(page)).min).toBe(1);
  await expectSettled(page);
});

test("the agent refresh does not fade the content", async ({ page }) => {
  const project = await createProjectViaMcp();
  await recordOpacity(page);
  await openWorkItems(page, project.id);
  await waitForAppHydrated(page);
  await expectSettled(page);
  await resetSamples(page);

  // Another process writes; the changes poller refreshes the open page within about 5 s (same pathname).
  await mcp("create_work_item", { project_id: project.id, name: "Written by an agent" });
  await expect(page.getByText("Written by an agent").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  expect((await sampled(page)).frames).toBeGreaterThan(10);
  expect((await sampled(page)).min).toBe(1);
});

/**
 * The sidebar collapse is Tessera's motion (decision 149, rail-motion.ts):
 * Astryx would move the content column with a transform and cross-fade a copy
 * of the old content, which reads as a reload. With motion on, in both
 * directions, every frame shows the content at full opacity with no Astryx
 * copy, the panel's trailing edge never moves, its leading edge passes
 * through in-between places on the way, and nothing is left behind.
 */
test("collapsing and opening the sidebar glides the content's leading edge without a fade", async ({ page }) => {
  type Snap = { min: number; lefts: number[]; rights: number[]; copies: number };
  await page.addInitScript(() => {
    const state = { min: 1, lefts: [] as number[], rights: [] as number[], copies: 0 };
    (window as unknown as { __snap: typeof state }).__snap = state;
    const tick = () => {
      const main = document.getElementById("astryx-app-shell-main");
      if (main) {
        const box = main.getBoundingClientRect();
        state.lefts.push(Math.round(box.left));
        state.rights.push(Math.round(box.right));
        for (const child of Array.from(main.children)) state.min = Math.min(state.min, parseFloat(getComputedStyle(child).opacity));
        state.copies = Math.max(state.copies, document.querySelectorAll('[aria-hidden="true"][inert]:not([data-tessera-rail-copy])').length);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/inbox");
  await waitForAppHydrated(page);
  const main = page.locator("#astryx-app-shell-main");
  const leftOf = () => main.evaluate((element) => Math.round(element.getBoundingClientRect().left));

  for (const label of ["Close sidebar", "Open sidebar"]) {
    const before = await leftOf();
    // Astryx's motion copies are inert and hidden; count them against what the page holds at rest.
    const atRest = await page.evaluate(() => {
      const state = (window as unknown as { __snap: { min: number; lefts: number[]; rights: number[]; copies: number } }).__snap;
      state.min = 1;
      state.lefts = [];
      state.rights = [];
      state.copies = document.querySelectorAll('[aria-hidden="true"][inert]:not([data-tessera-rail-copy])').length;
      return state.copies;
    });
    await page.getByRole("button", { name: label }).click();
    await expect(page.locator("[data-tessera-rail-copy]")).toHaveCount(0);
    await page.waitForTimeout(200);
    const after = await leftOf();
    expect(after).not.toBe(before);
    const snap = await page.evaluate(() => (window as unknown as { __snap: Snap }).__snap);
    expect(snap.lefts.length).toBeGreaterThan(10);
    expect(snap.min).toBe(1);
    expect(snap.copies).toBe(atRest);
    expect(new Set(snap.rights).size).toBe(1);
    const low = Math.min(before, after);
    const high = Math.max(before, after);
    expect(snap.lefts.filter((left) => left > low && left < high).length).toBeGreaterThan(2);
    expect(snap.lefts.every((left) => left >= low && left <= high)).toBe(true);
    await expect(page.locator("html")).not.toHaveAttribute("data-astryx-reduced-motion");
  }
});
