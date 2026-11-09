"use client";

/**
 * One virtual container (decisions 134-137): the only `@tanstack/react-virtual` import. The caller passes its row
 * count, a stable `getKey` and its threshold result, and renders `keptBefore`, `window` and `keptAfter` (or
 * `rendered`, the table) with `data-index` on each row.
 *
 * Phases. Off (below the threshold, while printing, or without a virtualising provider): every row, no class, no
 * padding. On but not measured (server, hydration, the first client frames): the deterministic `initialRange` from
 * the estimates, so the server and the first client render draw the same rows. On and measured: TanStack's items,
 * plus kept rows, behind the store's near-viewport gate.
 *
 * No ref is read or written during render (`react-hooks/refs`): the kept row is state set from `onFocusCapture`,
 * the window bounds come from the instance's public `range`, and every measurement arrives through the scroller
 * store (`useSyncExternalStore`).
 */
import { useCallback, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { defaultRangeExtractor, measureElement as measureDefault, useVirtualizer, type Range, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { cssVars } from "@/components/shared/css-vars";
import { usePrinting } from "./print-store";
import { BOARD_GAP_ESTIMATE, ESTIMATE, INITIAL_OVERSCAN, OVERSCAN, type VirtualKind } from "./virtual-config";
import { cssPx, gateWindow, initialRange, isOpenEnd, paddings, partitionKept, withKept } from "./virtual-math";
import { useAnchorGap, useAnchorHead, useAnchorNear, useAnchorOffset, useScrollerMeasured, useScrollerStore, useScrollerViewport, useScrollPaddingStart } from "./VirtualScrollerProvider";

export type UseVirtualRowsOptions = {
  /** Unique in its provider: "list:<groupKey>", "table", "gantt", "board:<container>". */
  anchorId: string;
  /** Picks ESTIMATE, OVERSCAN, INITIAL_OVERSCAN. */
  kind: VirtualKind;
  count: number;
  /** Stable: the caller's useCallback over its items array; passed to TanStack unchanged. */
  getKey: (index: number) => string;
  /** The caller's threshold result. */
  isEnabled: boolean;
  /** From estimateStarts(); used until measured. */
  estimateStart: number;
  /** Gantt: the measured row height; no per-row measuring. */
  fixedSize?: number;
  /** Always rendered (gantt: the dragged bar's row). */
  keepIndexes?: readonly number[];
};

/** `start` is relative to the anchor; `keptTop` is set only on kept rows. */
export type VirtualRow = { index: number; key: string; start: number; size: number; keptTop?: number };

export type VirtualRowsResult = {
  /** False below the threshold, while printing and without a virtualising provider. */
  isEnabled: boolean;
  /** Stable while the window is on or off; registers the anchor with the store. */
  anchorRef: (el: HTMLElement | null) => void;
  /** "tessera-virtual" when enabled. */
  anchorClassName: string | undefined;
  /** cssVars({ "--tessera-virtual-before": …, "--tessera-virtual-after": … }). */
  anchorStyle: CSSProperties | undefined;
  /** For data-virtual-open-end. */
  anchorOpenEnd: "" | undefined;
  totalSize: number;
  scrollMargin: number;
  keptBefore: readonly VirtualRow[];
  /** All rows when disabled. */
  window: readonly VirtualRow[];
  keptAfter: readonly VirtualRow[];
  /** keptBefore + window + keptAfter, in index order (the table). */
  rendered: readonly VirtualRow[];
  /** Stable identity; undefined until enabled and measured, and always with fixedSize. */
  measureRef: ((el: Element | null) => void) | undefined;
  /** Sets the kept-row state from closest("[data-index]"). */
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  /** True for a kept row rendered outside the window. */
  isKept: (index: number) => boolean;
  /** align "auto". */
  scrollToIndex: (index: number) => void;
};

/** The style of a kept row outside the window (`.tessera-virtual-kept`, virtual.css). */
export function keptRowStyle(keptTop: number): CSSProperties {
  return cssVars({ "--tessera-virtual-top": cssPx(keptTop) });
}

/** The style of a virtual table spacer row (`.tessera-table-spacer`, virtual.css). */
export function spacerRowStyle(height: number): CSSProperties {
  return cssVars({ "--tessera-virtual-spacer": cssPx(height) });
}

const NO_KEEP: readonly number[] = [];
const NO_ROWS: readonly VirtualRow[] = [];

function isIndex(value: number | null | undefined, count: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count;
}

function indexRange(first: number, last: number): number[] {
  const out: number[] = [];
  for (let i = first; i <= last; i += 1) out.push(i);
  return out;
}

/** Rows at their estimated positions (relative to the anchor). */
function estimatedRows(indexes: readonly number[], getKey: (index: number) => string, size: number, gap: number, kept: boolean): VirtualRow[] {
  return indexes.map((index) => {
    const start = index * (size + gap);
    return kept ? { index, key: getKey(index), start, size, keptTop: start } : { index, key: getKey(index), start, size };
  });
}

type Window = { keptBefore: readonly VirtualRow[]; window: readonly VirtualRow[]; keptAfter: readonly VirtualRow[]; totalSize: number; before: number; after: number };

/** Before the first measure: the deterministic first window plus any kept rows, at estimated positions. */
function initialWindow(input: { count: number; getKey: (index: number) => string; size: number; gap: number; start: number; viewport: number; overscan: number; keep: readonly number[] }): Window {
  const { count, getKey, size, gap, keep } = input;
  const totalSize = count > 0 ? count * size + (count - 1) * gap : 0;
  const r = initialRange({ start: input.start, count, size, gap, viewport: input.viewport, overscan: input.overscan });
  const first = r ? r.first : count;
  const last = r ? r.last : count - 1;
  const parts = partitionKept(withKept(indexRange(first, last), keep, count), first, last);
  const window = estimatedRows(parts.window, getKey, size, gap, false);
  const lastRow = window.at(-1);
  return {
    keptBefore: estimatedRows(parts.before, getKey, size, gap, true),
    window,
    keptAfter: estimatedRows(parts.after, getKey, size, gap, true),
    totalSize,
    before: window[0]?.start ?? 0,
    after: lastRow ? Math.max(0, totalSize - (lastRow.start + size)) : totalSize,
  };
}

/** After the first measure: TanStack's items split by its range bounds; the window is empty while not near. */
function liveWindow(virtualizer: Virtualizer<HTMLElement, Element>, count: number, overscan: number, scrollMargin: number, isNear: boolean, keep: readonly number[]): Window {
  const totalSize = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();
  const r = virtualizer.range;
  const first = r ? Math.max(0, r.startIndex - overscan) : 0;
  const last = r ? Math.min(count - 1, r.endIndex + overscan) : -1;
  const byIndex = new Map<number, VirtualItem>(items.map((item) => [item.index, item]));
  const parts = gateWindow(
    partitionKept(
      items.map((item) => item.index),
      first,
      last,
    ),
    isNear,
    keep,
  );
  const toRow = (index: number, kept: boolean): VirtualRow => {
    const item = byIndex.get(index) as VirtualItem;
    const start = item.start - scrollMargin;
    return kept ? { index, key: String(item.key), start, size: item.size, keptTop: start } : { index, key: String(item.key), start, size: item.size };
  };
  const windowIndexes = parts.window;
  const pad = paddings(
    windowIndexes.map((i) => byIndex.get(i) as VirtualItem),
    totalSize,
    scrollMargin,
  );
  return {
    keptBefore: parts.before.map((i) => toRow(i, true)),
    window: windowIndexes.map((i) => toRow(i, false)),
    keptAfter: parts.after.map((i) => toRow(i, true)),
    totalSize,
    before: pad.before,
    after: pad.after,
  };
}

export function useVirtualRows(options: UseVirtualRowsOptions): VirtualRowsResult {
  const { anchorId, kind, count, getKey, isEnabled, estimateStart, fixedSize, keepIndexes = NO_KEEP } = options;
  const store = useScrollerStore();
  const printing = usePrinting();
  const isOn = isEnabled && store.virtualizes && !printing;
  const isMeasured = useScrollerMeasured();
  const viewport = useScrollerViewport();
  const scrollMargin = useAnchorOffset(anchorId, estimateStart);
  const gap = useAnchorGap(anchorId, kind === "board" ? BOARD_GAP_ESTIMATE : 0);
  const head = useAnchorHead(anchorId);
  const isNear = useAnchorNear(anchorId);
  const scrollPadding = useScrollPaddingStart();
  const size = fixedSize ?? ESTIMATE[kind];
  const isLive = isOn && isMeasured;

  // Kept row (decision 135): the last-focused row, as state. Focus leaving the list does not clear it.
  const [kept, setKept] = useState<{ key: string; index: number } | null>(null);
  const keptIndex = useMemo(() => {
    if (!kept || !isOn) return null;
    if (isIndex(kept.index, count) && getKey(kept.index) === kept.key) return kept.index;
    for (let i = 0; i < count; i += 1) if (getKey(i) === kept.key) return i;
    return null;
  }, [kept, isOn, count, getKey]);
  const keepList = useMemo(() => [...keepIndexes, keptIndex].filter((i): i is number => isIndex(i, count)), [keepIndexes, keptIndex, count]);

  const rangeExtractor = useCallback((r: Range) => withKept(defaultRangeExtractor(r), keepList, count), [keepList, count]);
  const measureElement = useCallback(
    (el: Element, entry: ResizeObserverEntry | undefined, instance: Virtualizer<HTMLElement, Element>) => {
      const measured = measureDefault(el, entry, instance);
      // A hidden route or a collapsed ancestor reads 0: keep the cached size (else the estimate).
      if (measured > 0 || (el as HTMLElement).offsetParent !== null) return measured;
      return instance.measurementsCache[instance.indexFromElement(el)]?.size ?? size;
    },
    [size],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- React Compiler is off (no reactCompiler in next.config.ts) and the instance never leaves this hook (decision 134).
  const virtualizer = useVirtualizer<HTMLElement, Element>({
    count: isOn ? count : 0,
    enabled: isLive,
    getScrollElement: store.element,
    estimateSize: () => size,
    overscan: OVERSCAN[kind],
    getItemKey: getKey,
    scrollMargin,
    gap,
    initialRect: { width: 0, height: viewport },
    // Enabling an instance scrolls to its offset; on the shared scroller that must be where the user already is.
    initialOffset: store.scrollTop,
    scrollPaddingStart: scrollPadding + (kind === "table" ? head : 0),
    rangeExtractor,
    measureElement,
  });

  const w: Window = !isOn
    ? { keptBefore: NO_ROWS, window: estimatedRows(indexRange(0, count - 1), getKey, size, 0, false), keptAfter: NO_ROWS, totalSize: count * size, before: 0, after: 0 }
    : !isMeasured
      ? initialWindow({ count, getKey, size, gap, start: estimateStart, viewport, overscan: INITIAL_OVERSCAN[kind], keep: keepList })
      : liveWindow(virtualizer, count, OVERSCAN[kind], scrollMargin, isNear, keepList);
  const { keptBefore, keptAfter } = w;
  const rendered = keptBefore.length === 0 && keptAfter.length === 0 ? w.window : [...keptBefore, ...w.window, ...keptAfter];
  const lastRendered = rendered.at(-1)?.index ?? -1;

  const before = cssPx(w.before);
  const after = cssPx(w.after);
  const anchorStyle = useMemo(() => (isOn ? cssVars({ "--tessera-virtual-before": before, "--tessera-virtual-after": after }) : undefined), [isOn, before, after]);

  const margin = OVERSCAN[kind] * size;
  const unregister = useRef<(() => void) | null>(null);
  const anchorRef = useCallback(
    (el: HTMLElement | null) => {
      unregister.current?.();
      unregister.current = el && isOn ? store.register(anchorId, el, margin) : null;
    },
    [store, anchorId, margin, isOn],
  );

  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!isOn) return;
      const row = (event.target as Element).closest("[data-index]");
      const index = row ? Number(row.getAttribute("data-index")) : Number.NaN;
      if (!isIndex(index, count)) return;
      const key = getKey(index);
      setKept((previous) => (previous && previous.key === key && previous.index === index ? previous : { key, index }));
    },
    [isOn, count, getKey],
  );

  const keptIndexes = [...keptBefore, ...keptAfter].map((row) => row.index).join(",");
  const isKept = useCallback((index: number) => keptIndexes !== "" && keptIndexes.split(",").includes(String(index)), [keptIndexes]);
  const scrollToIndex = useCallback((index: number) => virtualizer.scrollToIndex(index, { align: "auto" }), [virtualizer]);

  return {
    isEnabled: isOn,
    anchorRef,
    anchorClassName: isOn ? "tessera-virtual" : undefined,
    anchorStyle,
    anchorOpenEnd: isOn && isOpenEnd(lastRendered, count) ? "" : undefined,
    totalSize: w.totalSize,
    scrollMargin,
    keptBefore,
    window: w.window,
    keptAfter,
    rendered,
    // The instance's own bound method (stable per instance, react-virtual `index.js:87-102`); none for the initial
    // window, whose rows a disabled instance would not observe, and none for fixed-size rows.
    measureRef: isLive && fixedSize === undefined ? virtualizer.measureElement : undefined,
    onFocusCapture,
    isKept,
    scrollToIndex,
  };
}
