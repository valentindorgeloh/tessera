"use client";

/**
 * Pieces shared by the row-reorder surfaces (views list, project States and
 * Labels settings; decision 105): the grip a draggable row carries, the lifted
 * clone that follows the pointer and the dashed slot where the row will land.
 * The pointer logic is `usePointerDrag` (src/components/dnd/use-pointer-drag.ts);
 * the clone reuses `.tessera-drag-overlay` and the slot `.tessera-board-placeholder`
 * look from board.css so every drag reads like the board's. Styles live in
 * src/components/styles/project-settings.css (`tessera-row-*`).
 */
import { createPortal } from "react-dom";
import { Card } from "@astryxdesign/core/Card";
import { Icon, type IconProps } from "@astryxdesign/core/Icon";
import { ListItem } from "@astryxdesign/core/List";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { DragHandleIcon } from "@/themes/catppuccin/icons";

/**
 * The grip at the start of a draggable row. Pointer presses on it bubble to
 * the row's drag handlers; `touch-action: none` on it (not on the row) lets a
 * finger drag from the grip while the rest of the row still scrolls the page.
 */
export function RowGrip() {
  return <Icon icon={DragHandleIcon} size="sm" color="secondary" className="tessera-row-grip" />;
}

/** The dragged row's clone, portalled to the body; `registerOverlay` is the hook's overlay ref. */
export function RowDragOverlay({
  registerOverlay,
  icon,
  color,
  label,
}: {
  registerOverlay: (el: HTMLElement | null) => void;
  icon: IconProps["icon"];
  color?: IconProps["color"];
  label: string;
}) {
  return createPortal(
    <Card ref={registerOverlay} padding={3} elevation="high" className="tessera-drag-overlay" aria-hidden="true">
      <HStack gap={3} vAlign="center">
        <Icon icon={icon} color={color} size="sm" />
        <Text weight="medium" maxLines={1}>
          {label}
        </Text>
      </HStack>
    </Card>,
    document.body,
  );
}

/** The landing slot inside a `List`: a dashed row as tall as the dragged one. */
export function RowSlot({ height }: { height: number }) {
  return <ListItem label="" aria-hidden="true" className="tessera-row-slot" style={{ height }} />;
}
