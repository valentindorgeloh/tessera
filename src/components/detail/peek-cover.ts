"use client";

/**
 * The side peek on a container too narrow for it (visual audit item board-table
 * "peek at 768"). At 768 the sidebar is open and the content panel is about
 * 490px wide, so a 480px panel left the board strip 32px and the table 20px
 * wide. Below `PEEK_COVER_BELOW` the panel therefore covers the list, as it
 * already does on a phone (detail.css `.tessera-peek-panel--cover`): the item
 * gets the whole width and the list is not squeezed into a sliver. Above it
 * the list keeps at least `PEEK_MIN_LIST_WIDTH` beside the minimum panel.
 * The threshold is a fixed container width, not the panel's current width, so
 * dragging the resize handle never flips the panel into cover mid-drag.
 */
import { useCallback, useState } from "react";
import { PEEK_MIN_WIDTH } from "./peek-prefs";

/** The least width the list keeps beside the side peek. */
export const PEEK_MIN_LIST_WIDTH = 280;

/** Container widths under this make the side peek cover the list. */
export const PEEK_COVER_BELOW = PEEK_MIN_WIDTH + PEEK_MIN_LIST_WIDTH;

/** Whether a container of this width gets a covering peek. An unmeasured container (width 0) does not. */
export function coversList(containerWidth: number): boolean {
  return containerWidth > 0 && containerWidth < PEEK_COVER_BELOW;
}

/**
 * True while the container is narrower than `PEEK_COVER_BELOW`. Same wiring as
 * `useIsPanelCapped` (PeekHost.tsx): the returned ref goes on an element inside
 * the panel, and the observer re-checks whenever the container changes size.
 */
export function useIsPanelCover(): [boolean, (element: HTMLElement | null) => void | (() => void)] {
  const [isCover, setCover] = useState(false);
  const watch = useCallback((element: HTMLElement | null) => {
    const container = element?.closest<HTMLElement>(".tessera-peek-panel")?.parentElement;
    if (!container) return;
    const update = () => setCover(coversList(container.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return [isCover, watch];
}
