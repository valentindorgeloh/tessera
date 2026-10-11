/**
 * Pure geometry and list logic behind the pointer drag-and-drop
 * (src/components/dnd/use-pointer-drag.ts). No DOM, no React: everything here
 * takes plain numbers and arrays so Vitest covers it (tests/ui/drag-math.test.ts)
 * and the board, list, calendar and gantt layouts can share it.
 *
 * Ported from the Astryx `kanban-board` page template (MIT, Copyright (c) Meta
 * Platforms, Inc. and affiliates; see THIRD_PARTY_NOTICES.md): the target
 * resolution, the insertion index against the remaining cards and the
 * reorder reducer follow that template; the neighbour and auto-scroll helpers
 * are Tessera additions.
 */

export type Point = { x: number; y: number };

/** Viewport-space box, the subset of DOMRect the maths needs. */
export type Rect = { left: number; top: number; width: number; height: number };

export type Axis = "x" | "y";

/** Where a dragged item will land: a container and an insertion index among the items that stay in place. */
export type DropTarget = { container: string; index: number };

/** Manhattan distance between two points, compared against the drag threshold. */
export function exceedsThreshold(start: Point, current: Point, threshold: number): boolean {
  return Math.abs(current.x - start.x) + Math.abs(current.y - start.y) >= threshold;
}

export function rectContains(rect: Rect, point: Point): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}

/**
 * The container under the pointer. When containers nest (a swimlane cell
 * inside a column) the smallest one wins so the innermost drop zone is chosen.
 */
export function containerAt(point: Point, containers: ReadonlyArray<{ id: string; rect: Rect }>): string | null {
  let best: { id: string; area: number } | null = null;
  for (const candidate of containers) {
    if (!rectContains(candidate.rect, point)) continue;
    const area = candidate.rect.width * candidate.rect.height;
    if (best === null || area < best.area) best = { id: candidate.id, area };
  }
  return best?.id ?? null;
}

/**
 * Insertion index for a pointer among items laid out along `axis`: the index
 * of the first item whose midpoint lies past the pointer, else the end. The
 * rects must exclude the item being dragged.
 */
export function dropIndexFor(point: Point, rects: ReadonlyArray<Rect>, axis: Axis = "y"): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const mid = axis === "y" ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    const pos = axis === "y" ? point.y : point.x;
    if (pos < mid) return i;
  }
  return rects.length;
}

/** `ids` without `draggedId`, the list drop indices are measured against. */
export function withoutId(ids: ReadonlyArray<string>, draggedId: string): string[] {
  return ids.filter((id) => id !== draggedId);
}

/**
 * The neighbours of a slot in `ids` (which must exclude the dragged item):
 * `before_id` is the item that will sit directly before the dropped one,
 * `after_id` the item directly after, matching `move_work_item`.
 */
export function neighboursAt(ids: ReadonlyArray<string>, index: number): { before_id?: string; after_id?: string } {
  const clamped = Math.max(0, Math.min(index, ids.length));
  const result: { before_id?: string; after_id?: string } = {};
  if (clamped > 0) result.before_id = ids[clamped - 1];
  if (clamped < ids.length) result.after_id = ids[clamped];
  return result;
}

/**
 * True when dropping `draggedId` at `target` leaves the order unchanged:
 * same container and the slot it already occupies (measured against the
 * remaining items, so index n and the original position n are the same slot).
 */
export function isNoopDrop(draggedId: string, fromContainer: string, fromIds: ReadonlyArray<string>, target: DropTarget): boolean {
  if (target.container !== fromContainer) return false;
  const original = fromIds.indexOf(draggedId);
  if (original < 0) return false;
  return target.index === original;
}

export type MoveSpec = { id: string; toContainer: string; index: number };

export type MoveAdapter<T> = {
  idOf: (item: T) => string;
  containerOf: (item: T) => string;
  /** A copy of `item` placed in `container`. */
  withContainer: (item: T, container: string) => T;
};

/**
 * Reorder reducer: rebuilds a flat list so `id` lands at `index` inside
 * `toContainer` (index measured against the remaining items of that
 * container) while every other item keeps its relative order. Returns a new
 * array, or the input when the id is unknown. Suitable as a `useOptimistic`
 * reducer for board, list, calendar and gantt moves.
 */
export function applyMove<T>(items: ReadonlyArray<T>, move: MoveSpec, adapter: MoveAdapter<T>): T[] {
  const { idOf, containerOf, withContainer } = adapter;
  const moved = items.find((item) => idOf(item) === move.id);
  if (moved === undefined) return [...items];
  const rest = items.filter((item) => idOf(item) !== move.id);
  const updated = containerOf(moved) === move.toContainer ? moved : withContainer(moved, move.toContainer);
  const siblings = rest.filter((item) => containerOf(item) === move.toContainer);
  const index = Math.max(0, Math.min(move.index, siblings.length));
  if (index < siblings.length) {
    const at = rest.indexOf(siblings[index]);
    return [...rest.slice(0, at), updated, ...rest.slice(at)];
  }
  const last = siblings[siblings.length - 1];
  if (last === undefined) return [...rest, updated];
  const at = rest.indexOf(last) + 1;
  return [...rest.slice(0, at), updated, ...rest.slice(at)];
}

/**
 * Reorders a plain id list: `ids` is the full ordered list, the dragged id is
 * removed and reinserted at `index` measured against the remaining ids.
 */
export function reorderIds(ids: ReadonlyArray<string>, draggedId: string, index: number): string[] {
  const rest = withoutId(ids, draggedId);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), draggedId, ...rest.slice(at)];
}

export type AutoScrollOptions = {
  /** Distance from an edge, in px, inside which scrolling starts. */
  edge: number;
  /** Scroll speed at the very edge, in px per frame; ramps linearly from 0 at `edge`. */
  maxSpeed: number;
};

/**
 * Scroll velocity along one axis for a pointer at `pos` inside a scroll
 * region spanning `start..end`: negative near the start edge, positive near
 * the end edge, zero in the middle or outside the region.
 */
export function autoScrollVelocity(pos: number, start: number, end: number, options: AutoScrollOptions): number {
  if (options.edge <= 0 || end <= start) return 0;
  if (pos < start || pos > end) return 0;
  const fromStart = pos - start;
  const fromEnd = end - pos;
  if (fromStart < options.edge) return -Math.ceil(((options.edge - fromStart) / options.edge) * options.maxSpeed);
  if (fromEnd < options.edge) return Math.ceil(((options.edge - fromEnd) / options.edge) * options.maxSpeed);
  return 0;
}

/** Velocity on both axes for a pointer inside `rect`. */
export function autoScrollFor(point: Point, rect: Rect, options: AutoScrollOptions): Point {
  return {
    x: autoScrollVelocity(point.x, rect.left, rect.left + rect.width, options),
    y: autoScrollVelocity(point.y, rect.top, rect.top + rect.height, options),
  };
}
