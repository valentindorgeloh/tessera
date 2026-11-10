import type { Locator, Page } from "@playwright/test";
import { dragByPointer, expect, mcp, test, uniqueIdentifier, workItemsUrl } from "./fixtures";
import { getItem } from "./helpers-a";
import { waitForAppHydrated } from "./helpers-d";
import { archiveProject, BOARD_GROUP_PAGE, MAX_RENDERED, OVERSCAN, ROW_PAGE, rowBoxes, seedPerfProject, showMoreLabel, VIRTUAL_LIST_MIN, visibleScroller, type RowBox } from "./helpers-p12";

/**
 * Virtual scrolling (decisions 135-137) on perf-seeded projects of 1 500 items
 * (`seedPerfProject`): the threshold, the server window, the flat and grouped
 * list, the keyboard on kept rows, selection, the board column window and its
 * drop rule (decision 114), the table's row semantics and the gantt window.
 *
 * Isolation (decision 123): each `describe` seeds its own project in
 * `beforeAll` (one for the list blocks, one for the board, one for table and
 * gantt, one below the threshold) and archives it in `afterAll`, because the
 * seeded items are assigned to the user and later specs read "Your work" on
 * the same data/e2e.db. Seeding takes about 5 s, so each `beforeAll` raises its
 * own timeout first. Every row count and row locator is scoped inside the
 * visible scroller: Next keeps left routes mounted, hidden.
 */

const SEED_ITEMS = 1500;

type Listed = { items: { id: string; key: string; start_date: string | null; target_date: string | null; state_id: string }[]; total: number };
type ListedGroups = { groups: { id: string; name: string; count: number; item_ids: string[] }[]; items: { id: string; key: string }[] };

/** The engine's first `limit` rows of a flat layout, in the order the page loads them. */
async function flatRows(projectId: string, layout: "list" | "table" | "gantt", limit: number): Promise<Listed["items"]> {
  const listed = await mcp<Listed>("list_work_items", { scope: { type: "project", project_id: projectId }, display: { layout, group_by: null }, limit });
  return listed.items;
}

/** Two frames and a short pause: the scroller store measures in a rAF and React commits after it. */
async function settle(page: Page, ms = 150): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForTimeout(ms);
}

async function setScrollTop(target: Locator, top: number, page: Page): Promise<number> {
  const applied = await target.evaluate((el, value) => {
    el.scrollTop = value;
    return el.scrollTop;
  }, top);
  await settle(page);
  return applied;
}

async function scrollTopOf(target: Locator): Promise<number> {
  return target.evaluate((el) => el.scrollTop);
}

async function openFlat(page: Page, projectId: string, layout: "list" | "table" | "gantt"): Promise<void> {
  await page.goto(workItemsUrl(projectId, { layout, group_by: null }));
  await expect(visibleScroller(page).locator(layout === "gantt" ? ".tessera-gantt" : "[data-list-ready]").first()).toBeVisible({ timeout: 30_000 });
  await waitForAppHydrated(page);
  await settle(page);
}

async function openGrouped(page: Page, projectId: string, layout: "list" | "board"): Promise<void> {
  await page.goto(workItemsUrl(projectId, { layout, group_by: "state" }));
  await expect(visibleScroller(page).locator("[data-list-ready]").first()).toBeVisible({ timeout: 30_000 });
  await waitForAppHydrated(page);
  await settle(page);
}

/** Clicks the flat footer's "Show 200 more" and waits for the next label. */
async function showMore(page: Page, loaded: number, total: number): Promise<void> {
  const scroller = visibleScroller(page);
  await scroller.getByRole("button", { name: showMoreLabel(loaded, total, ROW_PAGE), exact: true }).click();
  const next = loaded + ROW_PAGE;
  if (next < total) await expect(scroller.getByRole("button", { name: showMoreLabel(next, total, ROW_PAGE), exact: true })).toBeAttached({ timeout: 30_000 });
  await expect(scroller.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  await settle(page);
}

function expectNoOverlap(boxes: readonly RowBox[], what: string): void {
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i]!.top, `${what}: row ${i} starts at or below the previous row's bottom`).toBeGreaterThanOrEqual(boxes[i - 1]!.bottom - 1);
  }
}

/** The focused element's row: its window index, key text and box, and the scroller's box. */
type FocusState = { index: string | null; key: string; top: number; bottom: number; scrollerTop: number; scrollerBottom: number; inScroller: boolean };

async function focusState(page: Page): Promise<FocusState> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest<HTMLElement>("[data-index]") ?? null;
    const scroller = active?.closest<HTMLElement>(".tessera-wi-scroller") ?? null;
    const box = (row ?? active)?.getBoundingClientRect();
    const frame = scroller?.getBoundingClientRect();
    return {
      index: row?.getAttribute("data-index") ?? null,
      // Named, not read, when focus fell to the body (its text is the whole page).
      key: active === null || active === document.body ? "(document.body)" : (active.textContent ?? "").trim().slice(0, 80),
      top: box?.top ?? 0,
      bottom: box?.bottom ?? 0,
      scrollerTop: frame?.top ?? 0,
      scrollerBottom: frame?.bottom ?? 0,
      inScroller: scroller !== null,
    };
  });
}

/** The bottom edge of what covers the top of the scroller over a focused row: its group's sticky band, or the table head. */
async function coverBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const band = active?.closest(".tessera-wi-group")?.querySelector(".astryx-collapsible-trigger");
    if (band) return band.getBoundingClientRect().bottom;
    const head = active?.closest("table")?.querySelector("thead");
    if (head) return head.getBoundingClientRect().bottom;
    return active?.closest(".tessera-wi-scroller")?.getBoundingClientRect().top ?? 0;
  });
}

