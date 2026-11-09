"use client";

/**
 * Board layout (docs/contracts/ui.md "Work items screen"): one column per
 * group of `result.groups`, swimlane rows when `display.sub_group_by` is
 * set, pointer drag between columns and reorder within a column through
 * `usePointerDrag`, a "Move to" menu on every card as the keyboard
 * alternative, and an inline quick-add row per column. Drops call `onMove`
 * with `{ group_by, value, from_value, before_id, after_id }`; the parent
 * (WorkItemsScreen) owns the optimistic state, so this component is a pure
 * function of its props. Columns of a field the engine cannot move between
 * (created by, created at, project; see ./moves.ts) accept no drops and offer
 * no "Move to"; neither do the columns and lanes of an archived module or a
 * completed or archived cycle, in either direction (./quick-add.ts
 * `acceptsGroupMove`). Quick-add placeholders render as inert cards. A paged
 * column or lane cell ends in a "Show more" footer (decision 112) and a drop
 * at its end lands after the last loaded card (decision 114). Each column
 * without swimlanes is a memoised BoardColumn that windows its cards above
 * eight loaded cards (decisions 135-136); a drag publish re-renders only the
 * source and the target column. Swimlane cells are never windowed.
 *
 * Layout idea ported from the Astryx `kanban-board` page template (MIT,
 * Meta Platforms; THIRD_PARTY_NOTICES.md): className + tokens
 * (src/components/styles/board.css) instead of StyleX, Phosphor icons.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { groupLimitKey } from "@/lib/tessera/core/group";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import { BoardCardBody, BoardCardGrip, BoardCardMenuSlot } from "./BoardCards";
import { BoardColumn, COLUMN_WIDTH, ColumnHeader, GroupTitle } from "./BoardColumn";
import { BoardVirtualCards, boardCards } from "./BoardVirtualCards";
import { dragKey, itemIdOf } from "./board-keys";
import { closedColumnText, containerId, groupValue, useBoardModel, type Column } from "./board-model";
import { isMovableGroup } from "./moves";
import { usePeekedId } from "./peeked";
import { useProjectRow } from "./project-provider";
import { UNGROUPED_KEY } from "./paging";
import { isOptimisticId } from "./optimistic";
import { GroupFooter } from "./GroupFooter";
import { NoResults } from "./NoResults";
import { QuickAdd } from "./QuickAdd";
import { acceptsGroupMove, isOpenGroupValue, openMemberships } from "./quick-add";
import type { LayoutProps, MoveInput, QuickAddGroup } from "./types";

const NO_TARGETS: readonly Column[] = [];

/**
 * Keeps `--tessera-board-head-h` (board.css) on the strip at the height of the swimlane heads row, so each lane bar
 * sticks directly under it. A callback ref with a cleanup: no state, no render per resize.
 */
function trackHeadHeight(row: HTMLElement | null): (() => void) | void {
  const strip = row?.parentElement;
  if (!row || !strip) return;
  const write = () => strip.style.setProperty("--tessera-board-head-h", `${row.offsetHeight}px`);
  write();
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(write);
  observer.observe(row);
  return () => observer.disconnect();
}

