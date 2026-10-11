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
 * no "Move to"; quick-add placeholders render as inert cards.
 *
 * Layout idea ported from the Astryx `kanban-board` page template (MIT,
 * Meta Platforms; THIRD_PARTY_NOTICES.md): className + tokens
 * (src/components/styles/board.css) instead of StyleX, Phosphor icons.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@astryxdesign/core/Avatar";
import { AvatarGroup } from "@astryxdesign/core/AvatarGroup";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from "@astryxdesign/core/Layout";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { usePointerDrag, type DragDropEvent, type ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import type { Display, DisplayProperties, Group, GroupBy, PaletteColor, StateGroup, WorkItem } from "@/lib/tessera/types";
import { PlusIcon } from "@/themes/catppuccin/icons";
import { isMovableGroup } from "./moves";
import { isOptimisticId } from "./optimistic";
import { ActorLabel, PriorityLabel, StateLabel, isPriority, paletteTokenColor } from "./properties";
import { QuickAdd } from "./QuickAdd";
import type { LayoutProps, MoveInput, ProjectBundle } from "./types";

/** Id of the synthetic "no value" group (`NONE_GROUP_ID` in the engine's filters.ts). */
const NONE_GROUP = "none";
/** Structural column width in px; board.css repeats the number for the flex basis. */
const COLUMN_WIDTH = 350;

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

/** The engine's group id for a move: the none group becomes null, except for priority where "none" is a real value. */
function groupValue(id: string, field: GroupBy): string | null {
  return id === NONE_GROUP && field !== "priority" ? null : id;
}

type Column = { id: string; name: string; color: PaletteColor | null; count: number; itemIds: string[] };
type Lane = { id: string; name: string; color: PaletteColor | null; count: number; cells: Map<string, string[]> };
type Container = { columnId: string; laneId: string | null; itemIds: string[] };

function containerId(columnId: string, laneId: string | null): string {
  return laneId === null ? `col:${columnId}` : `cell:${laneId}::${columnId}`;
}

function toColumn(group: Group): Column {
  return { id: group.id, name: group.name, color: group.color, count: group.count, itemIds: group.item_ids };
}

/** Columns, swimlanes and drop containers derived from the grouped list result. */
function useBoardModel(result: LayoutProps["result"], display: Display) {
  return useMemo(() => {
    const groups = result.groups ?? [];
    const grouped = display.group_by !== null && groups.length > 0;
    const columns: Column[] = grouped
      ? groups.filter((group) => display.show_empty_groups || group.count > 0).map(toColumn)
      : [{ id: "all", name: "All work items", color: null, count: result.items.length, itemIds: result.items.map((item) => item.id) }];

    let lanes: Lane[] | null = null;
    if (grouped && display.sub_group_by !== null) {
      const laneMap = new Map<string, Lane>();
      for (const group of groups) {
        for (const sub of group.sub_groups ?? []) {
          let lane = laneMap.get(sub.id);
          if (!lane) {
            lane = { id: sub.id, name: sub.name, color: sub.color, count: 0, cells: new Map() };
            laneMap.set(sub.id, lane);
          }
          lane.count += sub.count;
          lane.cells.set(group.id, sub.item_ids);
        }
      }
      lanes = [...laneMap.values()].filter((lane) => display.show_empty_groups || lane.count > 0);
    }

    const containers = new Map<string, Container>();
    if (lanes === null) {
      for (const column of columns) containers.set(containerId(column.id, null), { columnId: column.id, laneId: null, itemIds: column.itemIds });
    } else {
      for (const lane of lanes) {
        for (const column of columns) {
          containers.set(containerId(column.id, lane.id), { columnId: column.id, laneId: lane.id, itemIds: lane.cells.get(column.id) ?? [] });
        }
      }
    }
    const byId = new Map(result.items.map((item) => [item.id, item]));
    return { columns, lanes, containers, byId };
  }, [display.group_by, display.show_empty_groups, display.sub_group_by, result.groups, result.items]);
}

export function BoardLayout({ result, display, bundle, onMove, onOpen, onQuickAdd }: LayoutProps) {
  const { columns, lanes, containers, byId } = useBoardModel(result, display);
  // The header "+" opens that column's quick-add row; a per-column nonce remounts only that row
  // active, so text typed in another column's row survives.
  const [quickAddNonces, setQuickAddNonces] = useState<Record<string, number>>({});
  const canMoveColumns = isMovableGroup(display.group_by);
  const canMoveLanes = isMovableGroup(display.sub_group_by);

  // Quick-add placeholders are not registered with the drag hook and cannot be neighbours.
  const itemsOf = useCallback((container: string) => (containers.get(container)?.itemIds ?? []).filter((id) => !isOptimisticId(id)), [containers]);

  const handleDrop = useCallback(
    (event: DragDropEvent) => {
      const from = containers.get(event.fromContainer);
      const to = containers.get(event.toContainer);
      if (!from || !to) return;
      // Neighbour ids only mean something when the list is in sort order; otherwise a drop just changes the group.
      const placement: Pick<MoveInput, "before_id" | "after_id"> = display.order_by === "sort_order" ? { before_id: event.before_id, after_id: event.after_id } : {};
      const field = display.group_by;
      const columnChanged = from.columnId !== to.columnId;
      const laneChanged = to.laneId !== null && from.laneId !== to.laneId;
      // A drop into a column (or lane) of a field the engine cannot move between is ignored: the card snaps back.
      if ((columnChanged && !canMoveColumns) || (laneChanged && !canMoveLanes)) return;
      if (field !== null && columnChanged) {
        onMove({ id: event.id, group_by: field, value: groupValue(to.columnId, field), from_value: groupValue(from.columnId, field), ...placement });
      } else if (placement.before_id !== undefined || placement.after_id !== undefined) {
        onMove({ id: event.id, ...placement });
      }
      const subField = display.sub_group_by;
      if (subField !== null && laneChanged && to.laneId !== null) {
        onMove({ id: event.id, group_by: subField, value: groupValue(to.laneId, subField), from_value: from.laneId === null ? null : groupValue(from.laneId, subField) });
      }
    },
    [canMoveColumns, canMoveLanes, containers, display.group_by, display.order_by, display.sub_group_by, onMove],
  );

  const { drag, registerContainer, registerItem, registerScroller, registerOverlay, itemHandlers } = usePointerDrag({ onDrop: handleDrop, itemsOf });
  const dragged = drag ? byId.get(drag.id) : undefined;

  const moveToColumn = useCallback(
    (itemId: string, fromColumn: string, toColumn: string) => {
      const field = display.group_by;
      if (field === null || !canMoveColumns) return;
      onMove({ id: itemId, group_by: field, value: groupValue(toColumn, field), from_value: groupValue(fromColumn, field) });
    },
    [canMoveColumns, display.group_by, onMove],
  );

  const quickAdd = useCallback(
    (column: Column, name: string) => {
      const field = display.group_by;
      onQuickAdd({ field, value: field === null ? null : groupValue(column.id, field) }, name);
    },
    [display.group_by, onQuickAdd],
  );

  const renderCards = (container: string, column: Column): ReactNode => {
    const ids = containers.get(container)?.itemIds ?? [];
    const visible = ids.map((id) => byId.get(id)).filter((item): item is WorkItem => item !== undefined && item.id !== drag?.id);
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
          columns={canMoveColumns ? columns : []}
          currentColumn={column.id}
          cardRef={registerItem(item.id)}
          handlers={itemHandlers(item.id, container)}
          onOpen={onOpen}
          onMoveTo={moveToColumn}
        />
      ),
    );
    if (drag?.target && drag.target.container === container) {
      nodes.splice(Math.min(drag.target.index, nodes.length), 0, <Card key="placeholder" variant="muted" padding={0} height={drag.height} className="tessera-board-placeholder" />);
    }
    if (nodes.length === 0) {
      return <EmptyState isCompact title="No work items" description={lanes === null ? "Drag a card here or add one with the plus button." : "Drag a card here."} />;
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
      onAdd={() => setQuickAddNonces((current) => ({ ...current, [column.id]: (current[column.id] ?? 0) + 1 }))}
    />
  );

  const quickAddRow = (column: Column) => {
    const nonce = quickAddNonces[column.id] ?? 0;
    return <QuickAdd key={`${column.id}:${nonce}`} defaultIsActive={nonce > 0} label={`Add a work item to ${column.name}`} onSubmit={(name) => quickAdd(column, name)} />;
  };

  return (
    <VStack className="tessera-board" gap={0}>
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
                footer={<LayoutFooter padding={2}>{quickAddRow(column)}</LayoutFooter>}
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
            <VStack key={lane.id} gap={2} className="tessera-board-lane">
              <HStack gap={2} vAlign="center" className="tessera-board-lane-title">
                <GroupTitle name={lane.name} color={lane.color} id={lane.id} field={display.sub_group_by} bundle={bundle} level={5} />
                <Badge label={lane.count} variant="neutral" />
              </HStack>
              <HStack gap={4} vAlign="stretch" className="tessera-board-lane-row">
                {columns.map((column) => {
                  const cell = containerId(column.id, lane.id);
                  return (
                    <Card key={column.id} variant="muted" padding={2} width={COLUMN_WIDTH} className="tessera-board-cell" ref={registerContainer(cell)}>
                      {renderCards(cell, column)}
                    </Card>
                  );
                })}
              </HStack>
            </VStack>
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

function ColumnHeader({ column, field, bundle, onAdd }: { column: Column; field: GroupBy | null; bundle: ProjectBundle; onAdd: () => void }) {
  return (
    <HStack hAlign="between" vAlign="center" gap={2}>
      <HStack gap={2} vAlign="center" className="tessera-board-column-title">
        <GroupTitle name={column.name} color={column.color} id={column.id} field={field} bundle={bundle} level={4} />
        <Badge label={column.count} variant="neutral" />
      </HStack>
      <IconButton label={`Add a work item to ${column.name}`} tooltip="Add work item" size="sm" variant="ghost" icon={<Icon icon={PlusIcon} size="sm" />} onClick={onAdd} />
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

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function BoardCard({
  item,
  bundle,
  properties,
  columns,
  currentColumn,
  cardRef,
  handlers,
  onOpen,
  onMoveTo,
}: {
  item: WorkItem;
  bundle: ProjectBundle;
  properties: DisplayProperties;
  /** "Move to" targets; empty when the grouped field cannot be moved between. */
  columns: Column[];
  currentColumn: string;
  cardRef: (el: HTMLDivElement | null) => void;
  handlers: ItemDragHandlers;
  onOpen: (id: string) => void;
  onMoveTo: (itemId: string, fromColumn: string, toColumn: string) => void;
}) {
  const targets = columns.filter((column) => column.id !== currentColumn);
  const menu = (
    <MoreMenu
      label={`Actions for ${item.key}`}
      size="sm"
      alignment="end"
      items={[
        { id: "open", label: "Open", onClick: () => onOpen(item.id) },
        ...(targets.length > 0
          ? [
              { type: "divider" as const },
              {
                id: "move",
                label: "Move to",
                items: targets.map((column) => ({ id: column.id, label: column.name, onClick: () => onMoveTo(item.id, currentColumn, column.id) })),
              },
            ]
          : []),
      ]}
    />
  );
  return (
    <ClickableCard
      ref={cardRef}
      label={`${item.key} ${item.name}`}
      padding={3}
      className="tessera-board-card"
      onClick={() => onOpen(item.id)}
      onPointerDown={handlers.onPointerDown}
      onClickCapture={handlers.onClickCapture}
    >
      <BoardCardBody item={item} bundle={bundle} properties={properties} menu={menu} />
    </ClickableCard>
  );
}

/** Card contents, shared by the column card and the drag overlay clone so both stay identical. */
function BoardCardBody({ item, bundle, properties, menu }: { item: WorkItem; bundle: ProjectBundle; properties: DisplayProperties; menu: ReactNode }) {
  return (
    <VStack gap={2}>
      <HStack hAlign="between" vAlign="center" gap={2}>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {properties.key ? item.key : ""}
        </Text>
        {menu}
      </HStack>
      <Text weight="medium" maxLines={3}>
        {item.name}
      </Text>
      <CardProperties item={item} bundle={bundle} properties={properties} />
    </VStack>
  );
}

/** Compact property tokens enabled in display.properties. */
function CardProperties({ item, bundle, properties }: { item: WorkItem; bundle: ProjectBundle; properties: DisplayProperties }) {
  const state = properties.state ? bundle.states.find((candidate) => candidate.id === item.state_id) : undefined;
  const labels = properties.labels ? bundle.labels.filter((label) => item.label_ids.includes(label.id)) : [];
  const modules = properties.modules ? bundle.modules.filter((module) => item.module_ids.includes(module.id)) : [];
  const cycle = properties.cycle && item.cycle_id !== null ? bundle.cycles.find((candidate) => candidate.id === item.cycle_id) : undefined;
  const assignees = properties.assignees ? bundle.actors.filter((actor) => item.assignee_ids.includes(actor.id)) : [];
  const showPriority = properties.priority && item.priority !== "none";
  const dates: string[] = [];
  if (properties.start_date && item.start_date !== null) dates.push(`Start ${item.start_date}`);
  if (properties.target_date && item.target_date !== null) dates.push(`Due ${item.target_date}`);
  const counts: string[] = [];
  if (properties.sub_items_count && item.sub_items_count > 0) counts.push(item.sub_items_count === 1 ? "1 sub-item" : `${item.sub_items_count} sub-items`);
  if (properties.links && item.links_count > 0) counts.push(item.links_count === 1 ? "1 link" : `${item.links_count} links`);
  if (properties.created_at) counts.push(`Created ${item.created_at.slice(0, 10)}`);
  if (properties.updated_at) counts.push(`Updated ${item.updated_at.slice(0, 10)}`);

  const hasTokens = state !== undefined || showPriority || labels.length > 0 || modules.length > 0 || cycle !== undefined || assignees.length > 0;
  if (!hasTokens && dates.length === 0 && counts.length === 0) return null;

  return (
    <VStack gap={1}>
      {hasTokens ? (
        <HStack gap={1.5} vAlign="center" wrap="wrap">
          {state ? (
            <Text type="supporting" color="secondary">
              <StateLabel state={state} />
            </Text>
          ) : null}
          {showPriority ? (
            <Text type="supporting" color="secondary">
              <PriorityLabel value={item.priority} />
            </Text>
          ) : null}
          {labels.map((label) => (
            <Token key={label.id} size="sm" label={label.name} color={paletteTokenColor(label.color)} />
          ))}
          {cycle ? <Token key={cycle.id} size="sm" label={cycle.name} /> : null}
          {modules.map((module) => (
            <Token key={module.id} size="sm" label={module.name} />
          ))}
          {assignees.length > 0 ? (
            <AvatarGroup size="xsm">
              {assignees.map((actor) => (
                <Avatar key={actor.id} name={actor.name} size="xsm" tooltip={actor.name} />
              ))}
            </AvatarGroup>
          ) : null}
        </HStack>
      ) : null}
      {dates.length > 0 ? (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {dates.join(" · ")}
        </Text>
      ) : null}
      {counts.length > 0 ? (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {counts.join(" · ")}
        </Text>
      ) : null}
    </VStack>
  );
}
