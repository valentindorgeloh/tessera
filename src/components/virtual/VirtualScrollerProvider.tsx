"use client";

/**
 * The scroller store of the virtual windows (decision 135). One store per scroll element: the work-items scroller
 * (WorkItemsScreen) and each board column body (a nested provider). Every virtual container (a list group's List,
 * the table tbody, the gantt body, a column's cards) registers as an anchor; the store measures, in one
 * rAF-coalesced pass, each anchor's offset in the scroller, its row-gap and border-box height, and the scroller's
 * `clientHeight` and `scroll-padding-block-start`. A ResizeObserver on the scroller and its first element child and
 * every anchor registration schedule a pass. A pass is skipped while the scroller has no layout (a hidden
 * `<Activity>` route keeps its last values). A passive `scroll` listener, also rAF-coalesced, recomputes each
 * anchor's near-viewport flag and emits only when one flipped.
 *
 * React reads it through `useSyncExternalStore`, so no state is set in an effect body (decision 134); every selector
 * returns a primitive, so a subscriber re-renders only when its own number changes. Until the first pass the store
 * equals its server snapshot (`viewport` = the initial viewport, not measured), so hydration matches.
 *
 * Without a provider, `useScrollerStore()` returns a default store that never virtualises: a layout rendered on its
 * own (Vitest) renders every row, as before.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { INITIAL_VIEWPORT } from "./virtual-config";
import { isNearViewport, offsetWithin } from "./virtual-math";

export type ScrollerStore = {
  subscribe: (listener: () => void) => () => void;
  /** Scroller clientHeight; the provider's initialViewport until measured. */
  viewport: () => number;
  isMeasured: () => boolean;
  /** The anchor's offset in the scroller content (`offsetWithin`); undefined until a pass measured it. */
  offsetOf: (anchorId: string) => number | undefined;
  /** Computed row-gap of the anchor in px, 0 for "normal". */
  gapOf: (anchorId: string) => number;
  /** Height of the element before a `tbody` anchor (the table head); 0 for other anchors and until measured. */
  headOf: (anchorId: string) => number;
  /** Read live, not a subscription source. */
  scrollTop: () => number;
  /** Computed scroll-padding-block-start of the scroller in px (0 for "auto"). */
  scrollPaddingStart: () => number;
  /** Near-viewport gate (decision 135); true until measured. */
  isNear: (anchorId: string) => boolean;
  /** The scroll element, for the virtualizer's `getScrollElement`. */
  element: () => HTMLElement | null;
  /** False for the default store (no provider) and for a nested provider under it. */
  virtualizes: boolean;
  /** The viewport before the first measure: the server snapshot. */
  initialViewport: number;
  /** From the anchor's ref callback; schedules a measure. Returns the unregister function. */
  register: (anchorId: string, el: HTMLElement, marginPx: number) => () => void;
};

export type ScrollerStoreHandle = ScrollerStore & {
  /** Attaches the store to a scroll element (observers, scroll listener); returns the detach function. */
  attach: (scroller: HTMLElement | null) => () => void;
  /** Runs a measure pass now (the rAF callback; tests). */
  measureNow: () => void;
  /** Recomputes the near flags now (the rAF callback; tests). */
  scrollNow: () => void;
};

type Anchor = { el: HTMLElement; margin: number; offset?: number; height: number; gap: number; head: number; near: boolean };

type Frames = Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;

/** A px length from computed style; "normal", "auto" and anything unparsable read 0. */
function px(value: string | undefined): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

