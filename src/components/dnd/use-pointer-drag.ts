"use client";

/**
 * Pointer drag-and-drop between containers (board columns, list groups,
 * calendar days, gantt rows). A hand-written port of the pointer logic of the
 * Astryx `kanban-board` page template (MIT, Copyright (c) Meta Platforms,
 * Inc. and affiliates; notice in THIRD_PARTY_NOTICES.md), generalised:
 *
 * - containers and items register DOM nodes through stable ref callbacks;
 *   hit-testing reads their rects at pointer time (never render state);
 * - a press becomes a drag after `threshold` px of travel, so taps and clicks
 *   on card controls still work; a press inside `ignoreSelector` never drags;
 * - the drop target (container + insertion index among the items that stay)
 *   is exposed as `drag.target` so the layout can render a placeholder;
 * - the overlay clone follows the pointer through CSS custom properties set
 *   directly on the element (`--tessera-drag-x/y/w`, styled by
 *   `.tessera-drag-overlay` in src/components/styles/board.css), so pointer
 *   moves never re-render the layout; state only changes when the target does;
 * - containers auto-scroll near their edges and the optional outer scroller
 *   (the board's horizontal strip) does the same;
 * - Escape or `pointercancel` abandons the drag; mouse, touch and pen all go
 *   through pointer events (give a touch grip `touch-action: none`, never the
 *   whole item: the board card starts a touch drag from its grip only).
 *
 * The pure maths live in ./drag-math.ts (tested in tests/ui/drag-math.test.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { autoScrollFor, containerAt, dropIndexFor, dropIndexForGrid, exceedsThreshold, isNoopDrop, neighboursAt, withoutId, type Axis, type DropTarget, type Point } from "./drag-math";

export type { DropTarget } from "./drag-math";

/** A rectangle in viewport pixels (a `DOMRect`'s four numbers, so it can be kept after the node is gone). */
export type DropRect = { left: number; top: number; width: number; height: number };

export type DragDropEvent = {
  id: string;
  fromContainer: string;
  toContainer: string;
  /** Slot among the items that stay in `toContainer`. */
  index: number;
  /** Item that will sit directly before the dropped one (same container), for move_work_item. */
  before_id?: string;
  /** Item that will sit directly after the dropped one. */
  after_id?: string;
  /**
   * Where the drag overlay was at the moment of the drop, measured before the drag state clears (the overlay unmounts
   * with it). Absent when the surface renders no overlay. A layout that settles the dropped item into its slot
   * (the board) animates from here; every other surface ignores it.
   */
  overlayRect?: DropRect;
};

export type DragState = {
  id: string;
  fromContainer: string;
  /** Size of the dragged element, for the placeholder. */
  width: number;
  height: number;
  target: DropTarget | null;
};

export type UsePointerDragOptions = {
  onDrop: (event: DragDropEvent) => void;
  /** Ordered item ids of a container; may include the dragged id, which is ignored. */
  itemsOf: (container: string) => ReadonlyArray<string>;
  /** Pointer travel (px) before a press becomes a drag. @default 5 */
  threshold?: number;
  /**
   * Axis items are laid out along inside a container; "grid" is a wrapping
   * layout (row by y, then slot by x; decision 105, stickies and quick links).
   * @default "y"
   */
  axis?: Axis | "grid";
  /** Distance from a container edge (px) inside which it auto-scrolls. @default 48 */
  autoScrollEdge?: number;
  /** Auto-scroll speed at the edge (px per frame). @default 14 */
  autoScrollSpeed?: number;
  /** Descendants that keep the press for themselves. @default buttons, links, inputs, menus */
  ignoreSelector?: string;
};

/**
 * Event handlers for a draggable item. The element itself is registered
 * separately through `registerItem(id)` passed to the `ref` prop, so the
 * React Compiler lint never sees a ref read through a props object.
 */
export type ItemDragHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Swallows the click that follows a completed drag so the item does not also open. */
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
};

export type UsePointerDragResult = {
  /** The in-progress drag, or null. Changes only when the drag starts, ends or its target moves. */
  drag: DragState | null;
  isDragging: boolean;
  /** Stable ref callback for a container element (the scrolling list of items). */
  registerContainer: (id: string) => (el: HTMLElement | null) => void;
  /** Stable ref callback for a draggable item's element. */
  registerItem: (id: string) => (el: HTMLElement | null) => void;
  /** The element an item registered under `id` right now, or null. For code that acts on a dropped item after the commit. */
  getItemElement: (id: string) => HTMLElement | null;
  /** Optional outer scroller (e.g. the board's horizontal strip) that auto-scrolls near its edges. */
  registerScroller: (el: HTMLElement | null) => void;
  /** Ref callback for the overlay clone rendered while dragging; positions it under the pointer. */
  registerOverlay: (el: HTMLElement | null) => void;
  /** Pointer-down and click-guard handlers for a draggable item in `container`. */
  itemHandlers: (id: string, container: string) => ItemDragHandlers;
  cancel: () => void;
};

