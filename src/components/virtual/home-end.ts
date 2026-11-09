"use client";

/**
 * Home and End in a virtual list (decision 136). The first or last loaded row may not be mounted, and the measured
 * sizes that replace the estimates move `scrollHeight` while the scroller travels, so one `scrollTo` is not enough:
 * scroll to the top or bottom, then check once per animation frame. While the target row is missing, or its top
 * moved more than 1 px since the last frame, issue the same scroll again; once it is mounted and still for two
 * frames, focus it. After `EDGE_MAX_FRAMES` frames focus the nearest rendered row instead.
 */
import { useRef, type KeyboardEvent } from "react";
import { isTypingTarget } from "@/components/shell/shortcuts";
import { useScrollerStore } from "./VirtualScrollerProvider";

export const EDGE_MAX_FRAMES = 20;

type Frames = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;

export type EdgeFocusInput = {
  scroller: HTMLElement;
  toEnd: boolean;
  /** The target row once it is mounted. */
  target: () => HTMLElement | null;
  /** The control to focus inside the target row. */
  focusSelector: string;
  /** The nearest rendered row's control, after the last frame. */
  fallback: () => HTMLElement | null;
  win?: Frames;
};

/** Starts the loop and returns its cancel function. */
export function focusEdgeRow({ scroller, toEnd, target, focusSelector, fallback, win = window }: EdgeFocusInput): () => void {
  let frame: number | null = null;
  let frames = 0;
  let still = 0;
  let lastTop: number | null = null;
  const scroll = () => scroller.scrollTo({ top: toEnd ? scroller.scrollHeight : 0 });
  const step = () => {
    frame = null;
    frames += 1;
    const row = target();
    const top = row ? row.getBoundingClientRect().top : null;
    if (top === null || lastTop === null || Math.abs(top - lastTop) > 1) {
      still = 0;
      scroll();
    } else still += 1;
    lastTop = top;
    if (row && still >= 2) {
      row.querySelector<HTMLElement>(focusSelector)?.focus();
      return;
    }
    if (frames >= EDGE_MAX_FRAMES) {
      fallback()?.focus();
      return;
    }
    frame = win.requestAnimationFrame(step);
  };
  scroll();
  frame = win.requestAnimationFrame(step);
  return () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
  };
}

/**
 * The root `onKeyDown` of a virtual list: Home and End without modifiers, outside a typing target, run
 * `focusEdgeRow` over the list's `.tessera-virtual` anchors (the first anchor's row 0, the last anchor's row
 * `lastCount() − 1`); a new press cancels a running loop. Every other key, and every key while the list is not
 * windowed, goes to `onOtherKey` (Astryx `useListFocus`).
 */
export function useEdgeKeys({
  isVirtual,
  focusSelector,
  lastCount,
  onOtherKey,
}: {
  isVirtual: boolean;
  focusSelector: string;
  lastCount: () => number;
  onOtherKey: (event: KeyboardEvent<HTMLElement>) => void;
}): (event: KeyboardEvent<HTMLElement>) => void {
  const store = useScrollerStore();
  const loop = useRef<(() => void) | null>(null);
  return (event) => {
    const isEdge = (event.key === "Home" || event.key === "End") && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const scroller = store.element();
    if (!isVirtual || !store.virtualizes || !isEdge || !scroller || isTypingTarget(event.target as HTMLElement)) {
      onOtherKey(event);
      return;
    }
    event.preventDefault();
    const root = event.currentTarget;
    const toEnd = event.key === "End";
    const index = toEnd ? lastCount() - 1 : 0;
    loop.current?.();
    loop.current = focusEdgeRow({
      scroller,
      toEnd,
      focusSelector,
      target: () => {
        const anchors = root.querySelectorAll<HTMLElement>(".tessera-virtual");
        const anchor = toEnd ? anchors[anchors.length - 1] : anchors[0];
        return anchor?.querySelector<HTMLElement>(`:scope > [data-index="${index}"]`) ?? null;
      },
      fallback: () => {
        const keys = root.querySelectorAll<HTMLElement>(focusSelector);
        return (toEnd ? keys[keys.length - 1] : keys[0]) ?? null;
      },
    });
  };
}
