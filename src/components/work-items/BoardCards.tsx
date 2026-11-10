"use client";

/**
 * Board cards: the draggable card with its "Move to" menu, the card body shared
 * with the drag overlay, and the compact property tokens. Split out of
 * BoardLayout.tsx. The card is memoised (decision 136): project data comes from
 * the lean `useProjectRow()` context, never a `bundle` prop, so a write that
 * leaves the card alone does not redraw it, and a virtual column passes only
 * its window primitives (`virtualIndex`, `measureRef`, `keptTop`).
 */

import { memo, useCallback, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AvatarGroup } from "@astryxdesign/core/AvatarGroup";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Icon, useIcon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { formatEstimateValue } from "@/components/estimates/estimate-format";
import type { ItemDragHandlers } from "@/components/dnd/use-pointer-drag";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { keptRowStyle } from "@/components/virtual/use-virtual-rows";
import type { DisplayProperties, WorkItem } from "@/lib/tessera/types";
import { DragHandleIcon } from "@/themes/catppuccin/icons";
import { useProjectRow } from "./project-provider";
import { ArmedContext, useArmed, useArmedHandoff, useChipHandoff, useRowArming } from "./properties/arming";
import { PriorityLabel, StateLabel, paletteTokenColor } from "./properties";

/** The press target that starts a touch or pen drag (board.css `.tessera-board-card-grip`). */
const GRIP_SELECTOR = ".tessera-board-card-grip";

/**
 * The grip a draggable card carries in its key row (field guide "Drag and touch"). It is the only place with
 * `touch-action: none` (`.tessera-row-grip`), so a finger anywhere else on the card or the column scrolls. Hidden on a
 * fine pointer wide screen, where the whole card is the handle (board.css).
 */
export function BoardCardGrip() {
  return <Icon icon={DragHandleIcon} size="sm" color="secondary" className="tessera-row-grip tessera-board-card-grip" />;
}

/** The card's menu slot: sized like the menu so the drag overlay's inert copy keeps the card's height (board.css). */
export function BoardCardMenuSlot({ children }: { children?: ReactNode }) {
  return (
    // Focus inside the slot (the button or its open menu) is the card's menu to the focus-follow (./focus-follow.ts).
    <HStack vAlign="center" className="tessera-board-card-menu" aria-hidden={children === undefined ? true : undefined} data-focus-key={MENU_ARM_KEY}>
      {children}
    </HStack>
  );
}

/** The key a card's actions menu goes by in the arming state (./properties/arming.tsx). */
const MENU_ARM_KEY = "menu";

type CardMenuProps = {
  item: WorkItem;
  currentColumn: string;
  targets: { id: string; name: string }[];
  onOpen: (id: string) => void;
  onMoveTo: (itemId: string, fromColumn: string, toColumn: string) => void;
};

/** The card's "Actions" menu: an icon button until the card arms, and the real menu (open when its button was clicked) after. */
function CardMenu(props: CardMenuProps) {
  const { armed, arm } = useArmed();
  const handoff = useChipHandoff(arm, MENU_ARM_KEY);
  const moreIcon = useIcon("moreHorizontal");
  // How the click that armed the card was made. A click from the keyboard or from assistive technology has no pointer, so
  // its `detail` is 0 (the way Astryx's own menu button tells a key from a press); a mouse or a finger reports 1 or more.
  const [isKeyClick, setKeyClick] = useState(false);
  if (!armed) {
    return (
      <IconButton
        ref={handoff}
        variant="ghost"
        size="sm"
        label={`Actions for ${props.item.key}`}
        icon={moreIcon}
        data-arm-key={MENU_ARM_KEY}
        onClick={(event) => {
          setKeyClick(event.detail === 0);
          arm(MENU_ARM_KEY, MENU_ARM_KEY);
        }}
      />
    );
  }
  return <ArmedCardMenu {...props} isKeyOpen={isKeyClick} />;
}

