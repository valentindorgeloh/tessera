/**
 * Pure maths for dragging a page in the tree (decision 105): which siblings a
 * drop sits between, the `move_page` input it becomes, the optimistic order
 * and the landing line. No DOM and no React, so Vitest covers it
 * (tests/pages/move.test.ts).
 *
 * `usePointerDrag` hands over a container (the tree root or one page's child
 * group) and the neighbours of the slot, with `before_id` the sibling that will
 * sit directly before the dropped page. `move_page` reads the names the other
 * way round (`before_id` = place immediately before that sibling), so the two
 * are swapped here.
 */
import type { PageSummary } from "@/lib/tessera/types";
import { subtreeIds } from "./page-tree";

/** Container id of the top level. A child group is its parent page's id (a uuid, never this). */
export const ROOT_CONTAINER = "root";

/** The `move_page` input a drop becomes. */
export type PageMove = { page_id: string; parent_id: string | null; before_id?: string; after_id?: string };

/** The drop `usePointerDrag` reports: the slot's neighbours among the items that stay. */
export type PageDrop = { id: string; toContainer: string; before_id?: string; after_id?: string };

type PageNode = Pick<PageSummary, "id" | "parent_id">;

/** The parent a row is drawn under: its own, or the top level when that parent is not in the list (another tab). */
function drawnParent(ids: ReadonlySet<string>, page: PageNode): string | null {
  return page.parent_id !== null && ids.has(page.parent_id) ? page.parent_id : null;
}

/** Ids drawn directly under `parentId` (null = top level), in list order. */
export function siblingIds(pages: readonly PageNode[], parentId: string | null): string[] {
  const ids = new Set(pages.map((page) => page.id));
  return pages.filter((page) => drawnParent(ids, page) === parentId).map((page) => page.id);
}

/**
 * A row whose parent is not in the list (a public page under a private one) is
 * drawn at the top level but is not a real top-level page: moving it would
 * silently change its parent, so it is not draggable.
 */
export function isPageDraggable(pages: readonly PageNode[], pageId: string): boolean {
  const page = pages.find((entry) => entry.id === pageId);
  if (page === undefined) return false;
  return page.parent_id === null || pages.some((entry) => entry.id === page.parent_id);
}

/**
 * The move a drop means, or null when it is refused (the page would land under
 * itself or one of its own descendants, or it is not draggable). Neighbours
 * that are only drawn at the top level (see `isPageDraggable`) are skipped:
 * the engine looks for them among the real siblings.
 */
export function pageMoveFromDrop(pages: readonly PageSummary[], drop: PageDrop): PageMove | null {
  if (!isPageDraggable(pages, drop.id)) return null;
  const parent = drop.toContainer === ROOT_CONTAINER ? null : drop.toContainer;
  if (parent !== null) {
    if (!pages.some((page) => page.id === parent)) return null;
    if (subtreeIds(pages, drop.id).has(parent)) return null;
  }
  const real = new Set(pages.filter((page) => page.parent_id === parent && page.id !== drop.id).map((page) => page.id));
  const move: PageMove = { page_id: drop.id, parent_id: parent };
  if (drop.after_id !== undefined && real.has(drop.after_id)) move.before_id = drop.after_id;
  else if (drop.before_id !== undefined && real.has(drop.before_id)) move.after_id = drop.before_id;
  return move;
}

/** The list after `move`: the page gets its new parent and sits next to the named sibling (or last). Subtrees follow by parent id. */
export function applyPageMove<T extends PageNode>(pages: readonly T[], move: PageMove): T[] {
  const moving = pages.find((page) => page.id === move.page_id);
  if (moving === undefined) return [...pages];
  const rest = pages.filter((page) => page.id !== move.page_id);
  const moved = { ...moving, parent_id: move.parent_id };
  let index = rest.length;
  if (move.before_id !== undefined) {
    const at = rest.findIndex((page) => page.id === move.before_id);
    if (at >= 0) index = at;
  } else if (move.after_id !== undefined) {
    const at = rest.findIndex((page) => page.id === move.after_id);
    if (at >= 0) index = at + 1;
  }
  return [...rest.slice(0, index), moved, ...rest.slice(index)];
}

/** Where the landing line goes: above `before`, or below `after` when the slot is last. */
export type DropLine = { before?: string; after?: string };

/**
 * The landing line for a drag target (`container`, `index` among the items that
 * stay), or none when the drop would be refused or the container is empty.
 */
export function dropLineFor(pages: readonly PageNode[], draggedId: string, target: { container: string; index: number } | null): DropLine {
  if (target === null) return {};
  const parent = target.container === ROOT_CONTAINER ? null : target.container;
  if (parent !== null && subtreeIds(pages, draggedId).has(parent)) return {};
  const stay = siblingIds(pages, parent).filter((id) => id !== draggedId);
  if (stay.length === 0) return {};
  if (target.index < stay.length) return { before: stay[target.index] };
  return { after: stay[stay.length - 1] };
}
