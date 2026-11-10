import type { Locator, Page } from "@playwright/test";
import { createProjectViaMcp, expect, mcp, openWorkItems, test, waitForDialog } from "./fixtures";
import { horizontalOverflow, inboxRows } from "./helpers-b";
import { strictHitBoxMisses } from "./helpers-c";
import { hitAreaMisses, hitAreaRects, lineCount, searchAddonBoxMisses, substringVisible } from "./helpers-d";

/**
 * Browser checks for the features of fix round 5 (2026-10-23). The features
 * have landed, so every test here runs; none is marked fixme. Each test uses
 * its own MCP client name (decision 51 coalesces one agent's notifications on
 * one item for 10 minutes, and scripts/mcp-call.ts defaults to
 * `mcp:p3-acceptance`). Client names avoid form-field words ("name", "label"):
 * the name shows as an avatar label and breaks `getByLabel("Name")` in other specs.
 *
 *   a  assigned inbox rows   decisions 50 and 51: an agent's create with assignees notifies the assignee
 *   b  home Since rows       at 375 the key survives a long agent name and the row has at most two lines
 *   c  coarse tabs, search   touch option A: project tab areas tile edge to edge, the search field owns its box
 *   d  coarse top-bar heading touch option A: the sidebar toggle and the brand areas do not overlap
 *
 * Coarse pointer means the context option pair `hasTouch` + `isMobile`, which makes
 * `(pointer: coarse)` match; each coarse test asserts that first.
 */

type Actor = { id: string; kind: string; name: string };
type NotificationRow = { kind: string; work_item_key: string | null; event_count: number };

/** The id of the built-in user actor, the one the inbox belongs to. */
async function userActorId(): Promise<string> {
  const actors = await mcp<{ items: Actor[] }>("list_actors");
  const user = actors.items.find((actor) => actor.kind === "user");
  expect(user, "the built-in user actor").toBeDefined();
  return user!.id;
}

/** Asserts the page is a touch device for CSS: `(pointer: coarse)` and no hover. */
async function expectCoarsePointer(page: Page): Promise<void> {
  const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  expect(coarse, "(pointer: coarse) matches").toBe(true);
}

/**
 * Waits until a control's box has not moved for ten frames. Since Astryx 0.7.5 the sidebar's rail collapses and
 * expands with a slide, and a hit area measured while the top bar is still sliding is not the resting one.
 */
async function settled(locator: Locator): Promise<void> {
  await locator.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let last = "";
        let still = 0;
        const tick = () => {
          const box = element.getBoundingClientRect();
          const now = [box.x, box.y, box.width, box.height].join();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 10) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
}