export function createScrollerStore(initialViewport: number, virtualizes: boolean, frames?: Frames): ScrollerStoreHandle {
  const listeners = new Set<() => void>();
  const anchors = new Map<string, Anchor>();
  let scroller: HTMLElement | null = null;
  let measured = false;
  let viewport = initialViewport;
  let scrollPadding = 0;
  let measureFrame: number | null = null;
  let scrollFrame: number | null = null;
  let observer: ResizeObserver | null = null;
  let observedChild: Element | null = null;

  const win = (): Frames | null => frames ?? (typeof window === "undefined" ? null : window);
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  /** Recomputes every measured anchor's near flag; true when one flipped. */
  const updateNear = (scrollTop: number): boolean => {
    let flipped = false;
    for (const anchor of anchors.values()) {
      if (anchor.offset === undefined) continue;
      const near = isNearViewport({ start: anchor.offset, size: anchor.height, scrollTop, viewport, margin: anchor.margin });
      if (near !== anchor.near) {
        anchor.near = near;
        flipped = true;
      }
    }
    return flipped;
  };

  // The content element can be replaced (a layout switch): observe whichever is first now.
  const observeChild = () => {
    const child = scroller?.firstElementChild ?? null;
    if (!observer || child === observedChild) return;
    if (observedChild) observer.unobserve(observedChild);
    observedChild = child;
    if (child) observer.observe(child);
  };

  const measureNow = () => {
    measureFrame = null;
    const el = scroller;
    if (!el || el.clientHeight === 0 || el.offsetParent === null) return;
    observeChild();
    let changed = !measured;
    measured = true;
    const rect = el.getBoundingClientRect();
    const scrollTop = el.scrollTop;
    if (el.clientHeight !== viewport) {
      viewport = el.clientHeight;
      changed = true;
    }
    const padding = px(getComputedStyle(el).getPropertyValue("scroll-padding-block-start"));
    if (padding !== scrollPadding) {
      scrollPadding = padding;
      changed = true;
    }
    for (const anchor of anchors.values()) {
      const box = anchor.el.getBoundingClientRect();
      const offset = offsetWithin(box.top, rect.top, scrollTop, el.clientTop);
      const gap = px(getComputedStyle(anchor.el).getPropertyValue("row-gap"));
      const headEl = anchor.el.tagName === "TBODY" ? anchor.el.previousElementSibling : null;
      const head = headEl ? headEl.getBoundingClientRect().height : 0;
      if (offset !== anchor.offset || gap !== anchor.gap || head !== anchor.head) changed = true;
      anchor.offset = offset;
      anchor.height = box.height;
      anchor.gap = gap;
      anchor.head = head;
    }
    if (updateNear(scrollTop)) changed = true;
    if (changed) emit();
  };

  const scheduleMeasure = () => {
    const w = win();
    if (!w || measureFrame !== null) return;
    measureFrame = w.requestAnimationFrame(measureNow);
  };

  const scrollNow = () => {
    scrollFrame = null;
    if (!scroller || !measured) return;
    if (updateNear(scroller.scrollTop)) emit();
  };

  const onScroll = () => {
    const w = win();
    if (!w || scrollFrame !== null) return;
    scrollFrame = w.requestAnimationFrame(scrollNow);
  };

  const attach = (next: HTMLElement | null) => {
    scroller = next;
    if (!next) return () => {};
    next.addEventListener("scroll", onScroll, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleMeasure);
      observer.observe(next);
      observeChild();
      for (const anchor of anchors.values()) observer.observe(anchor.el);
    }
    scheduleMeasure();
    return () => {
      next.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      observer = null;
      observedChild = null;
      const w = win();
      if (w && measureFrame !== null) w.cancelAnimationFrame(measureFrame);
      if (w && scrollFrame !== null) w.cancelAnimationFrame(scrollFrame);
      measureFrame = null;
      scrollFrame = null;
      if (scroller === next) scroller = null;
    };
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    viewport: () => viewport,
    isMeasured: () => measured,
    offsetOf: (id) => anchors.get(id)?.offset,
    gapOf: (id) => anchors.get(id)?.gap ?? 0,
    headOf: (id) => anchors.get(id)?.head ?? 0,
    scrollTop: () => scroller?.scrollTop ?? 0,
    scrollPaddingStart: () => scrollPadding,
    isNear: (id) => anchors.get(id)?.near ?? true,
    element: () => scroller,
    virtualizes,
    initialViewport,
    register(anchorId, el, marginPx) {
      const anchor: Anchor = { el, margin: marginPx, height: 0, gap: 0, head: 0, near: true };
      anchors.set(anchorId, anchor);
      // The anchor itself is observed too: its height changes (more rows loaded, a group collapsed) are not always a
      // resize of the scroller's first child (the table's loaded-rows note comes first), and a stale height turns the
      // window off near its end (`isNearViewport`).
      observer?.observe(el);
      scheduleMeasure();
      return () => {
        if (anchors.get(anchorId) === anchor) anchors.delete(anchorId);
        if (el !== observedChild) observer?.unobserve(el);
      };
    },
    attach,
    measureNow,
    scrollNow,
  };
}

