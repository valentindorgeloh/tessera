import type { Page } from "@playwright/test";
import { createProjectViaMcp, expect, mcp, openWorkItems, test } from "./fixtures";
import { modifierKey } from "./helpers-b";
import { waitForAppHydrated } from "./helpers-d";

/**
 * Panel motion (docs/contracts/ui.md "Motion"), with motion ON: the suite runs with reducedMotion "reduce"
 * (playwright.config.ts) and this file opts back in; the last describe runs Reduce Motion with a mouse.
 *
 * The side peek and the assistant panel slide in from the end edge when they OPEN after mount (225 ms, the
 * `tessera-slide-in-end` keyframes) and out on close (140 ms, `tessera-slide-out-end`, held out until the panel
 * unmounts). Never on hydration: a `?peek=` deep link, and the assistant's stored open state after a reload.
 * A peek close starts its navigation at once; the host keeps the leaving panel on screen so the exit runs to its
 * `animationend` before the panel goes (a cut exit would end in `animationcancel`). Switching the peek to another
 * item dips the shared mount node and fades it back.
 *
 * An in-page recorder (installed before the first script of every document) logs the panels' CSS animation events
 * and when each panel appears and goes, each with its time, so a one-frame animation or an unmount that cut one still
 * shows. An exit that ran to its end took the full 140 ms between its start and the panel going and logged no cancel
 * (a panel that goes the moment its exit ends may log no `end`: the unmount can come before the event is dispatched).
 */
test.use({ reducedMotion: "no-preference" });

type Events = string[];

/** Records `<panel> start|end|cancel <keyframes>` for the two panels, and `<panel> appeared|gone`, into window.__panelEvents. */
async function recordPanels(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events: string[] = [];
    const times: number[] = [];
    (window as unknown as { __panelEvents: string[]; __panelTimes: number[] }).__panelEvents = events;
    (window as unknown as { __panelTimes: number[] }).__panelTimes = times;
    const log = (text: string) => {
      events.push(text);
      times.push(performance.now());
    };
    const selector = ".tessera-peek-panel, .tessera-ai-panel";
    const label = (element: Element): string => (element.classList.contains("tessera-peek-panel") ? "peek" : "assistant");
    for (const type of ["animationstart", "animationend", "animationcancel"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          if (target instanceof Element && target.matches(selector)) log(`${label(target)} ${type.replace("animation", "")} ${(event as AnimationEvent).animationName}`);
        },
        true,
      );
    }
    const present = new Set<string>();
    const scan = () => {
      const now = new Set([...document.querySelectorAll(selector)].map(label));
      for (const name of now) if (!present.has(name)) log(`${name} appeared`);
      for (const name of present) if (!now.has(name)) log(`${name} gone`);
      present.clear();
      for (const name of now) present.add(name);
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  });
}

const events = (page: Page): Promise<Events> => page.evaluate(() => [...(window as unknown as { __panelEvents: string[] }).__panelEvents]);
const clearEvents = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as { __panelEvents: string[] }).__panelEvents.length = 0;
    (window as unknown as { __panelTimes: number[] }).__panelTimes.length = 0;
  });

/**
 * The panel's exit ran to its end: one slide-out start, no cancel, the panel gone last, and at least 60 ms
 * between the start event and the panel going (the exit is 140 ms, but `animationstart` is dispatched a frame or two
 * after the animation began, so a loaded run measures about 95 ms; an exit that was skipped measures about 0).
 */
async function expectExitRanToEnd(page: Page, name: "peek" | "assistant"): Promise<void> {
  const { log, times } = await page.evaluate(() => ({ log: [...(window as unknown as { __panelEvents: string[] }).__panelEvents], times: [...(window as unknown as { __panelTimes: number[] }).__panelTimes] }));
  const start = log.indexOf(`${name} start tessera-slide-out-end`);
  expect(start, `${name} exit started: ${log.join(", ")}`).toBeGreaterThanOrEqual(0);
  expect(log.filter((event) => event.includes(" cancel ")), "no cancelled animation").toEqual([]);
  expect(log.at(-1)).toBe(`${name} gone`);
  expect(times.at(-1)! - times[start]!).toBeGreaterThanOrEqual(60);
}

