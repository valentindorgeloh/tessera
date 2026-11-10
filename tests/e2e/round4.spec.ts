import type { Locator, Page } from "@playwright/test";
import { createProjectViaMcp, expect, mcp, openWorkItems, quickAddItems, test } from "./fixtures";
import { stateId } from "./helpers-a";
import { horizontalOverflow, inboxRows, waitForTooltipsClosed } from "./helpers-b";
import { lastCharVisible, strictHitBoxMisses } from "./helpers-c";

/**
 * Browser checks for the features of fix round 4 (2026-10-23). The features
 * have landed, so every test here runs; none is marked fixme. Each test uses
 * its own MCP client name (decision 51 coalesces one agent's notifications on
 * one item for 10 minutes, and scripts/mcp-call.ts defaults to
 * `mcp:p3-acceptance`).
 *
 *   a  inbox wording     decision 51: "commented · +1 more" for a state change plus a comment
 *   b  project sections  a section menu at 375, folded tabs with tooltips at 768, labels at 1440
 *   c  project settings  seven tabs fit at 768 and 1024, a section menu at 375
 *   d  app header        touch option A: Help and Account hit boxes do not overlap at 375 and 360
 *   e  page links        decision 10: [[ does not offer the page being edited
 *   f  home              Since rows wrap to at most two lines at 375
 */

type Item = { id: string; key: string };

const SETTINGS_LABELS = ["General", "Features", "States", "Labels", "Estimates", "Agents", "Automations"];

/** The entries of an open menu, whichever menu item role Astryx gives them. */
function menuItems(menu: Locator): Locator {
  return menu.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]');
}

/**
 * The accessible name of each tab: the aria-label a project tab keeps when it is folded to its icon
 * (ProjectFrame sets it), else the label text. An Astryx tab has no aria-label in the settings strip and
 * repeats its label in textContent (a width-reserving copy), so "GeneralGeneral" is collapsed to "General".
 */
async function tabNames(strip: Locator): Promise<string[]> {
  return strip.locator(".astryx-tab").evaluateAll((tabs) =>
    tabs.map((tab) => {
      const label = tab.getAttribute("aria-label");
      if (label !== null && label.trim() !== "") return label.trim();
      const text = (tab.textContent ?? "").trim();
      const half = text.length / 2;
      return Number.isInteger(half) && half > 0 && text.slice(0, half) === text.slice(half) ? text.slice(0, half) : text;
    }),
  );
}

/** Opens the project route at a width: resize first, then load, so the layout starts from that width. */
async function openProjectAt(page: Page, projectId: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width < 600 ? 812 : 900 });
  await openWorkItems(page, projectId);
}

/**
 * Clicks each visible section menu button until the menu called `menuName` is open.
 * ASSUMPTION: the settings route has two section menu buttons at 375 (the project's and
 * the settings'), and only the menu name tells them apart.
 */
async function openSectionMenuNamed(page: Page, menuName: string): Promise<Locator> {
  const menu = page.getByRole("menu", { name: menuName });
  const buttons = page.locator(".tessera-section-menu-button:visible");
  await expect(buttons.first()).toBeVisible();
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    await buttons.nth(index).click();
    try {
      await menu.waitFor({ state: "visible", timeout: 1_500 });
      return menu;
    } catch {
      await page.keyboard.press("Escape");
    }
  }
  throw new Error(`no section menu button opens a menu named "${menuName}" (${count} buttons tried)`);
}