/** No provider: never measures, never virtualises (every loaded row renders). */
export const DEFAULT_SCROLLER_STORE: ScrollerStore = {
  subscribe: () => () => {},
  viewport: () => INITIAL_VIEWPORT,
  isMeasured: () => false,
  offsetOf: () => undefined,
  gapOf: () => 0,
  headOf: () => 0,
  scrollTop: () => 0,
  scrollPaddingStart: () => 0,
  isNear: () => true,
  element: () => null,
  virtualizes: false,
  initialViewport: INITIAL_VIEWPORT,
  register: () => () => {},
};

const ScrollerContext = createContext<ScrollerStore | null>(null);

/**
 * Provides the store for `scroller`. At the top (the screen) it virtualises; with `nested` (a board column body) it
 * virtualises only when the store above it does, so a layout rendered without the screen never windows.
 */
export function VirtualScrollerProvider({
  scroller,
  initialViewport = INITIAL_VIEWPORT,
  nested = false,
  children,
}: {
  scroller: HTMLElement | null;
  initialViewport?: number;
  nested?: boolean;
  children: ReactNode;
}): ReactNode {
  const parent = useScrollerStore();
  const [store] = useState(() => createScrollerStore(initialViewport, nested ? parent.virtualizes : true));
  // Subscribes only (observers and a scroll listener); it sets no state.
  useEffect(() => store.attach(scroller), [store, scroller]);
  return <ScrollerContext.Provider value={store}>{children}</ScrollerContext.Provider>;
}

export function useScrollerStore(): ScrollerStore {
  return useContext(ScrollerContext) ?? DEFAULT_SCROLLER_STORE;
}

export function useScrollerViewport(): number {
  const store = useScrollerStore();
  return useSyncExternalStore(store.subscribe, store.viewport, () => store.initialViewport);
}

export function useScrollerMeasured(): boolean {
  const store = useScrollerStore();
  return useSyncExternalStore(store.subscribe, store.isMeasured, () => false);
}

/** The anchor's measured offset; the estimate on the server and until measured. */
export function useAnchorOffset(anchorId: string, estimate: number): number {
  const store = useScrollerStore();
  return useSyncExternalStore(
    store.subscribe,
    () => (store.isMeasured() ? (store.offsetOf(anchorId) ?? estimate) : estimate),
    () => estimate,
  );
}

/** The anchor's measured row-gap; the estimate on the server and until measured. */
export function useAnchorGap(anchorId: string, estimate: number): number {
  const store = useScrollerStore();
  return useSyncExternalStore(
    store.subscribe,
    () => (store.isMeasured() && store.offsetOf(anchorId) !== undefined ? store.gapOf(anchorId) : estimate),
    () => estimate,
  );
}

/** The measured height before a `tbody` anchor (the table head); 0 on the server and until measured. */
export function useAnchorHead(anchorId: string): number {
  const store = useScrollerStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.headOf(anchorId),
    () => 0,
  );
}

/** The near-viewport gate of an anchor; true on the server and until measured. */
export function useAnchorNear(anchorId: string): boolean {
  const store = useScrollerStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.isNear(anchorId),
    () => true,
  );
}

export function useScrollPaddingStart(): number {
  const store = useScrollerStore();
  return useSyncExternalStore(store.subscribe, store.scrollPaddingStart, () => 0);
}
