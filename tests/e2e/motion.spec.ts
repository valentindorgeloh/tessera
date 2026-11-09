import type { Page } from "@playwright/test";
import { parseDurationMs } from "@/components/shell/layout-motion";
import { createProjectViaMcp, expect, openWorkItems, test, type CreatedProject } from "./fixtures";
import { createItem } from "./helpers-a";
import { waitForAppHydrated } from "./helpers-d";
import { visibleScroller, visibleScrollerSource } from "./helpers-p12";

/**
 * Layout motion (decisions 132–133): the sidebar panel's width animation, the
 * peek card slide with its guarded close, the layout and zoom fade, and the
 * floating panel's transition, each with `prefers-reduced-motion: reduce`.
 *
 * Every `Element.animate` call is recorded by an init script (`window.__anims`),
 * so a check does not depend on catching a 280 ms animation in flight; where the
 * contract asks for a running animation, the page reads `getAnimations()` in the
 * same task as the action that starts it.
 */

type Recorded = { cls: string; props: string[] };

async function recordAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as { __anims: { cls: string; props: string[] }[] };
    host.__anims = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function animate(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
      const first = Array.isArray(keyframes) ? (keyframes[0] ?? {}) : (keyframes ?? {});
      host.__anims.push({ cls: typeof this.className === "string" ? this.className : "", props: Object.keys(first).filter((key) => key !== "offset" && key !== "easing" && key !== "composite") });
      return original.call(this, keyframes, options);
    };
  });
}

async function recorded(page: Page): Promise<Recorded[]> {
  return page.evaluate(() => (window as unknown as { __anims?: Recorded[] }).__anims ?? []);
}

async function clearRecorded(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __anims?: Recorded[] }).__anims = [];
  });
}

async function loadHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible({ timeout: 30_000 });
  await waitForAppHydrated(page);
}

/** A project with three items; returns it with the first item's key and name. */
async function smallProject(): Promise<{ project: CreatedProject; key: string; name: string; id: string }> {
  const project = await createProjectViaMcp();
  const first = await createItem(project.id, "Motion first");
  await createItem(project.id, "Motion second");
  await createItem(project.id, "Motion third");
  return { project, key: first.key, name: "Motion first", id: first.id };
}

const peekCard = (page: Page) => page.locator(".tessera-peek-card:visible");
const peekPanel = (page: Page) => page.locator(".tessera-peek-panel:visible");

