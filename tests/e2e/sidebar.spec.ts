import type { Browser, Page } from "@playwright/test";
import { createProjectViaMcp, expect, mcp, test } from "./fixtures";
import { modifierKey } from "./helpers-b";
import { collectErrors, delayChunks, waitForAppHydrated, type ErrorCollector } from "./helpers-d";
import { navPrefs } from "./helpers-p12";

/**
 * Sidebar views and the floating sidebar (decisions 128–131): the three docked
 * views (Full, Icons and labels, Icons only), the stored preference
 * (`localStorage["tessera.nav.v1"]`), the top-bar toggle and `mod+b`, the
 * "Sidebar options" menu, the floating panel (open, close, focus), the Power K
 * commands, the help row, the phone width, other tabs and an early `mod+b`.
 *
 * Widths are read from the `<nav aria-label="Work">` box after the 280 ms width
 * animation has settled (polled). The Desktop Chrome device is 1280 × 720.
 */

const FULL = 250;
const ICONS = 48;
const LABELS = 60;

type View = "full" | "labels" | "icons";
const PREFS: Record<View, { display: "full" | "rail"; rail: "icons" | "labels" }> = {
  full: { display: "full", rail: "icons" },
  labels: { display: "rail", rail: "labels" },
  icons: { display: "rail", rail: "icons" },
};
const WIDTH: Record<View, number> = { full: FULL, labels: LABELS, icons: ICONS };

const nav = (page: Page) => page.locator('nav[aria-label="Work"]');
const panelEl = (page: Page) => page.locator("#tessera-sidebar");
const options = (page: Page) => page.locator("#tessera-nav-options");

async function navWidth(page: Page): Promise<number> {
  const box = await nav(page).boundingBox();
  return Math.round(box?.width ?? -1);
}

/** Width of AppShell's sidebar panel (0 while floating). */
async function sidenavPanelWidth(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(document.querySelector(".astryx-app-shell-sidenav")?.getBoundingClientRect().width ?? -1));
}

async function expectNavWidth(page: Page, width: number, message = "nav width"): Promise<void> {
  await expect.poll(() => navWidth(page), { message }).toBe(width);
}

/** Loads Home and waits until every element has hydrated, so the shell's hotkeys and stores are live. */
async function loadHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible({ timeout: 30_000 });
  await waitForAppHydrated(page);
}

/** Stores the sidebar preferences and reloads Home with them. */
async function withPrefs(page: Page, prefs: { display?: string; rail?: string; dock?: string }): Promise<void> {
  if (!page.url().startsWith("http")) await page.goto("/");
  await page.evaluate((value) => window.localStorage.setItem("tessera.nav.v1", JSON.stringify(value)), { display: "full", rail: "icons", dock: "docked", ...prefs });
  await loadHome(page);
}

async function pickView(page: Page, label: "Full sidebar" | "Icons and labels" | "Icons only"): Promise<void> {
  await options(page).click();
  await page.getByRole("menuitemradio", { name: label }).click();
}

async function pressModB(page: Page): Promise<void> {
  await page.keyboard.press(`${await modifierKey(page)}+b`);
}

async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command bar" });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const shortcut = `${await modifierKey(page)}+k`;
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press(shortcut);
    await expect(palette).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  return palette;
}

/** The "Sidebar: …" commands Power K lists for the query "Sidebar", sorted. */
async function sidebarCommands(page: Page): Promise<string[]> {
  const palette = await openPalette(page);
  await page.keyboard.type("Sidebar");
  // The command list answers in the same task as the query; give the search a moment before reading it.
  await page.waitForTimeout(500);
  const names = await palette.getByRole("option", { name: /^Sidebar:/ }).allTextContents();
  return names.map((name) => name.replace(/\s+/g, " ").trim()).sort();
}

async function runCommand(page: Page, label: string): Promise<void> {
  const palette = await openPalette(page);
  await page.keyboard.type(label);
  await palette.getByRole("option", { name: label }).first().click();
  await expect(palette).toBeHidden();
}

async function isOpen(page: Page): Promise<boolean> {
  return (await panelEl(page).getAttribute("data-open")) !== null;
}

async function undock(page: Page): Promise<void> {
  await options(page).click();
  await page.getByRole("menuitem", { name: /Undock sidebar/ }).click();
  await expect(panelEl(page)).toHaveAttribute("data-dock", "floating");
}

async function openFloating(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  await expect(panelEl(page)).toHaveAttribute("data-open", "");
}