const DEFAULT_IGNORE = 'button, a, input, textarea, select, [role="menuitem"], [role="menu"], [role="dialog"], [contenteditable="true"]';
/** Body class while a drag runs: no text selection, grabbing cursor (board.css). */
const DRAGGING_CLASS = "tessera-dragging";

type Session = {
  id: string;
  container: string;
  pointerId: number;
  start: Point;
  offset: Point;
  width: number;
  height: number;
  started: boolean;
  target: DropTarget | null;
  teardown: () => void;
};

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.container === b.container && a.index === b.index;
}

function canScroll(el: HTMLElement, axis: Axis): boolean {
  return axis === "y" ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
}

export function usePointerDrag(options: UsePointerDragOptions): UsePointerDragResult {
  // Pointer handlers run after commit, so the latest options are synced in an effect rather than during render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const [drag, setDrag] = useState<DragState | null>(null);

  const containerEls = useRef(new Map<string, HTMLElement>());
  const itemEls = useRef(new Map<string, HTMLElement>());
  const containerRefCbs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const itemRefCbs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const scrollerEl = useRef<HTMLElement | null>(null);
  const overlayEl = useRef<HTMLElement | null>(null);
  const session = useRef<Session | null>(null);
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const registerContainer = useCallback((id: string) => {
    let cb = containerRefCbs.current.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) containerEls.current.set(id, el);
        else containerEls.current.delete(id);
      };
      containerRefCbs.current.set(id, cb);
    }
    return cb;
  }, []);

  const registerItem = useCallback((id: string) => {
    let cb = itemRefCbs.current.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) itemEls.current.set(id, el);
        else itemEls.current.delete(id);
      };
      itemRefCbs.current.set(id, cb);
    }
    return cb;
  }, []);

  const getItemElement = useCallback((id: string) => itemEls.current.get(id) ?? null, []);

  const registerScroller = useCallback((el: HTMLElement | null) => {
    scrollerEl.current = el;
  }, []);

  /** Writes the clone's position and width as CSS custom properties (no React render per move). */
  const positionOverlay = useCallback(() => {
    const el = overlayEl.current;
    const active = session.current;
    if (!el || !active) return;
    el.style.setProperty("--tessera-drag-x", `${pointer.current.x - active.offset.x}px`);
    el.style.setProperty("--tessera-drag-y", `${pointer.current.y - active.offset.y}px`);
    el.style.setProperty("--tessera-drag-w", `${active.width}px`);
  }, []);

  const registerOverlay = useCallback(
    (el: HTMLElement | null) => {
      overlayEl.current = el;
      positionOverlay();
    },
    [positionOverlay],
  );

  /** Container + insertion index under the pointer, measured against the items that stay in place. */
  const computeTarget = useCallback((point: Point, draggedId: string): DropTarget | null => {
    const containers = Array.from(containerEls.current, ([id, el]) => ({ id, rect: el.getBoundingClientRect() }));
    const container = containerAt(point, containers);
    if (container === null) return null;
    const ids = withoutId(optionsRef.current.itemsOf(container), draggedId);
    const rendered = ids.filter((id) => itemEls.current.has(id));
    const rects = rendered.map((id) => {
      // Filtered on the line above, so the element exists.
      const el = itemEls.current.get(id) as HTMLElement;
      return el.getBoundingClientRect();
    });
    const axis = optionsRef.current.axis ?? "y";
    const slot = axis === "grid" ? dropIndexForGrid(point, rects) : dropIndexFor(point, rects, axis);
    const index = slot < rendered.length ? ids.indexOf(rendered[slot]) : ids.length;
    return { container, index };
  }, []);

  const publish = useCallback(
    (active: Session, target: DropTarget | null) => {
      if (sameTarget(active.target, target) && active.started) {
        // Same slot: nothing to re-render; the first move after start always publishes.
        return;
      }
      active.target = target;
      setDrag({ id: active.id, fromContainer: active.container, width: active.width, height: active.height, target });
    },
    [],
  );

  /**
   * One auto-scroll frame: scrolls the hovered container and the outer
   * scroller near their edges and re-targets when something moved. Returns
   * false once the session is over so the caller stops scheduling frames.
   */
  const autoScrollFrame = useCallback((): boolean => {
    const active = session.current;
    if (!active || !active.started) return false;
    const { autoScrollEdge = 48, autoScrollSpeed = 14, axis: layoutAxis = "y" } = optionsRef.current;
    // A wrapping grid scrolls along y (its page), like a vertical list.
    const axis: Axis = layoutAxis === "grid" ? "y" : layoutAxis;
    const scrollOptions = { edge: autoScrollEdge, maxSpeed: autoScrollSpeed };
    let scrolled = false;

    const containerId = active.target?.container ?? null;
    const containerEl = containerId === null ? null : (containerEls.current.get(containerId) ?? null);
    if (containerEl && canScroll(containerEl, axis)) {
      const velocity = autoScrollFor(pointer.current, containerEl.getBoundingClientRect(), scrollOptions);
      const delta = axis === "y" ? velocity.y : velocity.x;
      if (delta !== 0) {
        if (axis === "y") containerEl.scrollTop += delta;
        else containerEl.scrollLeft += delta;
        scrolled = true;
      }
    }
    const scroller = scrollerEl.current;
    if (scroller) {
      const velocity = autoScrollFor(pointer.current, scroller.getBoundingClientRect(), scrollOptions);
      if (velocity.x !== 0 && canScroll(scroller, "x")) {
        scroller.scrollLeft += velocity.x;
        scrolled = true;
      }
      if (velocity.y !== 0 && canScroll(scroller, "y")) {
        scroller.scrollTop += velocity.y;
        scrolled = true;
      }
    }
    if (scrolled) publish(active, computeTarget(pointer.current, active.id));
    return true;
  }, [computeTarget, publish]);

  const finish = useCallback((commit: boolean) => {
    const active = session.current;
    if (!active) return;
    active.teardown();
    session.current = null;
    if (raf.current !== null) {
      window.cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    document.body.classList.remove(DRAGGING_CLASS);
    // The overlay unmounts with the drag state, so its place is read first (a rectangle copied out of the DOMRect).
    const overlay = commit && active.started ? overlayEl.current?.getBoundingClientRect() : undefined;
    if (active.started) {
      // The click that follows pointerup must not open the item; the flag clears after this task.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      setDrag(null);
    }
    if (!commit || !active.started || active.target === null) return;
    const target = active.target;
    const fromIds = [...optionsRef.current.itemsOf(active.container)];
    if (isNoopDrop(active.id, active.container, fromIds, target)) return;
    const stayIds = withoutId(optionsRef.current.itemsOf(target.container), active.id);
    optionsRef.current.onDrop({
      id: active.id,
      fromContainer: active.container,
      toContainer: target.container,
      index: target.index,
      ...neighboursAt(stayIds, target.index),
      ...(overlay ? { overlayRect: { left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height } } : {}),
    });
  }, []);

  const cancel = useCallback(() => finish(false), [finish]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string, container: string) => {
      if (event.button !== 0 || session.current) return;
      const target = event.target as Element | null;
      const ignore = optionsRef.current.ignoreSelector ?? DEFAULT_IGNORE;
      if (target?.closest(ignore)) return;
      const el = itemEls.current.get(id);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY };
      pointer.current = start;

      // The frame loop lives in the session closure so it can schedule itself.
      const step = () => {
        raf.current = autoScrollFrame() ? window.requestAnimationFrame(step) : null;
      };
      const onMove = (ev: PointerEvent) => {
        const active = session.current;
        if (!active || ev.pointerId !== active.pointerId) return;
        pointer.current = { x: ev.clientX, y: ev.clientY };
        if (!active.started) {
          if (!exceedsThreshold(active.start, pointer.current, optionsRef.current.threshold ?? 5)) return;
          document.body.classList.add(DRAGGING_CLASS);
          publish(active, computeTarget(pointer.current, active.id));
          active.started = true;
          if (raf.current === null) raf.current = window.requestAnimationFrame(step);
        } else {
          publish(active, computeTarget(pointer.current, active.id));
        }
        positionOverlay();
      };
      const onUp = (ev: PointerEvent) => {
        if (session.current && ev.pointerId !== session.current.pointerId) return;
        finish(true);
      };
      const onCancel = (ev: PointerEvent) => {
        if (session.current && ev.pointerId !== session.current.pointerId) return;
        finish(false);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !session.current?.started) return;
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      };
      const teardown = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
      };

      session.current = {
        id,
        container,
        pointerId: event.pointerId,
        start,
        offset: { x: start.x - rect.left, y: start.y - rect.top },
        width: rect.width,
        height: rect.height,
        started: false,
        target: null,
        teardown,
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
    },
    [autoScrollFrame, computeTarget, finish, positionOverlay, publish],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const itemHandlers = useCallback(
    (id: string, container: string): ItemDragHandlers => ({
      onPointerDown: (event) => onPointerDown(event, id, container),
      onClickCapture,
    }),
    [onClickCapture, onPointerDown],
  );

  // Detach listeners if the layout unmounts mid-drag.
  useEffect(() => () => finish(false), [finish]);

  return useMemo(
    () => ({ drag, isDragging: drag !== null, registerContainer, registerItem, getItemElement, registerScroller, registerOverlay, itemHandlers, cancel }),
    [cancel, drag, getItemElement, itemHandlers, registerContainer, registerItem, registerOverlay, registerScroller],
  );
}
