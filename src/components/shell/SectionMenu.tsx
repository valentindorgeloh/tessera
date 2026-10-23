"use client";

import { createElement, isValidElement, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu, DropdownMenuItem } from "@astryxdesign/core/DropdownMenu";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { CaretDownIcon, CheckIcon } from "@/themes/catppuccin/icons";

export type SectionMenuEntry = {
  key: string;
  label: string;
  href: string;
  /** An element (`<KanbanIcon />`) or an icon component. */
  icon?: ReactNode | IconType;
  /** Kept after the label (the Intake count Badge); the current entry adds a check after it. */
  endContent?: ReactNode;
};

export type SectionMenuProps = {
  /** The menu's accessible name (the strip it stands in for: "Website pages", "Project settings"). */
  label: string;
  entries: readonly SectionMenuEntry[];
  /** The entry for the current route; none when the route matches no entry. */
  currentKey: string | null;
  /** Placement and band rules (shell.css, project-settings.css): `tessera-section-menu--project`, `--settings`. */
  className?: string;
};

/** An icon component becomes an element; an element, text or nothing passes through. */
function iconNode(icon: ReactNode | IconType | undefined): ReactNode {
  if (icon === undefined || icon === null || typeof icon === "string" || typeof icon === "number" || typeof icon === "boolean" || isValidElement(icon)) {
    return icon as ReactNode;
  }
  return createElement(icon as IconType);
}

/** The entry's own end content (a count Badge), then the check on the current one. */
function endOf(entry: SectionMenuEntry, isCurrent: boolean): ReactNode {
  if (!isCurrent) return entry.endContent;
  const check = <Icon icon={CheckIcon} size="sm" />;
  if (entry.endContent === undefined) return check;
  return (
    <HStack gap={2} vAlign="center">
      {entry.endContent}
      {check}
    </HStack>
  );
}

/**
 * The phone's replacement for a tab strip (decision 14): one ghost button that
 * shows the current section (icon, label, caret) and opens a menu of every
 * section as a link, the current one marked `aria-current="page"` with a check.
 * An Astryx DropdownMenu in compound mode (popover only; its item takes `href`
 * and spreads `aria-*`, which NavHeadingMenuItem does not): Enter, Space and the
 * arrows open it, the arrows move, Enter follows the link and Escape closes it
 * with focus back on the button. The band switch is CSS only (shell.css: shown
 * below 600px, hidden from there), so both renders stay mounted and nothing
 * flips on hydration.
 */
export function SectionMenu({ label, entries, currentKey, className }: SectionMenuProps) {
  const current = entries.find((entry) => entry.key === currentKey);
  return (
    <HStack vAlign="center" className={className ? `tessera-section-menu ${className}` : "tessera-section-menu"}>
      <DropdownMenu
        aria-label={label}
        menuWidth={240}
        alignment="start"
        renderTrigger={(triggerProps) => (
          <Button
            {...triggerProps}
            size="sm"
            variant="ghost"
            label={current?.label ?? "Sections"}
            icon={iconNode(current?.icon)}
            endContent={<Icon icon={CaretDownIcon} size="sm" />}
            className="tessera-section-menu-button"
          />
        )}
      >
        {entries.map((entry) => {
          const isCurrent = entry.key === currentKey;
          return (
            <DropdownMenuItem
              key={entry.key}
              href={entry.href}
              label={entry.label}
              icon={iconNode(entry.icon)}
              aria-current={isCurrent ? "page" : undefined}
              endContent={endOf(entry, isCurrent)}
            />
          );
        })}
      </DropdownMenu>
    </HStack>
  );
}