test.describe("docked views", () => {
  test("the sidebar starts in the Full view, 250 px wide", async ({ page }) => {
    await loadHome(page);
    await expectNavWidth(page, FULL);
    await expect(nav(page)).not.toHaveAttribute("data-rail", /.*/);
  });

  test("the top-bar toggle collapses to the 48 px Icons only rail, and a reload keeps it", async ({ page }) => {
    await loadHome(page);
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await expectNavWidth(page, ICONS);
    expect(await navPrefs(page)).toMatchObject({ display: "rail", rail: "icons" });
    await loadHome(page);
    await expectNavWidth(page, ICONS, "nav width after the reload");
    await expect(page.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  });

  test("mod+b switches between Full and the rail", async ({ page }) => {
    await loadHome(page);
    await pressModB(page);
    await expectNavWidth(page, ICONS);
    await pressModB(page);
    await expectNavWidth(page, FULL);
    expect(await navPrefs(page)).toMatchObject({ display: "full" });
  });

  test("the options menu sets each view and gives focus back to Sidebar options", async ({ page }) => {
    await loadHome(page);
    await pickView(page, "Icons and labels");
    await expectNavWidth(page, LABELS);
    await expect(nav(page)).toHaveAttribute("data-rail", "labels");
    await expect(options(page)).toBeFocused();
    const home = nav(page).getByRole("link", { name: "Home", exact: true });
    const tile = await home.boundingBox();
    expect(Math.round(tile!.width), "Home tile width").toBe(52);
    expect(tile!.height, "Home tile height").toBeGreaterThanOrEqual(44);
    expect(await home.evaluate((el) => getComputedStyle(el, "::after").content), "the tile's name").toBe('"Home"');

    await pickView(page, "Icons only");
    await expectNavWidth(page, ICONS);
    await expect(nav(page)).toHaveAttribute("data-rail", "icons");
    await expect(options(page)).toBeFocused();

    await pickView(page, "Full sidebar");
    await expectNavWidth(page, FULL);
    await expect(options(page)).toBeFocused();
    expect(await navPrefs(page)).toMatchObject({ display: "full", rail: "icons", dock: "docked" });
  });

  test("with Icons and labels stored, mod+b goes to Full and back to the 60 px rail", async ({ page }) => {
    await withPrefs(page, PREFS.labels);
    await expectNavWidth(page, LABELS);
    await pressModB(page);
    await expectNavWidth(page, FULL);
    await pressModB(page);
    await expectNavWidth(page, LABELS);
    await expect(nav(page)).toHaveAttribute("data-rail", "labels");
  });

  test("dragging the resize handle 150 px to the left collapses to the stored rail kind", async ({ page }) => {
    await withPrefs(page, { display: "full", rail: "labels" });
    await expectNavWidth(page, FULL);
    const handle = page.getByRole("separator", { name: /resize/i }).first();
    const box = await handle.boundingBox();
    expect(box, "resize handle box").not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 150, y, { steps: 15 });
    await page.mouse.up();
    await expectNavWidth(page, LABELS);
    expect(await navPrefs(page)).toMatchObject({ display: "rail", rail: "labels" });
  });
});