function ArmedCardMenu({ item, currentColumn, targets, onOpen, onMoveTo, isKeyOpen }: CardMenuProps & { isKeyOpen: boolean }) {
  const { isDefaultOpen, takeFocus } = useArmedHandoff(MENU_ARM_KEY);
  // Mounts only once the card has armed, so the click that armed it decides how the menu opens. A pointer's click mounts it
  // open and Astryx leaves the focus alone (a menu that mounts open is not an open anyone asked for). A key's click opens it
  // after it has mounted, from the ref callback that has already put the focus on the button: Astryx then reads it as the
  // keyboard open it is and moves the focus to the first item, and Escape or a pick returns it to the button.
  const [isOpen, setOpen] = useState(isDefaultOpen && !isKeyOpen);
  const handoff = useMemo(() => {
    if (!takeFocus || !isDefaultOpen || !isKeyOpen) return takeFocus;
    return (element: HTMLButtonElement | null) => {
      takeFocus(element);
      if (element) setOpen(true);
    };
  }, [takeFocus, isDefaultOpen, isKeyOpen]);
  return (
    <MoreMenu
      ref={handoff}
      label={`Actions for ${item.key}`}
      size="sm"
      alignment="end"
      isMenuOpen={isOpen}
      onOpenChange={setOpen}
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
}

/** The window props of a card or a placeholder in a virtual column; all absent while the column is not windowed. */
export type WindowCardProps = {
  virtualIndex?: number;
  measureRef?: (el: Element | null) => void;
  keptTop?: number;
};

/** `data-index`, and for a kept card outside the window its class and offset (virtual.css). */
export function windowCardProps(className: string, { virtualIndex, keptTop }: WindowCardProps): { className: string; "data-index"?: string; style?: ReturnType<typeof keptRowStyle> } {
  if (virtualIndex === undefined) return { className };
  if (keptTop === undefined) return { className, "data-index": String(virtualIndex) };
  return { className: `${className} tessera-virtual-kept`, "data-index": String(virtualIndex), style: keptRowStyle(keptTop) };
}

/** One ref from the drag registration and the window's measuring ref; stable while both are. */
function useCardRef(cardRef: ((el: HTMLDivElement | null) => void) | undefined, measureRef: ((el: Element | null) => void) | undefined) {
  return useCallback(
    (el: HTMLDivElement | null) => {
      cardRef?.(el);
      measureRef?.(el);
    },
    [cardRef, measureRef],
  );
}

export type BoardCardProps = WindowCardProps & {
  item: WorkItem;
  properties: DisplayProperties;
  /** "Move to" targets; empty when the grouped field cannot be moved between. */
  columns: readonly { id: string; name: string }[];
  currentColumn: string;
  /** Absent when the board is read-only: the card is not a drag source. */
  cardRef?: (el: HTMLDivElement | null) => void;
  handlers?: ItemDragHandlers;
  /** The side peek shows this item: the card is marked `aria-current` and takes the accent border (board.css). */
  isPeeked?: boolean;
  onOpen: (id: string) => void;
  onMoveTo: (itemId: string, fromColumn: string, toColumn: string) => void;
};

/**
 * Memoised (decision 136): its props are the item, primitives and stable references (the cached drag handlers and
 * ref of use-pointer-drag.ts, the screen's stable callbacks, the column's memoised "Move to" targets).
 */
export const BoardCard = memo(function BoardCard({
  item,
  properties,
  columns,
  currentColumn,
  cardRef,
  handlers,
  isPeeked = false,
  onOpen,
  onMoveTo,
  ...windowed
}: BoardCardProps) {
  const ref = useCardRef(cardRef, windowed.measureRef);
  const targets = columns.filter((column) => column.id !== currentColumn);
  // The actions menu is an icon button until the pointer or focus reaches the card (./properties/arming.tsx). The state
  // lives in this card, so a kept card (focused outside the window) stays armed; a card that mounts as the window moves
  // starts at rest and arms on the pointer's next move or enter.
  const { state: arming, handlers: armingHandlers } = useRowArming();
  const menu = (
    <BoardCardMenuSlot>
      <ArmedContext value={arming}>
        <CardMenu item={item} currentColumn={currentColumn} targets={targets} onOpen={onOpen} onMoveTo={onMoveTo} />
      </ArmedContext>
    </BoardCardMenuSlot>
  );
  // A mouse or pen drags from anywhere on the card; a finger only from the grip, so the rest of the card scrolls.
  const dragHandlers = handlers && {
    ...handlers,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch" && !(event.target as Element | null)?.closest(GRIP_SELECTOR)) return;
      handlers.onPointerDown(event);
    },
  };
  return (
    <ClickableCard
      ref={ref}
      label={`${item.key} ${item.name}`}
      padding={3}
      aria-current={isPeeked ? "true" : undefined}
      data-item-id={item.id}
      {...windowCardProps(handlers ? "tessera-board-card" : "tessera-board-card tessera-board-card-readonly", windowed)}
      onClick={() => onOpen(item.id)}
      onPointerDown={dragHandlers?.onPointerDown}
      onClickCapture={handlers?.onClickCapture}
      onPointerEnter={armingHandlers.onPointerEnter}
      onPointerMove={armingHandlers.onPointerMove}
      onFocus={armingHandlers.onFocus}
    >
      <BoardCardBody item={item} properties={properties} menu={menu} grip={handlers ? <BoardCardGrip /> : null} />
    </ClickableCard>
  );
});

