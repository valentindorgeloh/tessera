/**
 * Pure helpers behind the drag reorder of stickies, quick links and the Home
 * widget list (decision 105). The pointer hook (src/components/dnd/use-pointer-drag.ts)
 * reports a slot among the items that stay in place; these turn it into the
 * optimistic order and into the one-neighbour placement `move_sticky` and
 * `move_quick_link` take. No React: Vitest covers them
 * (tests/ui/reorder-math.test.ts); only `scrollParentOf` reads the DOM.
 */
import { reorderIds, withoutId } from "@/components/dnd/drag-math";

/** `before_id` is the row that ends up directly before the moved one, `after_id` the row directly after it. */
export type Placement = { before_id: string } | { after_id: string };

/**
 * Where `id` lands when it moves to `index` among the other items of `ids`
 * (the full current order). One neighbour only: a stickies grid narrowed by a
 * search shows rows that are not adjacent in the full list, and the engine
 * refuses two non-adjacent neighbours. The previous item is preferred, so a
 * move to the front names the first item as `after_id`. Null when nothing
 * else is in the list.
 */
export function placementFor(ids: ReadonlyArray<string>, id: string, index: number): Placement | null {
  const stay = withoutId(ids, id);
  if (stay.length === 0) return null;
  const at = Math.max(0, Math.min(index, stay.length));
  return at > 0 ? { before_id: stay[at - 1] } : { after_id: stay[0] };
}

/**
 * The slot `id` takes when it steps one place earlier (-1) or later (1), as an
 * index among the other items; null at an edge or for an unknown id. This is
 * the keyboard path of every pointer drag (decision 14).
 */
export function stepIndex(ids: ReadonlyArray<string>, id: string, direction: -1 | 1): number | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = from + direction;
  return to < 0 || to >= ids.length ? null : to;
}

/** `items` with `id` moved to `index` among the others; the input itself when `id` is unknown. */
export function reorderBy<T>(items: ReadonlyArray<T>, idOf: (item: T) => string, id: string, index: number): T[] {
  if (!items.some((item) => idOf(item) === id)) return [...items];
  const byId = new Map(items.map((item) => [idOf(item), item] as const));
  return reorderIds(items.map(idOf), id, index).flatMap((key) => {
    const item = byId.get(key);
    return item === undefined ? [] : [item];
  });
}

/** Where to draw the insertion line for a drag target: before the item at the slot, else after the last one. */
export function dropMarker(ids: ReadonlyArray<string>, draggedId: string, index: number): { id: string; edge: "before" | "after" } | null {
  const stay = withoutId(ids, draggedId);
  if (stay.length === 0) return null;
  const at = Math.max(0, Math.min(index, stay.length));
  return at < stay.length ? { id: stay[at], edge: "before" } : { id: stay[stay.length - 1], edge: "after" };
}

/** The nearest ancestor that scrolls vertically, for the hook's edge auto-scroll; null when the page itself scrolls. */
export function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}
