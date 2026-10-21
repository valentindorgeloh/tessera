"use client";

/**
 * Pointer drag for the page tree (decision 105) on top of `usePointerDrag`.
 * The Astryx `TreeList` takes no ref or pointer props per row, but it renders
 * `<li data-tree-id>` rows and `<ul role="group">` child groups, so the hook
 * delegates: one `pointerdown` on the wrapper finds the row, and after every
 * render it registers each row (the `.tessera-page-row` element PagesScreen
 * gives the item) and each group as drag nodes. The containers are the tree
 * root and each expanded parent's group; a drop calls `onMove` with a
 * `move_page` input. Mouse and pen drag from anywhere on the row. A row that
 * can move carries a `RowGrip` (shared/RowDrag.tsx; shown on hover, always on
 * a touch screen); `touch-action: none` is on the grip only, so a finger drags
 * from the grip while the rest of the row still scrolls and opens the page.
 * The row menu's Move up / Move down stay the keyboard path (decision 14).
 */
import { useCallback, useEffect, useRef, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import type { PageSummary } from "@/lib/tessera/types";
import { dropLineFor, isPageDraggable, pageMoveFromDrop, ROOT_CONTAINER, siblingIds, type PageMove } from "./page-move";

/** Controls inside a row keep their press: the chevron, the row menu, inputs. The row's own link does not. */
const IGNORE = 'button, input, textarea, select, [role="menuitem"], [role="menu"], [role="dialog"], [data-tree-toggle]';
const ROW_CLASS = "tessera-page-row";
/** The only touch drag source: a finger elsewhere on the row scrolls (decision 105). */
const GRIP_SELECTOR = ".tessera-row-grip";

export type UsePageDragOptions = {
  pages: readonly PageSummary[];
  /** False on the Archived tab, in a search, and in an archived project. */
  enabled: boolean;
  onMove: (move: PageMove) => void;
};

export type PageDragApi = {
  /** Ref for the element wrapping the TreeList. */
  setRoot: (element: HTMLElement | null) => void;
  /** Spread on that element. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
    onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
  };
  /** The page being dragged, for the overlay. */
  draggingId: string | null;
  registerOverlay: (element: HTMLElement | null) => void;
  /** Whether the row shows a grip: dragging is on and the page is movable (not locked, archived, or drawn under a parent outside the list). */
  isRowDraggable: (pageId: string) => boolean;
  /** Extra class for a row: dimmed while dragged, a line above or below at the landing slot. */
  rowClassName: (pageId: string) => string;
};

export function usePageDrag({ pages, enabled, onMove }: UsePageDragOptions): PageDragApi {
  const root = useRef<HTMLElement | null>(null);
  const known = useRef({ items: new Set<string>(), containers: new Set<string>() });

  const setRoot = useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);

  const onDrop = (event: DragDropEvent) => {
    const move = pageMoveFromDrop(pages, event);
    if (move !== null) onMove(move);
  };
  const { drag, registerContainer, registerItem, registerOverlay, itemHandlers } = usePointerDrag({
    onDrop,
    itemsOf: (container) => siblingIds(pages, container === ROOT_CONTAINER ? null : container),
    ignoreSelector: IGNORE,
  });

  // The rows are rendered by TreeList, so their nodes are found in the DOM after each render.
  useEffect(() => {
    const element = root.current;
    const items = new Set<string>();
    const containers = new Set<string>();
    if (element !== null) {
      const tree = element.querySelector<HTMLElement>('[role="tree"]');
      if (tree !== null) {
        registerContainer(ROOT_CONTAINER)(tree);
        containers.add(ROOT_CONTAINER);
      }
      for (const row of element.querySelectorAll<HTMLElement>("li[data-tree-id]")) {
        const id = row.dataset.treeId;
        if (id === undefined) continue;
        const rowElement = row.querySelector<HTMLElement>(`:scope > div > .${ROW_CLASS}`);
        if (rowElement !== null) {
          registerItem(id)(rowElement);
          items.add(id);
        }
        const group = row.querySelector<HTMLElement>(':scope > [role="group"]');
        if (group !== null) {
          registerContainer(id)(group);
          containers.add(id);
        }
      }
    }
    for (const id of known.current.items) if (!items.has(id)) registerItem(id)(null);
    for (const id of known.current.containers) if (!containers.has(id)) registerContainer(id)(null);
    known.current = { items, containers };
  });

  const isRowDraggable = (pageId: string): boolean => {
    if (!enabled || !isPageDraggable(pages, pageId)) return false;
    const page = pages.find((entry) => entry.id === pageId);
    return page !== undefined && !page.is_locked && page.archived_at === null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled) return;
    const target = event.target as Element | null;
    const row = target?.closest<HTMLElement>("li[data-tree-id]");
    const id = row?.dataset.treeId;
    if (id === undefined || !isRowDraggable(id)) return;
    // Touch drags from the grip only; a finger on the rest of the row scrolls.
    if (event.pointerType === "touch" && target?.closest(GRIP_SELECTOR) == null) return;
    const page = pages.find((entry) => entry.id === id);
    if (page === undefined) return;
    const parent = page.parent_id !== null && pages.some((entry) => entry.id === page.parent_id) ? page.parent_id : ROOT_CONTAINER;
    itemHandlers(id, parent).onPointerDown(event);
  };

  const draggingId = drag?.id ?? null;
  const line = draggingId === null ? {} : dropLineFor(pages, draggingId, drag?.target ?? null);
  const rowClassName = (pageId: string): string => {
    const classes = [ROW_CLASS];
    if (isRowDraggable(pageId)) classes.push("tessera-row-draggable", `${ROW_CLASS}--draggable`);
    if (pageId === draggingId) classes.push(`${ROW_CLASS}--dragging`);
    if (pageId === line.before) classes.push(`${ROW_CLASS}--drop-before`);
    if (pageId === line.after) classes.push(`${ROW_CLASS}--drop-after`);
    return classes.join(" ");
  };

  return {
    setRoot,
    handlers: {
      onPointerDown,
      onClickCapture: itemHandlers("", ROOT_CONTAINER).onClickCapture,
      // A press on the row's link would start the browser's own link drag.
      onDragStart: (event) => event.preventDefault(),
    },
    draggingId,
    registerOverlay,
    isRowDraggable,
    rowClassName,
  };
}
