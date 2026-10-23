/**
 * Helpers for the round5 spec (fix round 5, lane e2e). They import nothing from
 * the other helper files and change none of them. Every function runs in the
 * page, so it reads real layout.
 */
import type { Locator, Page } from "@playwright/test";

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

/**
 * Waits until React has hydrated every element of the page. React attaches a
 * `__reactFiber$...` key to each DOM node it hydrates, so a server-rendered
 * element without one still sits in a dehydrated boundary. Scripts, styles and
 * Next's route announcer are not React-owned and are skipped. A click or a
 * state change before this point can make React report hydration error 418.
 */
export async function waitForHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => !element.closest("script, noscript, template, style, next-route-announcer"))
      .every((element) => Object.keys(element).some((key) => key.startsWith("__reactFiber"))),
  );
}