/** Watches the visible peek panel and the URL from now on: whether the panel got data-motion="closing" and inert, and URL samples per frame. */
async function watchClose(page: Page): Promise<void> {
  await page.evaluate(() => {
    const panel = [...document.querySelectorAll<HTMLElement>(".tessera-peek-panel")].find((el) => el.offsetParent !== null);
    const state = { closing: false, inert: false, peekWhenClosing: false, samples: [] as { t: number; peek: boolean }[], start: performance.now() };
    (window as unknown as { __close: typeof state }).__close = state;
    if (panel === undefined) return;
    const check = () => {
      if (panel.getAttribute("data-motion") === "closing" && !state.closing) {
        state.closing = true;
        state.inert = panel.hasAttribute("inert");
        state.peekWhenClosing = new URL(window.location.href).searchParams.has("peek");
      }
    };
    new MutationObserver(check).observe(panel, { attributes: true, attributeFilter: ["data-motion", "inert"] });
    const sample = (t: number) => {
      state.samples.push({ t: t - state.start, peek: new URL(window.location.href).searchParams.has("peek") });
      if (t - state.start < 2000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

type CloseState = { closing: boolean; inert: boolean; peekWhenClosing: boolean; samples: { t: number; peek: boolean }[] };

async function closeState(page: Page): Promise<CloseState> {
  return page.evaluate(() => (window as unknown as { __close: CloseState }).__close);
}

type CardFrame = { transform: boolean; panel: number; skeleton: boolean; editor: boolean };

/**
 * Resolves on the first animation frame in which a visible peek card exists (start it before the click that opens
 * the peek): whether the card then has a running transform animation, the panel's width, and what the card holds.
 */
function firstCardFrame(page: Page): Promise<CardFrame> {
  return page.evaluate(
    () =>
      new Promise<CardFrame>((resolve, reject) => {
        const started = performance.now();
        const check = () => {
          const card = [...document.querySelectorAll<HTMLElement>(".tessera-peek-card")].find((el) => el.offsetParent !== null);
          if (card === undefined) {
            if (performance.now() - started > 10_000) reject(new Error("no peek card within 10 s"));
            else requestAnimationFrame(check);
            return;
          }
          resolve({
            transform: card.getAnimations().some((animation) => animation.playState === "running" && ((animation.effect as KeyframeEffect | null)?.getKeyframes() ?? []).some((frame) => "transform" in frame)),
            panel: card.closest<HTMLElement>(".tessera-peek-panel")?.getBoundingClientRect().width ?? -1,
            skeleton: card.querySelector('[class*="skeleton" i]') !== null,
            editor: card.querySelector(".ProseMirror") !== null,
          });
        };
        requestAnimationFrame(check);
      }),
  );
}

async function openPeek(page: Page, key: string, name: string): Promise<void> {
  await visibleScroller(page).getByRole("button", { name: key, exact: true }).click();
  // Decision 142: the lazy detail can arrive 300 ms or more after the skeleton; close only a loaded detail.
  await expect(peekCard(page).getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
}

test.describe("sidebar width motion", () => {
  test("the motion token is 280 ms", async ({ page }) => {
    await loadHome(page);
    const raw = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--duration-medium"));
    expect(parseDurationMs(raw), `--duration-medium is ${JSON.stringify(raw)}`).toBe(280);
  });

  for (const rail of ["icons", "labels"] as const) {
    test(`collapsing to the ${rail} rail animates the panel's width, and expanding reveals a nav that is already at full width`, async ({ page }) => {
      await loadHome(page);
      if (rail === "labels") {
        await page.evaluate(() => window.localStorage.setItem("tessera.nav.v1", JSON.stringify({ display: "full", rail: "labels", dock: "docked" })));
        await loadHome(page);
      }
      const running = await page.evaluate(() => {
        document.getElementById("tessera-nav-toggle")!.click();
        const panel = document.querySelector<HTMLElement>(".astryx-app-shell-sidenav")!;
        return panel.getAnimations().some((animation) => animation.playState === "running");
      });
      expect(running, "the panel has a running animation right after the click").toBe(true);
      await page.waitForTimeout(600);
      const railWidth = rail === "labels" ? 60 : 48;
      const settled = await page.evaluate(() => ({
        panel: Math.round(document.querySelector(".astryx-app-shell-sidenav")!.getBoundingClientRect().width),
        nav: Math.round(document.querySelector('nav[aria-label="Work"]')!.getBoundingClientRect().width),
      }));
      expect(settled.nav, "nav width").toBe(railWidth);
      expect(settled.panel, "panel width").toBe(railWidth);

      // About 100 ms into the expand: the nav is at its final width already and the panel clips it.
      const mid = await page.evaluate(() => {
        document.getElementById("tessera-nav-toggle")!.click();
        const panel = document.querySelector<HTMLElement>(".astryx-app-shell-sidenav")!;
        const animation = panel.getAnimations()[0];
        if (animation === undefined) return null;
        animation.pause();
        animation.currentTime = 100;
        const result = {
          nav: Math.round(document.querySelector('nav[aria-label="Work"]')!.getBoundingClientRect().width),
          panel: panel.getBoundingClientRect().width,
          scrollWidth: panel.scrollWidth,
          clientWidth: panel.clientWidth,
        };
        animation.play();
        return result;
      });
      expect(mid, "an expand animation exists").not.toBeNull();
      expect(mid!.nav, "nav width 100 ms into the expand").toBe(250);
      expect(mid!.panel, "panel width 100 ms into the expand").toBeLessThan(250);
      expect(mid!.scrollWidth, "the panel does not scroll sideways").toBeLessThanOrEqual(mid!.clientWidth);
    });
  }

  test("under reduced motion nothing animates and the rail width applies in the same frame", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadHome(page);
    const result = await page.evaluate(() => {
      document.getElementById("tessera-nav-toggle")!.click();
      const panel = document.querySelector<HTMLElement>(".astryx-app-shell-sidenav")!;
      return { animations: panel.getAnimations().length, width: Math.round(panel.getBoundingClientRect().width) };
    });
    expect(result).toEqual({ animations: 0, width: 48 });
  });
});

test.describe("peek motion", () => {
  test("open slides the card while the panel takes its width at once; Escape slides it out, then drops peek and refocuses the key", async ({ page }) => {
    const { project, key, name } = await smallProject();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    const watch = firstCardFrame(page);
    await visibleScroller(page).getByRole("button", { name: key, exact: true }).click();
    const atOpen = await watch;
    expect(atOpen.transform, "the card has a running transform animation").toBe(true);
    await expect(peekCard(page).getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });
    const panelLater = (await peekPanel(page).boundingBox())!.width;
    expect(Math.abs(panelLater - atOpen.panel), "the panel had its final width at once").toBeLessThanOrEqual(1);

    await watchClose(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.has("peek")), { message: "peek drops from the URL" }).toBe(false);
    const state = await closeState(page);
    expect(state.closing, 'the panel got data-motion="closing"').toBe(true);
    expect(state.inert, "the closing panel is inert").toBe(true);
    expect(state.peekWhenClosing, "the URL keeps peek while the card slides").toBe(true);
    const dropped = state.samples.find((sample) => !sample.peek);
    expect(dropped, "a frame without peek").toBeDefined();
    expect(dropped!.t, "peek dropped after the slide").toBeGreaterThanOrEqual(200);
    expect(dropped!.t, "peek dropped within 600 ms").toBeLessThanOrEqual(600);
    await expect(visibleScroller(page).getByRole("button", { name: key, exact: true })).toBeFocused();
  });

  test("Escape twice within 50 ms closes once and stays on the list", async ({ page }) => {
    const { project, key, name } = await smallProject();
    await loadHome(page);
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await openPeek(page, key, name);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const url = new URL(page.url());
    expect(url.pathname, "still the work-items list").toBe(`/projects/${project.id}/work-items`);
    expect(url.searchParams.has("peek"), "peek dropped").toBe(false);
    await expect(visibleScroller(page).getByRole("button", { name: key, exact: true })).toBeVisible();
  });

  test("Escape, then Inbox within 100 ms: the closing peek does not pull the page back", async ({ page }) => {
    const { project, key, name } = await smallProject();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await openPeek(page, key, name);
    const inbox = page.locator('nav[aria-label="Work"]').getByRole("link", { name: /^Inbox/ });
    await page.keyboard.press("Escape");
    await inbox.click();
    await page.waitForURL(/\/inbox/);
    await page.waitForTimeout(800);
    expect(new URL(page.url()).pathname, "still Inbox 800 ms later").toBe("/inbox");
  });

  test("with the detail chunk delayed 1 s the card slides in with the skeleton, and the detail is never remounted", async ({ page }) => {
    const { project, key, name } = await smallProject();
    // Keep the idle-time preload from fetching the detail chunk before the click (peek-detail-lazy.tsx).
    await page.addInitScript(() => {
      window.requestIdleCallback = (() => 0) as unknown as typeof window.requestIdleCallback;
    });
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    // Chunks the page asks for from now on (the detail chunk) arrive a second late.
    await page.route("**/_next/static/chunks/**", (route) => {
      setTimeout(() => void route.continue().catch(() => undefined), 1000);
    });
    const watch = firstCardFrame(page);
    await visibleScroller(page).getByRole("button", { name: key, exact: true }).click();
    const atOpen = await watch;
    expect({ moving: atOpen.transform, skeleton: atOpen.skeleton, editor: atOpen.editor }, "the card moves with the skeleton in it").toEqual({ moving: true, skeleton: true, editor: false });

    const editor = peekCard(page).locator(".ProseMirror").first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(peekCard(page).getByRole("heading", { name })).toBeVisible();
    const handle = await editor.elementHandle();
    await page.setViewportSize({ width: 1180, height: 720 });
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(400);
    const same = await page.evaluate(
      (node) => node !== null && node.isConnected && [...document.querySelectorAll(".tessera-peek-card .ProseMirror")].includes(node as Element),
      handle,
    );
    expect(same, "the editor is the same node after a re-render").toBe(true);
  });

  test("under reduced motion Escape drops peek at once, without a closing slide", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { project, key, name } = await smallProject();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);
    await openPeek(page, key, name);
    await watchClose(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.has("peek")), { message: "peek drops from the URL" }).toBe(false);
    const state = await closeState(page);
    expect(state.closing, "no closing slide").toBe(false);
  });
});

