"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { useAnimator } from "@astryxdesign/core/hooks";

/** How far the content dips before it fades back in: a hint of change, not a blink. */
const DIP_OPACITY = 0.4;

/**
 * A pathname change that follows a popstate within this long is the browser's Back or Forward.
 * Next commits the restored route within a frame for a cached one (Activity keeps it mounted)
 * and after the fetch for an uncached one, so the window is generous; a stale popstate that
 * changed only the search (closing a peek with Back) can at worst skip the fade of the next click.
 */
const POPSTATE_WINDOW_MS = 1000;

/**
 * The page change fade (docs/contracts/ui.md "Motion"): when the pathname changes the content
 * dips to 0.4 and fades back to 1 on Astryx's own motion (`useAnimator`, the theme's tempo). It
 * renders nothing and animates the element `targetRef` holds, the shell's content panel, so it is
 * a leaf: only it reads the request-bound `usePathname()` (the frame stays out of every
 * navigation's render, and the layout mounts it in its own Suspense boundary).
 *
 * It does not run:
 * - on first load or hydration: the first pathname it sees is the baseline;
 * - on Back and Forward (a popstate), which is the browser restoring a place, not going somewhere;
 * - on a search-only change (a layout, a filter, a peek), which keeps the pathname, or on the
 *   4-second agent refresh, which keeps everything.
 * Under Reduce Motion the animator lands at once with a mouse and cross-fades on touch (Astryx's
 * own rule). The promise of `animate` is never awaited: it resolves at spring settle. A settled
 * animator removes its inline style, so no stacking context outlives the fade; while it runs the
 * content is one (sticky headers keep sticking, popovers and dialogs sit in the top layer).
 *
 * Back and Forward come in two orders, and both are handled. Next's popstate listener is
 * registered first and restores a cached route synchronously, so the new pathname can commit (and
 * the dip start, in the layout effect) BEFORE this component's popstate listener runs, in the
 * same task: that listener then ends the dip before the browser paints a frame of it. Otherwise
 * the commit comes later and sees the popstate time.
 */
export function PageFade({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const pathname = usePathname();
  const animator = useAnimator(targetRef);
  const shown = useRef(pathname);
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

  // A layout effect: it runs in the commit that shows the new page, before the browser paints it,
  // so the page never shows at full opacity for a frame and then dips.
  useLayoutEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (performance.now() - poppedAt.current < POPSTATE_WINDOW_MS) return;
    animator.set({ opacity: DIP_OPACITY });
    void animator.animate({ opacity: 1 });
    dippedThisTask.current = true;
    setTimeout(() => {
      dippedThisTask.current = false;
    }, 0);
  }, [pathname, animator]);

  return null;
}