/** Wheels the visible scroller by `dy` with the mouse over it, then waits until it has moved. */
async function wheelAway(page: Page, dy = 3000): Promise<void> {
  const scroller = visibleScroller(page);
  const before = await scrollTopOf(scroller);
  const box = await scroller.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, dy);
  await expect.poll(() => scrollTopOf(scroller), { message: "the wheel scrolled the list" }).toBeGreaterThan(before + dy / 2);
  await settle(page, 300);
}

async function expectFocusedRowFullyVisible(page: Page, what: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await focusState(page);
        const cover = await coverBottom(page);
        return state.top >= cover - 1 && state.bottom <= state.scrollerBottom + 1;
      },
      { message: `${what}: the focused row is fully visible below the sticky band or header` },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

test.describe("below the threshold", () => {
  let project: { id: string; identifier: string };
  const items = Math.min(VIRTUAL_LIST_MIN, ROW_PAGE);

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    project = await seedPerfProject(uniqueIdentifier("VS"), items);
  });

  test.afterAll(async () => {
    if (project) await archiveProject(project.id);
  });

  test(`${items} rows (exactly the threshold): the list and the table render every row, with no window`, async ({ page }) => {
    await openFlat(page, project.id, "list");
    const scroller = visibleScroller(page);
    await expect(scroller.locator(".tessera-wi-row")).toHaveCount(items);
    await expect(scroller.locator(".tessera-virtual")).toHaveCount(0);

    await openFlat(page, project.id, "table");
    const table = visibleScroller(page);
    await expect(table.locator("tbody tr:not(.tessera-table-spacer)")).toHaveCount(items);
    await expect(table.locator(".tessera-virtual, .tessera-table-spacer")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

test.describe("list", () => {
  let project: { id: string; identifier: string };

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    project = await seedPerfProject(uniqueIdentifier("VL"), SEED_ITEMS);
  });

  test.afterAll(async () => {
    if (project) await archiveProject(project.id);
  });

  test.describe("server window", () => {
    test("the server HTML holds at most 20 list rows, and the page hydrates without a mismatch", async ({ page }) => {
      const url = workItemsUrl(project.id, { layout: "list", group_by: null });
      const response = await page.request.get(url);
      expect(response.ok()).toBe(true);
      const html = await response.text();
      const rows = html.match(/tessera-wi-row(?![\w-])/g)?.length ?? 0;
      expect(rows, "rows in the server HTML").toBeGreaterThan(0);
      expect(rows, "rows in the server HTML").toBeLessThanOrEqual(20);

      const messages: string[] = [];
      page.on("console", (message) => messages.push(message.text()));
      await openFlat(page, project.id, "list");
      await page.waitForTimeout(500);
      expect(
        messages.filter((text) => /hydrat/i.test(text)),
        "console messages about hydration",
      ).toEqual([]);
    });
  });

  test.describe("flat", () => {
    test("200 and then 400 loaded rows render at most 40, with the divider, print and a round trip through Inbox", async ({ page }) => {
      await openFlat(page, project.id, "list");
      const scroller = visibleScroller(page);
      const rows = scroller.locator(".tessera-wi-row");

      await test.step("200 loaded rows: windowed", async () => {
        await expect(scroller.locator(".tessera-virtual")).toHaveCount(1);
        expect(await rows.count()).toBeGreaterThan(0);
        expect(await rows.count()).toBeLessThanOrEqual(MAX_RENDERED.list);
      });

      await test.step("Show more: 400 loaded rows, still at most 40 rendered", async () => {
        await showMore(page, ROW_PAGE, SEED_ITEMS);
        expect(await rows.count()).toBeLessThanOrEqual(MAX_RENDERED.list);
      });

      await test.step("the bottom shows the footer", async () => {
        await setScrollTop(scroller, 1e7, page);
        const footer = scroller.getByRole("button", { name: showMoreLabel(2 * ROW_PAGE, SEED_ITEMS, ROW_PAGE), exact: true });
        await expect(footer).toBeInViewport();
        expect(showMoreLabel(2 * ROW_PAGE, SEED_ITEMS, ROW_PAGE)).toBe("Show 200 more (1100 hidden)");
      });

      await test.step("halfway down, the last rendered row keeps its divider", async () => {
        const height = await scroller.evaluate((el) => el.scrollHeight);
        await setScrollTop(scroller, height / 2, page);
        await expect(scroller.locator(".tessera-virtual[data-virtual-open-end]")).toHaveCount(1);
        const border = await scroller.locator(".tessera-virtual > li:last-child").evaluate((el) => parseFloat(getComputedStyle(el).borderBottomWidth));
        expect(border, "border-bottom-width of the last rendered row").toBeGreaterThan(0);
      });

      await test.step("print renders all 400 loaded rows; screen windows again", async () => {
        await page.emulateMedia({ media: "print" });
        await expect(rows).toHaveCount(2 * ROW_PAGE);
        await page.emulateMedia({ media: "screen" });
        await settle(page, 300);
        await expect.poll(() => rows.count()).toBeLessThanOrEqual(MAX_RENDERED.list);
      });

      await test.step("to Inbox through the sidebar and back: no overlap, and the rows at the scroll position are there", async () => {
        const height = await scroller.evaluate((el) => el.scrollHeight);
        await setScrollTop(scroller, height / 3, page);
        await page.locator('nav[aria-label="Work"]').getByRole("link", { name: /^Inbox/ }).click();
        await page.waitForURL(/\/inbox/);
        await expect(page.getByRole("heading", { name: "Inbox" }).first()).toBeVisible();
        await page.goBack();
        await page.waitForURL(/\/work-items/);
        await expect(visibleScroller(page).locator(".tessera-wi-row").first()).toBeVisible();
        await settle(page, 300);
        const back = visibleScroller(page);
        const boxes = await rowBoxes(back, ".tessera-wi-row");
        expect(boxes.length).toBeGreaterThan(0);
        expectNoOverlap(boxes, "after the round trip");
        const frame = (await back.boundingBox())!;
        const middle = frame.y + frame.height / 2;
        expect(
          boxes.some((box) => box.top <= middle && box.bottom >= middle),
          "a rendered row covers the middle of the scroller",
        ).toBe(true);
      });
    });
  });

  test.describe("grouped by state", () => {
    test("the sticky band at the top belongs to the group whose rows show under it", async ({ page }) => {
      await openGrouped(page, project.id, "list");
      const scroller = visibleScroller(page);
      const height = await scroller.evaluate((el) => el.scrollHeight);
      let compared = 0;
      for (const fraction of [0.08, 0.2, 0.33, 0.45, 0.58, 0.7, 0.85]) {
        await setScrollTop(scroller, height * fraction, page);
        const probe = await scroller.evaluate((el) => {
          const frame = el.getBoundingClientRect();
          const x = frame.left + frame.width / 2;
          const groups = [...el.querySelectorAll(".tessera-wi-group")];
          const band = document.elementFromPoint(x, frame.top + 4)?.closest(".astryx-collapsible-trigger") ?? null;
          if (band === null) return { band: -1, row: -1 };
          const below = document.elementFromPoint(x, band.getBoundingClientRect().bottom + 6);
          const row = below?.closest(".tessera-wi-row") ?? null;
          return {
            band: groups.indexOf(band.closest(".tessera-wi-group") as Element),
            row: row === null ? -1 : groups.indexOf(row.closest(".tessera-wi-group") as Element),
          };
        });
        expect(probe.band, `a sticky band at the top at ${Math.round(fraction * 100)}%`).toBeGreaterThanOrEqual(0);
        if (probe.row < 0) continue;
        compared += 1;
        expect(probe.row, `at ${Math.round(fraction * 100)}% the rows under the band belong to its group`).toBe(probe.band);
      }
      expect(compared, "positions where a row sat under the band").toBeGreaterThanOrEqual(4);
    });

    test("collapsing the first group moves the next band up with no gap and mounts no rows", async ({ page }) => {
      await openGrouped(page, project.id, "list");
      const scroller = visibleScroller(page);
      const groups = scroller.locator(".tessera-wi-group");
      await groups.nth(0).locator(".astryx-collapsible-trigger").click();
      await expect(groups.nth(0).locator(".tessera-wi-row")).toHaveCount(0);
      await settle(page, 400);
      const gap = await scroller.evaluate((el) => {
        const row = el.querySelector(".tessera-wi-row");
        const band = row?.closest(".tessera-wi-group")?.querySelector(".astryx-collapsible-trigger");
        return row && band ? row.getBoundingClientRect().top - band.getBoundingClientRect().bottom : Number.NaN;
      });
      expect(gap, "distance from the next group's band to its first row").toBeGreaterThanOrEqual(-1);
      expect(gap, "distance from the next group's band to its first row").toBeLessThanOrEqual(100);
    });

    test("collapsing and expanding a group above the viewport, and printing, keep the scroll position", async ({ page }) => {
      await openGrouped(page, project.id, "list");
      const scroller = visibleScroller(page);
      const height = await scroller.evaluate((el) => el.scrollHeight);
      await setScrollTop(scroller, height / 2, page);
      const before = await scrollTopOf(scroller);
      const groupHeight = await scroller.evaluate((el) => {
        const group = el.querySelector(".tessera-wi-group")!;
        const band = group.querySelector(".astryx-collapsible-trigger")!;
        return group.getBoundingClientRect().height - band.getBoundingClientRect().height;
      });
      // Click the band without scrolling it into view (a locator click would scroll to it).
      const toggleFirst = () => scroller.evaluate((el) => (el.querySelector(".tessera-wi-group .astryx-collapsible-trigger") as HTMLElement).click());

      await toggleFirst();
      await expect(scroller.locator(".tessera-wi-group").first().locator(".tessera-wi-row")).toHaveCount(0);
      await settle(page, 600);
      const collapsed = await scrollTopOf(scroller);
      const unchangedOrShifted = (value: number, base: number, shift: number) => Math.abs(value - base) <= 2 || Math.abs(value - (base + shift)) <= 2;
      expect(unchangedOrShifted(collapsed, before, -groupHeight), `after the collapse scrollTop ${collapsed} is ${before} or ${before - groupHeight}`).toBe(true);

      await toggleFirst();
      await settle(page, 600);
      const expanded = await scrollTopOf(scroller);
      expect(expanded, "the expanded group does not jump the list to the top").toBeGreaterThan(height / 4);
      const expandedHeight = await scroller.evaluate((el) => {
        const group = el.querySelector(".tessera-wi-group")!;
        const band = group.querySelector(".astryx-collapsible-trigger")!;
        return group.getBoundingClientRect().height - band.getBoundingClientRect().height;
      });
      expect(
        unchangedOrShifted(expanded, collapsed, expandedHeight) || Math.abs(expanded - before) <= 2,
        `after the expand scrollTop ${expanded} is ${collapsed}, ${collapsed + expandedHeight} or ${before}`,
      ).toBe(true);

      const beforePrint = await scrollTopOf(scroller);
      await page.emulateMedia({ media: "print" });
      await settle(page, 300);
      await page.emulateMedia({ media: "screen" });
      await settle(page, 600);
      expect(Math.abs((await scrollTopOf(scroller)) - beforePrint), "print and back leave scrollTop unchanged").toBeLessThanOrEqual(2);
    });

    test("scrolling slowly into the second group never shows a blank strip under its band; three groups down stays within the cap", async ({ page }) => {
      await openGrouped(page, project.id, "list");
      const scroller = visibleScroller(page);
      const start = await scroller.evaluate((el) => {
        const band = el.querySelectorAll(".tessera-wi-group")[1]!.querySelector(".astryx-collapsible-trigger")!;
        const offset = band.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
        return Math.max(0, offset - el.clientHeight - 200);
      });
      await setScrollTop(scroller, start, page);
      const result = await scroller.evaluate(
        (el) =>
          new Promise<{ visibleFrames: number; blankFrames: number[] }>((resolve) => {
            const group = el.querySelectorAll(".tessera-wi-group")[1]!;
            const band = group.querySelector(".astryx-collapsible-trigger")!;
            let visibleFrames = 0;
            const blankFrames: number[] = [];
            let frame = 0;
            const step = () => {
              frame += 1;
              const frameBox = el.getBoundingClientRect();
              const bandBox = band.getBoundingClientRect();
              if (bandBox.top < frameBox.bottom && bandBox.bottom > frameBox.top) {
                visibleFrames += 1;
                if (group.querySelector('.tessera-wi-row[data-index="0"]') === null) blankFrames.push(frame);
              }
              if (bandBox.top <= frameBox.top + 10 || frame > 200) {
                resolve({ visibleFrames, blankFrames });
                return;
              }
              el.scrollTop += 10;
              requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }),
      );
      expect(result.visibleFrames, "frames with the second band on screen").toBeGreaterThan(10);
      expect(result.blankFrames, "frames where the band showed without its first row").toEqual([]);

      const third = await scroller.evaluate((el) => {
        const band = el.querySelectorAll(".tessera-wi-group")[3]!.querySelector(".astryx-collapsible-trigger")!;
        return band.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      });
      await setScrollTop(scroller, third + 200, page);
      await settle(page, 300);
      expect(await scroller.locator(".tessera-wi-row").count()).toBeLessThanOrEqual(MAX_RENDERED.list);
    });

    test.describe("with motion on", () => {
      // The suite runs with Reduce Motion (playwright.config.ts). A windowed list has no group glide (docs/contracts/ui.md
      // "Motion", ListLayout passes no `animatedLayout` while windowed): the rows below a closing group fill the window in
      // the store's next measuring frame, and no row of the window (kept rows included) ever runs an animation of its own.
      test.use({ reducedMotion: "no-preference" });

      type MotionFrame = { t: number; shown: number; animatedRows: number; moves: number };

      test("collapsing a group plays no glide: rows are back within 100 ms, nothing moves, and rows a scroll mounts meanwhile do not animate", async ({ page }) => {
        await openGrouped(page, project.id, "list");
        const scroller = visibleScroller(page);
        // The second group's band 200 px below the top, and its first row focused: the scroll below leaves it a kept row.
        const bandAt = await scroller.evaluate((el) => {
          const band = el.querySelectorAll(".tessera-wi-group")[1]!.querySelector(".astryx-collapsible-trigger")!;
          return band.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
        });
        await setScrollTop(scroller, bandAt - 200, page);
        await scroller.locator(".tessera-wi-group").nth(1).locator(".tessera-wi-open").first().focus();
        const frames = await scroller.evaluate(
          (el) =>
            new Promise<MotionFrame[]>((resolve) => {
              // The band's chevron turns on its own; anything else that moves would be a glide.
              const moving = (a: Animation) =>
                a.playState === "running" &&
                !((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest(".astryx-collapsible-trigger") &&
                ((a.effect as KeyframeEffect | null)?.getKeyframes() ?? []).some((f) => "translate" in f || "transform" in f || "clipPath" in f);
              const read = (t: number): MotionFrame => {
                const box = el.getBoundingClientRect();
                const rows = [...el.querySelectorAll<HTMLElement>(".tessera-wi-row")];
                const shown = rows.filter((row) => {
                  const b = row.getBoundingClientRect();
                  return b.bottom > box.top + 60 && b.top < box.bottom;
                }).length;
                return {
                  t,
                  shown,
                  animatedRows: rows.filter((row) => row.getAnimations().some((a) => a.playState === "running")).length,
                  moves: el.getAnimations({ subtree: true }).filter(moving).length,
                };
              };
              (el.querySelector(".tessera-wi-group .astryx-collapsible-trigger") as HTMLElement).click();
              const start = performance.now();
              const out: MotionFrame[] = [read(0)];
              let scrolled = false;
              const tick = () => {
                const t = performance.now() - start;
                out.push(read(t));
                // Within the 280 ms a glide would take: a scroll that mounts new rows.
                if (!scrolled && t > 80) {
                  scrolled = true;
                  el.scrollTop += 1200;
                }
                if (t >= 700) resolve(out);
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }),
        );
        const summary = frames.map((frame) => `${Math.round(frame.t)}:${frame.shown}/${frame.animatedRows}/${frame.moves}`).join(" ");
        // The window catches up with the jump in the store's next measuring frame (as under Reduce Motion); a glide kept
        // the scroller empty for several frames and filled it over its 280 ms.
        const blank = frames.filter((frame) => frame.shown === 0);
        expect(blank.length, `frames with no row on screen (t:shown/animated/moves) ${summary}`).toBeLessThanOrEqual(2);
        expect(blank.every((frame) => frame.t < 100), `rows show again within 100 ms ${summary}`).toBe(true);
        expect(Math.max(...frames.map((frame) => frame.animatedRows)), `rows with an animation of their own ${summary}`).toBe(0);
        expect(Math.max(...frames.map((frame) => frame.moves)), `moves in the scroller ${summary}`).toBe(0);
        await expect(scroller.locator(".tessera-virtual-kept"), "the focused row, scrolled away, is kept").toHaveCount(1);

        // Settled: in each group the rendered window rows sit edge to edge, none overlaps, none leaves a gap.
        await settle(page, 300);
        const groups = await scroller.evaluate((el) =>
          [...el.querySelectorAll(".tessera-wi-group")].map((group) =>
            [...group.querySelectorAll(".tessera-wi-row:not(.tessera-virtual-kept)")].map((row) => {
              const b = row.getBoundingClientRect();
              return { top: b.top, bottom: b.bottom };
            }),
          ),
        );
        expect(groups.flat().length, "rendered rows after the collapse").toBeGreaterThan(5);
        groups.forEach((boxes, g) => {
          expectNoOverlap(boxes, `group ${g} after the collapse`);
          for (let i = 1; i < boxes.length; i += 1) {
            expect(boxes[i]!.top - boxes[i - 1]!.bottom, `group ${g}: row ${i} follows the previous one with no gap`).toBeLessThanOrEqual(1);
          }
        });
      });
    });
  });

  test.describe("keyboard", () => {
    test("ArrowDown 60 times focuses the 61st loaded row, in view; End and Home reach the last and first loaded rows", async ({ page }) => {
      const loaded = await flatRows(project.id, "list", ROW_PAGE);
      await openFlat(page, project.id, "list");
      const scroller = visibleScroller(page);
      await scroller.locator('[data-index="0"] .tessera-wi-open').focus();
      for (let i = 0; i < 60; i += 1) await page.keyboard.press("ArrowDown");
      await expect.poll(async () => (await focusState(page)).key).toBe(loaded[60]!.key);
      const state = await focusState(page);
      expect(state.top).toBeGreaterThanOrEqual(state.scrollerTop - 1);
      expect(state.bottom).toBeLessThanOrEqual(state.scrollerBottom + 1);

      await page.keyboard.press("End");
      await expect.poll(async () => (await focusState(page)).key, { message: "End focuses the last loaded row" }).toBe(loaded.at(-1)!.key);
      await expectFocusedRowFullyVisible(page, "End");
      await page.keyboard.press("Home");
      await expect.poll(async () => (await focusState(page)).key, { message: "Home focuses the first row" }).toBe(loaded[0]!.key);
      await expectFocusedRowFullyVisible(page, "Home");
    });

    test("grouped: End and Home focus the last and first loaded rows, fully visible below the sticky band", async ({ page }) => {
      const listed = await mcp<ListedGroups>("list_work_items", { scope: { type: "project", project_id: project.id }, display: { layout: "list", group_by: "state" }, per_group_limit: 50 });
      const keyOf = new Map(listed.items.map((item) => [item.id, item.key]));
      const filled = listed.groups.filter((group) => group.item_ids.length > 0);
      await openGrouped(page, project.id, "list");
      await visibleScroller(page).locator('[data-index="0"] .tessera-wi-open').first().focus();
      await page.keyboard.press("End");
      await expect.poll(async () => (await focusState(page)).key, { message: "End focuses the last loaded row" }).toBe(keyOf.get(filled.at(-1)!.item_ids.at(-1)!));
      await expectFocusedRowFullyVisible(page, "End");
      await page.keyboard.press("Home");
      await expect.poll(async () => (await focusState(page)).key, { message: "Home focuses the first row" }).toBe(keyOf.get(filled[0]!.item_ids[0]!));
      await expectFocusedRowFullyVisible(page, "Home");
    });

    test("grouped: wheel 3 000 px away from a focused row, then ArrowDown: the row scrolled back is fully visible below the sticky band", async ({ page }) => {
      await openGrouped(page, project.id, "list");
      const scroller = visibleScroller(page);
      await scroller.locator('[data-index="3"] .tessera-wi-open').first().focus();
      const focused = await focusState(page);
      await wheelAway(page);
      expect((await focusState(page)).bottom, "the focused row is scrolled out of view").toBeLessThan(focused.scrollerTop);
      await page.keyboard.press("ArrowDown");
      // Read the row by its key, so this check holds whatever happens to focus (the next test checks focus).
      await expect
        .poll(
          () =>
            scroller.evaluate((el, key) => {
              const open = [...el.querySelectorAll(".tessera-wi-open")].find((button) => button.textContent?.trim() === key);
              const row = open?.closest(".tessera-wi-row");
              const band = row?.closest(".tessera-wi-group")?.querySelector(".astryx-collapsible-trigger");
              if (!row || !band) return false;
              const box = row.getBoundingClientRect();
              return box.top >= band.getBoundingClientRect().bottom - 1 && box.bottom <= el.getBoundingClientRect().bottom + 1;
            }, focused.key),
          { message: "the row is fully visible below its sticky band" },
        )
        .toBe(true);
    });

    for (const grouped of [false, true]) {
      test(`${grouped ? "grouped" : "flat"}: wheel 3 000 px away, then ArrowDown brings the focused row back into view and focus does not move`, async ({ page }) => {
        if (grouped) await openGrouped(page, project.id, "list");
        else await openFlat(page, project.id, "list");
        await visibleScroller(page).locator('[data-index="3"] .tessera-wi-open').first().focus();
        const focused = await focusState(page);
        await wheelAway(page);
        const away = await focusState(page);
        expect(away.key, "the focused row stays mounted and focused off screen").toBe(focused.key);
        expect(away.bottom, "the focused row is scrolled out of view").toBeLessThan(away.scrollerTop);

        await page.keyboard.press("ArrowDown");
        await expect.poll(async () => (await focusState(page)).key, { message: "focus stays on the same row's key" }).toBe(focused.key);
        await expectFocusedRowFullyVisible(page, "after ArrowDown");
        expect((await focusState(page)).index, "focus did not move to another row").toBe(focused.index);
      });
    }

    test("wheel 3 000 px away, then Enter opens the peek for the focused row", async ({ page }) => {
      await openFlat(page, project.id, "list");
      await visibleScroller(page).locator('[data-index="2"] .tessera-wi-open').focus();
      const focused = await focusState(page);
      await wheelAway(page);
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).searchParams.has("peek"), { message: "the peek opens" }).toBe(true);
      await expect(page.locator(".tessera-peek-card:visible").getByText(focused.key, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe("selection", () => {
    test("three selected rows stay checked after scrolling away and back; the bulk bar says 3", async ({ page }) => {
      const loaded = await flatRows(project.id, "list", 3);
      await openFlat(page, project.id, "list");
      const scroller = visibleScroller(page);
      for (const item of loaded) await scroller.getByRole("checkbox", { name: `Select ${item.key}`, exact: true }).click();
      const bulk = page.getByRole("region", { name: "Bulk actions" });
      await expect(bulk.getByText("3 selected", { exact: true })).toBeVisible();

      await setScrollTop(scroller, 6000, page);
      // The window left the top rows (the last-clicked one stays mounted as the focus-kept row).
      await expect(scroller.locator('.tessera-wi-row[data-index="0"]')).toHaveCount(0);
      await setScrollTop(scroller, 0, page);
      for (const item of loaded) await expect(scroller.getByRole("checkbox", { name: `Select ${item.key}`, exact: true })).toBeChecked();
      await expect(bulk.getByText("3 selected", { exact: true })).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

// Serial: the drag moves a card into Todo; the window check reads Backlog before it.
test.describe.serial("board", () => {
  let project: { id: string; identifier: string };

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    project = await seedPerfProject(uniqueIdentifier("VL"), SEED_ITEMS);
  });

  test.afterAll(async () => {
    if (project) await archiveProject(project.id);
  });

  const column = (page: Page, state: string) =>
    visibleScroller(page)
      .locator(".tessera-board-column")
      .filter({ has: page.getByRole("button", { name: `Add a work item to ${state}`, exact: true }) });

  async function groupsByState(): Promise<ListedGroups> {
    return mcp<ListedGroups>("list_work_items", { scope: { type: "project", project_id: project.id }, display: { layout: "board", group_by: "state" }, per_group_limit: BOARD_GROUP_PAGE });
  }

  test("1. the scrolled Backlog column (30 loaded cards, windowed) holds at most 12 cards", async ({ page }) => {
    const backlogGroup = (await groupsByState()).groups.find((group) => group.name === "Backlog")!;
    expect(backlogGroup.item_ids.length, "loaded Backlog cards").toBe(BOARD_GROUP_PAGE);
    await openGrouped(page, project.id, "board");
    const backlog = column(page, "Backlog");
    await expect(backlog.getByRole("button", { name: showMoreLabel(BOARD_GROUP_PAGE, backlogGroup.count, BOARD_GROUP_PAGE), exact: true })).toBeAttached();
    await expect(backlog.locator(".tessera-virtual")).toHaveCount(1);
    const body = backlog.locator(".tessera-board-column-body");
    const middle = await body.evaluate((el) => (el.scrollHeight - el.clientHeight) / 2);
    await setScrollTop(body, middle, page);
    await settle(page, 300);
    const cards = await backlog.locator(".tessera-board-card").count();
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThanOrEqual(MAX_RENDERED.board);
  });

  test("2. a card dropped below the last loaded card of another column lands right after it (decision 114)", async ({ page }) => {
    const before = await groupsByState();
    const todoGroup = before.groups.find((group) => group.name === "Todo")!;
    expect(todoGroup.count, "Todo has unloaded cards").toBeGreaterThan(BOARD_GROUP_PAGE + 1);
    const lastLoaded = todoGroup.item_ids.at(-1)!;
    const keyOf = new Map(before.items.map((item) => [item.id, item.key]));

    await openGrouped(page, project.id, "board");
    const backlog = column(page, "Backlog");
    const backlogBody = backlog.locator(".tessera-board-column-body");
    await setScrollTop(backlogBody, await backlogBody.evaluate((el) => (el.scrollHeight - el.clientHeight) / 2), page);
    const todo = column(page, "Todo");
    const todoBody = todo.locator(".tessera-board-column-body");
    await setScrollTop(todoBody, 1e6, page);
    await settle(page, 300);

    // The card nearest the middle of the Backlog window.
    const sourceIndex = await backlogBody.evaluate((el) => {
      const frame = el.getBoundingClientRect();
      const centre = frame.top + frame.height / 2;
      const cards = [...el.querySelectorAll<HTMLElement>(".tessera-board-card[data-index]")];
      cards.sort((a, b) => Math.abs(a.getBoundingClientRect().top - centre) - Math.abs(b.getBoundingClientRect().top - centre));
      return cards[0]!.getAttribute("data-index")!;
    });
    const card = backlog.locator(`.tessera-board-card[data-index="${sourceIndex}"]`);
    const backlogGroup = before.groups.find((group) => group.name === "Backlog")!;
    const movedId = backlogGroup.item_ids[Number(sourceIndex)]!;
    const movedKey = keyOf.get(movedId)!;
    // Press on the key text: a press on a chip or the menu (buttons) keeps the press for itself and starts no drag.
    const source = card.getByText(movedKey, { exact: true });
    await expect(source).toBeVisible();

    // The bottom slot: the lower half of the last loaded card, with the Todo body scrolled to its end. The column
    // footer ("Show 30 more") is outside the drop container (the body).
    const last = todo.locator(`.tessera-board-card[data-index="${BOARD_GROUP_PAGE - 1}"]`);
    await expect(last).toContainText(keyOf.get(lastLoaded)!);
    const lastBox = (await last.boundingBox())!;
    await dragByPointer(page, source, last, { offset: { x: 0, y: lastBox.height / 2 - 8 } });
    const todoState = (await getItem(lastLoaded)).state_id;
    await expect.poll(async () => (await getItem(movedId)).state_id, { timeout: 15_000, message: "the card moved to Todo" }).toBe(todoState);

    await page.reload();
    await expect(visibleScroller(page).locator("[data-list-ready]").first()).toBeVisible({ timeout: 30_000 });
    const after = await mcp<Listed>("list_work_items", {
      scope: { type: "project", project_id: project.id },
      filters: { state: [todoState] },
      display: { layout: "board", group_by: null },
    });
    const order = after.items.map((item) => item.id);
    expect(order.indexOf(movedId), "the moved card sits right after the column's last loaded card").toBe(order.indexOf(lastLoaded) + 1);
    expect(order.indexOf(movedId), "not at the end of the unloaded cards").toBeLessThan(order.length - 1);
  });
});

// ---------------------------------------------------------------------------
// Table and gantt
// ---------------------------------------------------------------------------

test.describe("table and gantt", () => {
  let project: { id: string; identifier: string };

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    project = await seedPerfProject(uniqueIdentifier("VL"), SEED_ITEMS);
  });

  test.afterAll(async () => {
    if (project) await archiveProject(project.id);
  });

  test("table: 400 loaded rows of 1 500, row indexes match the loaded order, spacers are hidden from assistive tech", async ({ page }) => {
    const loaded = await flatRows(project.id, "table", 2 * ROW_PAGE);
    await openFlat(page, project.id, "table");
    await showMore(page, ROW_PAGE, SEED_ITEMS);
    const scroller = visibleScroller(page);
    await expect(scroller.locator('table[aria-rowcount="1500"]')).toHaveCount(1);

    for (const top of [0, 6000, 1e7]) {
      await setScrollTop(scroller, top, page);
      const rows = await scroller.evaluate((el) =>
        [...el.querySelectorAll<HTMLTableRowElement>("tbody tr:not(.tessera-table-spacer)")].map((row) => ({
          index: row.getAttribute("data-index"),
          rowIndex: row.getAttribute("aria-rowindex"),
          key: row.querySelector(".tessera-table-open")?.textContent?.trim() ?? "",
        })),
      );
      expect(rows.length, `rendered rows at scrollTop ${top}`).toBeGreaterThan(0);
      expect(rows.length).toBeLessThanOrEqual(MAX_RENDERED.table);
      for (const row of rows) {
        expect(Number(row.rowIndex), `aria-rowindex of the row at data-index ${row.index}`).toBe(Number(row.index) + 1);
        expect(row.key, `the key of loaded row ${row.rowIndex}`).toBe(loaded[Number(row.rowIndex) - 1]!.key);
      }
      const spacers = await scroller.evaluate((el) => [...el.querySelectorAll("tbody tr.tessera-table-spacer")].map((row) => ({ hidden: row.getAttribute("aria-hidden"), role: row.getAttribute("role") })));
      expect(spacers.length, `spacer rows at scrollTop ${top}`).toBeGreaterThan(0);
      for (const spacer of spacers) expect(spacer).toEqual({ hidden: "true", role: "presentation" });
    }
  });

  test("table: a focused row wheeled 3 000 px away stays in normal flow; Tab and ArrowDown work from it", async ({ page }) => {
    await openFlat(page, project.id, "table");
    const scroller = visibleScroller(page);
    await scroller.locator('tr[data-index="3"] .tessera-table-open').focus();
    const focused = await focusState(page);
    await wheelAway(page);
    const away = await focusState(page);
    expect(away.key).toBe(focused.key);
    expect(away.bottom, "the focused row is scrolled out of view").toBeLessThan(away.scrollerTop);
    const position = await page.evaluate(() => getComputedStyle((document.activeElement as HTMLElement).closest("tr")!).position);
    expect(position, "the kept table row is in normal flow").toBe("static");

    await page.keyboard.press("ArrowDown");
    await expectFocusedRowFullyVisible(page, "table ArrowDown");
    expect((await focusState(page)).key, "ArrowDown on a kept row only scrolls it back").toBe(focused.key);

    await wheelAway(page);
    await page.keyboard.press("Tab");
    const tabbed = await page.evaluate(() => {
      const active = document.activeElement;
      return { inTable: active?.closest("table") !== null && active?.closest("table") !== undefined, isBody: active === document.body };
    });
    expect(tabbed, "Tab moves focus on inside the table").toEqual({ inTable: true, isBody: false });
  });

  test("gantt: 400 loaded rows render at most 56; the connectors drawn belong to rendered rows", async ({ page }) => {
    // Two blocked_by pairs among dated rows, one near the top and one far below, so both cases have a connector.
    const loaded = await flatRows(project.id, "gantt", 2 * ROW_PAGE);
    const dated = loaded.map((item, index) => ({ item, index })).filter(({ item }) => item.start_date !== null && item.target_date !== null);
    const near = dated.filter(({ index }) => index < 20).slice(0, 2);
    const far = dated.filter(({ index }) => index >= 300).slice(0, 2);
    expect(near.length).toBe(2);
    expect(far.length).toBe(2);
    for (const pair of [near, far]) await mcp("add_relation", { work_item_id: pair[1]!.item.id, related_work_item_id: pair[0]!.item.id, relation_type: "blocked_by" });

    await openFlat(page, project.id, "gantt");
    await showMore(page, ROW_PAGE, SEED_ITEMS);
    const scroller = visibleScroller(page);

    const check = async (top: number, label: string) => {
      await setScrollTop(scroller, top, page);
      await settle(page, 300);
      const rows = scroller.locator(".tessera-gantt-row");
      expect(await rows.count(), `${label}: rendered gantt rows`).toBeLessThanOrEqual(MAX_RENDERED.gantt);
      // The SVG's viewBox is `days × day` by `rows × row` (all loaded rows), so a path's rows are its y range in
      // viewBox units over the row height in those units.
      return scroller.evaluate((el, count) => {
        const svg = el.querySelector<SVGSVGElement>(".tessera-gantt-connectors");
        const indexes = [...el.querySelectorAll(".tessera-gantt-row[data-index]")].map((row) => Number(row.getAttribute("data-index")));
        if (svg === null) return { indexes, paths: [] as { from: number; to: number }[] };
        const frame = svg.getBoundingClientRect();
        const rowUnits = svg.viewBox.baseVal.height / count;
        const scale = frame.height / svg.viewBox.baseVal.height;
        return {
          indexes,
          paths: [...svg.querySelectorAll(".tessera-gantt-edge")].map((path) => {
            const box = path.getBoundingClientRect();
            return { from: (box.top - frame.top) / scale / rowUnits, to: (box.bottom - frame.top) / scale / rowUnits };
          }),
        };
      }, 2 * ROW_PAGE);
    };

    const rowHeight = await scroller.evaluate((el) => (el.querySelector(".tessera-gantt-row") as HTMLElement).getBoundingClientRect().height);
    const bodyOffset = await scroller.evaluate((el) => {
      const body = el.querySelector(".tessera-gantt-body")!;
      return body.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    });
    for (const [top, label, pair] of [
      [0, "top", near],
      [bodyOffset + far[0]!.index * rowHeight - 200, "far below", far],
    ] as const) {
      const geometry = await check(top, label);
      const first = Math.min(...geometry.indexes);
      const last = Math.max(...geometry.indexes);
      expect(geometry.paths.length, `${label}: the added pair's connector is drawn`).toBeGreaterThan(0);
      expect(geometry.indexes).toEqual(expect.arrayContaining([pair[0]!.index, pair[1]!.index]));
      for (const path of geometry.paths) {
        const fromRow = Math.floor(path.from);
        const toRow = Math.ceil(path.to);
        expect(fromRow <= last + OVERSCAN.gantt + 1 && toRow >= first - OVERSCAN.gantt - 1, `${label}: a connector over rows ${fromRow}-${toRow} meets the rendered rows ${first}-${last}`).toBe(true);
      }
    }
  });

  test("gantt: t centres today while the rows are windowed", async ({ page }) => {
    await openFlat(page, project.id, "gantt");
    const scroller = visibleScroller(page);
    await setScrollTop(scroller, 3000, page);
    await page.waitForTimeout(1800);
    const offsets = () =>
      scroller.evaluate((el) => {
        const root = el.querySelector<HTMLElement>(".tessera-gantt")!;
        let horizontal: HTMLElement | null = null;
        for (let node = root.parentElement; node; node = node.parentElement) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") {
            horizontal = node;
            break;
          }
        }
        horizontal ??= document.scrollingElement as HTMLElement;
        const left = horizontal === document.scrollingElement ? 0 : horizontal.getBoundingClientRect().left;
        const labelWidth = root.querySelector<HTMLElement>(".tessera-gantt-label")!.getBoundingClientRect().width;
        const line = root.querySelector<HTMLElement>(".tessera-gantt-today")!.getBoundingClientRect();
        return { lineCentre: line.left + line.width / 2, areaCentre: left + labelWidth + (horizontal.clientWidth - labelWidth) / 2 };
      });
    await scroller.evaluate((el) => {
      const root = el.querySelector<HTMLElement>(".tessera-gantt")!;
      for (let node: HTMLElement | null = root.parentElement; node; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") {
          node.scrollLeft = 0;
          return;
        }
      }
    });
    await settle(page);
    const away = await offsets();
    expect(Math.abs(away.lineCentre - away.areaCentre), "scrolled to the start, the today line is off centre").toBeGreaterThan(100);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("t");
    await expect
      .poll(async () => {
        const now = await offsets();
        return Math.abs(now.lineCentre - now.areaCentre);
      })
      .toBeLessThanOrEqual(20);
  });

  test("gantt: press a bar, wheel 1 500 px, move 3 days, release: the start date moved by 3 days", async ({ page }) => {
    await openFlat(page, project.id, "gantt");
    await showMore(page, ROW_PAGE, SEED_ITEMS);
    const scroller = visibleScroller(page);
    await setScrollTop(scroller, 0, page);
    await page.waitForTimeout(1800);
    const bar = scroller.locator(".tessera-gantt-row .tessera-gantt-bar:not([data-open-start]):not([data-open-end]):not([data-readonly])").first();
    const name = (await bar.getAttribute("aria-label")) ?? "";
    // "<key> <name>, <start> to <target>", plus ", date conflict" when it clashes (decision 92).
    const match = name.match(/^(\S+) .*?, (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})(?:, .*)?$/);
    expect(match, `bar label ${name}`).not.toBeNull();
    const [, key, start, target] = match!;
    const item = await mcp<{ id: string; start_date: string; target_date: string }>("get_work_item_by_key", { key });
    const days = Math.round((Date.parse(target!) - Date.parse(start!)) / 86_400_000) + 1;

    await bar.scrollIntoViewIfNeeded();
    await settle(page);
    const box = (await bar.boundingBox())!;
    const dayWidth = (box.width + 8) / days;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.wheel(0, 1500);
    await settle(page, 300);
    await page.mouse.move(x + 6, y, { steps: 2 });
    await page.mouse.move(x + Math.round(dayWidth * 3), y, { steps: 10 });
    await page.waitForTimeout(120);
    await page.mouse.up();

    const shift = (date: string) => new Date(Date.parse(date) + 3 * 86_400_000).toISOString().slice(0, 10);
    await expect.poll(async () => (await getItem(item.id)).start_date, { timeout: 15_000, message: "the start date moved by 3 days" }).toBe(shift(start!));
    expect((await getItem(item.id)).target_date).toBe(shift(target!));

    await page.reload();
    await expect(visibleScroller(page).locator(".tessera-gantt").first()).toBeVisible({ timeout: 30_000 });
    await expect(visibleScroller(page).getByRole("button", { name: new RegExp(`^${key} .*?, ${shift(start!)} to ${shift(target!)}(?:, .*)?$`) })).toHaveCount(1);
  });
});