const PEEK = ".tessera-peek-panel";
const ASSISTANT = ".tessera-ai-panel";

/** The assistant's shortcut (`mod+j`): the modifier the page reads, which is not Playwright's `ControlOrMeta` on every host (helpers-b). */
async function toggleAssistantKey(page: Page): Promise<string> {
  return `${await modifierKey(page)}+j`;
}

/** The panel shows as it is: no enter or exit marker, no transform, full opacity. */
async function expectSettled(page: Page, selector: string): Promise<void> {
  const panel = page.locator(selector);
  await expect(panel).toHaveCount(1);
  await expect(panel).not.toHaveAttribute("data-enter", "");
  await expect(panel).not.toHaveAttribute("data-exiting", "");
  await expect(panel).toHaveCSS("translate", "none");
  await expect(panel).toHaveCSS("opacity", "1");
}

async function projectWithTwoItems(): Promise<{ id: string; identifier: string; ids: string[] }> {
  const project = await createProjectViaMcp();
  const first = await mcp<{ id: string }>("create_work_item", { project_id: project.id, name: "Slide me in" });
  const second = await mcp<{ id: string }>("create_work_item", { project_id: project.id, name: "Switch to me" });
  return { id: project.id, identifier: project.identifier, ids: [first.id, second.id] };
}

const keyButton = (page: Page, identifier: string, sequence: number) => page.getByRole("button", { name: `${identifier}-${sequence}`, exact: true });
const peekPanel = (page: Page) => page.getByRole("complementary", { name: "Work item" });
const assistantPanel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });

test.describe("the peek", () => {
  test("slides in when it opens after mount", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await clearEvents(page);

    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expect.poll(() => events(page)).toEqual(["peek appeared", "peek start tessera-slide-in-end", "peek end tessera-slide-in-end"]);
    await expectSettled(page, PEEK);
    // The content card clips the slide: the page never scrolls sideways for it.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("does not slide for a ?peek= deep link", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id, `?peek=${project.ids[0]}`);
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await page.waitForTimeout(1_000);
    // A freshly streamed page may client-render its list once (the panel then goes and appears again): still no animation.
    expect((await events(page)).filter((event) => / (start|end|cancel) /.test(event))).toEqual([]);
    await expectSettled(page, PEEK);
  });

  test("slides out on Escape and on the Close button, and the exit runs to its end before the panel goes", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);

    // Close button, with the focus back on the row's key button afterwards (decision 11).
    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expectSettled(page, PEEK);
    await clearEvents(page);
    await peekPanel(page).getByRole("button", { name: "Close" }).first().click();
    await expect(page).not.toHaveURL(/peek=/);
    await expect(page.locator(PEEK)).toHaveCount(0);
    await expectExitRanToEnd(page, "peek");
    await expect(keyButton(page, project.identifier, 1)).toBeFocused();

    // Escape, from the detail.
    await keyButton(page, project.identifier, 2).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Switch to me" })).toBeVisible();
    await expectSettled(page, PEEK);
    await clearEvents(page);
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/peek=/);
    await expect(page.locator(PEEK)).toHaveCount(0);
    await expectExitRanToEnd(page, "peek");
  });

  test("a second close while it leaves does nothing, and a peek reopened after the exit slides in again", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expectSettled(page, PEEK);
    await clearEvents(page);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator(PEEK)).toHaveCount(0);
    await expect(page).not.toHaveURL(/peek=/);
    // One exit, one removal; a second navigation would have replaced or popped another entry.
    await expectExitRanToEnd(page, "peek");
    expect((await events(page)).filter((event) => event.includes(" start "))).toEqual(["peek start tessera-slide-out-end"]);
    expect(page.url()).toContain(`/projects/${project.id}/work-items`);

    await clearEvents(page);
    await keyButton(page, project.identifier, 2).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Switch to me" })).toBeVisible();
    await expect.poll(() => events(page)).toEqual(["peek appeared", "peek start tessera-slide-in-end", "peek end tessera-slide-in-end"]);
  });

  test("switching to another item dips the mount node and fades it back, and the panel itself stays", async ({ page }) => {
    await recordPanels(page);
    // An in-page sampler of the shared mount node's opacity, from the first frame of each document.
    await page.addInitScript(() => {
      const state = { min: 1, frames: 0 };
      (window as unknown as { __nodeFade: typeof state }).__nodeFade = state;
      const tick = () => {
        const node = document.querySelector(".tessera-peek-node");
        if (node) {
          state.frames += 1;
          state.min = Math.min(state.min, parseFloat(getComputedStyle(node).opacity));
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expectSettled(page, PEEK);
    expect((await page.evaluate(() => (window as unknown as { __nodeFade: { min: number } }).__nodeFade.min))).toBe(1);
    await clearEvents(page);

    await keyButton(page, project.identifier, 2).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Switch to me" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __nodeFade: { min: number } }).__nodeFade.min)).toBeLessThan(1);
    expect(await page.evaluate(() => (window as unknown as { __nodeFade: { min: number } }).__nodeFade.min)).toBeGreaterThanOrEqual(0.3);
    // Settled: full opacity and no inline style left (a stacking context must not outlive the fade).
    const node = page.locator(".tessera-peek-node");
    await expect(node).toHaveCSS("opacity", "1");
    await expect.poll(() => node.evaluate((element) => (element as HTMLElement).style.opacity)).toBe("");
    // The panel did not slide or leave for it.
    expect(await events(page)).toEqual([]);
  });
});

test.describe("the assistant panel", () => {
  test("slides in when it opens, slides out on Close, and reopens at once when toggled during the exit", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await clearEvents(page);

    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(assistantPanel(page)).toBeVisible();
    await expect.poll(() => events(page)).toEqual(["assistant appeared", "assistant start tessera-slide-in-end", "assistant end tessera-slide-in-end"]);
    await expectSettled(page, ASSISTANT);

    // Close: the exit runs to its end, then the panel goes.
    await clearEvents(page);
    await assistantPanel(page).getByRole("button", { name: "Close" }).click();
    await expect(page.locator(ASSISTANT)).toHaveCount(0);
    await expectExitRanToEnd(page, "assistant");

    // Open again, then toggle twice within the exit: the second toggle takes the exit back and the panel stays.
    await page.keyboard.press(await toggleAssistantKey(page));
    await expect(assistantPanel(page)).toBeVisible();
    await expectSettled(page, ASSISTANT);
    await clearEvents(page);
    await page.keyboard.press(await toggleAssistantKey(page));
    await expect.poll(() => page.locator(ASSISTANT).getAttribute("data-exiting")).toBe("");
    await page.keyboard.press(await toggleAssistantKey(page));
    await expect(page.locator(ASSISTANT)).not.toHaveAttribute("data-exiting", "");
    await page.waitForTimeout(500);
    await expect(assistantPanel(page)).toBeVisible();
    expect(await events(page)).not.toContain("assistant gone");
    await expectSettled(page, ASSISTANT);
  });

  test("does not slide for the open state that comes back after a reload", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(assistantPanel(page)).toBeVisible();
    await expectSettled(page, ASSISTANT);

    await page.reload();
    await expect(assistantPanel(page)).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await events(page)).toEqual(["assistant appeared"]);
    await expectSettled(page, ASSISTANT);
    // Closing it still slides out.
    await clearEvents(page);
    await page.keyboard.press(await toggleAssistantKey(page));
    await expect(page.locator(ASSISTANT)).toHaveCount(0);
    await expectExitRanToEnd(page, "assistant");
  });
});

test.describe("Reduce Motion with a mouse", () => {
  test.use({ reducedMotion: "reduce" });

  test("the peek and the assistant open and close at once, with no animation", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await clearEvents(page);

    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await peekPanel(page).getByRole("button", { name: "Close" }).first().click();
    await expect(page.locator(PEEK)).toHaveCount(0);
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await expect(assistantPanel(page)).toBeVisible();
    await page.keyboard.press(await toggleAssistantKey(page));
    await expect(page.locator(ASSISTANT)).toHaveCount(0);
    expect((await events(page)).filter((event) => / (start|end|cancel) /.test(event))).toEqual([]);
  });
});
