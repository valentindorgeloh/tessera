"use client";

/**
 * Small pieces of the sidebar that depend on whether the SideNav rail is
 * collapsed (docs/contracts/ui.md "Shell"). They read Astryx's own collapse
 * context, so they stay right inside the mobile drawer too, which is never a rail.
 */
import type { ComponentProps, ReactNode } from "react";
import { HStack, Stack } from "@astryxdesign/core/Stack";
import { SideNavItem, useSideNavCollapse } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";

/**
 * A section's end buttons ("New folder", "Create project"), rendered only while
 * the sidebar is expanded. A collapsed rail hides the section header, but
 * Astryx keeps its end content in the document as visually hidden text, so the
 * buttons stayed focus stops off screen (S2).
 */
export function ExpandedOnly({ children }: { children: ReactNode }) {
  const { isCollapsed } = useSideNavCollapse();
  return isCollapsed ? null : children;
}

/**
 * A SideNavItem that names itself in a tooltip while the rail is collapsed (S3).
 * Astryx tries the same through a sibling-mode Tooltip, but its ref is not set
 * yet when that Tooltip attaches (0.6.8), so no hover or focus ever opens it.
 * This wrapper anchors on the rendered row instead, and opens on keyboard focus
 * too (`focusTrigger="always"`: the row's wrapper is not focusable itself, the
 * link inside it is). Expanded, the row renders bare. Rows with children keep
 * the plain SideNavItem: their flyout already shows the label on hover.
 */
export function RailItem(props: ComponentProps<typeof SideNavItem>) {
  const { isCollapsed } = useSideNavCollapse();
  const item = <SideNavItem {...props} />;
  if (!isCollapsed) return item;
  return (
    <Tooltip content={props.label} placement="end" focusTrigger="always">
      {item}
    </Tooltip>
  );
}

/**
 * The trailing slot of a sidebar row that has a menu (S9): the menu button, and
 * optionally the row's count. With a fine pointer the button is hidden until the
 * row is hovered or holds focus, and the count sits where the button will
 * appear, so counts end on the same edge as the Inbox and Drafts badges. On
 * touch and on a phone (no hover) both show, side by side. The rules are in
 * shell.css (`tessera-row-actions`). The count is outside the row's link, so
 * it is hidden from assistive tech here and the caller names the link with it
 * (Sidebar.tsx `aria-label`); otherwise a screen reader would hear it twice.
 */
export function RowActions({ count, children }: { count?: number; children: ReactNode }) {
  return (
    <HStack gap={0} vAlign="center" className="tessera-row-actions">
      {count === undefined ? null : (
        <Text type="supporting" color="secondary" hasTabularNumbers className="tessera-row-count" aria-hidden="true">
          {count}
        </Text>
      )}
      <Stack className="tessera-row-menu">{children}</Stack>
    </HStack>
  );
}