/** Card contents, shared by the column card and the drag overlay clone so both stay identical. */
export function BoardCardBody({ item, properties, menu, grip = null }: { item: WorkItem; properties: DisplayProperties; menu: ReactNode; grip?: ReactNode }) {
  return (
    <VStack gap={2}>
      <HStack hAlign="between" vAlign="center" gap={2}>
        <HStack vAlign="center" gap={2}>
          {grip}
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {properties.key ? item.key : ""}
          </Text>
        </HStack>
        {menu}
      </HStack>
      <Text weight="medium" maxLines={3}>
        {item.name}
      </Text>
      <CardProperties item={item} properties={properties} />
    </VStack>
  );
}

/** Compact property tokens enabled in display.properties; project data from the lean row context. */
function CardProperties({ item, properties }: { item: WorkItem; properties: DisplayProperties }) {
  const { bundle } = useProjectRow();
  const state = properties.state ? bundle.states.find((candidate) => candidate.id === item.state_id) : undefined;
  const labels = properties.labels ? bundle.labels.filter((label) => item.label_ids.includes(label.id)) : [];
  const modules = properties.modules ? bundle.modules.filter((module) => item.module_ids.includes(module.id)) : [];
  const cycle = properties.cycle && item.cycle_id !== null ? bundle.cycles.find((candidate) => candidate.id === item.cycle_id) : undefined;
  const assignees = properties.assignees ? bundle.actors.filter((actor) => item.assignee_ids.includes(actor.id)) : [];
  const showPriority = properties.priority && item.priority !== "none";
  const estimatePoint =
    properties.estimate && item.estimate_point_id !== null && bundle.estimate !== null
      ? bundle.estimate.points.find((point) => point.id === item.estimate_point_id)
      : undefined;
  const dates: string[] = [];
  if (properties.start_date && item.start_date !== null) dates.push(`Start ${item.start_date}`);
  if (properties.target_date && item.target_date !== null) dates.push(`Due ${item.target_date}`);
  const counts: string[] = [];
  if (properties.sub_items_count && item.sub_items_count > 0) counts.push(item.sub_items_count === 1 ? "1 sub-item" : `${item.sub_items_count} sub-items`);
  if (properties.links && item.links_count > 0) counts.push(item.links_count === 1 ? "1 link" : `${item.links_count} links`);
  if (properties.created_at) counts.push(`Created ${item.created_at.slice(0, 10)}`);
  if (properties.updated_at) counts.push(`Updated ${item.updated_at.slice(0, 10)}`);

  const hasTokens = state !== undefined || showPriority || labels.length > 0 || modules.length > 0 || cycle !== undefined || assignees.length > 0 || estimatePoint !== undefined;
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
          {estimatePoint !== undefined && bundle.estimate !== null ? <Token size="sm" label={formatEstimateValue(bundle.estimate.type, estimatePoint.value)} /> : null}
          {modules.map((module) => (
            <Token key={module.id} size="sm" label={module.name} />
          ))}
          {assignees.length > 0 ? (
            <AvatarGroup size="xsm">
              {assignees.map((actor) => (
                <ActorAvatar key={actor.id} actor={actor} size="xsm" tooltip={actor.name} />
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
