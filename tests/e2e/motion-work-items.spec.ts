import type { Page } from "@playwright/test";
import { boardColumn, createProjectViaMcp, dragByPointer, expect, mcp, openLayout, test, waitForDialog } from "./fixtures";
import { waitForAppHydrated } from "./helpers-d";

/**
 * Work items motion (docs/contracts/ui.md "Motion"), with motion ON: the suite runs with reducedMotion "reduce"
 * (playwright.config.ts) and this file opts back in.
 *
 * - list groups and board swimlanes glide: the content below a collapsing group moves over several frames;
 * - the scroller dips and fades back when the layout changes, never on first load, a filter or the agent refresh;
 * - a dropped board card glides from where the overlay let go into its slot;
 * - the quick-add placeholder and the bulk bar use Astryx's entry animation; real rows never animate.
 *
 * Frames are sampled in the page (requestAnimationFrame), so a one-frame effect still shows.
 */
test.use({ reducedMotion: "no-preference" });

const SCROLLER = ".tessera-wi-scroller";

/** An item with a priority, so a list grouped by priority has one group per value. */
async function seedPriorities(projectId: string): Promise<void> {
  await mcp("create_work_item", { project_id: projectId, name: "Urgent one", priority: "urgent" });
  await mcp("create_work_item", { project_id: projectId, name: "Urgent two", priority: "urgent" });
  await mcp("create_work_item", { project_id: projectId, name: "Low one", priority: "low" });
  await mcp("create_work_item", { project_id: projectId, name: "Low two", priority: "low" });
}

/**
 * Clicks `trigger` and returns the top edge of `tracked` at every frame for `ms`. The click is in the same task as the
 * first sample, so nothing of the glide is missed. Also returns the scroller's scrollTop before and after.
 */
async function glideAfterClick(page: Page, trigger: string, triggerIndex: number, tracked: string, trackedIndex: number, ms = 1_200) {
  return page.evaluate(
    async ({ trigger, triggerIndex, tracked, trackedIndex, ms }) => {
      const scroller = document.querySelector(".tessera-wi-scroller") as HTMLElement;
      const target = document.querySelectorAll(tracked)[trackedIndex] as HTMLElement;
      const button = document.querySelectorAll(trigger)[triggerIndex] as HTMLElement;
      const tops: number[] = [target.getBoundingClientRect().top];
      const scrollBefore = scroller.scrollTop;
      button.click();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          tops.push(target.getBoundingClientRect().top);
          if (performance.now() - start >= ms) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { tops, scrollBefore, scrollAfter: scroller.scrollTop };
    },
    { trigger, triggerIndex, tracked, trackedIndex, ms },
  );
}

/** The frames strictly between the first and the last position: a glide has several, a jump has none. */
function between(tops: number[]): number[] {
  const first = tops[0]!;
  const last = tops[tops.length - 1]!;
  const low = Math.min(first, last);
  const high = Math.max(first, last);
  return tops.filter((top) => top > low + 0.5 && top < high - 0.5);
}

test("a list group that closes glides: the group below follows over several frames, and nothing scrolls", async ({ page }) => {
  const project = await createProjectViaMcp();
  await seedPriorities(project.id);
  await openLayout(page, project.id, "list", { group_by: "priority" });
  await waitForAppHydrated(page);
  expect(await page.locator(".tessera-wi-group").count(), "a group per priority").toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(400);

  const closing = await glideAfterClick(page, ".tessera-wi-group .astryx-collapsible-trigger", 0, ".tessera-wi-group", 1);
  const first = closing.tops[0]!;
  const last = closing.tops[closing.tops.length - 1]!;
  expect(first - last, "the second group moved up by the closed group's rows").toBeGreaterThan(40);
  expect(between(closing.tops).length, `frames in between: ${closing.tops.map((top) => Math.round(top)).join(",")}`).toBeGreaterThanOrEqual(3);
  expect(closing.scrollAfter).toBe(closing.scrollBefore);

  // And open again: the group below makes room the same way, and the rows are back.
  await page.waitForTimeout(300);
  const opening = await glideAfterClick(page, ".tessera-wi-group .astryx-collapsible-trigger", 0, ".tessera-wi-group", 1);
  expect(opening.tops[opening.tops.length - 1]! - opening.tops[0]!).toBeGreaterThan(40);
  expect(between(opening.tops).length).toBeGreaterThanOrEqual(3);
  await expect(page.getByText("Urgent one", { exact: true })).toBeVisible();
});

