/**
 * Helpers for the coverage-dialogs, coverage-touch and round-features specs
 * (fix round 2026-10-23, lane e2e-b). They import from fixtures.ts and never
 * change it. Nothing here reads the database directly: data comes over MCP.
 */
import type { Locator, Page } from "@playwright/test";
import { createProjectViaMcp, expect, mcp, type CreatedProject } from "./fixtures";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export type IntakeFixture = {
  project: CreatedProject;
  /** The open intake item the test marks as a duplicate. */
  pending: { id: string; workItemId: string; key: string; name: string };
  /** An ordinary work item of the same project: the original. */
  original: { id: string; key: string; name: string };
};

/**
 * A project with Intake on, one ordinary work item (the original) and one
 * pending intake item. Intake is on without `agent_intake_required`, so the
 * ordinary item is created straight on the board.
 */
export async function createIntakeFixture(): Promise<IntakeFixture> {
  const project = await createProjectViaMcp();
  await mcp("update_project_features", { project_id: project.id, intake_enabled: true });
  const original = await mcp<{ id: string; key: string }>("create_work_item", { project_id: project.id, name: "Original report" });
  const created = await mcp<{ id: string; work_item_id: string; key: string }>("create_intake_item", { project_id: project.id, name: "Incoming report" });
  return {
    project,
    pending: { id: created.id, workItemId: created.work_item_id, key: created.key, name: "Incoming report" },
    original: { id: original.id, key: original.key, name: "Original report" },
  };
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

/**
 * Presses Tab (then Shift+Tab) `presses` times each way and fails when focus
 * ever rests on an element outside `dialog`. A native modal dialog sends focus
 * to the browser chrome once per lap, which shows as `document.body`; that is
 * allowed and is not counted as "outside". At least half of the stops must be
 * inside the dialog, so a dialog with nothing focusable cannot pass.
 */
export async function expectTabStaysInside(page: Page, dialog: Locator, presses = 24): Promise<void> {
  for (const key of ["Tab", "Shift+Tab"]) {
    const stops: string[] = [];
    for (let index = 0; index < presses; index += 1) {
      await page.keyboard.press(key);
      stops.push(
        await dialog.evaluate((element) => {
          const active = document.activeElement;
          if (active === null || active === document.body) return "chrome";
          return element.contains(active) ? "inside" : `outside: ${active.tagName.toLowerCase()} ${(active.getAttribute("aria-label") ?? active.textContent ?? "").trim().slice(0, 40)}`;
        }),
      );
    }
    const outside = stops.filter((stop) => stop.startsWith("outside"));
    expect(outside, `${key} left the dialog`).toEqual([]);
    expect(stops.filter((stop) => stop === "inside").length, `${key} stops inside the dialog`).toBeGreaterThanOrEqual(presses / 2);
  }
}

/**
 * The modifier the page itself reads for `mod+...` hotkeys: Meta on an Apple
 * platform, Control elsewhere. It repeats Astryx's `isApplePlatform` (client
 * hints platform first, `navigator.platform` as the fallback) in the page, so
 * it follows the browser the test drives. Playwright's own `ControlOrMeta`
 * follows the HOST operating system instead: the "Desktop Chrome" device
 * descriptor sends a Windows user agent, so on a macOS host `ControlOrMeta` is
 * Meta while the page expects Control, and `mod+k` does not fire.
 */
export async function modifierKey(page: Page): Promise<"Meta" | "Control"> {
  const apple = await page.evaluate(() => {
    const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const named = typeof data?.platform === "string" ? data.platform.trim() : "";
    if (named !== "" && named.toLowerCase() !== "unknown") return /mac/i.test(named);
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
  });
  return apple ? "Meta" : "Control";
}

/**
 * Waits until no Astryx tooltip is open. A tooltip belongs to the control that
 * had keyboard focus; while it is open the first Escape dismisses it and only
 * the second closes the dialog, which is the intended layered dismissal. A test
 * that tabbed across icon buttons waits here before it presses Escape.
 */
export async function waitForTooltipsClosed(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.querySelectorAll(".astryx-tooltip:popover-open").length), { timeout: 5_000 }).toBe(0);
}

// ---------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------

/** Where a finger goes down and where it lifts, in viewport pixels. */
export type TouchPoint = { x: number; y: number };

