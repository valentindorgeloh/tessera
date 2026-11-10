"use client";

/**
 * Small pieces of the sidebar that depend on whether the SideNav rail is
 * collapsed (docs/contracts/ui.md "Shell"). They read Astryx's own collapse
 * context, so they stay right inside the mobile drawer too, which is never a rail.
 */
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Stack } from "@astryxdesign/core/Stack";
import { SideNavItem, useSideNavCollapse } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { PlusIcon } from "@/themes/catppuccin/icons";

/**
 * The sidebar's "New work item" button (its `topContent`): icon only in a
 * collapsed rail, the full-width labelled button otherwise. It reads the same
 * collapse context as the rows, not the shell flag: below md the sidebar is
 * the top bar's drawer, where Astryx gives no collapse context, so the rows
 * are expanded there whatever the flag says (collapse at 1440 and narrow the
 * window, or `mod+b` on a phone), and the button must be too. In the rail the
 * context carries the flag the Sidebar passes to `collapsible`, so it
 * hydrates against the server's value like the rest of the boundary. Both
 * variants carry `data-nav-autofocus`: opening the floating sidebar by its
 * toggle or `mod+b` focuses this button first (decision 129).
 */
export function NewItemButton({ label, tooltip, isDisabled, onClick }: { label: string; tooltip: string; isDisabled: boolean; onClick: () => void }) {
  const { isCollapsed } = useSideNavCollapse();
  const icon = <Icon icon={PlusIcon} />;
  if (isCollapsed) return <IconButton data-nav-autofocus="" label={label} variant="secondary" size="sm" icon={icon} isDisabled={isDisabled} tooltip={tooltip} onClick={onClick} />;
  return (
    <Button
      data-nav-autofocus=""
      label={label}
      variant="secondary"
      size="sm"
      width="100%"
      className="tessera-sidebar-new"
      icon={icon}
      isDisabled={isDisabled}
      tooltip={tooltip}
      onClick={onClick}
    />
  );
}

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
 * A sidebar destination row (S3). Since Astryx 0.7.5 a collapsed SideNavItem
 * names itself in a tooltip on its own link, opened by hover or keyboard focus,
 * so this renders the bare row; the 0.6.8 wrapper Tooltip would now show a
 * second one.
 *
 * `data-rail-label` lands on the collapsed link (Astryx spreads the rest props
 * there): the Icons and labels rail shows it as the link's `::after` (nav.css,
 * decision 128), so the link's accessible name stays its `aria-label`. Whether
 * the name shows is CSS on the nav's `data-rail`; no preference is read here.
 */
export function RailItem(props: ComponentProps<typeof SideNavItem>) {
  return <SideNavItem {...props} data-rail-label={props.label} />;
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
