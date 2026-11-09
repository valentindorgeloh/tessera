import { createProjectViaMcp, expect, isoDay, mcp, openLayout, test, waitForDialog } from "./fixtures";
import { centreOf, hitBoxMisses, horizontalOverflow, touchDrag, treeOrder } from "./helpers-b";

/**
 * Touch coverage at 375 px (fix round 2026-10-23, lane e2e-b). Every test runs
 * in a context with `hasTouch` and `isMobile`, so the page sees a coarse
 * pointer, `tap()` sends real touch events, and the touch rules of docs/contracts/ui.md
 * ("Theme", option A: drawn size kept, 44x44 hit area) apply.
 *
 * The page-tree drag uses `Input.dispatchTouchEvent` through the Chrome
 * DevTools Protocol (helpers-b.ts `touchDrag`): real touch events with
 * `pointerType: "touch"`, so `touch-action: none` on the grip is exercised too.
 */

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

type Item = { id: string; key: string };

test("a calendar chip taps open the peek, and its Target date moves the chip to the new day", async ({ page }) => {
  const project = await createProjectViaMcp();
  // The 10th and 12th of the current month, so both cells are inside the month grid whatever today is.
  const month = isoDay(0).slice(0, 8);
  const item = await mcp<Item>("create_work_item", { project_id: project.id, name: "Tap to move", target_date: `${month}10` });
  await openLayout(page, project.id, "calendar");

  const days = page.locator(".tessera-cal-day:not([data-outside])");
  const chip = (index: number) => days.nth(index).getByRole("button", { name: new RegExp(`^${project.identifier}-1 Tap to move`) });
  await expect(chip(9)).toBeVisible();
  // On touch the chip's Move control cannot be used (no hover to reveal it): a tap opens the item. The control may stay in the tree, invisible and not hittable.
  const move = days.nth(9).getByRole("button", { name: /^Move / });
  if ((await move.count()) > 0) expect(await move.first().evaluate((element) => getComputedStyle(element).pointerEvents), "Move control on touch").toBe("none");
  await chip(9).tap();

  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Tap to move" })).toBeVisible();

  // The date field is a DateInput: its wrapper takes the tap and opens the picker (the input under it is covered).
  const field = peek.getByPlaceholder(/(target|due) date/i);
  await expect(field).toHaveValue(/\b10\b/);
  await field.locator("xpath=ancestor::*[contains(@class,'astryx-date-input')][1]").tap({ position: { x: 40, y: 12 } });
  const picker = await waitForDialog(page, "Choose date");
  await picker.getByRole("button", { name: / 12, \d{4}$/ }).tap();
  await expect(picker).toBeHidden();
  await expect(field).toHaveValue(/\b12\b/);

  // No reload: the chip is on the 12th and gone from the 10th (the peek covers the grid, so the cells are counted, not looked at).
  await expect(chip(11)).toHaveCount(1);
  await expect(chip(9)).toHaveCount(0);
  await expect.poll(async () => (await mcp<{ target_date: string }>("get_work_item", { work_item_id: item.id })).target_date, { timeout: 15_000 }).toBe(`${month}12`);
});

