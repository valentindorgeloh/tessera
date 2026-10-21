/**
 * Centre the gantt's today line (decision 90: "Today" scrolls to the today
 * line). The timeline scrolls inside an ancestor panel, and its label column
 * is sticky, so the bar area is the scroller's width minus the label column.
 * `todayScrollLeft` is the pure offset math; `centerTodayLine` measures the
 * DOM and scrolls; `useTodayScroll` wires both to a first-open effect and
 * returns the handler the Today button and the `t` hotkey share. It serves the
 * work item gantt and the modules timeline.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";

export const TODAY_LINE_CLASS = "tessera-gantt-today";
export const LABEL_CLASS = "tessera-gantt-label";

export type TodayScrollInput = {
  /** `getBoundingClientRect().left` of the today line. */
  lineLeft: number;
  /** `getBoundingClientRect().left` of the scroller (0 for the page). */
  scrollerLeft: number;
  /** The scroller's current `scrollLeft`. */
  scrollLeft: number;
  /** Width of the sticky label column, which covers the left of the viewport. */
  labelWidth: number;
  /** The scroller's `clientWidth`. */
  viewportWidth: number;
  /** The scroller's `scrollWidth`. */
  scrollWidth: number;
};

/** The `scrollLeft` that puts the today line in the middle of the bar area, clamped to the scrollable range. */
export function todayScrollLeft({ lineLeft, scrollerLeft, scrollLeft, labelWidth, viewportWidth, scrollWidth }: TodayScrollInput): number {
  const lineInContent = lineLeft - scrollerLeft + scrollLeft;
  const barArea = Math.max(0, viewportWidth - labelWidth);
  const wanted = lineInContent - labelWidth - barArea / 2;
  const max = Math.max(0, scrollWidth - viewportWidth);
  return Math.min(max, Math.max(0, Math.round(wanted)));
}

/** The nearest ancestor that scrolls horizontally, else the page's scrolling element. */
export function horizontalScroller(from: HTMLElement): HTMLElement | null {
  for (let node = from.parentElement; node; node = node.parentElement) {
    const { overflowX } = getComputedStyle(node);
    if (overflowX === "auto" || overflowX === "scroll" || overflowX === "overlay") return node;
  }
  const page = document.scrollingElement;
  return page instanceof HTMLElement ? page : null;
}

/** Scrolls the gantt rooted at `root` so its today line is centred; false when there is nothing to scroll. */
export function centerTodayLine(root: HTMLElement | null): boolean {
  if (!root) return false;
  const line = root.querySelector<HTMLElement>(`.${TODAY_LINE_CLASS}`);
  const scroller = horizontalScroller(root);
  if (!line || !scroller) return false;
  const label = root.querySelector<HTMLElement>(`.${LABEL_CLASS}`);
  const isPage = scroller === document.scrollingElement;
  const left = todayScrollLeft({
    lineLeft: line.getBoundingClientRect().left,
    scrollerLeft: isPage ? 0 : scroller.getBoundingClientRect().left,
    scrollLeft: scroller.scrollLeft,
    labelWidth: label?.getBoundingClientRect().width ?? 0,
    viewportWidth: scroller.clientWidth,
    scrollWidth: scroller.scrollWidth,
  });
  // Instant, not smooth: a smooth scroll is dropped by a page that is not focused, and the line should be where Today says.
  if (typeof scroller.scrollTo === "function") scroller.scrollTo({ left, behavior: "instant" });
  else scroller.scrollLeft = left;
  return true;
}

/**
 * `rootRef` goes on the gantt's root element. `scrollToday` centres the line
 * (the Today button and `t`). The line is also centred once when the timeline
 * first shows items and once per `resetKey` (a zoom change resizes every day
 * column, which moves the line).
 */
export function useTodayScroll(resetKey: string, hasContent: boolean): { rootRef: RefObject<HTMLElement | null>; scrollToday: () => void } {
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollToday = useCallback(() => {
    centerTodayLine(rootRef.current);
  }, []);
  // Next re-runs effects when a hidden route is shown again; the key keeps that from undoing the reader's scroll.
  const centeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hasContent || centeredFor.current === resetKey) return;
    if (centerTodayLine(rootRef.current)) centeredFor.current = resetKey;
  }, [resetKey, hasContent]);
  return { rootRef, scrollToday };
}