test.describe("floating sidebar", () => {
  test("undocked, the panel takes no width and is inert; Show sidebar opens it on New work item and Escape closes it", async ({ page }) => {
    await loadHome(page);
    await undock(page);
    await expect.poll(() => sidenavPanelWidth(page), { message: "sidebar panel width" }).toBe(0);
    await expect(panelEl(page)).toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Show sidebar", exact: true })).toBeFocused();
    expect(await navPrefs(page)).toMatchObject({ dock: "floating" });

    await openFloating(page);
    await expect(panelEl(page)).not.toHaveAttribute("inert", /.*/);
    await expect(panelEl(page).getByRole("button", { name: "New work item" }).first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panelEl(page)).not.toHaveAttribute("data-open", /.*/);
    await expect(panelEl(page)).toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Show sidebar", exact: true })).toBeFocused();
  });

  test("with focus inside the open panel, a click on Hide sidebar closes it for good", async ({ page }) => {
    await withPrefs(page, { dock: "floating" });
    await openFloating(page);
    expect(await page.evaluate(() => document.getElementById("tessera-sidebar")?.contains(document.activeElement) ?? false), "focus is inside the panel").toBe(true);
    await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
    await expect(panelEl(page)).toHaveAttribute("inert", "");
    await page.waitForTimeout(600);
    await expect(panelEl(page)).toHaveAttribute("inert", "");
    expect(await isOpen(page), "still closed 600 ms later").toBe(false);
  });

  test("resting on the left edge opens the panel after 120 ms, and it stays open while the pointer rests there", async ({ page }) => {
    await withPrefs(page, { dock: "floating" });
    // Count every open and close of the panel from here on.
    await page.evaluate(() => {
      const panel = document.getElementById("tessera-sidebar")!;
      const flips: string[] = [];
      (window as unknown as { __flips: string[] }).__flips = flips;
      const start = performance.now();
      new MutationObserver(() => flips.push(`${Math.round(performance.now() - start)} ms ${panel.hasAttribute("data-open") ? "open" : "closed"}`)).observe(panel, {
        attributes: true,
        attributeFilter: ["data-open"],
      });
    });
    await page.mouse.move(400, 400);
    await page.mouse.move(4, 200);
    await expect.poll(() => isOpen(page), { message: "opens on the edge", timeout: 3_000 }).toBe(true);
    // Decision 129 closes on the pointer leaving the panel; a pointer resting on the edge strip never entered it.
    await page.waitForTimeout(1500);
    const flips = await page.evaluate(() => (window as unknown as { __flips: string[] }).__flips);
    expect(flips, "open and close changes while the pointer rests on the edge").toEqual([flips[0]]);
    expect(await isOpen(page), "still open").toBe(true);
  });

  test("moving from the edge through the panel into the content closes it after the leave delay, also with an expanded favourites folder", async ({ page }) => {
    let folder: { id: string } | null = null;
    try {
      await withPrefs(page, { dock: "floating" });
      for (const round of ["plain", "with an expanded favourites folder"]) {
        if (round !== "plain") {
          folder = await mcp<{ id: string }>("create_favorite_folder", { name: `Hover folder ${Date.now()}` });
          await loadHome(page);
          // A folder is expanded by default: a plain aria-expanded="true" that must not hold the panel open.
          await expect(panelEl(page).locator('[aria-expanded="true"]:not([aria-haspopup])').first()).toBeAttached();
        }
        await page.mouse.move(400, 400);
        await page.mouse.move(4, 200);
        await expect.poll(() => isOpen(page), { message: `opens on the edge (${round})`, timeout: 3_000 }).toBe(true);
        // On into the panel as it slides in, then on to the content centre: the pointer leaves the panel there.
        await page.mouse.move(120, 300);
        await page.waitForTimeout(600);
        expect(await isOpen(page), `open while the pointer is on it (${round})`).toBe(true);
        const left = await page.evaluate(() => performance.now());
        await page.mouse.move(640, 360);
        const stillOpen = await page.evaluate(() => [document.getElementById("tessera-sidebar")?.hasAttribute("data-open") ?? false, performance.now()] as const);
        // The close waits 300 ms after the leave; a check that ran later than that proves nothing either way.
        if (stillOpen[1] - left < 250) expect(stillOpen[0], `still open right after leaving (${round})`).toBe(true);
        await expect.poll(() => isOpen(page), { message: `closes after the leave delay (${round})`, timeout: 3_000 }).toBe(false);
      }
    } finally {
      if (folder !== null) await mcp("delete_favorite_folder", { folder_id: folder.id });
    }
  });

  test("a project click in the panel navigates and closes it; Enter on a project link puts focus on the main area", async ({ page }) => {
    const project = await createProjectViaMcp();
    await withPrefs(page, { dock: "floating" });
    await openFloating(page);
    await panelEl(page).getByRole("link", { name: new RegExp(`^${project.name} `) }).click();
    await page.waitForURL(new RegExp(`/projects/${project.id}/work-items`));
    await expect(panelEl(page)).not.toHaveAttribute("data-open", /.*/);

    await page.goto("/");
    await waitForAppHydrated(page);
    await openFloating(page);
    const link = panelEl(page).getByRole("link", { name: new RegExp(`^${project.name} `) });
    await link.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/projects/${project.id}/work-items`));
    await expect(panelEl(page)).not.toHaveAttribute("data-open", /.*/);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? ""), { message: "focused element id" }).toBe("astryx-app-shell-main");
  });

  test("opening a project's menu keeps the panel open", async ({ page }) => {
    const project = await createProjectViaMcp();
    await withPrefs(page, { dock: "floating" });
    await openFloating(page);
    await panelEl(page).getByRole("button", { name: `Actions for ${project.name}`, exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.waitForTimeout(800);
    expect(await isOpen(page), "open while the menu is").toBe(true);
    await page.keyboard.press("Escape");
  });

  test("Projects + opens Create project; Escape closes the dialog and leaves the panel open with focus on +", async ({ page }) => {
    await withPrefs(page, { dock: "floating" });
    await openFloating(page);
    const plus = panelEl(page).getByRole("button", { name: "Create project", exact: true });
    await plus.click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(700);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await isOpen(page), "the panel is still open").toBe(true);
    await expect(plus).toBeFocused();
  });

  for (const view of ["full", "labels", "icons"] as const) {
    test(`Dock restores the stored ${view} view and gives focus to Sidebar options`, async ({ page }) => {
      await withPrefs(page, { ...PREFS[view], dock: "floating" });
      await openFloating(page);
      await options(page).click();
      await page.getByRole("menuitem", { name: "Dock sidebar" }).click();
      await expect(panelEl(page)).not.toHaveAttribute("data-dock", /.*/);
      await expectNavWidth(page, WIDTH[view]);
      await expect(options(page)).toBeFocused();
      expect(await navPrefs(page)).toMatchObject({ ...PREFS[view], dock: "docked" });
    });
  }
});

test.describe("commands and help", () => {
  test("Power K runs the five sidebar commands and never lists the current view", async ({ page }) => {
    await loadHome(page);
    expect(await sidebarCommands(page)).toEqual(["Sidebar: Icons and labels", "Sidebar: Icons only", "Sidebar: Undock (float over the page)"]);
    await page.keyboard.press("Escape");
    await runCommand(page, "Sidebar: Icons only");
    await expectNavWidth(page, ICONS);

    expect(await sidebarCommands(page)).toEqual(["Sidebar: Full sidebar", "Sidebar: Icons and labels", "Sidebar: Undock (float over the page)"]);
    await page.keyboard.press("Escape");
    await runCommand(page, "Sidebar: Full sidebar");
    await expectNavWidth(page, FULL);

    await runCommand(page, "Sidebar: Icons and labels");
    await expectNavWidth(page, LABELS);

    await runCommand(page, "Sidebar: Undock (float over the page)");
    await expect(panelEl(page)).toHaveAttribute("data-dock", "floating");
    await expect.poll(() => sidenavPanelWidth(page), { message: "sidebar panel width" }).toBe(0);
    expect(await isOpen(page), "Undock leaves the overlay closed").toBe(false);

    expect(await sidebarCommands(page)).toEqual(["Sidebar: Dock"]);
    await page.keyboard.press("Escape");
    await runCommand(page, "Sidebar: Dock");
    await expect(panelEl(page)).not.toHaveAttribute("data-dock", /.*/);
    await expectNavWidth(page, LABELS);
    expect(await navPrefs(page)).toMatchObject({ display: "rail", rail: "labels", dock: "docked" });
  });

  test("the help dialog lists mod+b once, as Collapse or expand the sidebar", async ({ page }) => {
    await loadHome(page);
    await page.getByRole("button", { name: "Help and keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Collapse or expand the sidebar", { exact: true })).toHaveCount(1);
    await expect(dialog.getByText("Collapse the sidebar", { exact: true })).toHaveCount(0);
    const row = dialog.getByRole("listitem").filter({ hasText: "Collapse or expand the sidebar" });
    await expect(row).toHaveCount(1);
    await expect(row.locator("kbd").last()).toHaveText(/^b$/i);
  });
});

test.describe("phone width, other tabs and the early chord", () => {
  test("at 375 × 812 there are no sidebar options or rails, mod+b changes nothing and Power K lists no sidebar command", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loadHome(page);
    const before = await navPrefs(page);
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer.getByRole("link", { name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sidebar options" })).toHaveCount(0);
    await expect(page.locator("[data-rail]")).toHaveCount(0);
    await page.getByRole("button", { name: "Close navigation" }).click();
    await expect(drawer).toBeHidden();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pressModB(page);
    await page.waitForTimeout(500);
    expect(await navPrefs(page), "mod+b leaves the stored preferences alone").toEqual(before);

    expect(await sidebarCommands(page)).toEqual([]);
  });

  test("a floating panel open at 1280 px is closed after the window narrows to 375 px and widens again", async ({ page }) => {
    await withPrefs(page, { dock: "floating" });
    await openFloating(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(panelEl(page)).toHaveAttribute("data-dock", "floating");
    await expect(panelEl(page)).not.toHaveAttribute("data-open", /.*/);
    await expect(panelEl(page)).toHaveAttribute("inert", "");
  });

  test("a view change and an undock in one tab reach a second tab without a reload", async ({ page }) => {
    await loadHome(page);
    const other = await page.context().newPage();
    const otherErrors = collectErrors(other);
    await loadHome(other);
    await expectNavWidth(other, FULL, "second tab nav width at the start");

    await pickView(page, "Icons only");
    await expectNavWidth(other, ICONS, "second tab follows the view change");

    await undock(page);
    await expect(panelEl(other)).toHaveAttribute("data-dock", "floating");
    await expect.poll(() => sidenavPanelWidth(other), { message: "second tab sidebar panel width" }).toBe(0);
    expect(otherErrors.list(), "console errors in the second tab").toEqual([]);
    await other.close();
  });

  test("with Icons and labels stored, mod+b at the shell's hydration point logs no error and ends at the Full width", async ({ browser }) => {
    test.setTimeout(240_000);
    const { page, errors } = await earlyChordInGap(browser);
    await waitForAppHydrated(page);
    await page.waitForTimeout(1000);
    expect(errors.list(), "console errors and page errors").toEqual([]);
    await expectNavWidth(page, FULL);
    expect(await navPrefs(page)).toMatchObject({ display: "full", rail: "labels" });
    await page.context().close();
  });
});

// ---------------------------------------------------------------------------
// Early mod+b (the round 6 method: chunks delayed 800 ms, the press in the first task the toggle has a React fibre)

type ChordRecord = { fired: boolean; gaveUp: boolean; tries: number; workHydratedAtFire: boolean | "absent" };

/**
 * Arms `mod+b` presses from the first task in which `#tessera-nav-toggle` has a React fibre, every 80 ms until the
 * stored preference reads `display: "full"` (the press took effect), at most 200 presses. Unlike helpers-d
 * `armEarlyAction("chord")` it does not watch the toggle's label: with a rail stored, the label flips by itself
 * when the stored value arrives after hydration.
 */
async function armStoredChord(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const record: ChordRecord = { fired: false, gaveUp: false, tries: 0, workHydratedAtFire: "absent" };
    (window as unknown as { __chord?: ChordRecord }).__chord = record;
    const hydrated = (element: Element | null): boolean | "absent" => (element === null ? "absent" : Object.keys(element).some((key) => key.startsWith("__reactFiber")));
    const named = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.trim() ?? "";
    const apple = named !== "" && named.toLowerCase() !== "unknown" ? /mac/i.test(named) : /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
    const display = () => {
      try {
        return (JSON.parse(window.localStorage.getItem("tessera.nav.v1") ?? "{}") as { display?: string }).display;
      } catch {
        return undefined;
      }
    };
    const channel = new MessageChannel();
    const next = () => channel.port2.postMessage(0);
    const tick = () => {
      if (record.fired || record.gaveUp) return;
      if (performance.now() > 60_000) {
        record.gaveUp = true;
        return;
      }
      const target = document.getElementById("tessera-nav-toggle");
      if (target === null || hydrated(target) !== true) return next();
      record.tries += 1;
      const workAtPress = hydrated(document.querySelector('nav[aria-label="Work"]'));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: !apple, metaKey: apple, bubbles: true }));
      setTimeout(() => {
        if (display() === "full") {
          record.workHydratedAtFire = workAtPress;
          record.fired = true;
        } else if (record.tries >= 200) record.gaveUp = true;
        else next();
      }, 80);
    };
    channel.port1.onmessage = tick;
    next();
  });
}