test.describe("assigned notifications (decisions 50 and 51)", () => {
  test("an agent that creates a work item assigned to the user gives the user one 'assigned you' row", async ({ page }) => {
    const project = await createProjectViaMcp();
    const user = await userActorId();
    const client = "round5-assigns-user";
    await mcp("create_work_item", { project_id: project.id, name: "Assigned by an agent", assignee_ids: [user] }, client);
    const key = `${project.identifier}-1`;

    await page.goto("/inbox");
    const rows = inboxRows(page).filter({ hasText: key });
    await expect(rows, `inbox rows for ${key}`).toHaveCount(1);
    await expect(rows).toContainText("assigned you");
    // One event, so the row does not read "+N more".
    await expect(rows).not.toContainText(/\+\d+ more/);
  });

  test("the user creating an item assigned to an agent leaves the user's inbox empty of it and gives the agent one assigned row", async ({ page }) => {
    const project = await createProjectViaMcp();
    const user = await userActorId();
    const agent = "round5-assignee-agent";
    // First contact registers mcp:<agent> as an actor, so the dialog's Assignees control lists it.
    await mcp("list_actors", {}, agent);

    await openWorkItems(page, project.id);
    await page.getByRole("button", { name: "New work item" }).first().click();
    const dialog = await waitForDialog(page, "New work item");
    await dialog.getByLabel("Name").fill("Assigned by the user");
    // The trigger is a combobox up to 8 actors and a button (searchable popup) beyond that (AssigneeControl hasSearch), so accept both.
    const trigger = dialog.getByRole("combobox", { name: "Assignees" }).or(dialog.getByRole("button", { name: "Assignees" }));
    await trigger.click();
    await page.getByRole("option", { name: new RegExp(agent) }).click();
    // Close the selector's popup with its trigger: with more than 8 actors the searchable popup opens inline and
    // covers the Name field and the heading, and Escape would offer to save a draft.
    await trigger.click();
    await expect(page.getByRole("option", { name: new RegExp(agent) })).toBeHidden();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Assigned by the user", { exact: true }).first()).toBeVisible();
    const key = `${project.identifier}-1`;

    // The agent's own inbox is the check that proves the feature: it was notified, once.
    await expect
      .poll(async () => {
        const listed = await mcp<{ items: NotificationRow[] }>("list_notifications", {}, agent);
        return listed.items.filter((row) => row.work_item_key === key).map((row) => row.kind);
      })
      .toEqual(["assigned"]);

    // A sentinel from another agent proves the inbox has rendered fresh data before the absence is asserted.
    const sentinel = "round5-sentinel";
    await mcp("create_work_item", { project_id: project.id, name: "Sentinel row", assignee_ids: [user] }, sentinel);
    await page.goto("/inbox");
    await expect(inboxRows(page).filter({ hasText: `${project.identifier}-2` })).toHaveCount(1);
    await expect(inboxRows(page).filter({ hasText: key }), `inbox rows for ${key}`).toHaveCount(0);
  });
});

test.describe("home since rows with a long agent name", () => {
  test("at 375 px the work item key is painted and the row has at most two lines", async ({ page }) => {
    const project = await createProjectViaMcp();
    const client = "round5-since-very-long-agent-handle-for-the-phone-home";
    const title = "A work item title that is long enough to need the second line of the Since row on a phone, and a little more besides";
    await mcp("create_work_item", { project_id: project.id, name: title }, client);
    const key = `${project.identifier}-1`;

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Since you were last here" }).first()).toBeVisible();
    const label = page.locator(".tessera-home-since-label:visible").filter({ hasText: key });
    await expect(label).toHaveCount(1);

    expect(await substringVisible(label, key), `the characters of ${key} are painted, not clipped`).toBe(true);
    // The key is its own no-wrap run, so it never breaks at its hyphen across the two lines.
    const keyRun = label.locator(".astryx-text", { hasText: new RegExp(`^${key}$`) });
    expect(await keyRun.evaluate((run) => run.getClientRects().length), `${key} stays on one line`).toBe(1);
    const lines = await lineCount(label);
    expect(lines.fits(2), `label height ${lines.height.toFixed(1)} px vs line height ${lines.lineHeight.toFixed(1)} px`).toBe(true);
    // The full agent name stays in the DOM (CSS only shortens it, Astryx Text takes no title), so the
    // row link's accessible name, computed from its content, still carries the whole visible text.
    await expect(label.locator(".tessera-home-since-actor")).toContainText(client);
    await expect(page.getByRole("link", { name: new RegExp(`${client}.*${key}`) })).toHaveCount(1);
    expect(await horizontalOverflow(page), "horizontal overflow in px").toBeLessThanOrEqual(1);
  });
});

