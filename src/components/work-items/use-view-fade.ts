"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useAnimator } from "@astryxdesign/core/hooks";

/** How far the layout dips before it fades back in: a hint of change, not a blink (the page change fade uses the same). */
const DIP_OPACITY = 0.4;

/**
 * A change that follows a popstate within this long is the browser's Back or Forward, the same window the page
 * change fade uses (src/components/shell/PageFade.tsx; docs/field-guide/astryx-0.7.md "Back and Forward").
 */
const POPSTATE_WINDOW_MS = 1000;

/**
 * The layout, period and zoom fade (docs/contracts/ui.md "Motion"): when the view the work items screen shows
 * changes (`viewKey`: the layout, the calendar's period and month or week, the Gantt's zoom) the element behind
 * `targetRef`, the screen's scroller, dips to 0.4 and fades back to 1 on Astryx's own motion (`useAnimator`, the
 * theme's tempo). The promise of `animate` is never awaited and no velocity is passed. A settled animator removes its
 * inline style, so no stacking context outlives the fade.
 *
 * It does not run:
 * - on first load or hydration: the first key it sees is the baseline;
 * - when the key stays (a filter, a sort, a grouping, a data refresh, the 4-second agent refresh);
 * - on Back and Forward, which restore a place instead of going somewhere (a popstate window, and an undo for a
 *   commit that came before the listener ran, in the same task: Next's own popstate listener is registered first);
 * - when an Activity route reveals again: the effect re-runs with the same key and finds nothing to do.
 * Under Reduce Motion the animator lands at once with a mouse and cross-fades on touch (Astryx's own rule).
 *
 * A layout effect, so the new view never paints at full opacity for a frame and then dips.
 */
export function useViewFade(targetRef: RefObject<HTMLElement | null>, viewKey: string): void {
  const animator = useAnimator(targetRef);
  const shown = useRef(viewKey);
  const poppedAt = useRef(Number.NEGATIVE_INFINITY);
  /** True from the moment a dip starts until the end of that task (a macrotask cannot run between two listeners of one event). */
  const dippedThisTask = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      poppedAt.current = performance.now();
      if (dippedThisTask.current) animator.set({ opacity: 1 });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [animator]);

  useLayoutEffect(() => {
    if (shown.current === viewKey) return;
    shown.current = viewKey;
    if (performance.now() - poppedAt.current < POPSTATE_WINDOW_MS) return;
    animator.set({ opacity: DIP_OPACITY });
    void animator.animate({ opacity: 1 });
    dippedThisTask.current = true;
    setTimeout(() => {
      dippedThisTask.current = false;
    }, 0);
  }, [viewKey, animator]);
}
