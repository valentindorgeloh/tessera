"use client";

/**
 * One board column without swimlanes (decisions 135-136): the column Card with its header, its scrolling body and
 * its footer ("Show more", quick add). Memoised, and every prop is a primitive or a stable reference: the drag state
 * reaches it as `hiddenId` / `slotIndex` / `placeholderHeight`, which a drag publish changes for at most the source
 * and the target column, so only those re-render. The body is the column's own scroller: a nested
 * `VirtualScrollerProvider` windows its cards above `VIRTUAL_BOARD_MIN` loaded cards, and only while the screen's
 * provider virtualises.
 *
 * The column header and `GroupTitle` (also used by the swimlane heads in BoardLayout) read project data from the
 * lean `useProjectRow()` context.
 */
import { memo, useCallback, useMemo, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import { VirtualScrollerProvider } from "@/components/virtual/VirtualScrollerProvider";
import { INITIAL_BOARD_BODY, VIRTUAL_BOARD_MIN } from "@/components/virtual/virtual-config";
import { shouldVirtualize } from "@/components/virtual/virtual-math";
import type { Display, GroupBy, PaletteColor, StateGroup, WorkItem } from "@/lib/tessera/types";
import { PlusIcon } from "@/themes/catppuccin/icons";
import { NONE_GROUP, closedColumnText, type Column } from "./board-model";
import { BoardVirtualCards, boardCards } from "./BoardVirtualCards";
import { GroupFooter, GroupPoints } from "./GroupFooter";
import { useProjectRow } from "./project-provider";
import { ActorLabel, PriorityLabel, StateLabel, isPriority, paletteTokenColor } from "./properties";
import { QuickAdd } from "./QuickAdd";

/**
 * Column width: 350px, but never wider than the strip's content box, so a phone shows one full column
 * and scrolls (snapping) to the next. `cqw` is the strip's content width: board.css makes the strip the size container
 * and repeats this value as --tessera-board-column-width for the flex basis.
 */
export const COLUMN_WIDTH = "min(350px, 100cqw)";

export type BoardColumnProps = {
  column: Column;
  /** The drop container id of the column ("col:<id>"). */
  container: string;
  /** `containers.get(container).itemIds`: keeps its identity while the result does. */
  itemIds: readonly string[];
  byId: ReadonlyMap<string, WorkItem>;
  /** The screen's display (structurally shared, decision 141). */
  display: Display;
  readOnly: boolean;
  /** Whether the column takes a quick-add (BoardLayout's `canAddTo`), never the `canQuickAdd` function. */
  canAdd: boolean;
  /** No item may join the column (an archived module, a completed or archived cycle). */
  isClosed: boolean;
  /** "Move to" targets of a card in this column (memoised per column). */
  moveTargets: readonly { id: string; name: string }[];
  peekedId: string | null;
  /** The dragged item's id when this column is the drag source, else null. */
  hiddenId: string | null;
  /** The drop slot when this column is the drop target, else null. */
  slotIndex: number | null;
  /** The dragged card's height while this column is the target, else 0. */
  placeholderHeight: number;
  /** Bumped by the header "+": remounts the quick-add row active. */
  quickAddNonce: number;
  /** Whether "Show more" is loading for this column. */
  isLoadingMore: boolean | undefined;
  /** Shows the column footer's "Show more". */
  canLoadMore: boolean;
  registerContainer: (id: string) => (el: HTMLElement | null) => void;
  registerItem: (id: string) => (el: HTMLElement | null) => void;
  itemHandlers: (id: string, container: string) => ItemDragHandlers;
  onOpen: (id: string) => void;
  onMoveTo: (itemId: string, fromColumn: string, toColumn: string) => void;
  onAddRequest: (columnId: string) => void;
  onQuickAdd: (column: Column, name: string) => void;
  onLoadMore: (columnId: string) => void;
};

export const BoardColumn = memo(function BoardColumn({
  column,
  container,
  itemIds,
  byId,
  display,
  readOnly,
  canAdd,
  isClosed,
  moveTargets,
  peekedId,
  hiddenId,
  slotIndex,
  placeholderHeight,
  quickAddNonce,
  isLoadingMore,
  canLoadMore,
  registerContainer,
  registerItem,
  itemHandlers,
  onOpen,
  onMoveTo,
  onAddRequest,
  onQuickAdd,
  onLoadMore,
}: BoardColumnProps) {
  // The body is this column's scroller: held in state (a ref callback may set state) for the nested provider.
  const [body, setBody] = useState<HTMLElement | null>(null);
  const register = registerContainer(container);
  const bodyRef = useCallback(
    (el: HTMLElement | null) => {
      register(el);
      setBody(el);
    },
    [register],
  );
  const cards = useMemo(() => boardCards(itemIds, byId, hiddenId, slotIndex), [itemIds, byId, hiddenId, slotIndex]);
  const isVirtual = shouldVirtualize(itemIds.length, VIRTUAL_BOARD_MIN);
  const description = readOnly ? undefined : isClosed ? closedColumnText(display.group_by) : canAdd ? "Drag a card here or add one with the plus button." : "Drag a card here.";
  const columnId = column.id;
  const add = useCallback(() => onAddRequest(columnId), [onAddRequest, columnId]);
  return (
    <Card variant="muted" padding={0} width={COLUMN_WIDTH} className="tessera-board-column">
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={3}>
            <ColumnHeader column={column} field={display.group_by} display={display} onAdd={canAdd ? add : undefined} />
          </LayoutHeader>
        }
        content={
          <LayoutContent ref={bodyRef} padding={2} className="tessera-board-column-body">
            <VirtualScrollerProvider scroller={body} initialViewport={INITIAL_BOARD_BODY} nested>
              {cards.length === 0 ? (
                <EmptyState isCompact title="No work items" description={description} />
              ) : (
                <BoardVirtualCards
                  container={container}
                  cards={cards}
                  isVirtual={isVirtual}
                  properties={display.properties}
                  moveTargets={moveTargets}
                  currentColumn={column.id}
                  readOnly={readOnly}
                  peekedId={peekedId}
                  placeholderHeight={placeholderHeight}
                  registerItem={registerItem}
                  itemHandlers={itemHandlers}
                  onOpen={onOpen}
                  onMoveTo={onMoveTo}
                />
              )}
            </VirtualScrollerProvider>
          </LayoutContent>
        }
        footer={
          canLoadMore || canAdd ? (
            <LayoutFooter padding={2}>
              {canLoadMore ? <GroupFooter display={display} variant="card" loaded={column.itemIds.length} total={column.count} isLoading={isLoadingMore} onLoadMore={() => onLoadMore(column.id)} /> : null}
              {canAdd ? (
                <QuickAdd key={`${column.id}:${quickAddNonce}`} defaultIsActive={quickAddNonce > 0} label={`Add a work item to ${column.name}`} onSubmit={(name) => onQuickAdd(column, name)} />
              ) : null}
            </LayoutFooter>
          ) : undefined
        }
      />
    </Card>
  );
});

