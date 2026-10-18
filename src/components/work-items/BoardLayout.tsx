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
 * at its end lands after the last loaded card (decision 114).
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
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { groupLimitKey } from "@/lib/tessera/core/group";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import type { Display, GroupBy, PaletteColor, StateGroup, WorkItem } from "@/lib/tessera/types";
import { PlusIcon } from "@/themes/catppuccin/icons";
import { BoardCard, BoardCardBody } from "./BoardCards";
import { dragKey, itemIdOf } from "./board-keys";
import { NONE_GROUP, closedColumnText, containerId, groupValue, useBoardModel, type Column } from "./board-model";
import { isMovableGroup } from "./moves";
import { UNGROUPED_KEY } from "./paging";
import { isOptimisticId } from "./optimistic";
import { ActorLabel, PriorityLabel, StateLabel, isPriority, paletteTokenColor } from "./properties";
import { GroupFooter, GroupPoints } from "./GroupFooter";
import { QuickAdd } from "./QuickAdd";
import { acceptsGroupMove, isOpenGroupValue, openMemberships } from "./quick-add";
import type { LayoutProps, MoveInput, ProjectBundle, QuickAddGroup } from "./types";

/** Structural column width in px; board.css repeats the number for the flex basis. */
const COLUMN_WIDTH = 350;

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

