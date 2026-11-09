"use client";

/**
 * The floating sidebar's open and close wiring (decision 129). Sidebar spreads
 * `panelHandlers` on the SideNav and `edgeHandlers` on the edge strip it renders
 * while the panel is closed. Everything here acts only while undocked at or
 * above `md`; the rules themselves are in `floating-nav.ts`.
 *
 * Opens: the pointer resting `FLOAT_OPEN_DELAY_MS` on the edge strip (hover
 * does not move focus). The top bar's toggle and `mod+b` open it through the
 * shell. Closes: the pointer away for `FLOAT_CLOSE_DELAY_MS`, Escape, a press
 * outside, focus leaving (checked one frame after `focusout`, against the live
 * DOM) and a pathname change, each unless something holds it open
 * (`floatingStaysOpen`).
 */
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { useSideNavRenderMode } from "@astryxdesign/core/SideNav";
import {
  closeFocusTarget,
  FLOAT_CLOSE_DELAY_MS,
  FLOAT_OPEN_DELAY_MS,
  floatingStaysOpen,
  isTogglePressPending,
  MENU_OPEN_SELECTOR,
  shouldCloseOnFocusOut,
  type CloseReason,
  type FloatState,
} from "./floating-nav";
import { getNavOpen, getNavPrefs } from "./nav-prefs";
import { useShell } from "./TesseraShell";

const TOGGLE_ID = "tessera-nav-toggle";

export type FloatingNavHandlers = {
  panelHandlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  edgeHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
};

function liveState(panel: HTMLElement | null): FloatState {
  return {
    focusInside: panel?.contains(document.activeElement) ?? false,
    menuOpen: panel?.querySelector(MENU_OPEN_SELECTOR) != null,
    dragging: document.body.classList.contains("tessera-dragging"),
    modalOpen: document.querySelector("dialog[open]") !== null,
  };
}

function isInToggle(node: EventTarget | null): boolean {
  return node instanceof Node && (document.getElementById(TOGGLE_ID)?.contains(node) ?? false);
}

export function useFloatingNav({ panelId }: { panelId: string }): FloatingNavHandlers {
  const { navPrefs, isNavOpen, setNavOpen } = useShell();
  const isDrawer = useSideNavRenderMode() !== "default";
  const isFloating = navPrefs.dock === "floating" && !isDrawer;
  const isOpenFloating = isFloating && isNavOpen;
  const pathname = usePathname();
  const lastPathname = useRef(pathname);
  const closeTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);

  const panel = () => document.getElementById(panelId);
  /** Floating and open right now, read from the stores, never a render closure. */
  const isLiveOpen = () => getNavOpen() && getNavPrefs().dock === "floating";

  const clearTimer = (timer: { current: number | null }) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const close = (reason: CloseReason) => {
    const focusWasInside = panel()?.contains(document.activeElement) ?? false;
    setNavOpen(false, { focus: closeFocusTarget(reason, focusWasInside) });
  };

  // A pathname change closes the open panel; focus that was inside moves to the main content.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    if (!isDrawer && isLiveOpen()) close("route");
    // `close` and `isLiveOpen` read the DOM and the stores at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isDrawer]);

  // A press outside the panel, the edge strip and the toggle closes it.
  useEffect(() => {
    if (!isOpenFloating) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const element = panel();
      if (!(target instanceof Node) || !element || element.contains(target) || isInToggle(target)) return;
      if (target instanceof Element && target.closest(".tessera-nav-edge")) return;
      if (isTogglePressPending(performance.now()) || floatingStaysOpen(liveState(element))) return;
      close("outside");
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpenFloating]);

  // No timer outlives the floating state or the component.
  useEffect(() => {
    return () => {
      clearTimer(closeTimer);
      clearTimer(openTimer);
    };
  }, [isFloating]);

  const scheduleClose = () => {
    if (!isFloating || !isLiveOpen()) return;
    clearTimer(closeTimer);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      if (isLiveOpen() && !floatingStaysOpen(liveState(panel()))) close("pointer");
    }, FLOAT_CLOSE_DELAY_MS);
  };

  return {
    panelHandlers: {
      onPointerEnter: () => clearTimer(closeTimer),
      onPointerLeave: scheduleClose,
      onBlur: (event) => {
        if (!isFloating || !isLiveOpen()) return;
        const relatedInToggle = isInToggle(event.relatedTarget);
        window.requestAnimationFrame(() => {
          if (!isLiveOpen()) return;
          const state = liveState(panel());
          const togglePending = isTogglePressPending(performance.now());
          if (shouldCloseOnFocusOut({ focusInside: state.focusInside, relatedInToggle, togglePending, staysOpen: floatingStaysOpen(state) })) close("blur");
        });
      },
      onKeyDown: (event) => {
        if (!isFloating || !isLiveOpen() || event.key !== "Escape" || event.defaultPrevented) return;
        // An open menu inside the panel takes its own Escape.
        if (panel()?.querySelector(MENU_OPEN_SELECTOR)) return;
        close("escape");
      },
    },
    // The panel sits 8px in from the edge, so a pointer resting on the strip is outside it; while open the strip counts as panel.
    edgeHandlers: {
      onPointerEnter: () => {
        if (!isFloating) return;
        if (isLiveOpen()) return clearTimer(closeTimer);
        clearTimer(openTimer);
        openTimer.current = window.setTimeout(() => {
          openTimer.current = null;
          if (getNavPrefs().dock === "floating" && !getNavOpen()) setNavOpen(true, { focus: "none" });
        }, FLOAT_OPEN_DELAY_MS);
      },
      onPointerLeave: () => {
        clearTimer(openTimer);
        scheduleClose();
      },
    },
  };
}
