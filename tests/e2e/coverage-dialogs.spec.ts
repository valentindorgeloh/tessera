import { createProjectViaMcp, expect, mcp, openWorkItems, test, waitForDialog } from "./fixtures";
import { createIntakeFixture, expectTabStaysInside, hitBoxMisses, horizontalOverflow, modifierKey, waitForTooltipsClosed } from "./helpers-b";

/**
 * Dialog coverage (fix round 2026-10-23, lane e2e-b): Mark duplicate in Intake
 * at phone and tablet width, the "Save this draft?" path, keyboard focus in two
 * dialogs at 375 px (Tab stays inside, Escape returns focus to the opener), and
 * Power K from the page body.
 *
 * Astryx dialogs animate: waitForDialog lets the open animation finish. A native
 * modal dialog hands focus to the browser chrome once per Tab lap, which shows
 * as `document.body`; helpers-b.ts treats that as inside.
 */

for (const width of [375, 768]) {
  test.describe(`Mark duplicate at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`an intake item is marked as a duplicate of a work item, and the dialog fits the screen`, async ({ page }) => {
      const { project, pending, original } = await createIntakeFixture();
      await page.goto(`/projects/${project.id}/intake`);
      const list = page.getByRole("list", { name: "Intake items" });
      await list.getByRole("link", { name: new RegExp(pending.name) }).click();

      // The detail's own button opens the picker; at 375 px the detail replaces the list.
      await page.getByRole("button", { name: /^Mark duplicate/ }).click();
      const dialog = await waitForDialog(page, "Mark duplicate");

      // The dialog stays on screen and the page does not scroll sideways under it.
      const box = (await dialog.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x, "dialog left edge").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "dialog right edge").toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height, "dialog bottom edge").toBeLessThanOrEqual(viewport.height);
      expect(await horizontalOverflow(page), "horizontal overflow in px").toBeLessThanOrEqual(1);

      // The item itself is not offered, and Mark duplicate stays off until a row is picked.
      const confirm = dialog.getByRole("button", { name: "Mark duplicate", exact: true });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel("Search work items").fill("Original");
      const matches = dialog.getByRole("list", { name: "Matching work items" });
      await expect(matches.getByRole("listitem")).toHaveCount(1);
      await expect(matches).not.toContainText(pending.name);
      await matches.getByRole("listitem").filter({ hasText: original.key }).click();
      await expect(confirm).toBeEnabled();

      // Touch option A applies at phone width: every control in the dialog keeps a 44x44 hit box.
      if (width < 481) expect(await hitBoxMisses(dialog), "controls whose 44x44 box misses them").toEqual([]);

      await confirm.click();
      await expect(dialog).toBeHidden();
      await expect(list.getByRole("link", { name: new RegExp(pending.name) })).toHaveCount(0);

      const after = await mcp<{ status: string; duplicate_to: { id: string; key: string } | null }>("get_intake_item", { intake_item_id: pending.id });
      expect(after.status).toBe("duplicate");
      expect(after.duplicate_to?.id).toBe(original.id);
    });
  });
}

test.describe("Save this draft? at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("closing a dirty create dialog and saving lists the draft in Drafts", async ({ page }) => {
    const project = await createProjectViaMcp();
    await openWorkItems(page, project.id);
    await page.getByRole("button", { name: "New work item" }).first().click();
    const create = await waitForDialog(page, "New work item");
    await create.getByLabel("Name").fill("Phone-width draft");

    // Escape goes through the form's own close path, so a dirty form asks first.
    await page.keyboard.press("Escape");
    const save = await waitForDialog(page, "Save this draft?");
    await save.getByRole("button", { name: "Save draft" }).click();
    await expect(save).toBeHidden();
    await expect(create).toBeHidden();

    await page.goto("/drafts");
    const drafts = page.getByRole("list", { name: "Drafts" });
    const entry = drafts.getByRole("listitem").filter({ hasText: "Phone-width draft" });
    await expect(entry).toBeVisible();
    // The draft remembers the project it was started in.
    await expect(entry).toContainText(project.name);

    const listed = await mcp<{ items: { name: string; project_id: string | null }[] }>("list_drafts", { project_id: project.id });
    expect(listed.items.map((draft) => draft.name)).toContain("Phone-width draft");
  });

  // The nested Save dialog's remembered opener is the field inside the create dialog, which unmounts with
  // it: dialogs.tsx falls back to the last element focused outside any dialog (the "New work item" button).
  test("after Save draft, focus returns to the button that opened the create dialog", async ({ page }) => {
    const project = await createProjectViaMcp();
    await openWorkItems(page, project.id);
    const opener = page.getByRole("button", { name: "New work item" }).first();
    await opener.click();
    const create = await waitForDialog(page, "New work item");
    await create.getByLabel("Name").fill("Focus draft");
    await page.keyboard.press("Escape");
    const save = await waitForDialog(page, "Save this draft?");
    await save.getByRole("button", { name: "Save draft" }).click();
    await expect(save).toBeHidden();
    await expect(create).toBeHidden();
    await expect(opener).toBeFocused({ timeout: 3_000 });
  });
});

test.describe("dialog focus at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("New work item: Tab stays inside, Escape returns focus to the opener", async ({ page }) => {
    const project = await createProjectViaMcp();
    await openWorkItems(page, project.id);
    const opener = page.getByRole("button", { name: "New work item" }).first();
    await opener.click();
    const dialog = await waitForDialog(page, "New work item");

    await expectTabStaysInside(page, dialog);

    // Back to the first field, then two Tabs onto ordinary controls: an icon button with a tooltip would take the first Escape for the tooltip.
    await dialog.getByLabel("Name").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await waitForTooltipsClosed(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("Add link: Tab stays inside, Escape returns focus to the opener", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible();
    const opener = page.getByRole("button", { name: "Add link", exact: true });
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    const dialog = await waitForDialog(page, "Add link");

    await expectTabStaysInside(page, dialog);

    await dialog.getByPlaceholder("https:// or /path").focus();
    await page.keyboard.press("Tab");
    await waitForTooltipsClosed(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe("Power K", () => {
  test("mod+K from the page body opens the palette, and Escape closes it", async ({ page }) => {
    // The hotkey is `mod+k` (CommandBar.tsx): Meta on an Apple platform, Control elsewhere, as the page sees its own
    // platform. Playwright's `ControlOrMeta` follows the host OS instead and misses on a macOS host (see modifierKey).
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.evaluate(() => document.activeElement === document.body), "focus is on the page body").toBe(true);

    // The heading is server-rendered: the hotkey listener only exists once the shell hydrates, so press again until the palette opens (never while it is open: the shortcut toggles).
    const palette = page.getByRole("dialog", { name: "Command bar" });
    const shortcut = `${await modifierKey(page)}+k`;
    await expect(async () => {
      if (!(await palette.isVisible())) await page.keyboard.press(shortcut);
      await expect(palette).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });
    await expect(palette.getByRole("combobox")).toBeFocused();

    // The palette searches: the seeded project's first item shows up for its title.
    await page.keyboard.type("Accessibility");
    await expect(palette.getByRole("option", { name: /Accessibility audit/ })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });
});
