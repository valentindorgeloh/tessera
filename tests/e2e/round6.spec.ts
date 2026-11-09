import type { BrowserContext, Page } from "@playwright/test";
import { createProjectViaMcp, expect, mcp, test as base, workItemsUrl, type CreatedProject } from "./fixtures";
import {
  armEarlyAction,
  collectErrors,
  delayChunks,
  earlyRecord,
  throttleCpu,
  waitForAppHydrated,
  type EarlyAction,
  type EarlyRecord,
  type ErrorCollector,
} from "./helpers-d";

/**
 * Browser checks for fix round 6 (2026-10-23): the sidebar's hydration error 418.
 * The collapse flag lived in `TesseraShell` state and travelled through the
 * shell context. The sidebar streams in behind a Suspense boundary and hydrates
 * after the top bar and `mod+b` are live; a toggle in that gap re-rendered every
 * ancestor of the still-dehydrated boundary without telling it, so it hydrated
 * with the new flag against server HTML rendered expanded (React error 418, the
 * boundary then client-renders). The flag now lives in a client store that each
 * consumer reads through `useSyncExternalStore` with a server snapshot
 * (`src/components/shell/nav-collapse-store.ts`, docs/contracts/ui.md "Shell").
 *
 *   a  early toggle, 800 ms chunk delay, dark   ten routes; ends collapsed (48 px), then expands again
 *   b  early toggle, CPU x6, no delay           Home and Inbox
 *   c  early `mod+b` chord, 800 ms              Home and Projects
 *   d  Latte                                    (a) on Home; the page renders light
 *   e  375 regression (never reproduced)        early "Open navigation" opens the drawer
 *   f  AI status regression (latent)            loads with the status available, no interaction, 800 and 2500 ms
 *   g  early Assistant, Help, Account, search   Home at 800 ms; each opens its surface
 *
 * "Early" means the first task in which the target has a React fibre (`armEarlyAction`).
 * A Playwright click at "visible" is not that trigger: it lands once the target has hydrated, and the
 * sidebar may or may not have hydrated by then, so it hits the gap only some of the time. After every
 * case the page is hydrated completely
 * (`waitForAppHydrated`), given one more second, and must have logged no console error and no page error.
 *
 * Every case with an early action (all but f) must land it in the gap: fired while the "Work" nav had
 * no React fibre yet (`inWindow`). An attempt that misses passes on the pre-fix shell too, so the case
 * starts again in a fresh browser context, at most 3 attempts, and fails when none landed in the gap.
 * The "early window" annotation lists the attempts. An action that lands before the Work nav is in the
 * DOM at all also counts as in the gap; at 375 px (e) that happens (below md, 768 px, Astryx's AppShell drops
 * the inline sidebar once it hydrates, and the closed drawer holds none).
 *
 * Baseline proof against the pre-fix shell (TesseraShell.tsx from HEAD, no store; (a) to (d),
 * `--repeat-each=3`, four runs, before the gap check existed): docs/drafts/fix-round-6-2026-10-23.md,
 * section "e2e", "Baseline counts".
 */

/** Opens a page in a browser context of its own: no cached chunk, no module state from an earlier attempt. */
type FreshPage = () => Promise<Page>;

const test = base.extend<{ freshPage: FreshPage }>({
  freshPage: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    // `browser.newContext()` inside a test takes the project's `use` options (baseURL, the Desktop Chrome device).
    await provide(async () => {
      const context = await browser.newContext();
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

let rowCounter = 0;

/** A client name no other test uses (decision 51 coalesces one agent's events on one item); avoids the form-field words "name" and "label". */
function agentClient(): string {
  rowCounter += 1;
  return `round6-agent-${rowCounter}-r${test.info().repeatEachIndex}`;
}

type Seed = { project: CreatedProject; itemId: string | null; cycleId: string | null; pageId: string | null };

/** A project, optionally with one work item and one cycle; an agent's create gives Home a fresh "Since you were last here" row. */
async function seed(what: { item?: boolean; cycle?: boolean; page?: boolean; agentRow?: boolean; features?: Record<string, boolean> } = {}): Promise<Seed> {
  const project = await createProjectViaMcp();
  if (what.features !== undefined) await mcp("update_project_features", { project_id: project.id, ...what.features });
  let itemId: string | null = null;
  let cycleId: string | null = null;
  let pageId: string | null = null;
  if (what.item === true) itemId = (await mcp<{ id: string }>("create_work_item", { project_id: project.id, name: "Round 6 item" })).id;
  if (what.cycle === true) cycleId = (await mcp<{ id: string }>("create_cycle", { project_id: project.id, name: "Round 6 cycle" })).id;
  if (what.page === true) pageId = (await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Round 6 page" })).id;
  // Visiting Home moves the anchor, so the row is made right before the load.
  if (what.agentRow === true) await mcp("create_work_item", { project_id: project.id, name: "Agent row" }, agentClient());
  return { project, itemId, cycleId, pageId };
}

type Setup = { delay?: number; cpu?: number; scheme?: "light" | "dark"; width?: number; height?: number };

/** Arms the early action, applies the delay, the throttle and the scheme and loads `path`; the action runs during the load. */
async function loadWithEarlyAction(page: Page, path: string, action: EarlyAction, setup: Setup): Promise<ErrorCollector> {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: setup.width ?? 1440, height: setup.height ?? 900 });
  if (setup.scheme === "light") {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("tessera.scheme.v1", "light");
      } catch {
        // Storage can be blocked; the page then renders dark and (d) fails on the rendered scheme.
      }
    });
  }
  await armEarlyAction(page, action);
  if (setup.delay !== undefined) await delayChunks(page, setup.delay);
  if (setup.cpu !== undefined) await throttleCpu(page, setup.cpu);
  await page.goto(path);
  return errors;
}

