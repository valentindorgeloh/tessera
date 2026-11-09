/**
 * Helpers for the round5 spec (fix round 5, lane e2e) and, from the "Early
 * interaction" section on, for the round6 spec (fix round 6, lane e2e). They
 * import nothing from the other helper files and change none of them. The
 * round5 helpers run in the page, so they read real layout.
 */
import type { Locator, Page } from "@playwright/test";
import { isTolerated } from "./tolerated";

/** A hit area in viewport pixels, exactly as the browser lays it out (no rounding). */
export type HitRect = { left: number; right: number; top: number; bottom: number; source: "before" | "element" };

/**
 * The exact touch hit rectangle of each matched element (touch option A,
 * docs/contracts/ui.md "Theme"). The theme draws a hit area as an absolutely
 * positioned `::before` of the control, so the rectangle is the `::before`'s
 * computed insets (`left`/`right`/`top`/`bottom`, falling back to `width`/`height`
 * when an inset is `auto`) placed on its containing block (the nearest
 * positioned ancestor's padding box, normally the control itself).
 * An element with no generated `::before` returns its own border box
 * (`source: "element"`). No epsilon is applied: callers compare the raw numbers.
 */
export async function hitAreaRects(locator: Locator): Promise<HitRect[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element): HitRect => {
      const px = (value: string) => parseFloat(value) || 0;
      const box = element.getBoundingClientRect();
      const own: HitRect = { left: box.left, right: box.right, top: box.top, bottom: box.bottom, source: "element" };
      const before = getComputedStyle(element, "::before");
      const generated = before.content !== "none" && before.content !== "normal" && before.display !== "none";
      if (!generated || before.position !== "absolute") return own;

      let host: Element | null = element;
      while (host !== null && host !== document.documentElement && getComputedStyle(host).position === "static") host = host.parentElement;
      const hostBox = (host ?? document.documentElement).getBoundingClientRect();
      const hostStyle = getComputedStyle(host ?? document.documentElement);
      // Absolute offsets are measured from the containing block's padding edge. The far edges
      // come from the resolved `right`/`bottom` insets (exact values such as "-1px"), not from
      // left + width: Chrome serialises a computed `width` to 6 significant digits ("110.656px"
      // for 110.65625), which would invent an overlap of about 5e-5 px between exact neighbours.
      const padLeft = hostBox.left + px(hostStyle.borderLeftWidth);
      const padRight = hostBox.right - px(hostStyle.borderRightWidth);
      const padTop = hostBox.top + px(hostStyle.borderTopWidth);
      const padBottom = hostBox.bottom - px(hostStyle.borderBottomWidth);
      const inset = (value: string) => (/^-?[\d.]+px$/.test(value) ? parseFloat(value) : null);
      const insets = { left: inset(before.left), right: inset(before.right), top: inset(before.top), bottom: inset(before.bottom) };
      const extra = (horizontal: boolean) =>
        before.boxSizing === "content-box"
          ? horizontal
            ? px(before.paddingLeft) + px(before.paddingRight) + px(before.borderLeftWidth) + px(before.borderRightWidth)
            : px(before.paddingTop) + px(before.paddingBottom) + px(before.borderTopWidth) + px(before.borderBottomWidth)
          : 0;
      const width = px(before.width) + extra(true);
      const height = px(before.height) + extra(false);
      const left = padLeft + (insets.left ?? 0);
      const top = padTop + (insets.top ?? 0);
      const right = insets.right !== null ? padRight - insets.right : left + width;
      const bottom = insets.bottom !== null ? padBottom - insets.bottom : top + height;
      return { left, right, top, bottom, source: "before" };
    }),
  );
}

/**
 * Hit probe over the control's real touch area. helpers-c `strictHitBoxMisses`
 * probes a 44 box centred on the control, which is right for a control whose
 * area grows evenly around it. A project tab's area is anchored to the bar's
 * hairline instead (it grows upward only), so a centred box reaches below the
 * area and lands on the content under the bar. This probe takes the control's
 * own `hitAreaRects` rectangle and checks the centre and the four corners one
 * pixel inside it with `elementFromPoint`; a hit on the control or a descendant
 * (the `::before` counts as the control) passes. Points outside the viewport are
 * skipped. Returns one line per miss; empty when the control owns its area.
 */
