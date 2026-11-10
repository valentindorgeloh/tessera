import type { Page } from "@playwright/test";
import { createProjectViaMcp, createProjectViaUi, dragByPointer, expect, mcp, waitForSaved, openWorkItems, quickAddItems, test } from "./fixtures";
import { waitForAppHydrated } from "./helpers-d";

/**
 * docs/PLAN.md §12 browser check 7 (a page embeds a work item with `#`) and the
 * P6 page lifecycle: lock and archive. The last block is the page tree's glide
 * (docs/contracts/ui.md "Motion"), with motion on.
 */

test.describe.configure({ mode: "serial" });

test("a page embeds a work item with # and the embed survives a reload", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Embedded item"]);

  await page.goto(`/projects/${project.id}/pages`);
  await page.getByRole("button", { name: "New page" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled" })).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Untitled" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Launch notes");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");

  const editor = page.getByRole("textbox").last();
  await editor.click();
  await page.keyboard.type(`See #${project.identifier}-1`);
  const options = page.getByRole("listbox", { name: "Work items" });
  await expect(options.getByRole("option", { name: new RegExp(`${project.identifier}-1 Embedded item`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor.locator(`a[href="work:${project.identifier}-1"]`)).toBeVisible();
  await waitForSaved(page);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Launch notes" }).first()).toBeVisible();
  await expect(page.getByRole("textbox").last().locator(`a[href="work:${project.identifier}-1"]`)).toBeVisible();
});

test("the embedded work item shows Mentioned in with the page", async ({ page }) => {
  // docs/PLAN.md section 12 step 7: the work item detail lists the pages that embed it.
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Mentioned item"]);

  await page.goto(`/projects/${project.id}/pages`);
  await page.getByRole("button", { name: "New page" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled" })).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Untitled" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Backlink page");
  await page.getByRole("textbox", { name: "Title" }).press("Enter");

  const editor = page.getByRole("textbox").last();
  await editor.click();
  await page.keyboard.type(`See #${project.identifier}-1`);
  await expect(page.getByRole("listbox", { name: "Work items" }).getByRole("option", { name: new RegExp(`${project.identifier}-1 Mentioned item`) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor.locator(`a[href="work:${project.identifier}-1"]`)).toBeVisible();
  await waitForSaved(page);

  await openWorkItems(page, project.id);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Mentioned item" })).toBeVisible();
  await expect(peek.getByText("Mentioned in")).toBeVisible();
  await expect(peek.getByRole("link", { name: "Backlink page" })).toBeVisible();
});

test("a page locks, refuses edits, and unlocks; an archived page restores", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await page.goto(`/projects/${project.id}/pages`);
  await page.getByRole("button", { name: "New page" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Untitled" }).first()).toBeVisible();
  const editor = page.getByRole("textbox").last();
  await editor.click();
  await page.keyboard.type("Editable body");
  await waitForSaved(page);

  await page.getByRole("button", { name: "Lock page" }).click();
  await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox").last()).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox").last()).toHaveAttribute("contenteditable", "true");

  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toHaveCount(0);
});

test.describe("the page tree glide", () => {
  // The suite runs with reducedMotion "reduce" (playwright.config.ts); the glide needs motion on.
  test.use({ reducedMotion: "no-preference" });

  const ROW = (id: string) => `li[data-tree-id="${id}"] > div > .tessera-page-row`;

  type Sample = { tops: number[]; rowsFirst: number; rowsLast: number; shapeLast: number };
  /**
   * Clicks the chevron of page `parentId` and returns the top edge of page `trackedId` at every frame for `ms`. The
   * click is in the same task as the first sample, so nothing of the glide is missed. `rows` counts the tree's
   * `li[data-tree-id]`; `shape` counts those with the `.tessera-page-row` that the drag hook looks for.
   */
  async function sampleAfterToggle(page: Page, parentId: string, trackedId: string, ms = 1_200): Promise<Sample> {
    return page.evaluate(
      async ({ parentId, trackedId, ms }) => {
        const rowCount = () => document.querySelectorAll("li[data-tree-id]").length;
        const shapeCount = () => [...document.querySelectorAll("li[data-tree-id]")].filter((row) => row.querySelector(":scope > div > .tessera-page-row") !== null).length;
        const topOf = () => (document.querySelector(`li[data-tree-id="${trackedId}"] > div > .tessera-page-row`) as HTMLElement).getBoundingClientRect().top;
        const toggle = document.querySelector(`li[data-tree-id="${parentId}"] > div [data-tree-toggle]`) as HTMLElement;
        const tops: number[] = [topOf()];
        const rowsFirst = rowCount();
        toggle.click();
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const tick = () => {
            tops.push(topOf());
            if (performance.now() - start >= ms) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return { tops, rowsFirst, rowsLast: rowCount(), shapeLast: shapeCount() };
      },
      { parentId, trackedId, ms },
    );
  }

  /** The frames strictly between the first and the last position: a glide has several, a jump has none. */
  const between = (tops: number[]) => {
    const low = Math.min(tops[0]!, tops[tops.length - 1]!);
    const high = Math.max(tops[0]!, tops[tops.length - 1]!);
    return tops.filter((top) => top > low + 0.5 && top < high - 0.5);
  };

  test("a page closing and opening its sub-pages glides the rows below, the tree ends in place and still drags", async ({ page }) => {
    const project = await createProjectViaMcp();
    const parent = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Glide parent" });
    await mcp("create_page", { project_id: project.id, parent_id: parent.id, name: "Glide child one" });
    await mcp("create_page", { project_id: project.id, parent_id: parent.id, name: "Glide child two" });
    const sibling = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Glide sibling" });

    await page.goto(`/projects/${project.id}/pages`);
    await waitForAppHydrated(page);
    const tree = page.getByRole("tree", { name: "Pages" });
    await expect(tree.getByRole("treeitem", { name: "Glide child two" })).toBeVisible();
    await page.waitForTimeout(500);

    // Nothing animates on load: no animation runs in the tree and no row carries an inline transform.
    const atLoad = await tree.evaluate((node) => ({
      animations: node.getAnimations({ subtree: true }).length,
      inline: [...node.querySelectorAll<HTMLElement>("[style]")].filter((element) => /transform|translate/.test(element.getAttribute("style") ?? "")).length,
    }));
    expect(atLoad).toEqual({ animations: 0, inline: 0 });

    const restTop = (await page.locator(ROW(sibling.id)).boundingBox())!.y;
    const rowHeight = (await page.locator(ROW(sibling.id)).boundingBox())!.height;

    // Close: the sibling glides up by the two sub-page rows over several frames, and the sub-pages leave the DOM when it ends.
    const closing = await sampleAfterToggle(page, parent.id, sibling.id);
    expect(closing.rowsFirst).toBe(4);
    expect(closing.rowsLast, "the sub-pages are gone once the glide ends").toBe(2);
    expect(closing.tops[0]! - closing.tops[closing.tops.length - 1]!, "the sibling moved up by the two rows").toBeGreaterThan(rowHeight);
    expect(between(closing.tops).length, `frames in between: ${closing.tops.map((top) => Math.round(top)).join(",")}`).toBeGreaterThanOrEqual(2);
    expect(closing.shapeLast).toBe(closing.rowsLast);
    await expect(tree.getByRole("treeitem", { name: "Glide child one" })).toHaveCount(0);

    // Open again: the sibling glides back to where it started.
    const opening = await sampleAfterToggle(page, parent.id, sibling.id);
    expect(opening.rowsLast).toBe(4);
    expect(opening.shapeLast, "every shown row has the shape the drag hook finds").toBe(4);
    expect(between(opening.tops).length, `frames in between: ${opening.tops.map((top) => Math.round(top)).join(",")}`).toBeGreaterThanOrEqual(2);
    await expect(tree.getByRole("treeitem", { name: "Glide child two" })).toBeVisible();

    // The tree ends in place: the sibling is back at its start, and nothing keeps a transform or an animation.
    expect(Math.abs((await page.locator(ROW(sibling.id)).boundingBox())!.y - restTop)).toBeLessThan(1);
    const settled = await tree.evaluate((node) => ({
      animations: node.getAnimations({ subtree: true }).length,
      inline: [...node.querySelectorAll<HTMLElement>("[style]")].filter((element) => /transform|translate/.test(element.getAttribute("style") ?? "")).length,
    }));
    expect(settled).toEqual({ animations: 0, inline: 0 });

    // After a glide the drag still works: the sibling dragged above the parent reorders the top level.
    await dragByPointer(page, page.locator(ROW(sibling.id)), page.locator(ROW(parent.id)), { offset: { x: 0, y: -8 } });
    await expect
      .poll(async () => {
        type Row = { name: string; parent_id: string | null };
        const listed = await mcp<{ items?: Row[]; result?: Row[] }>("list_pages", { project_id: project.id });
        return (listed.items ?? listed.result ?? []).filter((entry) => entry.parent_id === null).map((entry) => entry.name);
      })
      .toEqual(["Glide sibling", "Glide parent"]);
  });

  type TopsWindow = Window & { __treeTops?: { samples: Record<string, number[]>; stopped: boolean } };
  /** Records the top edge of each page's row at every frame, from now until the returned function is called (the action runs in between). */
  async function recordTops(page: Page, ids: string[]): Promise<() => Promise<Record<string, number[]>>> {
    await page.evaluate((ids) => {
      const state = { samples: {} as Record<string, number[]>, stopped: false };
      for (const id of ids) state.samples[id] = [];
      (window as TopsWindow).__treeTops = state;
      const tick = () => {
        for (const id of ids) {
          const row = document.querySelector(`li[data-tree-id="${id}"] > div > .tessera-page-row`);
          if (row !== null) state.samples[id]!.push(row.getBoundingClientRect().top);
        }
        if (!state.stopped) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, ids);
    return () =>
      page.evaluate(() => {
        const state = (window as TopsWindow).__treeTops!;
        state.stopped = true;
        return state.samples;
      });
  }

  test("a search that keeps an open page, and clearing it, move the rows at once, with none at a position in between", async ({ page }) => {
    const project = await createProjectViaMcp();
    const alpha = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Alpha parent" });
    await mcp("create_page", { project_id: project.id, parent_id: alpha.id, name: "Alpha child" });
    const beta = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Beta" });
    const delta = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Delta" });

    await page.goto(`/projects/${project.id}/pages`);
    await waitForAppHydrated(page);
    const tree = page.getByRole("tree", { name: "Pages" });
    await expect(tree.getByRole("treeitem", { name: "Alpha child" })).toBeVisible();
    await page.waitForTimeout(500);
    const rowHeight = (await page.locator(ROW(beta.id)).boundingBox())!.height;
    const search = page.getByLabel("Search pages");

    // "t" keeps Alpha parent, Beta and Delta as a flat list and drops Alpha child: Beta and Delta move up by its row, at once.
    const stopEntering = await recordTops(page, [beta.id, delta.id]);
    await search.fill("t");
    await expect(tree.getByRole("treeitem", { name: "Alpha child" })).toHaveCount(0);
    await page.waitForTimeout(700);
    const entering = await stopEntering();
    for (const id of [beta.id, delta.id]) {
      const tops = entering[id]!;
      expect(tops.length, "sampled every frame").toBeGreaterThan(10);
      expect(tops[0]! - tops[tops.length - 1]!, "the row moved up past Alpha child's").toBeGreaterThan(rowHeight / 2);
      expect(between(tops).length, `frames in between: ${tops.map((top) => Math.round(top)).join(",")}`).toBe(0);
    }

    // Clearing it brings Alpha child back: Beta and Delta move down at once, again with no frame in between.
    const stopClearing = await recordTops(page, [beta.id, delta.id]);
    await search.fill("");
    await expect(tree.getByRole("treeitem", { name: "Alpha child" })).toBeVisible();
    await page.waitForTimeout(700);
    const clearing = await stopClearing();
    for (const id of [beta.id, delta.id]) {
      const tops = clearing[id]!;
      expect(tops[tops.length - 1]! - tops[0]!, "the row moved down by Alpha child's").toBeGreaterThan(rowHeight / 2);
      expect(between(tops).length, `frames in between: ${tops.map((top) => Math.round(top)).join(",")}`).toBe(0);
    }

    // A page's own toggle still glides after a search: Beta and Delta pass through positions in between.
    const closing = await sampleAfterToggle(page, alpha.id, delta.id);
    expect(between(closing.tops).length, `frames in between: ${closing.tops.map((top) => Math.round(top)).join(",")}`).toBeGreaterThanOrEqual(2);
  });
});