/** `onAdd` absent: the column takes no quick-add (closed scope or a closed state in a cycle), so no plus button. */
export function ColumnHeader({ column, field, display, onAdd }: { column: Column; field: GroupBy | null; display: Display; onAdd?: () => void }) {
  return (
    <HStack hAlign="between" vAlign="center" gap={2}>
      <HStack gap={2} vAlign="center" className="tessera-board-column-title">
        <GroupTitle name={column.name} color={column.color} id={column.id} field={field} level={4} />
        <Badge label={column.count} variant="neutral" />
        <GroupPoints points={column.points} display={display} />
      </HStack>
      {onAdd ? <IconButton label={`Add a work item to ${column.name}`} tooltip="Add work item" size="sm" variant="ghost" icon={<Icon icon={PlusIcon} size="sm" />} onClick={onAdd} /> : null}
    </HStack>
  );
}

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

/** A group's name with its mark: StatusDot for states and state groups, the priority glyph, a coloured Token for labels, cycles and modules, an avatar for actors. */
export function GroupTitle({ name, color, id, field, level }: { name: string; color: PaletteColor | null; id: string; field: GroupBy | null; level: 4 | 5 }) {
  const { bundle } = useProjectRow();
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
    return <ActorLabel name={name} actor={bundle.actors.find((actor) => actor.id === id) ?? null} />;
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