test.describe("layout fade and the floating panel transition", () => {
  test("a layout switch, a calendar zoom change and a gantt zoom change fade the scroller in", async ({ page }) => {
    await recordAnimations(page);
    const { project } = await smallProject();
    await openWorkItems(page, project.id);
    await waitForAppHydrated(page);

    const fadedSince = async (what: string, act: () => Promise<void>) => {
      await clearRecorded(page);
      await act();
      await expect
        .poll(async () => (await recorded(page)).some((entry) => entry.cls.split(" ").includes("tessera-wi-scroller") && entry.props.includes("opacity")), { message: `${what} fades the scroller` })
        .toBe(true);
    };

    await fadedSince("the switch to Board", async () => {
      await page.getByRole("radio", { name: "Board" }).click();
      const running = await page.evaluate(`(() => { const s = (${visibleScrollerSource})(); return s ? s.getAnimations().length : -1; })()`);
      expect(running, "animations on the visible scroller right after the switch").not.toBe(-1);
    });

    await page.getByRole("radio", { name: "Calendar" }).click();
    await expect(page.locator(".tessera-cal:visible")).toBeVisible();
    await fadedSince("the calendar zoom change", async () => {
      await page.getByRole("button", { name: "Display", exact: true }).click();
      await page.getByRole("radiogroup", { name: "Zoom" }).getByRole("radio", { name: "Quarter" }).click();
      await expect(page.locator(".tessera-cal:visible")).toHaveAttribute("data-view", "quarter");
      await page.keyboard.press("Escape");
    });

    await page.getByRole("radio", { name: "Gantt" }).click();
    await expect(page.locator(".tessera-gantt:visible")).toBeVisible();
    await fadedSince("the gantt zoom change", async () => {
      await page.getByRole("button", { name: "Display", exact: true }).click();
      await page.getByRole("radiogroup", { name: "Zoom" }).getByRole("radio", { name: "Quarter" }).click();
      await page.keyboard.press("Escape");
    });
  });

  test("the floating panel has a transform transition, and none under reduced motion", async ({ page }) => {
    await loadHome(page);
    await page.evaluate(() => window.localStorage.setItem("tessera.nav.v1", JSON.stringify({ display: "full", rail: "icons", dock: "floating" })));
    await loadHome(page);
    const property = () => page.evaluate(() => getComputedStyle(document.getElementById("tessera-sidebar")!).transitionProperty);
    expect(await property(), "transition-property under normal motion").toContain("transform");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await property(), "transition-property under reduced motion").toBe("none");
  });
});
