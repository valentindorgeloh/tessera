"use client";

/**
 * Layout motion (decisions 132 and 133; docs/contracts/ui.md "Sidebar views,
 * motion, virtual lists, calendar zoom"): WAAPI helpers for the sidebar
 * panel's width, the floating sidebar and peek card slides, and the layout
 * fade, all timed by the theme's `--duration-medium` with `ease-in-out`.
 *
 * Nothing here checks the viewport width: below `md` there is no sidebar panel
 * (`sideNavPanel()` is null), and the peek and the fade animate at every width.
 * Every `matchMedia` call checks that `window.matchMedia` exists first, so a
 * jsdom test without a shim still renders.
 */
import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

export const LAYOUT_MOTION_EASING = "ease-in-out";
export const LAYOUT_MOTION_FALLBACK_MS = 300;
/** 280ms in the Catppuccin theme (catppuccin.css); the production build serves it as ".28s", so it is parsed, never compared. */
export const LAYOUT_MOTION_TOKEN = "--duration-medium";
/** AppShell's `md` breakpoint in the Catppuccin theme: below it the sidebar is the mobile drawer. */
export const SIDENAV_DRAWER_QUERY = "(width < 768px)";
/** Two 60 Hz frames. */
export const JANK_FRAME_MS = 34;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

/** Below `md` the sidebar lives in the mobile drawer (decisions 129 and 131). */
export function isSidenavDrawer(): boolean {
  return matches(SIDENAV_DRAWER_QUERY);
}

/** A drag-resize is under way (Astryx marks the handle with `data-resizing`). */
export function isResizing(): boolean {
  return typeof document !== "undefined" && document.querySelector("[data-resizing]") !== null;
}

export type WidthPlan = { from: number; to: number } | null;

export function widthMotionPlan(input: { from: number; to: number; reduced: boolean; resizing: boolean }): WidthPlan {
  if (input.reduced || input.resizing || Math.abs(input.from - input.to) < 1) return null;
  return { from: input.from, to: input.to };
}

/** True when at least two of the first three frame intervals exceed `JANK_FRAME_MS`. */
export function isJanky(intervals: readonly number[]): boolean {
  return intervals.slice(0, 3).filter((interval) => interval > JANK_FRAME_MS).length >= 2;
}

/**
 * The jank guard (decision 132): samples animation frames until three
 * intervals are known or the animation ends, and finishes the animation at
 * once when they are janky (a jump is better than a stutter). Returns a stop
 * function; it never outlives the animation.
 */
export function guardJank(animation: Animation, win: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame"> = window): () => void {
  const intervals: number[] = [];
  let last: number | null = null;
  let frame: number | null = null;
  let isStopped = false;

  const stop = () => {
    if (isStopped) return;
    isStopped = true;
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    animation.removeEventListener?.("finish", stop);
    animation.removeEventListener?.("cancel", stop);
  };

  const tick = (time: number) => {
    frame = null;
    if (isStopped) return;
    if (last !== null) {
      intervals.push(time - last);
      if (isJanky(intervals)) {
        stop();
        try {
          animation.finish();
        } catch {
          // An animation that cannot finish (already cancelled) is left as it is.
        }
        return;
      }
      if (intervals.length >= 3) {
        stop();
        return;
      }
    }
    last = time;
    frame = win.requestAnimationFrame(tick);
  };

  animation.addEventListener?.("finish", stop);
  animation.addEventListener?.("cancel", stop);
  frame = win.requestAnimationFrame(tick);
  return stop;
}

function timing(): KeyframeAnimationOptions {
  return { duration: layoutMotionMs(), easing: LAYOUT_MOTION_EASING };
}

export function animateWidth(el: HTMLElement, plan: { from: number; to: number }): Animation | null {
  if (typeof el.animate !== "function") return null;
  return el.animate([{ width: `${plan.from}px` }, { width: `${plan.to}px` }], timing());
}

/**
 * Runs `change` synchronously (`flushSync`) between two width reads of `el`
 * and animates the difference, with the jank guard. Call it only from event
 * handlers or a `setTimeout` callback. Without `el` (below `md`) it only runs
 * `change`.
 */
export function withWidthMotion(el: HTMLElement | null, change: () => void): Animation | null {
  if (!el) {
    change();
    return null;
  }
  const from = el.getBoundingClientRect().width;
  flushSync(change);
  const to = el.getBoundingClientRect().width;
  const plan = widthMotionPlan({ from, to, reduced: prefersReducedMotion(), resizing: isResizing() });
  if (!plan) return null;
  const animation = animateWidth(el, plan);
  if (animation) guardJank(animation);
  return animation;
}

/** A `transform` slide with the motion timing; callers check reduced motion first. */
export function animateSlide(el: HTMLElement, from: string, to: string, options?: { fill?: FillMode }): Animation | null {
  if (typeof el.animate !== "function") return null;
  const fill = options?.fill;
  return el.animate([{ transform: from }, { transform: to }], fill ? { ...timing(), fill } : timing());
}

/** Opacity 0 → 1, skipped under reduced motion. */
export function fadeIn(el: HTMLElement | null): Animation | null {
  if (!el || typeof el.animate !== "function" || prefersReducedMotion()) return null;
  return el.animate([{ opacity: 0 }, { opacity: 1 }], timing());
}

/** Fades `el` in when `key` changes after the first render; the first key never fades. */
export function useFadeOnChange(el: HTMLElement | null, key: string): void {
  const lastKey = useRef(key);
  useLayoutEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    const animation = fadeIn(el);
    // A hidden route runs its layout-effect cleanups: do not leave the fade running there.
    return () => animation?.cancel();
  }, [el, key]);
}

/** Astryx AppShell's inline sidebar panel; null below `md`, where there is none. */
export function sideNavPanel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(".astryx-app-shell-sidenav");
}