export function BoardLayout({ result, display, onMove, onOpen, onQuickAdd, canQuickAdd, readOnly = false, onLoadMore, onLoadMoreUngrouped, isLoadingMore, onClearFilters }: LayoutProps) {
  const { columns, lanes, containers, byId } = useBoardModel(result, display);
  const peekedId = usePeekedId();
  // Collapsed swimlanes (F3.2): their cells stay mounted but hidden and take no drops.
  const [collapsedLanes, setCollapsedLanes] = useState<ReadonlySet<string>>(() => new Set());
  const toggleLane = (id: string, isOpen: boolean) =>
    setCollapsedLanes((previous) => {
      const next = new Set(previous);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });
  // The header "+" opens that column's quick-add row; a per-column nonce remounts only that row
  // active, so text typed in another column's row survives.
  const [quickAddNonces, setQuickAddNonces] = useState<Record<string, number>>({});
  // An archived project is read-only: no drag, no "Move to", no quick-add (F3.4).
  const canMoveColumns = !readOnly && isMovableGroup(display.group_by);
  const canMoveLanes = !readOnly && isMovableGroup(display.sub_group_by);
  // The modules and cycles items may join or leave; an archived module or a completed or archived cycle is closed. Read
  // from the lean row bundle, which keeps its identity across writes, so the "Move to" targets and `moveToColumn` do too.
  const { bundle: rowBundle } = useProjectRow();
  const open = useMemo(() => openMemberships(rowBundle), [rowBundle]);

  // Quick-add placeholders are not registered with the drag hook and cannot be neighbours. Every copy of a card is
  // keyed by its container (decision 30), so an item in two columns collides with nothing.
  const itemsOf = useCallback(
    (container: string) =>
      (containers.get(container)?.itemIds ?? []).filter((id) => !isOptimisticId(id)).map((id) => dragKey(container, id)),
    [containers],
  );

  /**
   * Whether a drop from one container into another goes through. A change of column (or lane) needs a field the engine
   * can move between and, for modules and cycles, an open value on both sides: the item leaves one and joins the other.
   */
  const acceptsDrop = useCallback(
    (fromContainer: string, toContainer: string): boolean => {
      const from = containers.get(fromContainer);
      const to = containers.get(toContainer);
      if (!from || !to) return false;
      if (to.laneId !== null && collapsedLanes.has(to.laneId)) return false;
      const field = display.group_by;
      if (from.columnId !== to.columnId) {
        if (!canMoveColumns || field === null) return false;
        if (!acceptsGroupMove(field, groupValue(from.columnId, field), groupValue(to.columnId, field), open)) return false;
      }
      const subField = display.sub_group_by;
      if (to.laneId !== null && from.laneId !== to.laneId) {
        if (!canMoveLanes || subField === null) return false;
        const fromLane = from.laneId === null ? null : groupValue(from.laneId, subField);
        if (!acceptsGroupMove(subField, fromLane, groupValue(to.laneId, subField), open)) return false;
      }
      return true;
    },
    [canMoveColumns, canMoveLanes, collapsedLanes, containers, display.group_by, display.sub_group_by, open],
  );

  const handleDrop = useCallback(
    (event: DragDropEvent) => {
      const from = containers.get(event.fromContainer);
      const to = containers.get(event.toContainer);
      if (!from || !to) return;
      // A drop the engine would refuse is ignored: the card snaps back.
      if (!acceptsDrop(event.fromContainer, event.toContainer)) return;
      // The hook speaks in drag keys; the engine wants item ids (decision 30). A neighbour that is another copy of the
      // dragged item (labels, assignees, modules show it in several columns) is no neighbour.
      const id = itemIdOf(event.id);
      const neighbour = (key: string | undefined) => {
        const neighbourId = key === undefined ? undefined : itemIdOf(key);
        return neighbourId === id ? undefined : neighbourId;
      };
      // Neighbour ids only mean something when the list is in sort order; otherwise a drop just changes the group.
      const placement: Pick<MoveInput, "before_id" | "after_id"> = display.order_by === "sort_order" ? { before_id: neighbour(event.before_id), after_id: neighbour(event.after_id) } : {};
      // The field of each axis that changed, else null.
      const columnField = from.columnId !== to.columnId ? display.group_by : null;
      const laneField = to.laneId !== null && from.laneId !== to.laneId ? display.sub_group_by : null;
      const fromLane = from.laneId === null || laneField === null ? null : groupValue(from.laneId, laneField);
      const toLane = to.laneId === null || laneField === null ? null : groupValue(to.laneId, laneField);
      if (columnField !== null && laneField !== null) {
        // Both axes change in one request (F3.5, decision 30).
        onMove({
          id,
          group_by: columnField,
          value: groupValue(to.columnId, columnField),
          from_value: groupValue(from.columnId, columnField),
          sub_group_by: laneField,
          sub_value: toLane,
          sub_from_value: fromLane,
          ...placement,
        });
      } else if (columnField !== null) {
        onMove({ id, group_by: columnField, value: groupValue(to.columnId, columnField), from_value: groupValue(from.columnId, columnField), ...placement });
      } else if (laneField !== null) {
        // Only the lane changed: a one-axis move on the sub field.
        onMove({ id, group_by: laneField, value: toLane, from_value: fromLane, ...placement });
      } else if (placement.before_id !== undefined || placement.after_id !== undefined) {
        onMove({ id, ...placement });
      }
    },
    [acceptsDrop, containers, display.group_by, display.order_by, display.sub_group_by, onMove],
  );

  const { drag, registerContainer, registerItem, registerScroller, registerOverlay, itemHandlers } = usePointerDrag({ onDrop: handleDrop, itemsOf });
  const dragged = drag ? byId.get(itemIdOf(drag.id)) : undefined;

  const moveToColumn = useCallback(
    (itemId: string, fromColumn: string, toColumn: string) => {
      const field = display.group_by;
      if (field === null || !canMoveColumns) return;
      const value = groupValue(toColumn, field);
      const fromValue = groupValue(fromColumn, field);
      if (!acceptsGroupMove(field, fromValue, value, open)) return;
      onMove({ id: itemId, group_by: field, value, from_value: fromValue });
    },
    [canMoveColumns, display.group_by, onMove, open],
  );

  /**
   * "Move to" targets of a card per column: none when the field cannot be moved between or the column is closed. One
   * array per column for as long as the columns are the same, so the memoised cards keep their `columns` prop.
   */
  const moveTargets = useMemo(() => {
    const field = display.group_by;
    const map = new Map<string, readonly Column[]>();
    if (field === null || !canMoveColumns) return map;
    for (const column of columns) {
      const fromValue = groupValue(column.id, field);
      map.set(
        column.id,
        columns.filter((target) => acceptsGroupMove(field, fromValue, groupValue(target.id, field), open)),
      );
    }
    return map;
  }, [canMoveColumns, columns, display.group_by, open]);

  /** A column of an archived module or a completed or archived cycle; its empty state says why nothing can join it. */
  const isClosedColumn = (column: Column): boolean => {
    const field = display.group_by;
    return field !== null && !isOpenGroupValue(field, groupValue(column.id, field), open);
  };

  const quickAddGroupOf = useCallback(
    (column: Column): QuickAddGroup => {
      const field = display.group_by;
      return { field, value: field === null ? null : groupValue(column.id, field) };
    },
    [display.group_by],
  );

  // A column has no quick-add when the list cannot create items, or when its group pins a value the engine refuses
  // (a closed state in a cycle scope, an archived module, a completed or archived cycle; ./quick-add.ts).
  const canAddTo = (column: Column) => !readOnly && onQuickAdd !== undefined && canQuickAdd?.(quickAddGroupOf(column)) !== false;

  const quickAdd = useCallback(
    (column: Column, name: string) => {
      onQuickAdd?.(quickAddGroupOf(column), name);
    },
    [onQuickAdd, quickAddGroupOf],
  );

  const requestAdd = useCallback((columnId: string) => setQuickAddNonces((current) => ({ ...current, [columnId]: (current[columnId] ?? 0) + 1 })), []);
  const loadMoreColumn = useCallback((columnId: string) => (display.group_by === null ? onLoadMoreUngrouped?.() : onLoadMore?.(columnId)), [display.group_by, onLoadMore, onLoadMoreUngrouped]);

  /** The drag primitives of one container: the hidden dragged copy and the placeholder slot, null when not involved. */
  const dragOf = (container: string) => {
    // Only the dragged copy is hidden: the item's copies in other columns stay (decision 30).
    const hiddenId = drag && drag.fromContainer === container ? itemIdOf(drag.id) : null;
    // The placeholder shows only where the drop would go through.
    const slotIndex = drag?.target && drag.target.container === container && acceptsDrop(drag.fromContainer, container) ? drag.target.index : null;
    return { hiddenId, slotIndex, placeholderHeight: slotIndex === null || !drag ? 0 : drag.height };
  };

  /** A swimlane cell's cards: never windowed (decision 135), redrawn with the board. */
  const renderCellCards = (container: string, column: Column): ReactNode => {
    const { hiddenId, slotIndex, placeholderHeight } = dragOf(container);
    const cards = boardCards(containers.get(container)?.itemIds ?? [], byId, hiddenId, slotIndex);
    if (cards.length === 0) {
      const description = readOnly ? undefined : isClosedColumn(column) ? closedColumnText(display.group_by) : "Drag a card here.";
      return <EmptyState isCompact title="No work items" description={description} />;
    }
    return (
      <BoardVirtualCards
        container={container}
        cards={cards}
        isVirtual={false}
        properties={display.properties}
        moveTargets={moveTargets.get(column.id) ?? NO_TARGETS}
        currentColumn={column.id}
        readOnly={readOnly}
        peekedId={peekedId}
        placeholderHeight={placeholderHeight}
        registerItem={registerItem}
        itemHandlers={itemHandlers}
        onOpen={onOpen}
        onMoveTo={moveToColumn}
      />
    );
  };

  const header = (column: Column) => <ColumnHeader column={column} field={display.group_by} display={display} onAdd={canAddTo(column) ? () => requestAdd(column.id) : undefined} />;

  const quickAddRow = (column: Column) => {
    if (!canAddTo(column)) return null;
    const nonce = quickAddNonces[column.id] ?? 0;
    return <QuickAdd key={`${column.id}:${nonce}`} defaultIsActive={nonce > 0} label={`Add a work item to ${column.name}`} onSubmit={(name) => quickAdd(column, name)} />;
  };

  // A filter that matches nothing: one message with "Clear filters" instead of a strip of empty columns.
  if (onClearFilters && result.total === 0 && result.items.length === 0) {
    return (
      <VStack className="tessera-board" gap={0} paddingBlock={2} data-list-ready="">
        <NoResults onClear={onClearFilters} />
      </VStack>
    );
  }

  return (
    <VStack className="tessera-board" gap={0} data-list-ready="">
      {lanes === null ? (
        <HStack gap={4} vAlign="stretch" className="tessera-board-strip" ref={registerScroller} aria-label="Board columns">
          {columns.map((column) => {
            const container = containerId(column.id, null);
            return (
              <BoardColumn
                key={column.id}
                column={column}
                container={container}
                itemIds={containers.get(container)?.itemIds ?? column.itemIds}
                byId={byId}
                display={display}
                readOnly={readOnly}
                canAdd={canAddTo(column)}
                isClosed={isClosedColumn(column)}
                moveTargets={moveTargets.get(column.id) ?? NO_TARGETS}
                peekedId={peekedId}
                {...dragOf(container)}
                quickAddNonce={quickAddNonces[column.id] ?? 0}
                isLoadingMore={isLoadingMore?.(display.group_by === null ? UNGROUPED_KEY : groupLimitKey(column.id))}
                canLoadMore={column.hasMore && (display.group_by === null ? onLoadMoreUngrouped : onLoadMore) !== undefined}
                registerContainer={registerContainer}
                registerItem={registerItem}
                itemHandlers={itemHandlers}
                onOpen={onOpen}
                onMoveTo={moveToColumn}
                onAddRequest={requestAdd}
                onQuickAdd={quickAdd}
                onLoadMore={loadMoreColumn}
              />
            );
          })}
        </HStack>
      ) : (
        <VStack gap={4} className="tessera-board-strip tessera-board-lanes" ref={registerScroller} aria-label="Board swimlanes">
          <HStack gap={4} className="tessera-board-lane-row tessera-board-heads" ref={trackHeadHeight}>
            {columns.map((column) => (
              <Card key={column.id} variant="muted" padding={3} width={COLUMN_WIDTH} className="tessera-board-column-head">
                <VStack gap={2}>
                  {header(column)}
                  {quickAddRow(column)}
                </VStack>
              </Card>
            ))}
          </HStack>
          {lanes.map((lane) => (
            <Collapsible
              key={lane.id}
              className="tessera-board-lane"
              chevronPosition="start"
              isOpen={!collapsedLanes.has(lane.id)}
              onOpenChange={(isOpen) => toggleLane(lane.id, isOpen)}
              trigger={
                <HStack gap={2} vAlign="center" className="tessera-board-lane-title">
                  <GroupTitle name={lane.name} color={lane.color} id={lane.id} field={display.sub_group_by} level={5} />
                  <Badge label={lane.count} variant="neutral" />
                </HStack>
              }
            >
              <HStack gap={4} vAlign="stretch" className="tessera-board-lane-row">
                {columns.map((column) => {
                  const cell = containerId(column.id, lane.id);
                  return (
                    <Card key={column.id} variant="muted" padding={2} width={COLUMN_WIDTH} className="tessera-board-cell" ref={registerContainer(cell)}>
                      {renderCellCards(cell, column)}
                      {containers.get(cell)?.hasMore && onLoadMore ? (
                        <GroupFooter
                          display={display}
                          variant="card"
                          loaded={containers.get(cell)?.itemIds.length ?? 0}
                          total={containers.get(cell)?.count ?? 0}
                          isLoading={isLoadingMore?.(groupLimitKey(column.id, lane.id))}
                          onLoadMore={() => onLoadMore(column.id, lane.id)}
                        />
                      ) : null}
                    </Card>
                  );
                })}
              </HStack>
            </Collapsible>
          ))}
        </VStack>
      )}
      {drag && dragged
        ? createPortal(
            <Card ref={registerOverlay} padding={3} elevation="high" className="tessera-drag-overlay" aria-hidden="true">
              {/* Same key row as the card (an inert menu slot and the grip), so the ghost is exactly as tall. */}
              <BoardCardBody item={dragged} properties={display.properties} menu={<BoardCardMenuSlot />} grip={<BoardCardGrip />} />
            </Card>,
            document.body,
          )
        : null}
    </VStack>
  );
}
