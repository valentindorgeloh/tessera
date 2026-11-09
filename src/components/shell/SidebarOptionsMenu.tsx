"use client";

import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { PinIcon, SidebarIcon, UnpinIcon } from "@/themes/catppuccin/icons";
import { navView, type NavView } from "./nav-prefs";
import { useShell } from "./TesseraShell";

const VIEWS: readonly { value: NavView; label: string }[] = [
  { value: "full", label: "Full sidebar" },
  { value: "labels", label: "Icons and labels" },
  { value: "icons", label: "Icons only" },
];

function isNavView(value: string): value is NavView {
  return VIEWS.some((view) => view.value === value);
}

/**
 * "Sidebar options" in the sidebar's footer (decision 131; desktop only, the
 * drawer has none). Docked: the three views and "Undock sidebar"; floating:
 * only "Dock sidebar". After a change that remounts the nav or puts this
 * button in the closed (inert) overlay, the shell moves focus back here or to
 * the top bar's toggle (`refocusNav`, decision 128).
 */
export function SidebarOptionsMenu() {
  const { navPrefs, setNavView, setNavDock } = useShell();
  const isFloating = navPrefs.dock === "floating";
  return (
    <DropdownMenu
      alignment="start"
      hasChevron={false}
      menuWidth={240}
      renderTrigger={(triggerProps) => (
        <IconButton {...triggerProps} id="tessera-nav-options" label="Sidebar options" variant="ghost" size="sm" tooltip="Sidebar options" icon={<Icon icon={SidebarIcon} />} />
      )}
    >
      {isFloating ? (
        <DropdownMenuItem label="Dock sidebar" icon={PinIcon} onClick={() => setNavDock("docked")} />
      ) : (
        <>
          <DropdownMenuRadioGroup
            label="Show"
            value={navView(navPrefs)}
            onChange={(value) => {
              if (isNavView(value)) setNavView(value);
            }}
          >
            {VIEWS.map((view) => (
              <DropdownMenuRadioItem key={view.value} value={view.value} label={view.label} />
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuDivider />
          <DropdownMenuItem label="Undock sidebar" description="Show it over the page when you need it" icon={UnpinIcon} onClick={() => setNavDock("floating")} />
        </>
      )}
    </DropdownMenu>
  );
}