test("a board swimlane that closes glides: the lane below follows over several frames", async ({ page }) => {
  const project = await createProjectViaMcp();
  await seedPriorities(project.id);
  await openLayout(page, project.id, "board", { group_by: "state", sub_group_by: "priority" });
  await waitForAppHydrated(page);
  expect(await page.locator(".tessera-board-lane").count(), "a lane per priority").toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(400);

  const closing = await glideAfterClick(page, ".tessera-board-lane > button", 0, ".tessera-board-lane", 1);
  expect(closing.tops[0]! - closing.tops[closing.tops.length - 1]!, "the second lane moved up").toBeGreaterThan(40);
  expect(between(closing.tops).length, `frames in between: ${closing.tops.map((top) => Math.round(top)).join(",")}`).toBeGreaterThanOrEqual(3);
});

/** Records the scroller's computed opacity at every frame, from before the first script of each document. */
async function recordScrollerOpacity(page: Page): Promise<void> {
  await page.addInitScript((selector: string) => {
    const state = { min: 1, frames: 0 };
    (window as unknown as { __wiFade: typeof state }).__wiFade = state;
    const tick = () => {
      const scroller = document.querySelector(selector);
      if (scroller) {
        state.frames += 1;
        state.min = Math.min(state.min, parseFloat(getComputedStyle(scroller).opacity));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SCROLLER);
}
const sampled = (page: Page) => page.evaluate(() => ({ ...(window as unknown as { __wiFade: { min: number; frames: number } }).__wiFade }));
const resetSamples = (page: Page) =>
  page.evaluate(() => {
    const state = (window as unknown as { __wiFade: { min: number; frames: number } }).__wiFade;
    state.min = 1;
    state.frames = 0;
  });

/** The fade is over: computed opacity 1 and no inline opacity left on the scroller (a stacking context must not outlive it). */
async function expectSettled(page: Page): Promise<void> {
  const scroller = page.locator(SCROLLER).first();
  await expect(scroller).toHaveCSS("opacity", "1");
  await expect.poll(() => scroller.evaluate((element) => (element as HTMLElement).style.opacity)).toBe("");
}

test("a layout change fades the scroller; first load, a filter and the agent refresh do not", async ({ page }) => {
  const project = await createProjectViaMcp();
  await seedPriorities(project.id);
  await recordScrollerOpacity(page);
  await openLayout(page, project.id, "list", { group_by: "priority" });
  await waitForAppHydrated(page);
  await page.waitForTimeout(800);
  const first = await sampled(page);
  expect(first.frames, "the sampler ran").toBeGreaterThan(10);
  expect(first.min, "nothing fades on first load").toBe(1);

  // A filter keeps the layout: the content stays still. It is applied inside the loaded page (a client-side change that
  // rewrites the URL state), after the samples are reset: a hard navigation would only repeat the first-load check.
  await resetSamples(page);
  await page.getByRole("button", { name: /^Advanced/ }).click();
  const dialog = await waitForDialog(page, "Advanced filters");
  await expect(dialog.getByRole("combobox", { name: "Field" })).toContainText("Priority"); // the first condition: Priority is Urgent
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Urgent one", { exact: true })).toBeVisible();
  await expect(page.getByText("Low one", { exact: true })).toHaveCount(0); // the filter took effect, in this document
  await page.waitForTimeout(600);
  const filtered = await sampled(page);
  expect(filtered.frames, "the sampler ran through the filter").toBeGreaterThan(10);
  expect(filtered.min, "a filter does not fade the scroller").toBe(1);

  // The agent refresh: another process writes, the open page re-renders with the new row, still.
  await openLayout(page, project.id, "list", { group_by: "priority" });
  await waitForAppHydrated(page);
  await resetSamples(page);
  await mcp("create_work_item", { project_id: project.id, name: "Written by an agent", priority: "low" });
  await expect(page.getByText("Written by an agent").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  expect((await sampled(page)).frames).toBeGreaterThan(10);
  expect((await sampled(page)).min, "the agent refresh does not fade").toBe(1);

  // The layout switch dips the scroller and fades it back to 1 with no inline style left.
  await resetSamples(page);
  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.locator(".tessera-board").first()).toBeVisible();
  await expect.poll(async () => (await sampled(page)).min).toBeLessThan(1);
  expect((await sampled(page)).min).toBeGreaterThanOrEqual(0.3);
  await expectSettled(page);
});

/** Frames of the dropped card after the pointer is released: its inline translate, its box and the column body that clips it. */
type SettleFrame = { translate: string; left: number; right: number; top: number; bodyLeft: number; bodyRight: number };

async function recordSettle(page: Page, cardText: string): Promise<void> {
  await page.addInitScript((text: string) => {
    const frames: SettleFrame[] = [];
    (window as unknown as { __settle: SettleFrame[] }).__settle = frames;
    window.addEventListener(
      "pointerup",
      () => {
        const start = performance.now();
        const tick = () => {
          const card = [...document.querySelectorAll(".tessera-board-card")].find((element) => element.textContent?.includes(text)) as HTMLElement | undefined;
          if (card) {
            const rect = card.getBoundingClientRect();
            const body = card.closest(".tessera-board-column-body")?.getBoundingClientRect();
            frames.push({ translate: card.style.translate, left: rect.left, right: rect.right, top: rect.top, bodyLeft: body?.left ?? NaN, bodyRight: body?.right ?? NaN });
          }
          if (performance.now() - start < 1_500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      true,
    );
    type SettleFrame = { translate: string; left: number; right: number; top: number; bodyLeft: number; bodyRight: number };
  }, cardText);
}

test("a dropped board card glides from where the overlay let go into its slot", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "Glider" });
  await recordSettle(page, "Glider");
  await openLayout(page, project.id, "board");
  await waitForAppHydrated(page);

  const backlog = boardColumn(page, "Backlog");
  const card = backlog.locator(".tessera-board-card").filter({ hasText: "Glider" });
  await expect(card).toBeVisible();
  const target = boardColumn(page, "In Progress");
  await dragByPointer(page, card, target.locator(".tessera-board-column-body"), { offset: { x: 0, y: 60 } });

  // The card lands in the new column and its inline translate is gone.
  const landed = boardColumn(page, "In Progress").locator(".tessera-board-card").filter({ hasText: "Glider" });
  await expect(landed).toBeVisible();
  await expect.poll(() => landed.evaluate((element) => (element as HTMLElement).style.translate), { timeout: 5_000 }).toBe("");

  const frames = await page.evaluate(() => (window as unknown as { __settle: SettleFrame[] }).__settle);
  const glide = frames.filter((frame) => frame.translate !== "");
  expect(glide.length, `frames with a translate: ${JSON.stringify(frames.slice(0, 8))}`).toBeGreaterThanOrEqual(3);
  // The very first frame after the release already shows the card away from its slot (set before paint), not in it.
  const rest = frames[frames.length - 1]!;
  expect(frames[0]!.translate, "the first frame is already offset").not.toBe("");
  expect(Math.hypot(frames[0]!.left - rest.left, frames[0]!.top - rest.top), "starts away from the slot").toBeGreaterThan(20);
  // And it ends in the slot.
  const distances = glide.map((frame) => Math.hypot(frame.left - rest.left, frame.top - rest.top));
  expect(distances[distances.length - 1]!).toBeLessThan(distances[0]!);
  expect(rest.translate).toBe("");
});

test("a drop near the column's edge starts the glide inside the column: the whole card shows from the first frame", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "Edge glider" });
  await recordSettle(page, "Edge glider");
  await openLayout(page, project.id, "board");
  await waitForAppHydrated(page);

  const card = boardColumn(page, "Backlog").locator(".tessera-board-card").filter({ hasText: "Edge glider" });
  await expect(card).toBeVisible();
  // Let go 25px from the target column's right edge: the overlay's left edge is about 150px right of the slot, far beyond
  // the column body's 8px padding, so an unclamped start would sit outside the body (which clips it) until it slid back.
  const targetBody = boardColumn(page, "In Progress").locator(".tessera-board-column-body");
  await dragByPointer(page, card, targetBody, { offset: { x: 150, y: 60 } });

  const landed = boardColumn(page, "In Progress").locator(".tessera-board-card").filter({ hasText: "Edge glider" });
  await expect(landed).toBeVisible();
  await expect.poll(() => landed.evaluate((element) => (element as HTMLElement).style.translate), { timeout: 5_000 }).toBe("");

  const frames = await page.evaluate(() => (window as unknown as { __settle: SettleFrame[] }).__settle);
  const glide = frames.filter((frame) => frame.translate !== "");
  expect(glide.length, `frames with a translate: ${JSON.stringify(frames.slice(0, 6))}`).toBeGreaterThanOrEqual(3);
  for (const frame of glide) {
    expect(frame.left, `the card starts inside the body on the left: ${JSON.stringify(frame)}`).toBeGreaterThanOrEqual(frame.bodyLeft - 0.5);
    expect(frame.right, `the card starts inside the body on the right: ${JSON.stringify(frame)}`).toBeLessThanOrEqual(frame.bodyRight + 0.5);
  }
});

