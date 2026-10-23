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

/**
 * Scrolls the gantt rooted at `root` so its today line is centred. False when
 * there is nothing to centre yet: no line, or a scroller whose content is not
 * wider than its viewport, or a label column with no width. That is the state
 * of a first paint at phone width, before the day columns have their layout,
 * and the caller tries again when the layout changes.
 */
export function centerTodayLine(root: HTMLElement | null): boolean {
  if (!root) return false;
  const line = root.querySelector<HTMLElement>(`.${TODAY_LINE_CLASS}`);
  const scroller = horizontalScroller(root);
  if (!line || !scroller) return false;
  if (scroller.scrollWidth <= scroller.clientWidth || line.getBoundingClientRect().width <= 0) return false;
  const label = root.querySelector<HTMLElement>(`.${LABEL_CLASS}`);
  const labelWidth = label?.getBoundingClientRect().width ?? 0;
  if (labelWidth <= 0) return false;
  const isPage = scroller === document.scrollingElement;
  const left = todayScrollLeft({
    lineLeft: line.getBoundingClientRect().left,
    scrollerLeft: isPage ? 0 : scroller.getBoundingClientRect().left,
    scrollLeft: scroller.scrollLeft,
    labelWidth,
    viewportWidth: scroller.clientWidth,
    scrollWidth: scroller.scrollWidth,
  });
  // Instant, not smooth: a smooth scroll is dropped by a page that is not focused, and the line should be where Today says.
  if (typeof scroller.scrollTo === "function") scroller.scrollTo({ left, behavior: "instant" });
  else scroller.scrollLeft = left;
  return true;
}

/** How long after the first centring a layout change (the panel settling to its width) centres again, unless the reader has acted. */
export const SETTLE_MS = 1500;

/** Reader input that ends the settle window: the reader's own scroll position wins from then on. */
const INTERACTION_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * `rootRef` goes on the gantt's root element. `scrollToday` centres the line
 * (the Today button and `t`). The line is also centred once when the timeline
 * first shows items and once per `resetKey` (a zoom change resizes every day
 * column, which moves the line).
 *
 * The first paint is not always the final layout: at phone width the panel
 * that scrolls the timeline can still be narrower than it will be, or the day
 * columns not laid out yet. So the centring is tried on the first effect and
 * then repeated on every size change of the scroller or the gantt, until the
 * reader scrolls, taps or presses a key, or `SETTLE_MS` has passed. After that
 * a later resize (a side peek opening) leaves the position alone.
 */
export function useTodayScroll(resetKey: string, hasContent: boolean): { rootRef: RefObject<HTMLElement | null>; scrollToday: () => void } {
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollToday = useCallback(() => {
    centerTodayLine(rootRef.current);
  }, []);
  // One session per `resetKey`. React runs an effect twice in development and Next re-runs effects when a
  // hidden route is shown again, so what has been done (when it was centred, whether the reader acted) lives
  // here and not in the effect: a re-run neither undoes the reader's scroll nor drops the watching.
  const session = useRef<{ key: string; centeredAt: number | null; hasReaderActed: boolean } | null>(null);
  useEffect(() => {
    if (!hasContent) return;
    const root = rootRef.current;
    if (session.current?.key !== resetKey) session.current = { key: resetKey, centeredAt: null, hasReaderActed: false };
    const current = session.current;
    if (current.hasReaderActed || (current.centeredAt !== null && performance.now() - current.centeredAt >= SETTLE_MS)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | null = null;
    // The window runs from the first centring; until there is one, the watching goes on.
    const arm = () => {
      if (timer !== undefined || current.centeredAt === null) return;
      timer = setTimeout(() => observer?.disconnect(), Math.max(0, SETTLE_MS - (performance.now() - current.centeredAt)));
    };
    const centre = () => {
      if (centerTodayLine(root)) current.centeredAt ??= performance.now();
      arm();
    };
    centre();
    const scroller = root ? horizontalScroller(root) : null;
    if (!root || !scroller || typeof ResizeObserver !== "function") return;
    observer = new ResizeObserver(centre);
    observer.observe(scroller);
    observer.observe(root);
    const onReader = () => {
      current.hasReaderActed = true;
      observer?.disconnect();
    };
    for (const type of INTERACTION_EVENTS) scroller.addEventListener(type, onReader, { passive: true, once: true });
    arm();
    return () => {
      clearTimeout(timer);
      for (const type of INTERACTION_EVENTS) scroller.removeEventListener(type, onReader);
      observer?.disconnect();
    };
  }, [resetKey, hasContent]);
  return { rootRef, scrollToday };
}
