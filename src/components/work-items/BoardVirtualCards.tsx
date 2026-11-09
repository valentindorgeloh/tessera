"use client";

/**
 * The cards of one board column (or one swimlane cell) behind a virtual window (decisions 135-137). `cards` is the
 * column's ordered list with the drag placeholder spliced in (`boardCards`), so the placeholder is one more virtual
 * item, keyed "placeholder" and carrying its own `data-index` (decision 136). A column is windowed above
 * `VIRTUAL_BOARD_MIN` loaded cards, inside the column body's nested scroller provider (BoardColumn); swimlane cells
 * pass `isVirtual={false}` and render every card.
 *
 * Every rendered entry, kept ones included, gets only primitives and stable references, so a range change or a
 * drag publish re-renders the cards whose `virtualIndex` changed and nothing else (BoardCard is memoised).
 */
import { useCallback } from "react";
import { Card } from "@astryxdesign/core/Card";
import { VStack } from "@astryxdesign/core/Stack";
import type { ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import { useVirtualRows, type VirtualRow } from "@/components/virtual/use-virtual-rows";
import { START } from "@/components/virtual/virtual-config";
import type { DisplayProperties, WorkItem } from "@/lib/tessera/types";
import { BoardCard, BoardCardBody, BoardCardMenuSlot, windowCardProps, type WindowCardProps } from "./BoardCards";
import { dragKey } from "./board-keys";
import { isOptimisticId } from "./optimistic";

/** The key of the drag placeholder entry. */
export const PLACEHOLDER_KEY = "placeholder";

/** One entry of a column: a card (`item`) or the drag placeholder (`item` null). */
export type BoardEntry = { key: string; item: WorkItem | null };

/**
 * The column's entries: its loaded cards in order, without the dragged copy (`hiddenId`, decision 30: the item's
 * copies in other columns stay), with the placeholder at `slotIndex` (clamped to the end) when the drop goes here.
 */
export function boardCards(itemIds: readonly string[], byId: ReadonlyMap<string, WorkItem>, hiddenId: string | null, slotIndex: number | null): BoardEntry[] {
  const entries: BoardEntry[] = [];
  for (const id of itemIds) {
    const item = byId.get(id);
    if (item !== undefined && item.id !== hiddenId) entries.push({ key: item.id, item });
  }
  if (slotIndex !== null) entries.splice(Math.min(Math.max(0, slotIndex), entries.length), 0, { key: PLACEHOLDER_KEY, item: null });
  return entries;
}

/** Where the dragged card would land: a virtual item of its own, sized to the dragged card (decision 136). */
function PlaceholderCard({ height, measureRef, ...windowed }: WindowCardProps & { height: number }) {
  return <Card ref={measureRef} variant="muted" padding={0} height={height} {...windowCardProps("tessera-board-placeholder", windowed)} />;
}

/** A quick-add placeholder: inert until the server item replaces it. */
function PendingCard({ item, properties, measureRef, ...windowed }: WindowCardProps & { item: WorkItem; properties: DisplayProperties }) {
  return (
    <Card ref={measureRef} padding={3} aria-busy="true" {...windowCardProps("tessera-board-card tessera-board-card-pending", windowed)}>
      <BoardCardBody item={item} properties={properties} menu={<BoardCardMenuSlot />} />
    </Card>
  );
}

export type BoardVirtualCardsProps = {
  /** The drop container id ("col:<id>" or a lane cell); also the anchor id's suffix. */
  container: string;
  cards: readonly BoardEntry[];
  /** The threshold result; false for swimlane cells. */
  isVirtual: boolean;
  properties: DisplayProperties;
  /** "Move to" targets of a card in this column (memoised per column). */
  moveTargets: readonly { id: string; name: string }[];
  /** The column id cards move from. */
  currentColumn: string;
  readOnly: boolean;
  peekedId: string | null;
  /** Height of the dragged card, for the placeholder. */
  placeholderHeight: number;
  registerItem: (id: string) => (el: HTMLElement | null) => void;
  itemHandlers: (id: string, container: string) => ItemDragHandlers;
  onOpen: (id: string) => void;
  onMoveTo: (itemId: string, fromColumn: string, toColumn: string) => void;
};

export function BoardVirtualCards({
  container,
  cards,
  isVirtual,
  properties,
  moveTargets,
  currentColumn,
  readOnly,
  peekedId,
  placeholderHeight,
  registerItem,
  itemHandlers,
  onOpen,
  onMoveTo,
}: BoardVirtualCardsProps) {
  const getKey = useCallback((i: number) => cards[i].key, [cards]);
  const { isEnabled, anchorRef, anchorClassName, anchorStyle, rendered, measureRef, onFocusCapture } = useVirtualRows({
    anchorId: `board:${container}`,
    kind: "board",
    count: cards.length,
    getKey,
    isEnabled: isVirtual,
    estimateStart: START.boardBodyPadding,
  });

  const renderEntry = (r: VirtualRow) => {
    const entry = cards[r.index];
    const windowed = { virtualIndex: isEnabled ? r.index : undefined, measureRef, keptTop: r.keptTop };
    const { item } = entry;
    if (item === null) return <PlaceholderCard key={PLACEHOLDER_KEY} height={placeholderHeight} {...windowed} />;
    if (isOptimisticId(item.id)) return <PendingCard key={item.id} item={item} properties={properties} {...windowed} />;
    const key = dragKey(container, item.id);
    return (
      <BoardCard
        key={item.id}
        item={item}
        properties={properties}
        columns={moveTargets}
        currentColumn={currentColumn}
        cardRef={readOnly ? undefined : registerItem(key)}
        handlers={readOnly ? undefined : itemHandlers(key, container)}
        isPeeked={item.id === peekedId}
        onOpen={onOpen}
        onMoveTo={onMoveTo}
        {...windowed}
      />
    );
  };

  return (
    <VStack
      gap={2}
      ref={anchorRef}
      className={anchorClassName ? `tessera-board-cards ${anchorClassName}` : "tessera-board-cards"}
      style={anchorStyle}
      onFocusCapture={isEnabled ? onFocusCapture : undefined}
    >
      {/* One array (keptBefore, window, keptAfter): a card moving between them keeps its key, so it stays mounted. */}
      {rendered.map(renderEntry)}
    </VStack>
  );
}