test("a card reordered inside its column settles too, and a cancelled drag does not", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "Alpha" });
  await mcp("create_work_item", { project_id: project.id, name: "Bravo" });
  await recordSettle(page, "Bravo");
  await openLayout(page, project.id, "board");
  await waitForAppHydrated(page);

  const backlog = boardColumn(page, "Backlog");
  const alpha = backlog.locator(".tessera-board-card").filter({ hasText: "Alpha" });
  const bravo = backlog.locator(".tessera-board-card").filter({ hasText: "Bravo" });
  await expect(bravo).toBeVisible();
  const alphaBox = (await alpha.boundingBox())!;
  await dragByPointer(page, bravo, alpha, { offset: { x: 0, y: -(alphaBox.height / 2 - 6) } });
  await expect(backlog.locator(".tessera-board-card").getByText(/^(Alpha|Bravo)$/)).toHaveText(["Bravo", "Alpha"]);
  await expect.poll(() => bravo.evaluate((element) => (element as HTMLElement).style.translate), { timeout: 5_000 }).toBe("");
  const frames = await page.evaluate(() => (window as unknown as { __settle: SettleFrame[] }).__settle);
  expect(frames.filter((frame) => frame.translate !== "").length, "a reorder glides too").toBeGreaterThanOrEqual(3);

  // Escape abandons a drag: nothing is dropped, so nothing settles.
  await page.evaluate(() => ((window as unknown as { __settle: SettleFrame[] }).__settle.length = 0));
  const again = backlog.locator(".tessera-board-card").filter({ hasText: "Bravo" });
  const box = (await again.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 40, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __settle: SettleFrame[] }).__settle.filter((frame) => frame.translate !== "").length)).toBe(0);
});