export async function hitAreaMisses(locator: Locator): Promise<string[]> {
  const [rect] = await hitAreaRects(locator);
  if (rect === undefined) return ["no hit area (the locator matched nothing)"];
  return locator.evaluate((element, area) => {
    const points: [string, number, number][] = [
      ["centre", (area.left + area.right) / 2, (area.top + area.bottom) / 2],
      ["top-left", area.left + 1, area.top + 1],
      ["top-right", area.right - 1, area.top + 1],
      ["bottom-left", area.left + 1, area.bottom - 1],
      ["bottom-right", area.right - 1, area.bottom - 1],
    ];
    const misses: string[] = [];
    for (const [name, x, y] of points) {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit === null) {
        misses.push(`${name} -> nothing`);
        continue;
      }
      if (hit === element || element.contains(hit)) continue;
      const cls = typeof hit.className === "string" && hit.className !== "" ? `.${hit.className.split(" ")[0]}` : "";
      const label = (hit.closest("[aria-label]")?.getAttribute("aria-label") ?? hit.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
      misses.push(`${name} (${x.toFixed(1)}, ${y.toFixed(1)}) -> ${hit.tagName.toLowerCase()}${cls} "${label}"`);
    }
    return misses;
  }, rect);
}

/**
 * True when every character of the first occurrence of `text` inside `label`
 * is painted. Same clip walk as helpers-c `lastCharVisible` (the rect's centre
 * must lie inside every `overflow: hidden|clip` ancestor, sideways it must lie
 * inside the viewport), but over a Range across the whole substring instead of
 * the label's last character, so a long title may clamp after the key. The
 * text may span several text nodes (a nested Text span). A wrapped substring
 * has several rects; each must pass. False when the text is not in the label.
 */
export async function substringVisible(label: Locator, text: string): Promise<boolean> {
  return label.evaluate((element, wanted) => {
    const nodes: { node: Text; start: number }[] = [];
    let all = "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push({ node: node as Text, start: all.length });
      all += node.textContent ?? "";
    }
    const from = all.indexOf(wanted);
    if (from < 0) return false;
    const to = from + wanted.length;
    const first = nodes.filter((entry) => entry.start + (entry.node.textContent ?? "").length > from)[0];
    const lastIndex = nodes.filter((entry) => entry.start < to).length - 1;
    const last = nodes[lastIndex];
    if (first === undefined || last === undefined) return false;
    const range = document.createRange();
    range.setStart(first.node, from - first.start);
    range.setEnd(last.node, to - last.start);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return false;
    for (const rect of rects) {
      const middle = rect.top + rect.height / 2;
      if (rect.left < -1 || rect.right > window.innerWidth + 1) return false;
      for (let el: Element | null = element; el !== null && el !== document.documentElement; el = el.parentElement) {
        const style = getComputedStyle(el);
        const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
        const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
        if (!clipsX && !clipsY) continue;
        const box = el.getBoundingClientRect();
        if (clipsX && (rect.left < box.left - 1 || rect.right > box.right + 1)) return false;
        if (clipsY && (middle < box.top || middle > box.bottom)) return false;
      }
    }
    return true;
  }, text);
}

/**
 * Line count of an element: its height over its computed line height, with the
 * contract's one pixel of slack (`height <= 2 x line-height + 1` means two lines).
 */
export async function lineCount(locator: Locator): Promise<{ height: number; lineHeight: number; fits: (lines: number) => boolean }> {
  const measured = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const fontSize = parseFloat(style.fontSize) || 16;
    return { height: element.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight) || fontSize * 1.4 };
  });
  return { ...measured, fits: (lines: number) => measured.height <= lines * measured.lineHeight + 1 };
}

/**
 * Top-bar search touch probe (touch option A). A 44x44 box is centred on the
 * field's shortcut addon (`.astryx-input-group-text`, which has no hit area of
 * its own); the centre and the four corners one pixel inside the box are probed
 * with `elementFromPoint`. Unlike helpers-c `strictHitBoxMisses` on the input,
 * a hit anywhere inside `.tessera-topbar-search` counts, because the whole field
 * is one click target that opens Power K. Points outside the viewport are
 * skipped. Returns one line per miss; empty when the addon's box belongs to the
 * field.
 */
export async function searchAddonBoxMisses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const field = document.querySelector(".tessera-topbar-search");
    const addon = field?.querySelector(".astryx-input-group-text") ?? null;
    if (field === null || addon === null) return ["the search field or its shortcut addon is not in the page"];
    const rect = addon.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const points: [string, number, number][] = [
      ["centre", cx, cy],
      ["top-left", cx - 21, cy - 21],
      ["top-right", cx + 21, cy - 21],
      ["bottom-left", cx - 21, cy + 21],
      ["bottom-right", cx + 21, cy + 21],
    ];
    const misses: string[] = [];
    for (const [name, x, y] of points) {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit === null) {
        misses.push(`${name} -> nothing`);
        continue;
      }
      if (field.contains(hit)) continue;
      const cls = typeof hit.className === "string" && hit.className !== "" ? `.${hit.className.split(" ")[0]}` : "";
      const label = (hit.closest("[aria-label]")?.getAttribute("aria-label") ?? hit.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
      misses.push(`${name} (${x.toFixed(0)}, ${y.toFixed(0)}) -> ${hit.tagName.toLowerCase()}${cls} "${label}"`);
    }
    return misses;
  });
}