test.describe("inbox wording (decision 51)", () => {
  test("a state change and a comment by one agent make one row reading 'commented · +1 more', in either order", async ({ page }) => {
    // The user creates both items in the UI, so only the creator is subscribed (round-features (a) pattern).
    // 'commented 2 times' for two comments is covered by round-features.spec.ts and is not repeated here.
    const project = await createProjectViaMcp();
    await openWorkItems(page, project.id);
    await quickAddItems(page, ["State then comment", "Comment then state"]);
    const first = await mcp<Item>("get_work_item_by_key", { key: `${project.identifier}-1` });
    const second = await mcp<Item>("get_work_item_by_key", { key: `${project.identifier}-2` });
    const progress = await stateId(project.id, "In Progress");

    const stateFirst = "e2e-r4-state-first";
    await mcp("update_work_item", { work_item_id: first.id, state_id: progress }, stateFirst);
    await mcp("create_comment", { work_item_id: first.id, body_md: "Moved it along" }, stateFirst);

    const commentFirst = "e2e-r4-comment-first";
    await mcp("create_comment", { work_item_id: second.id, body_md: "Looking at this" }, commentFirst);
    await mcp("update_work_item", { work_item_id: second.id, state_id: progress }, commentFirst);

    await page.goto("/inbox");
    for (const key of [first.key, second.key]) {
      const rows = inboxRows(page).filter({ hasText: key });
      await expect(rows, `rows for ${key}`).toHaveCount(1);
      await expect(rows).toContainText("commented · +1 more");
      await expect(rows).not.toContainText("commented 2 times");
    }
  });

  test("at 375 px the whole phrase shows for an agent with a long client name", async ({ page }) => {
    const project = await createProjectViaMcp();
    await openWorkItems(page, project.id);
    await quickAddItems(page, ["Phone inbox row"]);
    const item = await mcp<Item>("get_work_item_by_key", { key: `${project.identifier}-1` });
    const progress = await stateId(project.id, "In Progress");

    const client = "e2e-r4-a-deliberately-long-agent-client-label-for-the-phone-inbox";
    await mcp("update_work_item", { work_item_id: item.id, state_id: progress }, client);
    await mcp("create_comment", { work_item_id: item.id, body_md: "Done" }, client);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/inbox");
    const row = inboxRows(page).filter({ hasText: item.key });
    await expect(row).toHaveCount(1);
    const phrase = row.getByText(/commented · \+1 more/).first();
    await expect(phrase).toBeVisible();
    expect(await lastCharVisible(phrase), "the last character of 'commented · +1 more' is painted, not clipped").toBe(true);
    expect(await horizontalOverflow(page), "horizontal overflow in px").toBeLessThanOrEqual(1);
  });
});

test.describe("project sections", () => {
  test("at 375 px one section menu button replaces the tab strip, and the keyboard drives it", async ({ page }) => {
    const project = await createProjectViaMcp();

    // The strip at 1440 names every section; the menu at 375 must list the same names.
    await openProjectAt(page, project.id, 1440);
    const wide = page.locator(".tessera-project-tabs:visible");
    await expect(wide).toHaveCount(1);
    const names = await tabNames(wide);
    expect(names.length, "sections in the 1440 strip").toBeGreaterThanOrEqual(5);

    await openProjectAt(page, project.id, 375);
    const button = page.locator(".tessera-project-bar .tessera-section-menu-button:visible");
    await expect(button).toHaveCount(1);
    await expect(page.locator(".tessera-project-tabs:visible")).toHaveCount(0);

    await button.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: `${project.name} pages` });
    await expect(menu).toBeVisible();
    await expect(menuItems(menu)).toHaveCount(names.length);
    for (const name of names) await expect(menu.getByRole("menuitem", { name, exact: true }), `menu entry ${name}`).toBeVisible();

    // ASSUMPTION: the menu opens with the current section (Work items) first, so one ArrowDown reaches Cycles.
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Cycles", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cycles$/);

    // Escape closes the menu and returns focus to the button.
    await expect(button).toHaveCount(1);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("at 768 px the folded tabs show their name in a tooltip on hover and on focus", async ({ page }) => {
    const project = await createProjectViaMcp();
    await openProjectAt(page, project.id, 768);
    const strip = page.locator(".tessera-project-tabs:visible");
    await expect(strip).toHaveCount(1);

    // Work items is the current tab; the others are folded to their icon.
    await strip.locator('[aria-label="Cycles"]').first().hover();
    await expect(page.getByRole("tooltip", { name: "Cycles" })).toBeVisible();
    await page.mouse.move(700, 600);
    await waitForTooltipsClosed(page);

    // A key press first, so the programmatic focus counts as keyboard focus (:focus-visible).
    await page.keyboard.press("Shift");
    await strip.locator('[aria-label="Modules"]').first().focus();
    await expect(page.getByRole("tooltip", { name: "Modules" })).toBeVisible();
  });

  test("at 1440 px every tab shows its full label", async ({ page }) => {
    const project = await createProjectViaMcp();
    await openProjectAt(page, project.id, 1440);
    const strip = page.locator(".tessera-project-tabs:visible");
    await expect(strip).toHaveCount(1);
    const names = await tabNames(strip);
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) await expect(strip.getByText(name, { exact: true }).first(), `label ${name}`).toBeVisible();
  });
});