test("the quick-add placeholder fades in on Astryx's entry animation; real rows and the bulk bar behave", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "First" });
  await mcp("create_work_item", { project_id: project.id, name: "Second" });
  // Every row the page inserts, once, with the animation its computed style names the moment it is in the document.
  await page.addInitScript(() => {
    const seen: { pending: string[]; rows: string[] } = { pending: [], rows: [] };
    (window as unknown as { __entry: typeof seen }).__entry = seen;
    const counted = new WeakSet<Element>();
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const rows = [node, ...node.querySelectorAll<HTMLElement>(".tessera-wi-row")].filter((element) => element.classList.contains("tessera-wi-row"));
          for (const row of rows) {
            if (!row.isConnected || counted.has(row)) continue;
            counted.add(row);
            (row.classList.contains("tessera-wi-row-pending") ? seen.pending : seen.rows).push(getComputedStyle(row).animationName);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await openLayout(page, project.id, "list", { group_by: null });
  await waitForAppHydrated(page);
  await expect(page.getByText("Second", { exact: true })).toBeVisible();
  const entry = () => page.evaluate(() => (window as unknown as { __entry: { pending: string[]; rows: string[] } }).__entry);
  // Rows that rendered with the page (and from the server) never animate.
  const rendered = (await entry()).rows;
  expect(rendered.length).toBeGreaterThanOrEqual(2);
  expect(new Set(rendered), "rows that rendered with the page").toEqual(new Set(["none"]));

  await page.getByRole("button", { name: "New work item" }).last().click();
  await page.getByRole("textbox", { name: "New work item" }).fill("Fresh one");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Fresh one", { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await entry()).pending.length).toBeGreaterThan(0);
  const pending = (await entry()).pending;
  expect(pending[0], "the placeholder row plays an entry animation").not.toBe("none");
  await page.keyboard.press("Escape");

  // A write from another process: its row arrives on the refresh and stays still.
  await mcp("create_work_item", { project_id: project.id, name: "From an agent" });
  await expect(page.getByText("From an agent", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(new Set((await entry()).rows), "rows never animate").toEqual(new Set(["none"]));

  // The bulk bar rises: it mounts with an animation and keeps its sticky place.
  await page.getByRole("checkbox", { name: `Select ${project.identifier}-1` }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar).toBeVisible();
  const animation = await bar.evaluate((element) => ({ name: getComputedStyle(element).animationName, position: getComputedStyle(element).position }));
  expect(animation.name).not.toBe("none");
  expect(animation.position).toBe("sticky");
  await page.waitForTimeout(600);
  await expect.poll(() => bar.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
});

/**
 * Samples the quick-add placeholder (`selector`) at every frame from the moment it exists: its effective opacity (the
 * computed opacity times the filter's opacity(x), the way the page dims it) and whether a CSS animation is still running.
 */
async function recordPlaceholder(page: Page, selector: string): Promise<void> {
  await page.addInitScript((selector: string) => {
    const frames: Array<{ alpha: number; running: boolean }> = [];
    (window as unknown as { __placeholder: typeof frames }).__placeholder = frames;
    const tick = () => {
      const element = document.querySelector(selector);
      if (element) {
        const style = getComputedStyle(element);
        const dim = /opacity\(([\d.]+)\)/.exec(style.filter);
        frames.push({ alpha: parseFloat(style.opacity) * (dim ? parseFloat(dim[1]!) : 1), running: element.getAnimations().some((animation) => animation instanceof CSSAnimation) });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
}

/** Holds the first Server Action POST after `hold()` until `release()`, so the placeholder outlives its own fade. */
async function holdNextAction(page: Page): Promise<{ hold: () => void; release: () => void }> {
  let armed = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (armed && request.method() === "POST" && request.headers()["next-action"] !== undefined) {
      armed = false;
      await gate;
    }
    await route.continue();
  });
  return { hold: () => (armed = true), release: () => release() };
}

/**
 * The placeholder's fade ends at its resting dimming with no pop: Astryx's fadeIn drives `opacity` from 0 to 1, so a rule
 * that rested at `opacity: 0.6` climbed to 1 and dropped to 0.6 when the animation ended. Every sampled frame stays at or
 * below 0.6 (within a rounding margin) and, once the animation is over, sits at 0.6.
 */
async function expectNoPop(page: Page): Promise<void> {
  const read = () => page.evaluate(() => (window as unknown as { __placeholder: Array<{ alpha: number; running: boolean }> }).__placeholder.slice());
  await expect.poll(async () => (await read()).filter((frame) => !frame.running).length, { timeout: 10_000 }).toBeGreaterThan(3);
  const frames = await read();
  expect(frames.some((frame) => frame.running), "the fade ran").toBe(true);
  const peak = Math.max(...frames.map((frame) => frame.alpha));
  expect(peak, `no frame is brighter than the resting dimming: ${frames.map((frame) => frame.alpha.toFixed(2)).join(",")}`).toBeLessThanOrEqual(0.62);
  const settled = frames.slice(frames.findIndex((frame) => !frame.running));
  for (const frame of settled) expect(frame.alpha, "at rest after the fade").toBeCloseTo(0.6, 1);
}

test("the quick-add placeholder row fades to its resting dimming without a pop", async ({ page }) => {
  const project = await createProjectViaMcp();
  await mcp("create_work_item", { project_id: project.id, name: "First" });
  await recordPlaceholder(page, ".tessera-wi-row-pending");
  const gate = await holdNextAction(page);
  await openLayout(page, project.id, "list", { group_by: null });
  await waitForAppHydrated(page);

  await page.getByRole("button", { name: "New work item" }).last().click();
  await page.getByRole("textbox", { name: "New work item" }).fill("Held row");
  gate.hold();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tessera-wi-row-pending")).toBeVisible();
  await expectNoPop(page);
  gate.release();
  await expect(page.locator(".tessera-wi-row-pending")).toHaveCount(0);
});

test("the quick-add placeholder card fades to its resting dimming without a pop", async ({ page }) => {
  const project = await createProjectViaMcp();
  await recordPlaceholder(page, ".tessera-board-card-pending");
  const gate = await holdNextAction(page);
  await openLayout(page, project.id, "board");
  await waitForAppHydrated(page);

  // The column has two such buttons (the header's plus and the footer's quick-add row); the footer's opens the input.
  await page.getByRole("button", { name: "Add a work item to Backlog", exact: true }).last().click();
  await page.getByRole("textbox", { name: "Add a work item to Backlog" }).fill("Held card");
  gate.hold();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tessera-board-card-pending")).toBeVisible();
  await expectNoPop(page);
  gate.release();
  await expect(page.locator(".tessera-board-card-pending")).toHaveCount(0);
});
