/**
 * Helpers for the round4 spec (fix round 4, lane e2e). They import nothing
 * from the other helper files and change none of them. Both run in the page
 * through `Locator.evaluate`, so they read real layout.
 */
import type { Locator } from "@playwright/test";

/**
 * Strict touch hit-box check (touch option A, docs/contracts/ui.md "Theme").
 * The control keeps its drawn size and a 44x44 box centred on it must still
 * hit it. This probes the centre and the four corners one pixel inside that
 * box (cx +/- 21, cy +/- 21) with `elementFromPoint`; each point must land on
 * the control itself or on a descendant (a `::before` hit area counts as the
 * control). Unlike helpers-b `hitBoxMisses`, a corner that lands on a
 * neighbouring control is a miss, which is how two header buttons whose boxes
 * overlap show up. Points outside the viewport are skipped (a finger cannot
 * reach them). Returns one line per miss; empty when the control owns its box.
 */
export async function strictHitBoxMisses(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
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
      if (hit === element || element.contains(hit)) continue;
      const cls = typeof hit.className === "string" && hit.className !== "" ? `.${hit.className.split(" ")[0]}` : "";
      const label = (hit.closest("[aria-label]")?.getAttribute("aria-label") ?? hit.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
      misses.push(`${name} -> ${hit.tagName.toLowerCase()}${cls} "${label}"`);
    }
    return misses;
  });
}

/**
 * True when the last visible character of `label`'s text is painted: it has a
 * client rect (the Range check), sits inside the viewport sideways, and is not
 * cut off by the element itself or by an ancestor that clips (`overflow:
 * hidden` or `clip`, which covers `text-overflow: ellipsis` and a
 * `-webkit-line-clamp`). A scroll container does not clip here: a long page is
 * allowed to scroll. The vertical test uses the rect's centre, so a descender
 * that pokes a pixel past a tight line box does not count as clipped.
 */
export async function lastCharVisible(label: Locator): Promise<boolean> {
  return label.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? "").trim() !== "") last = node as Text;
    }
    if (last === null) return false;
    const text = last.textContent ?? "";
    let end = text.length;
    while (end > 0 && /\s/.test(text.charAt(end - 1))) end -= 1;
    if (end === 0) return false;
    const range = document.createRange();
    range.setStart(last, end - 1);
    range.setEnd(last, end);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const rect = rects[rects.length - 1];
    if (rect === undefined) return false;
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
    return true;
  });
}