/**
 * A single-finger drag through the Chrome DevTools Protocol
 * (`Input.dispatchTouchEvent`): real touch events, so the page sees
 * `pointerType: "touch"` pointer events, `touch-action` applies, and a finger
 * that starts outside a `touch-action: none` element scrolls instead of dragging.
 */
export async function touchDrag(page: Page, from: TouchPoint, to: TouchPoint, { steps = 14, stepMs = 30 }: { steps?: number; stepMs?: number } = {}): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] });
      await page.waitForTimeout(stepMs);
    }
    // The landing slot settles on the last move before the finger lifts.
    await page.waitForTimeout(150);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/** The centre of a locator's box, after scrolling it into view. */
export async function centreOf(locator: Locator): Promise<TouchPoint> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, "locator has a box on screen").not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/**
 * Touch option A (docs/contracts/ui.md "Theme"): every control keeps its drawn
 * size, and a 44x44 box centred on it must still hit it. For each visible control
 * under `root` this probes the centre and the four corners of that box with
 * `elementFromPoint`, and returns one line per control that misses (empty when all hit).
 *
 * The hit must land on the control or inside it (a `::before` hit area counts
 * as the control), or on the wrapper of a text field that holds the control.
 * The corner points sit 2 px inside the 44 px box, so a 1 px dialog border or
 * a rounded pixel does not count as a miss. Controls in the shell's banner sit
 * 4 px apart, so their boxes overlap by design: there a corner may land on a
 * neighbouring control, but never on dead space. Points outside the viewport
 * are skipped.
 */
export async function hitBoxMisses(root: Locator): Promise<string[]> {
  return root.evaluate((container) => {
    const CONTROL =
      'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="combobox"], [role="switch"], [role="checkbox"], [role="tab"], [role="menuitem"], [data-astryx-pressable]';
    const FIELD = 'label, [class*="astryx-text-input"], [class*="astryx-text-area"], [class*="astryx-date-input"], [class*="astryx-select"]';
    const misses: string[] = [];
    const scope: Element[] = container.matches(CONTROL) ? [container, ...container.querySelectorAll(CONTROL)] : [...container.querySelectorAll(CONTROL)];
    for (const element of scope) {
      if (element.closest('[inert], [aria-hidden="true"], [hidden]') !== null) continue;
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      // A 1 px skip link or a visually hidden input is not a control a finger meets.
      if (rect.width < 8 || rect.height < 8) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.pointerEvents === "none") continue;
      const shared = element.closest('[role="banner"]') !== null;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const points: [string, number, number][] = [
        ["centre", cx, cy],
        ["top-left", cx - 20, cy - 20],
        ["top-right", cx + 20, cy - 20],
        ["bottom-left", cx - 20, cy + 20],
        ["bottom-right", cx + 20, cy + 20],
      ];
      const missed: string[] = [];
      for (const [name, x, y] of points) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit === null) {
          missed.push(name);
          continue;
        }
        if (element === hit || element.contains(hit)) continue;
        // A text field's wrapper sits over its <input> and hands the tap on: the wrapper is the field.
        const wrapper = hit.closest(FIELD);
        if (wrapper !== null && wrapper.contains(element)) continue;
        const other = hit.closest(CONTROL);
        if (shared && name !== "centre" && other !== null) continue;
        missed.push(`${name} -> ${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === "string" ? `.${hit.className.split(" ")[0]}` : ""}`);
      }
      if (missed.length > 0) {
        const label = (element.getAttribute("aria-label") ?? element.textContent ?? element.getAttribute("placeholder") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        misses.push(`${element.tagName.toLowerCase()} "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}: ${missed.join(", ")}`);
      }
    }
    return misses;
  });
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Horizontal page overflow in px (0 when the page does not scroll sideways). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** The inbox's notification rows. */
export function inboxRows(page: Page): Locator {
  return page.getByRole("list", { name: "Notifications" }).getByRole("listitem");
}

/** The page tree's row names ordered by their vertical position, for `names` that all show in the tree. */
export async function treeOrder(page: Page, names: readonly string[]): Promise<string[]> {
  const tops = await Promise.all(
    names.map(async (name) => {
      const box = await page.getByRole("treeitem").filter({ hasText: name }).first().boundingBox();
      expect(box, `tree row ${name} is on screen`).not.toBeNull();
      return { name, top: box!.y };
    }),
  );
  return tops.sort((a, b) => a.top - b.top).map((row) => row.name);
}
