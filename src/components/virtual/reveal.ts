"use client";

/**
 * Bringing a row that is outside its virtual window into it, by key (decisions 135-137). Every live virtual container
 * (`useVirtualRows` while it is on and measured) registers a revealer on its scroller element. The focus-follow of a
 * moved work item (../work-items/focus-follow.ts) asks the scroller for the item's row when no row for it is mounted:
 * the container that holds the key scrolls it into view (align "auto"), and the row mounts with the next window.
 *
 * Module state keyed by the scroller element, outside React, so the screen that owns the scroller (and sits outside the
 * scroller store's provider) can ask without a context. A board column windows inside its own nested scroller (its
 * body), so asking a scroller also asks the containers of every registered scroller inside it. Nothing here renders.
 */

/** Scrolls the first row whose key matches into the window; false when this container holds no such row. */
export type Revealer = (matches: (key: string) => boolean) => boolean;

/** Every scroller with at least one live container; a scroller leaves the map with its last revealer. */
const revealers = new Map<Element, Set<Revealer>>();

/** Registers `revealer` for the containers inside `scroller`; returns the unregister function. */
export function registerRevealer(scroller: Element, revealer: Revealer): () => void {
  let set = revealers.get(scroller);
  if (!set) {
    set = new Set();
    revealers.set(scroller, set);
  }
  set.add(revealer);
  return () => {
    const current = revealers.get(scroller);
    if (!current) return;
    current.delete(revealer);
    if (current.size === 0) revealers.delete(scroller);
  };
}

/**
 * Asks the containers of `scroller`, then those of the scrollers nested inside it (board column bodies), to bring a row
 * whose key matches into their window; true when one did.
 */
export function revealKey(scroller: Element, matches: (key: string) => boolean): boolean {
  for (const revealer of revealers.get(scroller) ?? []) {
    if (revealer(matches)) return true;
  }
  for (const [nested, set] of revealers) {
    if (nested === scroller || !scroller.contains(nested)) continue;
    for (const revealer of set) {
      if (revealer(matches)) return true;
    }
  }
  return false;
}

/**
 * Whether a virtual row key stands for work item `itemId`: a list row, a board card and a gantt row are keyed by the
 * item's id, a grouped table row by `<groupId>:<itemId>` (TableLayout).
 */
export function keyNamesItem(key: string, itemId: string): boolean {
  return key === itemId || key.endsWith(`:${itemId}`);
}