// ---------------------------------------------------------------------------
// Early interaction (fix round 6)
// ---------------------------------------------------------------------------

/** The control an early action targets. */
export type EarlyAction = "toggle" | "chord" | "open-nav" | "assistant" | "help" | "account" | "search";

/** What the init script of `armEarlyAction` recorded on `window.__early`. */
export type EarlyRecord = {
  /** The action ran (for "chord": the sidebar label flipped). */
  fired: boolean;
  /** The script stopped without firing: the 200th chord press left the label as it was, or 60 s passed in the document. */
  gaveUp: boolean;
  /** Number of attempts; 1 for a click, up to 200 for a chord. */
  tries: number;
  /** Whether `nav[aria-label="Work"]` had a React fibre when the first attempt ran; "absent" when it was not in the DOM. */
  workHydratedAtFirstTry: boolean | "absent";
  /** The "Work" nav's own state when the action landed: at the click, or at the chord press that flipped the label. */
  workHydratedAtFire: boolean | "absent";
};

/**
 * Arms one user action to run at the earliest moment it can reach the app: in
 * the first task in which the target element carries a `__reactFiber$...` key,
 * which is when its own hydration has just finished. The streamed sidebar
 * (`nav[aria-label="Work"]`) is usually still dehydrated then. A Playwright
 * click once the control is "visible" is not this trigger: the server HTML is
 * visible long before hydration and the click is not routed to React yet, and
 * a click that waits for actionability lands after the sidebar has hydrated.
 *
 * It polls on a MessageChannel (one task per tick, so rendering and network
 * keep running) from document start, and fires once. "chord" dispatches a
 * keydown `b` with the page's `mod` key every 80 ms, at most 200 times,
 * until the toggle's label flips: the hotkey only exists after the shell's
 * effects have run, so the first presses can be lost. The other actions click
 * the target once. Either way the script gives up (`gaveUp`) after the 200th
 * press or 60 s into the document. Call before `page.goto`; read the outcome
 * with `earlyRecord`.
 *
 * The init script decides the `mod` key in the document it runs in, by
 * helpers-b `modifierKey`'s rule (`userAgentData.platform` when the browser
 * names one, else `navigator.platform`; the Desktop Chrome device makes it
 * Control). It cannot come from `modifierKey(page)` before the first `goto`:
 * `about:blank` has no `userAgentData`, so it answers from the host's
 * `navigator.platform` (Meta on a Mac) and the chord would miss.
 */
export async function armEarlyAction(page: Page, action: EarlyAction): Promise<void> {
  await page.addInitScript(
    (what) => {
      if (window.top !== window) return;
      const host = window as unknown as { __early?: EarlyRecord };
      const record: EarlyRecord = { fired: false, gaveUp: false, tries: 0, workHydratedAtFirstTry: "absent", workHydratedAtFire: "absent" };
      host.__early = record;
      const hydrated = (element: Element | null): boolean | "absent" =>
        element === null ? "absent" : Object.keys(element).some((key) => key.startsWith("__reactFiber"));
      // The top bar's sidebar toggle: docked "Close sidebar" / "Open sidebar", floating "Show sidebar" / "Hide sidebar" (one at a time).
      const toggle = () => document.querySelector<HTMLElement>("#tessera-nav-toggle");
      const target = (): HTMLElement | null => {
        switch (what) {
          case "toggle":
          case "chord":
            return toggle();
          case "open-nav":
            return document.querySelector<HTMLElement>('button[aria-label="Open navigation"]');
          case "assistant":
            return document.querySelector<HTMLElement>('button[aria-label="Assistant"]');
          case "help":
            return document.querySelector<HTMLElement>('button[aria-label="Help and keyboard shortcuts"]');
          case "account":
            return document.querySelector<HTMLElement>('button[aria-label="Account and preferences"]');
          case "search":
            return document.querySelector<HTMLElement>('input[aria-haspopup="dialog"]');
        }
      };
      const work = () => document.querySelector('nav[aria-label="Work"]');
      const named = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.trim() ?? "";
      const apple = named !== "" && named.toLowerCase() !== "unknown" ? /mac/i.test(named) : /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
      const key = apple ? "Meta" : "Control";
      const channel = new MessageChannel();
      const next = () => channel.port2.postMessage(0);
      const giveUpAt = 60_000;
      let labelBefore: string | null = null;
      const tick = () => {
        if (record.fired || record.gaveUp) return;
        if (performance.now() > giveUpAt) {
          record.gaveUp = true;
          return;
        }
        const element = target();
        if (element === null || hydrated(element) !== true) return next();
        record.tries += 1;
        if (record.tries === 1) record.workHydratedAtFirstTry = hydrated(work());
        if (what !== "chord") {
          record.workHydratedAtFire = hydrated(work());
          element.click();
          record.fired = true;
          return;
        }
        labelBefore ??= element.getAttribute("aria-label");
        const workAtPress = hydrated(work());
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: key === "Control", metaKey: key === "Meta", bubbles: true }),
        );
        setTimeout(() => {
          if (toggle()?.getAttribute("aria-label") !== labelBefore) {
            record.workHydratedAtFire = workAtPress;
            record.fired = true;
          } else if (record.tries >= 200) {
            record.gaveUp = true;
          } else next();
        }, 80);
      };
      channel.port1.onmessage = tick;
      next();
    },
    action,
  );
}

