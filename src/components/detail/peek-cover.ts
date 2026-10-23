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
import { useCallback, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
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

/** What a keyboard user can land on in the detail (the first of these in tree order gets the focus). */
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What the peek is doing, as `useCoverFocus` reads it. */
export type CoverFocusState = {
  /** An item is named by `?peek=` (either mode). */
  isOpen: boolean;
  /** The peek is the modal Dialog, which handles its own focus. */
  isModal: boolean;
  /** A side panel covers the (inert) list. */
  isCovering: boolean;
};

/**
 * Focus for a side peek (decision 11). The covered list is `inert` (PeekHost.tsx), so it leaves the tab order and the
 * accessibility tree, and an inert element cannot keep the focus. When the cover starts, focus moves to the first control
 * in the detail; when it ends (a resize that lets the list sit beside the panel) or the peek closes, focus returns to the
 * control the list had last (the row's key button) if the page did not move it elsewhere meanwhile. Focus already inside
 * the detail stays there when the cover starts or ends on a resize. The remembered control survives resizes (a 768 to
 * 1440 to 768 round trip) and is dropped only when the peek closes. A side panel beside the list gets the same return on
 * close, because the focused Close button leaves with the detail and the focus would otherwise fall to the body.
 * The returned handler goes on the list region's `onFocus` (React's focus bubbles) and remembers that control.
 * ASSUMPTION: opening a side peek that does not cover the list leaves focus where it is, as before.
 */
export function useCoverFocus({ isOpen, isModal, isCovering }: CoverFocusState, detailNode: HTMLElement | null): (event: FocusEvent<HTMLElement>) => void {
  const opener = useRef<HTMLElement | null>(null);
  const wasCovering = useRef(false);
  const wasOpen = useRef(false);
  // A layout effect: it runs after the commit that set or removed `inert`, and before the browser repaints.
  useLayoutEffect(() => {
    const closes = !isOpen && wasOpen.current;
    wasOpen.current = isOpen;
    if (isCovering && !wasCovering.current) {
      // The detail is not mounted yet (server render, hydration): try again when it is.
      if (detailNode === null) return;
      wasCovering.current = true;
      // A resize that starts the cover while the user works in the detail keeps the focus where it is.
      if (!detailNode.contains(document.activeElement)) detailNode.querySelector<HTMLElement>(TABBABLE)?.focus();
      return;
    }
    const endsCover = !isCovering && wasCovering.current;
    if (endsCover) wasCovering.current = false;
    // The Dialog restores its own focus; a switch to it ends the cover but must not pull focus behind it.
    if (!closes && !(endsCover && !isModal)) return;
    const target = opener.current;
    if (closes) opener.current = null;
    const active = document.activeElement;
    // Focus inside the detail is not free: a resize that ends the cover must not pull it out of the open peek. On
    // close the detail is gone, so the focus has already fallen back to the body.
    const isFocusFree = active === null || active === document.body;
    if (target?.isConnected && isFocusFree) target.focus();
  }, [isOpen, isModal, isCovering, detailNode]);
  return useCallback((event: FocusEvent<HTMLElement>) => {
    opener.current = event.target;
  }, []);
}
