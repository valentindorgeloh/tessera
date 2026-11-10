import { createProjectViaMcp, expect, mcp, openWorkItems, test } from "./fixtures";
import { waitForAppHydrated } from "./helpers-d";

/**
 * Accessibility and small adoptions of Astryx 0.7.11 (docs/field-guide/astryx-0.7.md):
 * - the folded project tabs open their tooltip on an arrow key without `focusTrigger="always"`;
 * - the version history panes are ScrollableAreas (a Tab stop while they overflow, arrow keys scroll);
 * - a banner that the person's action brings in slides in (Astryx's entry animation, motion on) and is
 *   announced from the handler; a banner that loaded with the page is neither;
 * - the page body speaks its save status through Astryx's live region, not an aria-live line of its own.
 * Astryx's polite live region is `[data-astryx-live-region="polite"]`; it holds a message for about 2 s.
 */

const polite = (page: import("@playwright/test").Page) => page.locator('[data-astryx-live-region="polite"]');

test("an arrow key in the folded tab strip opens the next tab's tooltip", async ({ page }) => {
  const project = await createProjectViaMcp();
  await page.setViewportSize({ width: 768, height: 900 });
  await openWorkItems(page, project.id);
  const strip = page.locator(".tessera-project-tabs:visible");
  await expect(strip).toHaveCount(1);

  // A key press first, so the focus that follows counts as keyboard focus (:focus-visible).
  await page.keyboard.press("Shift");
  await strip.locator('[aria-label="Work items"]').first().focus();
  await page.keyboard.press("ArrowRight");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  expect(focused, "the arrow key moved focus to another tab").not.toBe("");
  expect(focused).not.toBe("Work items");
  await expect(page.getByRole("tooltip", { name: focused })).toBeVisible();
});