/** Fresh starts a case gets to land its early action in the gap. */
const WINDOW_ATTEMPTS = 3;
/** How long one attempt waits for its action to fire or give up (the chord gives up after 200 presses, about 17 s). */
const FIRE_WAIT_MS = 30_000;
/** What each further attempt adds to the test's timeout. */
const RETRY_BUDGET_MS = 60_000;

/** The early record once the action fired or gave up, else as it is after `FIRE_WAIT_MS`. */
async function settledRecord(page: Page): Promise<EarlyRecord | null> {
  const until = Date.now() + FIRE_WAIT_MS;
  for (;;) {
    // A redirect or a reload destroys the execution context mid-read; the next document re-arms the script.
    const record = await earlyRecord(page).catch(() => null);
    if ((record !== null && (record.fired || record.gaveUp)) || Date.now() >= until) return record;
    await page.waitForTimeout(100);
  }
}

/** Whether an attempt's action landed in the gap (fired, and the "Work" nav had no fibre then), in the annotation's words. */
function verdictOf(record: EarlyRecord | null): { hit: boolean; text: string } {
  if (record === null) return { hit: false, text: "missed: no record (the init script did not run in this document)" };
  const state = `sidebar at first try: ${String(record.workHydratedAtFirstTry)}, when it landed: ${String(record.workHydratedAtFire)}, tries: ${record.tries}`;
  if (!record.fired) return { hit: false, text: `missed: never fired ${record.gaveUp ? "(the script gave up)" : `within ${FIRE_WAIT_MS / 1000} s`} (${state})` };
  if (record.workHydratedAtFire === true) return { hit: false, text: `missed: the sidebar had hydrated first (${state})` };
  return { hit: true, text: `in the gap${record.workHydratedAtFire === "absent" ? ", no Work nav in the DOM" : ""} (${state})` };
}

type Landed = { page: Page; errors: ErrorCollector };

/**
 * Starts a case (`start`: seed, arm and load on the page it gets) until its early action lands in the gap:
 * fired while `nav[aria-label="Work"]` had no React fibre yet. An attempt that misses (the action never
 * fired, or the sidebar had hydrated first) cannot show the bug and passes on the pre-fix shell as well,
 * so it must not decide the test: it is closed and the case starts again on a fresh page, at most
 * `WINDOW_ATTEMPTS` times, each further attempt with `RETRY_BUDGET_MS` more time. A missed attempt must
 * still have logged no error. Fails when no attempt hit the gap. Every attempt goes into the "early window" annotation.
 */
async function inWindow(freshPage: FreshPage, action: EarlyAction, start: (page: Page) => Promise<ErrorCollector>): Promise<Landed> {
  const attempts: string[] = [];
  try {
    for (let attempt = 1; attempt <= WINDOW_ATTEMPTS; attempt += 1) {
      if (attempt > 1) test.info().setTimeout(test.info().timeout + RETRY_BUDGET_MS);
      const page = await freshPage();
      const errors = await start(page);
      const verdict = verdictOf(await settledRecord(page));
      attempts.push(`attempt ${attempt}: ${verdict.text}`);
      if (verdict.hit) return { page, errors };
      expect(errors.list(), `console errors and page errors of attempt ${attempt}, which missed the gap`).toEqual([]);
      await page.context().close();
    }
  } finally {
    test.info().annotations.push({ type: "early window", description: attempts.join("; ") });
  }
  throw new Error(`the early ${action} landed in the gap in none of ${WINDOW_ATTEMPTS} attempts: ${attempts.join("; ")}`);
}

