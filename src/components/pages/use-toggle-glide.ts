"use client";

/**
 * Which page-tree toggles glide: only the person's own (docs/contracts/ui.md "Motion").
 *
 * `TreeList` measures every change of its expanded set once it has an `animatedLayout` handle, whatever caused the
 * change, and it has no expansion callback or controlled state to tell a click from new data. A search flattens the
 * tree (every open page loses its sub-pages, and gets them back when the search is cleared) and the agent refresh can
 * give a page its first sub-page or take its last, so a tree that always held the handle would glide rows the person
 * never asked to move. A remount on those changes would stop that too, but it would also drop the open and closed
 * state the person set (the tree keeps it inside itself), and a drag that makes a page a parent changes the set.
 *
 * So the handle reaches the tree only while the person toggles: from the capture phase of a chevron click or of the
 * arrow keys that open and close a row (the only toggles the tree has, since a row's label is a link) until the next
 * frame. React runs one click or key event's updates as a single render, so this flag and the tree's own expansion
 * change land in the same commit, which the tree measures. The handle has done its work in that commit (the glide,
 * the held exit and the chevron's turn all start there), so it can go a frame later. A change that comes from
 * anywhere else (a search, the refresh, a drag, hydration) renders without it and moves at once.
 */
import { useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AnimatedLayout } from "@astryxdesign/core/hooks";

/** The chevron `TreeList` renders for a row with sub-pages (stable: it names it for its own activation). */
const TOGGLE = "[data-tree-toggle]";
/** Right opens a closed row and left closes an open one (the tree swaps them right to left, and a key that moves focus instead changes nothing); Enter and Space follow the row's link. */
const TOGGLE_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight"]);

export type ToggleGlide = {
  /** The hook's handle while the person's toggle renders; undefined at every other render. */
  animatedLayout: AnimatedLayout | undefined;
  /** Spread on the `TreeList`. */
  handlers: {
    onClickCapture: (event: MouseEvent<HTMLElement>) => void;
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
  };
};

export function useToggleGlide(layout: AnimatedLayout): ToggleGlide {
  const [isToggling, setIsToggling] = useState(false);
  const begin = useCallback(() => {
    setIsToggling(true);
    // Set from the event, cleared a frame on: no effect and no timer to cancel (a state update after an unmount is a no-op).
    window.requestAnimationFrame(() => setIsToggling(false));
  }, []);
  const onClickCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.target instanceof Element && event.target.closest(TOGGLE) !== null) begin();
    },
    [begin],
  );
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (TOGGLE_KEYS.has(event.key)) begin();
    },
    [begin],
  );
  const handlers = useMemo(() => ({ onClickCapture, onKeyDownCapture }), [onClickCapture, onKeyDownCapture]);
  return { animatedLayout: isToggling ? layout : undefined, handlers };
}