test.describe("project settings tabs", () => {
  for (const width of [768, 1024]) {
    test(`at ${width} px all seven tabs are visible with no horizontal scroll in the strip`, async ({ page }) => {
      const project = await createProjectViaMcp();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/projects/${project.id}/settings/general`);
      const strip = page.locator("nav.tessera-settings-tabs--project:visible");
      await expect(strip).toHaveCount(1);

      const tabs = strip.locator(".astryx-tab");
      await expect(tabs).toHaveCount(SETTINGS_LABELS.length);
      const size = await strip.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
      expect(size.scroll, "strip scrollWidth vs clientWidth").toBeLessThanOrEqual(size.client);
      for (let index = 0; index < SETTINGS_LABELS.length; index += 1) await expect(tabs.nth(index), `tab ${SETTINGS_LABELS[index]}`).toBeVisible();
      expect(await tabNames(strip)).toEqual(SETTINGS_LABELS);

      // Every tab sits inside the strip's box: none is pushed out of sight.
      const outside = await strip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [...element.querySelectorAll(".astryx-tab")]
          .filter((tab) => {
            const rect = tab.getBoundingClientRect();
            return rect.left < box.left - 1 || rect.right > box.right + 1;
          })
          .map((tab) => (tab.getAttribute("aria-label") ?? tab.textContent ?? "").trim());
      });
      expect(outside, "tabs outside the strip").toEqual([]);
    });
  }

  test("at 375 px the 'Project settings' menu lists the seven tabs", async ({ page }) => {
    const project = await createProjectViaMcp();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/projects/${project.id}/settings/general`);
    // The settings route has no level-1 heading; the section menu button is the readiness signal.
    await expect(page.locator(".tessera-section-menu-button:visible").first()).toBeVisible();
    await expect(page.locator("nav.tessera-settings-tabs--project:visible")).toHaveCount(0);

    const menu = await openSectionMenuNamed(page, "Project settings");
    await expect(menuItems(menu)).toHaveCount(SETTINGS_LABELS.length);
    for (const label of SETTINGS_LABELS) await expect(menu.getByRole("menuitem", { name: label, exact: true }), `menu entry ${label}`).toBeVisible();
  });
});

test.describe("app header touch boxes", () => {
  for (const width of [375, 360]) {
    test(`at ${width} px Open navigation, Assistant, Help and Colour scheme each own their 44x44 box`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible();

      const controls = ["Open navigation", "Assistant", "Help and keyboard shortcuts", "Colour scheme"];
      for (const name of controls) {
        const control = page.getByRole("button", { name, exact: true });
        await expect(control, name).toBeVisible();
        // Centre and the four corners one pixel inside the 44x44 box must hit the control, not a neighbour.
        expect(await strictHitBoxMisses(control), `${name} at ${width} px`).toEqual([]);
      }
    });
  }
});

test.describe("page links (decision 10)", () => {
  test("typing [[ in a page does not offer that page itself", async ({ page }) => {
    const project = await createProjectViaMcp();
    const self = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Zeta self" });
    await mcp("create_page", { project_id: project.id, name: "Zeta other" });

    await page.goto(`/projects/${project.id}/pages/${self.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Zeta self" })).toBeVisible();
    // The editor mounts once the page has hydrated, a moment after the streamed title shows (decision 156);
    // until then the page's last textbox is the top bar's search field, which opens Power K on a key.
    const editor = page.getByRole("main").getByRole("textbox").last();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.click();
    await page.keyboard.type("[[Zeta");

    const options = page.getByRole("listbox", { name: "Pages" });
    await expect(options.getByRole("option", { name: /Zeta other/ })).toBeVisible();
    await expect(options.getByRole("option", { name: /Zeta self/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});

test.describe("home since rows", () => {
  test("at 375 px every Since row wraps to at most two lines and the long one wraps", async ({ page }) => {
    const project = await createProjectViaMcp();
    const client = "e2e-r4-since";
    const long =
      "Wrap this since row because the work item name is far longer than one phone line can hold, and then some more words follow so that the row would need three lines without a clamp";
    await mcp("create_work_item", { project_id: project.id, name: long }, client);
    await mcp("create_work_item", { project_id: project.id, name: "Short since row" }, client);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Since you were last here" }).first()).toBeVisible();
    const labels = page.locator(".tessera-home-since-label:visible");
    await expect(labels.first()).toBeVisible();
    expect(await labels.count(), "Since rows").toBeGreaterThanOrEqual(2);

    const lines = await labels.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        const fontSize = parseFloat(style.fontSize) || 16;
        const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
        return { text: (element.textContent ?? "").trim().slice(0, 60), lines: element.getBoundingClientRect().height / lineHeight };
      }),
    );
    const tooTall = lines.filter((row) => row.lines > 2.05).map((row) => `${row.text}: ${row.lines.toFixed(1)} lines`);
    expect(tooTall, "Since rows taller than two lines").toEqual([]);

    const wrapped = await labels.filter({ hasText: "Wrap this since row" }).evaluateAll((elements) => {
      const element = elements[0];
      if (element === undefined) return null;
      const style = getComputedStyle(element);
      const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.4;
      return element.getBoundingClientRect().height / lineHeight;
    });
    expect(wrapped, "the long row is on screen").not.toBeNull();
    expect(wrapped!, "the long row wraps").toBeGreaterThan(1.5);
    expect(await horizontalOverflow(page), "horizontal overflow in px").toBeLessThanOrEqual(1);
  });
});
