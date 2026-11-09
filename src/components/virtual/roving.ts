/**
 * The roving tab stop of a virtual list (decision 136). Astryx `useListFocus` re-stamps its items only after the
 * commits of the component that calls it (`hooks/useListFocus.js:294-313`), and a freshly mounted row's key Button
 * renders no `tabindex` of its own, so after a window commit a row could be tabbable twice. This applies the same
 * rule: the first item that already holds `tabindex="0"` keeps it, every other item gets `-1`, and when none holds
 * it the first item gets `0`. A kept row that holds the stop keeps it wherever it sits in DOM order.
 */
export function stampTabStops(root: HTMLElement, selector: string): void {
  const items = [...root.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return;
  const stop = items.find((item) => item.getAttribute("tabindex") === "0") ?? items[0];
  for (const item of items) {
    const value = item === stop ? "0" : "-1";
    if (item.getAttribute("tabindex") !== value) item.setAttribute("tabindex", value);
  }
}
