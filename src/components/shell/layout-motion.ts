"use client";

/**
 * Motion helpers shared by the shell and the work-items list (decisions 132, 133 and 149; docs/contracts/ui.md
 * "Motion"): the theme's `--duration-medium` read, Reduce Motion and the pointer read at the moment of each change,
 * and the drawer breakpoint. The sidebar's own motion is `rail-motion.ts` (decision 149); the width animation this
 * file used to carry for the rail kind switch and the dock changes was folded into it when the Astryx 0.7 sidebar
 * glide merged with the sidebar views, so one mechanism animates every change of the strip.
 *
 * Every `matchMedia` call checks that `window.matchMedia` exists first, so a jsdom test without a shim still renders.
 */

export const LAYOUT_MOTION_FALLBACK_MS = 300;
/** 280ms in the Catppuccin theme (catppuccin.css); the production build serves it as ".28s", so it is parsed, never compared. */
export const LAYOUT_MOTION_TOKEN = "--duration-medium";
/** AppShell's `md` breakpoint in the Catppuccin theme: below it the sidebar is the mobile drawer. */
export const SIDENAV_DRAWER_QUERY = "(width < 768px)";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** A CSS time ("280ms", ".28s", "0.28s") in whole milliseconds; anything else (empty, "auto", negative) is the fallback. */
export function parseDurationMs(value: string, fallback: number = LAYOUT_MOTION_FALLBACK_MS): number {
  const match = /^(\d*\.?\d+)(ms|s)$/i.exec(value.trim());
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  return Math.round(match[2].toLowerCase() === "s" ? amount * 1000 : amount);
}

/** The computed motion token on `<html>`, else the fallback. */
export function layoutMotionMs(): number {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return LAYOUT_MOTION_FALLBACK_MS;
  return parseDurationMs(getComputedStyle(document.documentElement).getPropertyValue(LAYOUT_MOTION_TOKEN));
}

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** Read at the moment of each change, never cached (decision 133). */
export function prefersReducedMotion(): boolean {
  return matches(REDUCED_MOTION_QUERY);
}

/**
 * Whether Astryx plays a closing exit (`holdLayoutExit`, `motion/animatedLayout.d.ts`): always with motion on; under
 * Reduce Motion only with a coarse primary pointer, where it cross-fades instead of concealing (`design:reduced-motion`
 * DR2). Read at the change.
 */
export function layoutExitPlays(): boolean {
  return !prefersReducedMotion() || matches(COARSE_POINTER_QUERY);
}

/** Below `md` the sidebar lives in the mobile drawer (decisions 129 and 131). */
export function isSidenavDrawer(): boolean {
  return matches(SIDENAV_DRAWER_QUERY);
}