test.describe("coarse pointer project tabs and search (touch option A)", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const width of [1440, 1280]) {
    test(`at ${width} px neighbouring project tab areas tile edge to edge and every tab hits strictly`, async ({ page }) => {
      const project = await createProjectViaMcp();
      await page.setViewportSize({ width, height: 900 });
      await openWorkItems(page, project.id);
      await expectCoarsePointer(page);

      // :visible, because the strip also holds hidden tab copies that have no layout box (7 more at HEAD).
      const tabs = page.locator(".tessera-project-tabs .astryx-tab:visible");
      const count = await tabs.count();
      expect(count, "visible project tabs").toBeGreaterThanOrEqual(5);

      // Exact ::before rectangles in tab order (edges from the resolved insets, see hitAreaRects): no overlap (gap >= 0 within 0.005 px, a third of one layout unit) and no dead strip (gap <= 0.5 px).
      const rects = (await hitAreaRects(tabs)).sort((a, b) => a.left - b.left);
      for (let index = 1; index < rects.length; index += 1) {
        const gap = rects[index]!.left - rects[index - 1]!.right;
        expect(gap, `gap between tab ${index} and tab ${index + 1} at ${width} px (${rects[index - 1]!.source} rect)`).toBeGreaterThanOrEqual(-0.005);
        expect(gap, `gap between tab ${index} and tab ${index + 1} at ${width} px`).toBeLessThanOrEqual(0.5);
      }

      for (const [index, rect] of rects.entries()) {
        expect(rect.bottom - rect.top, `tab ${index + 1} area height at ${width} px`).toBeGreaterThanOrEqual(43.5);
      }

      // Each tab owns its own area: the centre and the corners one pixel inside it hit the tab. The
      // centred 44 box of strictHitBoxMisses does not fit here, the area grows upward from the hairline.
      for (let index = 0; index < count; index += 1) {
        const tab = tabs.nth(index);
        const name = (await tab.getAttribute("aria-label")) ?? `tab ${index + 1}`;
        await expect(tab, name).toBeVisible();
        expect(await hitAreaMisses(tab), `${name} at ${width} px`).toEqual([]);
      }
    });

    test(`at ${width} px the top-bar search owns its hit box, including around the shortcut chip`, async ({ page }) => {
      const project = await createProjectViaMcp();
      await page.setViewportSize({ width, height: 900 });
      await openWorkItems(page, project.id);
      await expectCoarsePointer(page);

      const input = page.locator(".tessera-topbar-search .astryx-text-input");
      await expect(input).toBeVisible();
      expect(await strictHitBoxMisses(input), `search field at ${width} px`).toEqual([]);
      // A 44 box centred on the chip (62x28, no area of its own) belongs to the field, not the bar behind it.
      expect(await searchAddonBoxMisses(page), `44 px box around the shortcut chip at ${width} px`).toEqual([]);
    });
  }
});

test.describe("coarse pointer top-bar heading (touch option A)", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const scale of [1, 2]) {
    test.describe(`device pixel ratio ${scale}`, () => {
      test.use({ deviceScaleFactor: scale });

      test(`at 768 px the sidebar toggle and the brand areas do not overlap, docked and collapsed`, async ({ page }) => {
        // A fresh Since row (visiting Home moves the anchor, so rows from earlier tests may be gone) gives Home its
        // heaviest content. This test checks the layout. Its click lands once the top bar has hydrated, which can be
        // before the streamed sidebar has, so it may toggle in the early gap (at round 5 it raised error 418 there,
        // fixed in round 6); round6.spec.ts is the test that forces the gap.
        const project = await createProjectViaMcp();
        await mcp("create_work_item", { project_id: project.id, name: `Toggle row ${scale}` }, `round5-toggle-agent-${scale}`);
        await page.setViewportSize({ width: 768, height: 900 });
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible();
        await expectCoarsePointer(page);

        const brand = page.locator(".tessera-topbar-heading a.astryx-top-nav-heading");
        // The docked toggle is "Close sidebar" while the Full sidebar shows and "Open sidebar" on the rail (TopBar.tsx).
        for (const state of ["Close sidebar", "Open sidebar"]) {
          const toggle = page.getByRole("button", { name: state, exact: true });
          await expect(toggle, state).toBeVisible();
          await settled(toggle);
          await settled(brand);
          const [collapse] = await hitAreaRects(toggle);
          const [heading] = await hitAreaRects(brand);
          expect(collapse, `${state} area`).toBeDefined();
          expect(heading, "brand area").toBeDefined();
          // Exact numbers, no epsilon: the toggle's area ends where the brand's begins, or earlier.
          expect(collapse!.right, `${state} area right edge vs brand area left edge`).toBeLessThanOrEqual(heading!.left);
          expect(await strictHitBoxMisses(toggle), state).toEqual([]);
          expect(await strictHitBoxMisses(brand), `brand next to ${state}`).toEqual([]);
          if (state === "Close sidebar") await toggle.click();
        }
      });
    });
  }
});