test("the version history panes scroll from the keyboard while they overflow", async ({ page }) => {
  test.setTimeout(180_000);
  const project = await createProjectViaMcp();
  const item = await mcp<{ id: string; key: string; description_version: number }>("create_work_item", { project_id: project.id, name: "Many versions" });
  let version = item.description_version ?? 0;
  for (let index = 1; index <= 7; index += 1) {
    // Writes of one actor within five minutes collapse into one version (work-items/versions.ts): each draft is its own agent.
    const written = await mcp<{ description_version: number }>(
      "update_work_item_description",
      {
        work_item_id: item.id,
        description_md: `Draft ${index}\n\n${"A line that makes the diff longer. ".repeat(index)}`,
        expected_description_version: version,
      },
      `drafter-${index}`,
    );
    version = written.description_version;
  }

  // A short window caps the panes at 70vh, so the list of eight versions overflows.
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto(`/browse/${item.key}`);
  await waitForAppHydrated(page);
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  const dialog = page.getByRole("dialog", { name: "Version history" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(700);

  const versions = dialog.getByRole("group", { name: "Versions" });
  const diff = dialog.getByRole("group", { name: "Selected version" });
  await expect(versions).toBeVisible();
  await expect(diff).toBeVisible();
  // The list overflows its capped height: it is a Tab stop, and a key scrolls it.
  const metrics = await versions.evaluate((node) => ({ scroll: node.scrollHeight, client: node.clientHeight, overflow: getComputedStyle(node).overflowY }));
  expect(metrics.scroll, "the list overflows").toBeGreaterThan(metrics.client);
  expect(["auto", "scroll"]).toContain(metrics.overflow);
  await expect(versions).toHaveAttribute("tabindex", "0");
  await versions.focus();
  await page.keyboard.press("PageDown");
  await expect.poll(() => versions.evaluate((node) => node.scrollTop), { message: "PageDown scrolled the list" }).toBeGreaterThan(0);
  // The panes still sit side by side, the list in its fixed column.
  const boxes = await Promise.all([versions.boundingBox(), diff.boundingBox()]);
  expect(boxes[0] && boxes[1] && boxes[0].x + boxes[0].width <= boxes[1].x + 1, "list left of the diff").toBe(true);
});

test.describe("banners that the person brings in", () => {
  // Astryx's entry animation and Tessera's keyframes are off under Reduce Motion (the suite default): this block needs them on.
  test.use({ reducedMotion: "no-preference" });

  test("turning daily backups on shows the stale warning sliding in and says it from the switch", async ({ page }) => {
    await page.goto("/settings/backups");
    await waitForAppHydrated(page);
    const toggle = page.getByRole("switch", { name: "Daily backups" });
    await expect(toggle).toBeVisible();
    const wasOn = await toggle.isChecked();
    const warning = page.getByText("No recent automatic backup", { exact: true });
    try {
      if (wasOn) {
        // Off first: a warning that loaded with the page is plain content, so it neither moves nor says anything.
        await expect(warning).toBeVisible();
        await toggle.click();
        await expect(warning).toHaveCount(0);
        await page.waitForTimeout(2500);
      }
      await toggle.click();
      await expect(warning).toBeVisible();
      await expect(polite(page)).toContainText("No recent automatic backup. The last automatic backup is older than 48 hours, or none exists yet.");
      // The banner plays Astryx's slideDown on its frame (the xstyle lands there): an animation that the plain Banner does not have, and no role of its own.
      const frame = page.locator(".astryx-banner-frame", { has: warning });
      const animation = await frame.evaluate((node) => {
        const style = getComputedStyle(node);
        return { name: style.animationName, duration: parseFloat(style.animationDuration), fill: style.animationFillMode, alerts: node.querySelectorAll('[role="alert"], [role="status"]').length };
      });
      expect(animation.name).not.toBe("none");
      expect(animation.duration, "a short slide, well under 250 ms").toBeLessThan(0.25);
      expect(animation.fill).toBe("backwards");
      expect(animation.alerts).toBe(0);
    } finally {
      // Leave the setting as the suite found it.
      if ((await toggle.isChecked()) !== wasOn) await toggle.click();
      await page.waitForTimeout(500);
    }
  });

  const warningFrame = (page: import("@playwright/test").Page) => page.locator(".astryx-banner-frame", { has: page.getByText("No recent automatic backup", { exact: true }) });
  const animationNameOf = (frame: import("@playwright/test").Locator) => frame.evaluate((node) => getComputedStyle(node).animationName);

  test("a stale warning that is page content stays still when the screen opens by a client navigation", async ({ page }) => {
    const before = (await mcp<{ auto_backup: boolean }>("get_workspace_settings")).auto_backup;
    try {
      await mcp("update_workspace_settings", { auto_backup: true });
      await page.goto("/settings/general");
      await waitForAppHydrated(page);
      // A link, not a load: the Backups screen mounts now, with the warning already in its content.
      await page.locator('[data-tab-value="backups"]').first().click();
      await expect(page.getByText("No recent automatic backup", { exact: true })).toBeVisible();
      expect(await animationNameOf(warningFrame(page))).toBe("none");
      await expect(polite(page)).not.toContainText("No recent automatic backup");
    } finally {
      await mcp("update_workspace_settings", { auto_backup: before });
    }
  });

  test("a warning the switch brought in does not slide again when its route is shown again", async ({ page }) => {
    const before = (await mcp<{ auto_backup: boolean }>("get_workspace_settings")).auto_backup;
    try {
      await mcp("update_workspace_settings", { auto_backup: false });
      await page.goto("/settings/backups");
      await waitForAppHydrated(page);
      await page.getByRole("switch", { name: "Daily backups" }).click();
      const warning = page.getByText("No recent automatic backup", { exact: true });
      await expect(warning).toBeVisible();
      expect(await animationNameOf(warningFrame(page)), "it slides in while the person is looking").not.toBe("none");
      // Past the slide (about 140 ms): its animationend has dropped the style.
      await page.waitForTimeout(700);
      expect(await animationNameOf(warningFrame(page))).toBe("none");
      await warningFrame(page).evaluate((node) => node.setAttribute("data-probe", "same-instance"));

      // Leave by a link and come back by a link: Next keeps the left route mounted (Activity) and shows it again.
      await page.locator('[data-tab-value="general"]').first().click();
      await page.waitForURL("**/settings/general");
      await expect(warning).toBeHidden();
      await page.locator('[data-tab-value="backups"]').first().click();
      await expect(warning).toBeVisible();
      await expect(warningFrame(page)).toHaveAttribute("data-probe", "same-instance");
      expect(await animationNameOf(warningFrame(page)), "shown again, it does not replay the slide").toBe("none");
    } finally {
      await mcp("update_workspace_settings", { auto_backup: before });
    }
  });
});

test("the page body speaks 'Saved' through Astryx's live region and keeps no aria-live line", async ({ page }) => {
  const project = await createProjectViaMcp();
  const created = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Status page" });
  await page.goto(`/pages/${created.id}`);
  await waitForAppHydrated(page);
  const body = page.locator(".tessera-page-body");
  await expect(body).toBeVisible();
  // The status line is plain text: neither it nor anything around it inside the page body is a live region of Tessera's making.
  const status = body.getByText("Saved", { exact: true });
  await expect(status).toBeVisible();
  const isLive = () => status.evaluate((node) => node.hasAttribute("aria-live") || node.closest("[aria-live], [role='status'], [role='alert']") !== null);
  expect(await isLive()).toBe(false);

  const editor = body.getByRole("textbox").first();
  await editor.click();
  await page.keyboard.type("Typed for the live region");
  await expect(body.getByText("Unsaved changes", { exact: true }).or(status)).toBeVisible();
  await expect(polite(page)).toContainText("Saved", { timeout: 15_000 });
  await expect(status).toBeVisible();
  expect(await isLive()).toBe(false);
});