export function BoardLayout({ result, display, bundle, onMove, onOpen, onQuickAdd, canQuickAdd, readOnly = false, onLoadMore, onLoadMoreUngrouped, isLoadingMore }: LayoutProps) {
  const { columns, lanes, containers, byId } = useBoardModel(result, display);
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
  // The modules and cycles items may join or leave; an archived module or a completed or archived cycle is closed.
  const open = useMemo(() => openMemberships(bundle), [bundle]);

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

  /** "Move to" targets of a card in `column`: none when the field cannot be moved between or the column is closed. */
  const moveTargetsFrom = (column: Column): Column[] => {
    const field = display.group_by;
    if (field === null || !canMoveColumns) return [];
    const fromValue = groupValue(column.id, field);
    return columns.filter((target) => acceptsGroupMove(field, fromValue, groupValue(target.id, field), open));
  };

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

  const renderCards = (container: string, column: Column): ReactNode => {
    const ids = containers.get(container)?.itemIds ?? [];
    // Only the dragged copy is hidden: the item's copies in other columns stay (decision 30).
    const visible = ids.map((id) => byId.get(id)).filter((item): item is WorkItem => item !== undefined && dragKey(container, item.id) !== drag?.id);
    const nodes: ReactNode[] = visible.map((item) =>
      isOptimisticId(item.id) ? (
        <Card key={item.id} padding={3} className="tessera-board-card tessera-board-card-pending" aria-busy="true">
          <BoardCardBody item={item} bundle={bundle} properties={display.properties} menu={null} />
        </Card>
      ) : (
        <BoardCard
          key={item.id}
          item={item}
          bundle={bundle}
          properties={display.properties}
          columns={moveTargetsFrom(column)}
          currentColumn={column.id}
          cardRef={readOnly ? undefined : registerItem(dragKey(container, item.id))}
          handlers={readOnly ? undefined : itemHandlers(dragKey(container, item.id), container)}
          onOpen={onOpen}
          onMoveTo={moveToColumn}
        />
      ),
    );
    // The placeholder shows only where the drop would go through.
    if (drag?.target && drag.target.container === container && acceptsDrop(drag.fromContainer, container)) {
      nodes.splice(Math.min(drag.target.index, nodes.length), 0, <Card key="placeholder" variant="muted" padding={0} height={drag.height} className="tessera-board-placeholder" />);
    }
    if (nodes.length === 0) {
      const description = readOnly
        ? undefined
        : isClosedColumn(column)
          ? closedColumnText(display.group_by)
          : lanes === null && canAddTo(column)
            ? "Drag a card here or add one with the plus button."
            : "Drag a card here.";
      return <EmptyState isCompact title="No work items" description={description} />;
    }
    return (
      <VStack gap={2} className="tessera-board-cards">
        {nodes}
      </VStack>
    );
  };

  const header = (column: Column) => (
    <ColumnHeader
      column={column}
      field={display.group_by}
      bundle={bundle}
      display={display}
      onAdd={canAddTo(column) ? () => setQuickAddNonces((current) => ({ ...current, [column.id]: (current[column.id] ?? 0) + 1 })) : undefined}
    />
  );

  const quickAddRow = (column: Column) => {
    if (!canAddTo(column)) return null;
    const nonce = quickAddNonces[column.id] ?? 0;
    return <QuickAdd key={`${column.id}:${nonce}`} defaultIsActive={nonce > 0} label={`Add a work item to ${column.name}`} onSubmit={(name) => quickAdd(column, name)} />;
  };

  return (
    <VStack className="tessera-board" gap={0} data-list-ready="">
      {lanes === null ? (
        <HStack gap={4} vAlign="stretch" className="tessera-board-strip" ref={registerScroller} aria-label="Board columns">
          {columns.map((column) => (
            <Card key={column.id} variant="muted" padding={0} width={COLUMN_WIDTH} className="tessera-board-column">
              <Layout
                height="fill"
                header={
                  <LayoutHeader hasDivider padding={3}>
                    {header(column)}
                  </LayoutHeader>
                }
                content={
                  <LayoutContent ref={registerContainer(containerId(column.id, null))} padding={2} className="tessera-board-column-body">
                    {renderCards(containerId(column.id, null), column)}
                  </LayoutContent>
                }
                footer={
                  column.hasMore || canAddTo(column) ? (
                    <LayoutFooter padding={2}>
                      {column.hasMore && (display.group_by === null ? onLoadMoreUngrouped : onLoadMore) ? (
                        <GroupFooter
                          display={display}
                          variant="card"
                          loaded={column.itemIds.length}
                          total={column.count}
                          isLoading={isLoadingMore?.(display.group_by === null ? UNGROUPED_KEY : groupLimitKey(column.id))}
                          onLoadMore={() => (display.group_by === null ? onLoadMoreUngrouped?.() : onLoadMore?.(column.id))}
                        />
                      ) : null}
                      {quickAddRow(column)}
                    </LayoutFooter>
                  ) : undefined
                }
              />
            </Card>
          ))}
        </HStack>
      ) : (
        <VStack gap={4} className="tessera-board-strip tessera-board-lanes" ref={registerScroller} aria-label="Board swimlanes">
          <HStack gap={4} className="tessera-board-lane-row">
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
                  <GroupTitle name={lane.name} color={lane.color} id={lane.id} field={display.sub_group_by} bundle={bundle} level={5} />
                  <Badge label={lane.count} variant="neutral" />
                </HStack>
              }
            >
              <HStack gap={4} vAlign="stretch" className="tessera-board-lane-row">
                {columns.map((column) => {
                  const cell = containerId(column.id, lane.id);
                  return (
                    <Card key={column.id} variant="muted" padding={2} width={COLUMN_WIDTH} className="tessera-board-cell" ref={registerContainer(cell)}>
                      {renderCards(cell, column)}
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
              <BoardCardBody item={dragged} bundle={bundle} properties={display.properties} menu={null} />
            </Card>,
            document.body,
          )
        : null}
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Column header and group titles
// ---------------------------------------------------------------------------

/** `onAdd` absent: the column takes no quick-add (closed scope or a closed state in a cycle), so no plus button. */
function ColumnHeader({ column, field, bundle, display, onAdd }: { column: Column; field: GroupBy | null; bundle: ProjectBundle; display: Display; onAdd?: () => void }) {
  return (
    <HStack hAlign="between" vAlign="center" gap={2}>
      <HStack gap={2} vAlign="center" className="tessera-board-column-title">
        <GroupTitle name={column.name} color={column.color} id={column.id} field={field} bundle={bundle} level={4} />
        <Badge label={column.count} variant="neutral" />
        <GroupPoints points={column.points} display={display} />
      </HStack>
      {onAdd ? <IconButton label={`Add a work item to ${column.name}`} tooltip="Add work item" size="sm" variant="ghost" icon={<Icon icon={PlusIcon} size="sm" />} onClick={onAdd} /> : null}
    </HStack>
  );
}

/** A group's name with its mark: StatusDot for states and state groups, the priority glyph, a coloured Token for labels, cycles and modules, an avatar for actors. */
function GroupTitle({ name, color, id, field, bundle, level }: { name: string; color: PaletteColor | null; id: string; field: GroupBy | null; bundle: ProjectBundle; level: 4 | 5 }) {
  const heading = (
    <Heading level={level} maxLines={1}>
      {name}
    </Heading>
  );
  if (id === NONE_GROUP && field !== "priority") {
    return (
      <Heading level={level} color="secondary" maxLines={1}>
        {name}
      </Heading>
    );
  }
  if (field === "assignees" || field === "created_by") {
    return <ActorLabel name={name} />;
  }
  if (field === "state") {
    const state = bundle.states.find((candidate) => candidate.id === id);
    return state ? <StateLabel state={state} /> : heading;
  }
  if (field === "state_group" && STATE_GROUPS.has(id)) {
    return <StateLabel group={id as StateGroup} name={name} />;
  }
  if (field === "priority" && isPriority(id)) {
    return <PriorityLabel value={id} />;
  }
  if (color !== null) {
    return <Token label={name} size="md" color={paletteTokenColor(color)} />;
  }
  return heading;
}