/** What `armEarlyAction` recorded; `null` when the script did not run in this document. */
export async function earlyRecord(page: Page): Promise<EarlyRecord | null> {
  return page.evaluate(() => (window as unknown as { __early?: EarlyRecord }).__early ?? null);
}

/** Holds every Next chunk back by `ms`, so hydration finishes late and the server HTML is interactive-looking for a while. */
export async function delayChunks(page: Page, ms: number): Promise<void> {
  await page.route("**/_next/static/chunks/**", (route) => {
    // The route may be gone when the page closes before the timer fires: swallow that rejection.
    setTimeout(() => void route.continue().catch(() => undefined), ms);
  });
}

/** Slows the page's CPU by `rate` (Chrome DevTools "CPU throttling"); stays on across navigations of this page. */
export async function throttleCpu(page: Page, rate: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
}

/**
 * Waits until React has hydrated every element of an app page. React attaches
 * a `__reactFiber$...` key to each DOM node it hydrates, so a server-rendered
 * element without one still sits in a dehydrated boundary. It skips what React
 * never owns or never hydrates: scripts, styles, Next's route announcer, the
 * Tiptap editor (`.ProseMirror`, its drag handle `.tessera-editor-drag`, the
 * wrapper div the extension puts around it and the library's own
 * `.drag-handle`), the peek host's imperative node
 * (`.tessera-peek-node`, PeekHost) and an empty `div` or `span` that sits
 * directly under `body` (a portal root or a library's measuring node). The
 * sweep of round 6 timed out on the pages, cycles, active cycles and analytics
 * routes without these.
 */
export async function waitForAppHydrated(page: Page, timeout = 45_000): Promise<void> {
  // One in-page function, injected as source, so the wait and the timeout report look at the same elements.
  const unhydrated = `() =>
    [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          !element.closest("script, noscript, template, style, next-route-announcer, .ProseMirror, .tessera-peek-node, .tessera-editor-drag, .drag-handle") &&
          !(element.parentElement === document.body && (element.tagName === "DIV" || element.tagName === "SPAN") && !element.hasChildNodes()) &&
          // The wrapper the drag-handle extension puts around the handle inside the editor surface.
          element.querySelector(":scope > .tessera-editor-drag") === null,
      )
      .filter((element) => !Object.keys(element).some((key) => key.startsWith("__reactFiber")))`;
  try {
    // Poll on a timer, not on every animation frame (the default): the scan walks the whole DOM, and at CPU x6
    // on a page with a long sidebar it would take longer than a frame and starve the very hydration it waits for.
    await page.waitForFunction(`(${unhydrated})().length === 0`, undefined, { timeout, polling: 500 });
  } catch (error) {
    const left = await page
      .evaluate(
        `(${unhydrated})().slice(0, 6).map((element) => element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0] + " in " + (element.parentElement?.tagName.toLowerCase() ?? "?") + ": " + element.outerHTML.slice(0, 100))`,
      )
      .catch(() => ["(the page was gone)"]);
    throw new Error(`the page is still not hydrated after ${timeout} ms; first elements without a React fibre: ${JSON.stringify(left)}`, { cause: error });
  }
}

/** Console errors and page errors of a page, minus what `tolerated.ts` lists (the same filter as the e2e `page` fixture). */
export type ErrorCollector = { list: () => string[] };

export function collectErrors(page: Page): ErrorCollector {
  const seen: string[] = [];
  page.on("pageerror", (error) => seen.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") seen.push(message.text());
  });
  return { list: () => seen.filter((text) => !isTolerated(text)) };
}