/** The part after the action: full hydration, one more second, no errors. */
async function settle(page: Page, errors: ErrorCollector): Promise<void> {
  await waitForAppHydrated(page);
  await page.waitForTimeout(1000);
  expect(errors.list(), "console errors and page errors").toEqual([]);
}

async function navWidth(page: Page): Promise<number> {
  const box = await page.locator('nav[aria-label="Work"]').boundingBox();
  return Math.round(box?.width ?? -1);
}

/** The width the expanded sidebar has: the stored one, else the default (Sidebar.tsx SIDEBAR_WIDTH). */
async function expandedWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    try {
      const stored = Number(window.localStorage.getItem("tessera.sidebarWidth.v1"));
      return stored >= 236 && stored <= 350 ? stored : 250;
    } catch {
      return 250;
    }
  });
}

/** End state of a toggle or chord: collapsed to the 48 px rail, and a click on the button expands it again. */
async function expectCollapsedThenExpanded(page: Page): Promise<void> {
  const toggle = page.locator('button[aria-label$="sidebar"]').first();
  await expect(toggle).toHaveAttribute("aria-label", "Expand sidebar");
  await expect.poll(() => navWidth(page), { message: "collapsed nav width" }).toBe(48);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Collapse sidebar");
  const width = await expandedWidth(page);
  await expect.poll(() => navWidth(page), { message: "expanded nav width" }).toBe(width);
}

// ---------------------------------------------------------------------------

type Route = { name: string; need: Parameters<typeof seed>[0]; path: (s: Seed) => string };

/** One attempt on `route`: a fresh seed (a Home row must be newer than the last visit), then the load with the early action. */
function attemptOn(route: Route, action: EarlyAction, setup: Setup): (page: Page) => Promise<ErrorCollector> {
  return async (page) => loadWithEarlyAction(page, route.path(await seed(route.need)), action, setup);
}

/** (a) to (d): one early toggle or chord on a route, in the gap; `ErrorCollector` is read again at the end so a late error also fails. */
async function earlyCollapse(freshPage: FreshPage, route: Route, action: "toggle" | "chord", setup: Setup): Promise<Page> {
  const { page, errors } = await inWindow(freshPage, action, attemptOn(route, action, setup));
  await settle(page, errors);
  await expectCollapsedThenExpanded(page);
  expect(errors.list(), "console errors and page errors after the second click").toEqual([]);
  return page;
}

const HOME: Route = { name: "Home with a fresh agent Since row", need: { agentRow: true }, path: () => "/" };

const ROUTES: readonly Route[] = [
  HOME,
  { name: "Projects", need: {}, path: () => "/projects" },
  { name: "Inbox", need: {}, path: () => "/inbox" },
  { name: "Your work, assigned", need: {}, path: () => "/your-work/assigned" },
  { name: "Wiki", need: {}, path: () => "/wiki" },
  { name: "a project's work items list", need: {}, path: (s) => `/projects/${s.project.id}/work-items` },
  {
    name: "the board with a peek open",
    need: { item: true },
    path: (s) => workItemsUrl(s.project.id, { layout: "board", group_by: "state" }, { peek: s.itemId ?? "" }),
  },
  { name: "a cycle detail", need: { cycle: true }, path: (s) => `/projects/${s.project.id}/cycles/${s.cycleId ?? ""}` },
  // The editor page: its Tiptap DOM and drag handle are not React-owned (waitForAppHydrated skips them).
  { name: "a project page", need: { page: true }, path: (s) => `/projects/${s.project.id}/pages/${s.pageId ?? ""}` },
  { name: "workspace settings, General", need: {}, path: () => "/settings/general" },
];

test.describe("early sidebar toggle, 800 ms chunk delay, Frappé (a)", () => {
  for (const route of ROUTES) {
    test(`on ${route.name} the toggle pressed at the shell's hydration point collapses the sidebar and logs no error`, async ({ freshPage }) => {
      await earlyCollapse(freshPage, route, "toggle", { delay: 800, scheme: "dark" });
    });
  }
});