/** Up to three fresh contexts until the early press lands while the "Work" nav has no fibre yet (round 6, `inWindow`). */
async function earlyChordInGap(browser: Browser): Promise<{ page: Page; errors: ErrorCollector }> {
  const attempts: string[] = [];
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = collectErrors(page);
      await page.goto("/");
      await page.evaluate(() => window.localStorage.setItem("tessera.nav.v1", JSON.stringify({ display: "rail", rail: "labels", dock: "docked" })));
      await armStoredChord(page);
      await delayChunks(page, 800);
      await page.goto("/");
      await expect.poll(() => page.evaluate(() => { const r = (window as unknown as { __chord?: ChordRecord }).__chord; return r !== undefined && (r.fired || r.gaveUp); }), { timeout: 45_000 }).toBe(true);
      const record = await page.evaluate(() => (window as unknown as { __chord?: ChordRecord }).__chord ?? null);
      const hit = record !== null && record.fired && record.workHydratedAtFire !== true;
      attempts.push(`attempt ${attempt}: ${JSON.stringify(record)}`);
      if (hit) return { page, errors };
      await waitForAppHydrated(page);
      expect(errors.list(), `console errors of attempt ${attempt}, which missed the gap`).toEqual([]);
      await context.close();
    }
  } finally {
    test.info().annotations.push({ type: "early window", description: attempts.join("; ") });
  }
  throw new Error(`the early mod+b landed in the gap in none of 3 attempts: ${attempts.join("; ")}`);
}
