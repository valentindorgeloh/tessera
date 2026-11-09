"use client";

/**
 * The rows of one list group (or the flat list) behind a virtual window (decisions 135-137). A collapsed group
 * renders no rows and no `List`, also below the threshold: Astryx `Collapsible` keeps closed content mounted
 * (`Collapsible.js:306-313`). The footer and quick-add stay in `GroupSection`'s body.
 *
 * The row component comes in as `Row` (ListLayout's `WorkItemRow`), so this file imports ListLayout for types only
 * and the two modules have no runtime cycle.
 */
import { useCallback, useLayoutEffect, useRef, type ComponentType, type KeyboardEvent } from "react";
import { List } from "@astryxdesign/core/List";
import type { Display, WorkItem } from "@/lib/tessera/types";
import { stampTabStops } from "@/components/virtual/roving";
import { keptRowStyle, useVirtualRows, type VirtualRow } from "@/components/virtual/use-virtual-rows";
import { isNavKey } from "@/components/virtual/virtual-math";
import type { WorkItemRowProps } from "./ListLayout";
import type { LayoutProps } from "./types";

/** A row's window props (decision 137); all absent while the list is not windowed. */
export type WindowRowProps = {
  virtualIndex?: number;
  setSize?: number;
  measureRef?: (el: Element | null) => void;
  keptTop?: number;
};

/** The `ListItem` props of a row: its class, plus the window attributes when windowed. */
export function virtualRowProps(className: string, { virtualIndex, setSize, measureRef, keptTop }: WindowRowProps) {
  if (virtualIndex === undefined) return { className };
  const kept = keptTop === undefined ? {} : { className: `${className} tessera-virtual-kept`, style: keptRowStyle(keptTop) };
  return { className, ref: measureRef, "data-index": String(virtualIndex), "aria-posinset": virtualIndex + 1, "aria-setsize": setSize, ...kept };
}

/** The row props that are the same for every row of the list. */
export type ListRowFixed = {
  display: Display;
  onUpdate: LayoutProps["onUpdate"];
  onOpen: LayoutProps["onOpen"];
  readOnly: boolean;
  selection?: LayoutProps["selection"];
};

export type ListGroupRowsProps = {
  /** "list:<groupId>" or "list:flat"; unique in the scroller. */
  anchorId: string;
  items: readonly WorkItem[];
  /** aria-setsize: the group's total, or the loaded rows when larger. */
  setSize: number;
  /** The list's threshold result (ListLayout). */
  isVirtual: boolean;
  isOpen: boolean;
  /** From estimateStarts(). */
  estimateStart: number;
  row: ListRowFixed;
  Row: ComponentType<WorkItemRowProps>;
};

export function ListGroupRows({ anchorId, items, setSize, isVirtual, isOpen, estimateStart, row, Row }: ListGroupRowsProps) {
  const getKey = useCallback((i: number) => items[i].id, [items]);
  const v = useVirtualRows({ anchorId, kind: "list", count: items.length, getKey, isEnabled: isVirtual && isOpen, estimateStart });
  const { anchorRef, isKept, scrollToIndex } = v;
  const listEl = useRef<HTMLElement | null>(null);
  const setListEl = useCallback(
    (el: HTMLElement | null) => {
      listEl.current = el;
      anchorRef(el);
    },
    [anchorRef],
  );

  // After each commit: one tab stop over the whole list, kept rows included (decision 136). No state is set.
  useLayoutEffect(() => {
    if (!v.isEnabled) return;
    const root = listEl.current?.closest<HTMLElement>(".tessera-wi-list");
    if (root) stampTabStops(root, ".tessera-wi-open");
  });

  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!isNavKey(event)) return;
      const target = (event.target as Element).closest("[data-index]");
      const index = target ? Number(target.getAttribute("data-index")) : Number.NaN;
      if (!Number.isInteger(index) || !isKept(index)) return;
      scrollToIndex(index);
      event.preventDefault();
      event.stopPropagation();
    },
    [isKept, scrollToIndex],
  );

  if (!isOpen || items.length === 0) return null;
  const { display, onUpdate, onOpen, readOnly, selection } = row;
  const renderRow = (r: VirtualRow) => {
    const item = items[r.index];
    return (
      <Row
        key={item.id}
        item={item}
        display={display}
        onUpdate={onUpdate}
        onOpen={onOpen}
        readOnly={readOnly}
        selected={selection ? selection.selected.has(item.id) : undefined}
        onToggle={selection?.onToggle}
        virtualIndex={v.isEnabled ? r.index : undefined}
        setSize={v.isEnabled ? setSize : undefined}
        measureRef={v.measureRef}
        keptTop={r.keptTop}
      />
    );
  };
  return (
    <List
      ref={setListEl}
      className={v.anchorClassName}
      style={v.anchorStyle}
      data-virtual-open-end={v.anchorOpenEnd}
      density="compact"
      hasDividers
      onFocusCapture={v.isEnabled ? v.onFocusCapture : undefined}
      onKeyDownCapture={v.isEnabled ? onKeyDownCapture : undefined}
    >
      {/* One array (keptBefore, window, keptAfter): a row moving between them keeps its key, so it stays mounted. */}
      {v.rendered.map(renderRow)}
    </List>
  );
}