test.describe("early sidebar toggle with the CPU slowed 6x and no delay (b)", () => {
  for (const route of ROUTES.filter((r) => r === HOME || r.name === "Inbox")) {
    test(`on ${route.name} the early toggle logs no error`, async ({ freshPage }) => {
      await earlyCollapse(freshPage, route, "toggle", { cpu: 6, scheme: "dark" });
    });
  }
});

test.describe("early mod+b chord, 800 ms chunk delay (c)", () => {
  for (const route of ROUTES.filter((r) => r === HOME || r.name === "Projects")) {
    test(`on ${route.name} the chord collapses the sidebar and logs no error`, async ({ freshPage }) => {
      await earlyCollapse(freshPage, route, "chord", { delay: 800, scheme: "dark" });
    });
  }
});

test("on Home in Latte the early toggle collapses the sidebar and logs no error (d)", async ({ freshPage }) => {
  const page = await earlyCollapse(freshPage, HOME, "toggle", { delay: 800, scheme: "light" });
  // The page rendered in Latte (read after hydration, color-scheme.ts): the root Theme switched <html> and the body is light.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const luminance = await page.evaluate(() => {
    const [r = 0, g = 0, b = 0] = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
  expect(luminance, "body background luminance (Latte is light, Frappé dark)").toBeGreaterThan(0.5);
});

test("at 375 px the early Open navigation button opens the drawer and logs no error (e, regression)", async ({ freshPage }) => {
  const { page, errors } = await inWindow(freshPage, "open-nav", attemptOn(HOME, "open-nav", { delay: 800, scheme: "dark", width: 375, height: 812 }));
  await settle(page, errors);
  // Below md (768 px) the sidebar is a drawer, a dialog named "Navigation" that slides in from the left edge.
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box, "drawer box").not.toBeNull();
  expect(box!.x, "drawer is on screen").toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, "drawer is on screen").toBeLessThanOrEqual(375);
  expect(errors.list(), "console errors and page errors").toEqual([]);
});

// ---------------------------------------------------------------------------
// (f) The AI status is fetched after mount; consumers under the server-passed children render differently
// once it says "available". The e2e server runs TESSERA_AI_FAKE, so it does. No interaction: the page only loads.

type AiRoute = { name: string; need: Parameters<typeof seed>[0]; path: (s: Seed) => string; heading: string };

const AI_ROUTES: readonly AiRoute[] = [
  { name: "Home with a fresh agent Since row", need: { agentRow: true }, path: () => "/", heading: "Home" },
  { name: "the project intake", need: { features: { intake_enabled: true } }, path: (s) => `/projects/${s.project.id}/intake`, heading: "Intake" },
  { name: "the project views", need: { features: { views_enabled: true } }, path: (s) => `/projects/${s.project.id}/views`, heading: "Views" },
  { name: "workspace settings, AI", need: {}, path: () => "/settings/ai", heading: "Settings" },
];

test.describe("AI status arrives after mount (f, regression)", () => {
  for (const delay of [800, 2500]) {
    for (const route of AI_ROUTES) {
      test(`${route.name} loads with the assistant available and logs no error, chunks delayed ${delay} ms`, async ({ page }) => {
        const s = await seed(route.need);
        const errors = collectErrors(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await delayChunks(page, delay);
        await page.goto(route.path(s));
        await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible({ timeout: 30_000 });
        await settle(page, errors);
        // The status arrived: the top bar's Assistant button only renders when it says available.
        await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeVisible();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (g) The other top-bar controls do not change shell state, but an early click on them, in the gap, must still land.

type OtherControl = { action: EarlyAction; name: string; opened: (page: Page) => ReturnType<Page["locator"]> };

const OTHER_CONTROLS: readonly OtherControl[] = [
  { action: "assistant", name: "Assistant", opened: (page) => page.getByRole("complementary", { name: "Assistant" }) },
  { action: "help", name: "Help", opened: (page) => page.getByRole("dialog", { name: "Keyboard shortcuts" }) },
  { action: "scheme", name: "Colour scheme", opened: (page) => page.getByRole("menu") },
  { action: "search", name: "search", opened: (page) => page.getByRole("dialog", { name: "Command bar" }) },
];

test.describe("early clicks on the other top-bar controls (g, regression)", () => {
  for (const control of OTHER_CONTROLS) {
    test(`an early click on ${control.name} on Home opens it and logs no error`, async ({ freshPage }) => {
      const { page, errors } = await inWindow(freshPage, control.action, attemptOn(HOME, control.action, { delay: 800, scheme: "dark" }));
      await expect(control.opened(page).first()).toBeVisible();
      await settle(page, errors);
      await expect(control.opened(page).first()).toBeVisible();
    });
  }
});
