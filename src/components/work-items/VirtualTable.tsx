"use client";

/**
 * The work items table behind a virtual window (decisions 135-137). It renders the Astryx `Table` that TableLayout
 * renders, with `data` reduced to the rendered rows of `allRows` plus spacer rows (table-virtual.ts), so the kept
 * last-focused row stays in normal flow between split spacers and keeps its column widths. The anchor is the `tbody`
 * inside the scroller `.tessera-wi-scroller`; the sticky `thead` stays in the same scroller and its height is added
 * to the scroll padding (`useAnchorHead`).
 *
 * Only this component re-renders on a range change, not TableLayout. Astryx re-renders every rendered row then (its
 * `rowIndex` shifts, `BaseTable.js:196`); the memo cells (table-cells.tsx) keep that shallow.
 */
import { useCallback, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { Table, type TableColumn, type TablePlugin } from "@astryxdesign/core/Table";
import { useVirtualRows } from "@/components/virtual/use-virtual-rows";
import { START } from "@/components/virtual/virtual-config";
import { isNavKey } from "@/components/virtual/virtual-math";
import type { TableRow } from "./table-cells";
import { virtualTablePlugin, windowedRows } from "./table-virtual";

export type VirtualTableProps = {
  /** Every row the table would render without windowing: data rows, plus the group header rows when grouped. */
  allRows: TableRow[];
  /** The row key: `groupedRows.idKey` when grouped (the header Proxies read `""` for `id`), else `row.id`. */
  idOf: (row: TableRow) => string;
  /** The threshold result (TableLayout). */
  isVirtual: boolean;
  columns: TableColumn<TableRow>[];
  plugins: Record<string, TablePlugin<TableRow>>;
  /** The full total (`aria-rowcount`, decision 137). */
  rowCount: number;
  emptyState: ReactNode;
};

export function VirtualTable({ allRows, idOf, isVirtual, columns, plugins, rowCount, emptyState }: VirtualTableProps) {
  const getKey = useCallback((i: number) => idOf(allRows[i]), [allRows, idOf]);
  const v = useVirtualRows({ anchorId: "table", kind: "table", count: allRows.length, getKey, isEnabled: isVirtual, estimateStart: START.tableHead });
  const { isEnabled, rendered, totalSize, scrollMargin, measureRef, onFocusCapture, isKept, scrollToIndex, anchorRef } = v;

  // The anchor is the tbody: found from the table element's own ref (stable while the window is on or off).
  const tableRef = useCallback((el: HTMLTableElement | null) => anchorRef(el?.querySelector<HTMLElement>(":scope > tbody") ?? null), [anchorRef]);

  // A navigation key on a kept (off-window) row first scrolls it back into view, and does nothing else.
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!isNavKey(event)) return;
      const row = (event.target as Element).closest("[data-index]");
      const index = row ? Number(row.getAttribute("data-index")) : Number.NaN;
      if (!Number.isInteger(index) || !isKept(index)) return;
      scrollToIndex(index);
      event.preventDefault();
      event.stopPropagation();
    },
    [isKept, scrollToIndex],
  );

  const indexOf = useMemo(() => {
    const positions = new Map<TableRow, number>(allRows.map((row, i) => [row, i]));
    return (row: TableRow) => positions.get(row) ?? -1;
  }, [allRows]);
  const virtualPlugin = useMemo(() => virtualTablePlugin<TableRow>({ indexOf, measureRef, onFocusCapture, onKeyDownCapture }), [indexOf, measureRef, onFocusCapture, onKeyDownCapture]);
  // Last in the plugin order (Astryx keeps the insertion order of plugins it does not know).
  const allPlugins = useMemo(() => (isEnabled ? { ...plugins, virtual: virtualPlugin } : plugins), [isEnabled, plugins, virtualPlugin]);

  const data = useMemo(() => (isEnabled ? windowedRows(allRows, rendered, totalSize, scrollMargin) : allRows), [isEnabled, allRows, rendered, totalSize, scrollMargin]);

  return (
    <Table<TableRow>
      ref={tableRef}
      className="tessera-table"
      data-list-ready=""
      data={data}
      columns={columns}
      idKey={idOf}
      plugins={allPlugins}
      density="compact"
      dividers="rows"
      hasHover
      textOverflow="truncate"
      rowCount={rowCount}
      emptyState={emptyState}
    />
  );
}