test("a finger drag on a page-tree grip reorders the pages and the order survives a reload", async ({ page }) => {
  const project = await createProjectViaMcp();
  const names = ["Alpha page", "Beta page", "Gamma page"];
  for (const name of names) await mcp("create_page", { project_id: project.id, name });
  await page.goto(`/projects/${project.id}/pages`);
  await expect(page.getByRole("treeitem").filter({ hasText: "Gamma page" }).first()).toBeVisible();
  expect(await treeOrder(page, names)).toEqual(names);

  // On a touch screen the grip is always shown; the rest of the row still scrolls the page.
  const grip = page.getByRole("treeitem").filter({ hasText: "Gamma page" }).first().locator(".tessera-row-grip");
  await expect(grip).toBeVisible();
  expect(await grip.evaluate((element) => getComputedStyle(element).touchAction), "touch-action on the grip").toBe("none");
  const from = await centreOf(grip);
  const alpha = (await page.getByRole("treeitem").filter({ hasText: "Alpha page" }).first().boundingBox())!;
  // Drop on the upper half of the first row: Gamma lands before Alpha.
  await touchDrag(page, from, { x: from.x, y: alpha.y + 4 });

  const order = async () => {
    const listed = await mcp<{ items?: { name: string }[]; result?: { name: string }[] }>("list_pages", { project_id: project.id });
    return (listed.items ?? listed.result ?? []).map((row) => row.name);
  };
  await expect.poll(order, { timeout: 15_000 }).toEqual(["Gamma page", "Alpha page", "Beta page"]);
  expect(await treeOrder(page, names)).toEqual(["Gamma page", "Alpha page", "Beta page"]);

  await page.reload();
  await expect(page.getByRole("treeitem").filter({ hasText: "Gamma page" }).first()).toBeVisible();
  expect(await treeOrder(page, names)).toEqual(["Gamma page", "Alpha page", "Beta page"]);
});

test("/drafts at 375 px: no sideways scroll, and every control's 44x44 box hits it", async ({ page }) => {
  await mcp("create_draft", { name: "Touch draft one" });
  await mcp("create_draft", { name: "Touch draft two" });
  await page.goto("/drafts");
  const list = page.getByRole("list", { name: "Drafts" });
  await expect(list.getByRole("listitem").filter({ hasText: "Touch draft one" })).toBeVisible();
  await expect(list.getByRole("listitem").filter({ hasText: "Touch draft two" })).toBeVisible();
  expect(await horizontalOverflow(page), "horizontal overflow in px").toBeLessThanOrEqual(1);

  // The screen itself (header button, rows, row menus) hits strictly; the top bar's controls sit 4 px apart and may share corners.
  // While the route streams in, a hidden copy of the screen sits beside the live one (field guide): count only the visible one.
  const screen = page.locator(".tessera-drafts:visible");
  await expect(screen).toHaveCount(1);
  await expect(screen).toBeVisible();
  expect(await hitBoxMisses(screen), "drafts controls whose 44x44 box misses them").toEqual([]);
  expect(await hitBoxMisses(page.getByRole("banner")), "top bar controls whose 44x44 box misses them").toEqual([]);

  // The New draft dialog: its fields and buttons keep the same hit box.
  await page.getByRole("button", { name: "New draft" }).first().tap();
  const dialog = await waitForDialog(page, "New draft");
  expect(await hitBoxMisses(dialog), "New draft dialog controls whose 44x44 box misses them").toEqual([]);
});

// Astryx 0.7.9-0.7.11 paints a pressed Button's tint on the button's own `::before`, the pseudo-element Tessera's 44px
// hit area also uses (catppuccinTheme.ts, shell.css). While a finger is down the tint must be the button's box, not the
// hit area; at rest the hit area is 44px. A real touch through CDP, so Astryx's press controller writes its press.
test("a pressed button's tint is its own box and its resting hit area is 44px", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Help and keyboard shortcuts" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box, "the button has a box").not.toBeNull();
  const pseudo = () =>
    button.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return { press: element.getAttribute("data-astryx-press"), width: parseFloat(style.width), height: parseFloat(style.height) };
    });

  const resting = await pseudo();
  expect(resting.press, "no press at rest").toBeNull();
  expect([resting.width, resting.height], "resting hit area").toEqual([44, 44]);

  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }] });
    // Astryx waits 150 ms before it paints a press.
    await expect.poll(async () => (await pseudo()).press, { timeout: 5_000 }).toBe("on");
    const pressed = await pseudo();
    expect([pressed.width, pressed.height], "pressed tint box").toEqual([box!.width, box!.height]);
  } finally {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
});
