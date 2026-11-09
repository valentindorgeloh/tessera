/**
 * The virtual table's rows and its Astryx Table plugin (decisions 135-137). The windowed `data` is the rendered rows
 * of `allRows` (the same objects, never copies: the grouped header rows are Astryx Proxies recognised by a private
 * Symbol) with synthetic spacer rows for the rows it leaves out. The plugin, last in the plugin order, turns a spacer
 * into an empty `aria-hidden` presentation row of the spacer's height, and gives every other rendered row its
 * `data-index`, its `aria-rowindex` in the loaded rows and the window's measuring ref.
 */
import type { HTMLAttributes, KeyboardEvent, FocusEvent, Ref } from "react";
import type { TablePlugin } from "@astryxdesign/core/Table";
import { spacerRowStyle, type VirtualRow } from "@/components/virtual/use-virtual-rows";
import { tableSegments } from "@/components/virtual/virtual-math";

/*
 * A plain string key, not a Symbol: Astryx's row memo compares a new row object with the previous one by its
 * `Object.keys` (`BaseTable.js:224-239`), so a spacer that keeps its id and position but changes its height must
 * change an enumerable field, or the row keeps its old height. A grouped header Proxy reads it as "" (no number).
 */
const SPACER = "tesseraSpacerHeight";

/**
 * A synthetic spacer row of `height` px. Like Astryx's grouped header rows it is not one of the caller's rows: it has
 * no `item` object, so `isDataRow` is false for it and the row renderers never see it, and its `id` is its key.
 */
export function spacerRow<R extends object>(id: string, height: number): R {
  return { id, groupKey: "", [SPACER]: height } as unknown as R;
}

/** The height of a spacer row, or null for any other row. */
export function spacerHeight(row: object): number | null {
  const height = (row as { [SPACER]?: unknown })[SPACER];
  return typeof height === "number" ? height : null;
}

/**
 * The windowed table `data`: the rendered rows (window and kept, in index order; `start` relative to the anchor)
 * as the very objects of `allRows` (a grouped header row is an Astryx Proxy recognised by a private Symbol, so it
 * must never be copied), with a spacer row for each run of rows left out (`tableSegments`).
 */
export function windowedRows<R extends object>(allRows: readonly R[], rendered: readonly VirtualRow[], totalSize: number, scrollMargin: number): R[] {
  const spans = rendered.map(({ index, start, size }) => ({ index, start: start + scrollMargin, end: start + size + scrollMargin }));
  return tableSegments(spans, totalSize, scrollMargin).map((segment) => (segment.kind === "row" ? allRows[segment.index] : spacerRow<R>(segment.id, segment.height)));
}

/** `data-index` as row `htmlProps`: `HTMLAttributes` declares no `data-*` keys (`Table/types.d.ts:246`). */
export function dataIndexAttr(index: number): HTMLAttributes<HTMLTableRowElement> {
  return { "data-index": String(index) } as HTMLAttributes<HTMLTableRowElement>;
}

/** Calls each ref in turn (a callback ref, or an object ref through its `current`). */
function composeRefs<T>(a: Ref<T> | undefined, b: ((el: T | null) => void) | undefined): Ref<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  return (el: T | null) => {
    if (typeof a === "function") a(el);
    else (a as { current: T | null }).current = el;
    b(el);
  };
}

export type VirtualTablePluginInput<R> = {
  /** The row's index in `allRows` (header rows included); -1 when it is not one of them. */
  indexOf: (row: R) => number;
  /** The window's measuring ref; undefined until the scroller is measured. */
  measureRef: ((el: Element | null) => void) | undefined;
  /** Keeps the last-focused row (useVirtualRows). */
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  /** Turns a navigation key on a kept row into a scroll (decision 136). */
  onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
};

export function virtualTablePlugin<R extends Record<string, unknown>>({ indexOf, measureRef, onFocusCapture, onKeyDownCapture }: VirtualTablePluginInput<R>): TablePlugin<R> {
  // One composed ref per previous ref, so a row whose previous plugins keep their ref keeps its own.
  const composed = new WeakMap<object, Ref<HTMLTableRowElement> | undefined>();
  const rowRef = (previous: Ref<HTMLTableRowElement> | undefined): Ref<HTMLTableRowElement> | undefined => {
    if (!previous) return measureRef;
    if (!composed.has(previous)) composed.set(previous, composeRefs<HTMLTableRowElement>(previous, measureRef));
    return composed.get(previous);
  };
  return {
    transformBodyRow: (props, row) => {
      const height = spacerHeight(row);
      if (height !== null) {
        return { ...props, htmlProps: { className: "tessera-table-spacer", "aria-hidden": true, role: "presentation", style: spacerRowStyle(height) } };
      }
      const index = indexOf(row);
      if (index < 0) return props;
      return { ...props, ref: rowRef(props.ref), htmlProps: { ...props.htmlProps, ...dataIndexAttr(index), "aria-rowindex": index + 1 } };
    },
    transformBodyCell: (props, _column, row) => (spacerHeight(row) === null ? props : { ...props, isContentSuppressed: true }),
    transformScrollWrapper: (props) => ({ ...props, htmlProps: { ...props.htmlProps, onFocusCapture, onKeyDownCapture } }),
  };
}
