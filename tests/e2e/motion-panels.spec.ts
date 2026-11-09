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
 * Where the peek covers the list (a container under 640 px: 768 and 375 px here) it fades in and out instead of
 * sliding. The slide never widens the project's scroller (the nested Layout clips the x axis), the leaving panel is
 * inert, and nothing animates for the browser's Back and Forward (an open, an item switch).
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

/** What `recordFrames` samples of the peek: at each of its animation starts and on every frame while it enters or exits. */
type Frame = {
  phase: string;
  entering: boolean;
  exiting: boolean;
  inert: boolean;
  focusInside: boolean;
  translate: string;
  opacity: number;
  /** The project frame's scroller (the nearest LayoutContent above the peek's nested Layout). */
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
};

/**
 * Samples the peek panel and the project's scroller into window.__frames: at each `animationstart` of the panel
 * (`start <keyframes>`) and on every animation frame while it carries `data-enter` or `data-exiting` (`frame`).
 */
async function recordFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: unknown[] = [];
    (window as unknown as { __frames: unknown[] }).__frames = frames;
    const sample = (phase: string, panel: Element) => {
      const scroller = document.querySelector(".tessera-peek-layout")?.closest(".astryx-layout-content");
      const style = getComputedStyle(panel);
      frames.push({
        phase,
        entering: panel.hasAttribute("data-enter"),
        exiting: panel.hasAttribute("data-exiting"),
        inert: panel.hasAttribute("inert"),
        focusInside: panel.contains(document.activeElement),
        translate: style.translate,
        opacity: parseFloat(style.opacity),
        scrollWidth: scroller?.scrollWidth ?? -1,
        clientWidth: scroller?.clientWidth ?? -1,
        scrollLeft: scroller?.scrollLeft ?? -1,
      });
    };
    document.addEventListener(
      "animationstart",
      (event) => {
        if (event.target instanceof Element && event.target.matches(".tessera-peek-panel")) sample(`start ${(event as AnimationEvent).animationName}`, event.target);
      },
      true,
    );
    const tick = () => {
      const panel = document.querySelector(".tessera-peek-panel");
      if (panel && (panel.hasAttribute("data-enter") || panel.hasAttribute("data-exiting"))) sample("frame", panel);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const framesOf = (page: Page): Promise<Frame[]> => page.evaluate(() => [...(window as unknown as { __frames: Frame[] }).__frames]);
const clearFrames = (page: Page): Promise<void> => page.evaluate(() => void ((window as unknown as { __frames: unknown[] }).__frames.length = 0));

/** The project's scroller never gained width and never scrolled sideways, at an animation start and mid-animation. */
function expectScrollerStill(frames: Frame[]): void {
  expect(frames.some((frame) => frame.phase.startsWith("start")), "an animation start was sampled").toBe(true);
  expect(frames.some((frame) => frame.phase === "frame"), "a mid-animation frame was sampled").toBe(true);
  for (const frame of frames) {
    expect(frame.clientWidth, `the scroller was found: ${JSON.stringify(frame)}`).toBeGreaterThan(0);
    expect(frame.scrollWidth, `scrollWidth <= clientWidth: ${JSON.stringify(frame)}`).toBeLessThanOrEqual(frame.clientWidth);
    expect(frame.scrollLeft, `scrollLeft stays 0: ${JSON.stringify(frame)}`).toBe(0);
  }
}

/**
 * The panel's exit ran to its end: one slide-out start, no cancel, the panel gone last, and at least 60 ms
 * between the start event and the panel going (the exit is 140 ms, but `animationstart` is dispatched a frame or two
 * after the animation began, so a loaded run measures about 95 ms; an exit that was skipped measures about 0).
 */
async function expectExitRanToEnd(page: Page, name: "peek" | "assistant", keyframes = "tessera-slide-out-end"): Promise<void> {
  const { log, times } = await page.evaluate(() => ({ log: [...(window as unknown as { __panelEvents: string[] }).__panelEvents], times: [...(window as unknown as { __panelTimes: number[] }).__panelTimes] }));
  const start = log.indexOf(`${name} start ${keyframes}`);
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
    await recordFrames(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);

    // Close button, with the focus back on the row's key button afterwards (decision 11).
    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expectSettled(page, PEEK);
    await clearEvents(page);
    await clearFrames(page);
    await peekPanel(page).getByRole("button", { name: "Close" }).first().click();
    await expect(page).not.toHaveURL(/peek=/);
    await expect(page.locator(PEEK)).toHaveCount(0);
    await expectExitRanToEnd(page, "peek");
    await expect(keyButton(page, project.identifier, 1)).toBeFocused();
    // The leaving panel is inert from its first frame on, with no focus inside it.
    const leaving = (await framesOf(page)).filter((frame) => frame.exiting);
    expect(leaving.length, "the exit was sampled").toBeGreaterThan(0);
    for (const frame of leaving) {
      expect(frame.inert, `inert while leaving: ${JSON.stringify(frame)}`).toBe(true);
      expect(frame.focusInside, `no focus inside while leaving: ${JSON.stringify(frame)}`).toBe(false);
    }

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

test.describe("the peek and the project's scroller", () => {
  test("slides in and out at 1280 px without widening the scroller or scrolling it sideways", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await recordPanels(page);
    await recordFrames(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await clearEvents(page);
    await clearFrames(page);

    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expect.poll(() => events(page)).toEqual(["peek appeared", "peek start tessera-slide-in-end", "peek end tessera-slide-in-end"]);
    await expectSettled(page, PEEK);
    const entering = await framesOf(page);
    expectScrollerStill(entering);
    expect(entering.some((frame) => frame.translate !== "none"), "the slide moved the panel").toBe(true);

    await clearFrames(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(PEEK)).toHaveCount(0);
    await expectExitRanToEnd(page, "peek");
    const leaving = await framesOf(page);
    expectScrollerStill(leaving);
    expect(leaving.some((frame) => frame.translate !== "none"), "the exit moved the panel").toBe(true);
  });

  test("control: without the clip the same slide widens the scroller", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await recordFrames(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await page.addStyleTag({ content: ".tessera-peek-layout { overflow-x: visible !important; }" });
    await clearFrames(page);
    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expectSettled(page, PEEK);
    const entering = await framesOf(page);
    expect(entering.some((frame) => frame.scrollWidth > frame.clientWidth), `the sampler sees the overflow the clip removes: ${JSON.stringify(entering[0])}`).toBe(true);
  });

  for (const [width, height] of [
    [768, 1024],
    [375, 812],
  ] as const) {
    test(`at ${width} px the peek covers the list and fades in and out: opacity moves, translate never does`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await recordPanels(page);
      await recordFrames(page);
      const project = await projectWithTwoItems();
      await openWorkItems(page, project.id);
      await waitForAppHydrated(page);
      await clearEvents(page);
      await clearFrames(page);

      await keyButton(page, project.identifier, 1).click();
      await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
      await expect.poll(() => events(page)).toEqual(["peek appeared", "peek start tessera-fade-in", "peek end tessera-fade-in"]);
      await expectSettled(page, PEEK);
      const entering = await framesOf(page);
      expectScrollerStill(entering);
      for (const frame of entering) expect(frame.translate, `no translate while it fades in: ${JSON.stringify(frame)}`).toBe("none");
      expect(entering.some((frame) => frame.opacity < 1), "the panel faded in").toBe(true);

      await clearEvents(page);
      await clearFrames(page);
      await peekPanel(page).getByRole("button", { name: "Close" }).first().click();
      await expect(page.locator(PEEK)).toHaveCount(0);
      await expectExitRanToEnd(page, "peek", "tessera-fade-out");
      const leaving = await framesOf(page);
      expectScrollerStill(leaving);
      for (const frame of leaving) expect(frame.translate, `no translate while it fades out: ${JSON.stringify(frame)}`).toBe("none");
      expect(leaving.some((frame) => frame.opacity < 1), "the panel faded out").toBe(true);
      await expect(keyButton(page, project.identifier, 1)).toBeFocused();
    });
  }
});

test.describe("the browser's Back and Forward", () => {
  test("nothing slides for an open that Forward brings, and a click after them still slides", async ({ page }) => {
    await recordPanels(page);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await expectSettled(page, PEEK);

    // Open, close (the close goes Back, which is the panel's own and counts for nothing), Forward.
    await page.keyboard.press("Escape");
    await expect(page.locator(PEEK)).toHaveCount(0);
    await expectExitRanToEnd(page, "peek");
    await clearEvents(page);
    await page.goForward();
    await expect(page).toHaveURL(/peek=/);
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await page.waitForTimeout(600);
    expect((await events(page)).filter((event) => / (start|end|cancel) /.test(event))).toEqual([]);
    await expectSettled(page, PEEK);

    // The browser's own Back closes it at once, with no exit; Forward brings it again, still without a slide.
    await clearEvents(page);
    await page.goBack();
    await expect(page).not.toHaveURL(/peek=/);
    await expect(page.locator(PEEK)).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/peek=/);
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await page.waitForTimeout(600);
    expect((await events(page)).filter((event) => / (start|end|cancel) /.test(event))).toEqual([]);
    await expectSettled(page, PEEK);

    // A click on a row once the history step has passed is a user's open again: it slides.
    await page.waitForTimeout(1_100);
    await page.keyboard.press("Escape");
    await expect(page.locator(PEEK)).toHaveCount(0);
    await clearEvents(page);
    await keyButton(page, project.identifier, 2).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Switch to me" })).toBeVisible();
    await expect.poll(() => events(page)).toEqual(["peek appeared", "peek start tessera-slide-in-end", "peek end tessera-slide-in-end"]);
  });

  test("the mount node does not dip when Back or Forward moves between two peeked items", async ({ page }) => {
    await recordPanels(page);
    await page.addInitScript(() => {
      const state = { min: 1 };
      (window as unknown as { __nodeFade: typeof state }).__nodeFade = state;
      const tick = () => {
        const node = document.querySelector(".tessera-peek-node");
        if (node) state.min = Math.min(state.min, parseFloat(getComputedStyle(node).opacity));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const dipped = () => page.evaluate(() => (window as unknown as { __nodeFade: { min: number } }).__nodeFade.min);
    const project = await projectWithTwoItems();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await keyButton(page, project.identifier, 1).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    // A click on the second row switches in place: that is a user's switch and it dips.
    await keyButton(page, project.identifier, 2).click();
    await expect(peekPanel(page).getByRole("heading", { name: "Switch to me" })).toBeVisible();
    await expect.poll(dipped).toBeLessThan(1);
    const node = page.locator(".tessera-peek-node");
    await expect.poll(() => node.evaluate((element) => (element as HTMLElement).style.opacity)).toBe("");
    await page.evaluate(() => void ((window as unknown as { __nodeFade: { min: number } }).__nodeFade.min = 1));

    // Back to the first item, Forward to the second: both restore a place, and neither dips it.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`peek=${project.ids[0]}`));
    await expect(peekPanel(page).getByRole("heading", { name: "Slide me in" })).toBeVisible();
    await page.waitForTimeout(700);
    expect(await dipped()).toBe(1);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`peek=${project.ids[1]}`));
    await expect(peekPanel(page).getByRole("heading", { name: "Switch to me" })).toBeVisible();
    await page.waitForTimeout(700);
    expect(await dipped()).toBe(1);
    await expectSettled(page, PEEK);
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
