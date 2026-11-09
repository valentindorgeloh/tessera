/**
 * Power K's sidebar commands (decision 131), palette-only, in "Settings" and
 * labelled like the "Sidebar options" menu. Docked, the palette lists the two
 * views that are not current and "Undock"; floating, only "Dock" (no command
 * opens or switches the overlay); below `md` (the drawer) none. CommandBar
 * runs a picked id after the palette has closed: a view through `setNavView`,
 * a dock change through `setNavDock` (`sidebarCommandPatch` in ./nav-prefs.ts
 * tells them apart). Kept out of ./command-source.ts for the file budget.
 */
import type { CommandSearchItem } from "./command-source";
import { navView, type NavPrefs, type NavView, type SidebarCommandId } from "./nav-prefs";

const SIDEBAR_KEYWORDS: readonly string[] = ["sidebar", "navigation", "rail", "collapse", "expand", "dock", "float", "icons", "labels", "full"];

const VIEW_COMMANDS: readonly { view: NavView; id: SidebarCommandId; label: string }[] = [
  { view: "full", id: "sidebar.full", label: "Sidebar: Full sidebar" },
  { view: "labels", id: "sidebar.labels", label: "Sidebar: Icons and labels" },
  { view: "icons", id: "sidebar.icons", label: "Sidebar: Icons only" },
];

function sidebarCommand(id: SidebarCommandId, label: string): CommandSearchItem {
  return { id, label, auxiliaryData: { group: "Settings", kind: "command", keywords: SIDEBAR_KEYWORDS } };
}

export function buildSidebarCommands(prefs: NavPrefs, isDrawer: boolean): CommandSearchItem[] {
  if (isDrawer) return [];
  if (prefs.dock === "floating") return [sidebarCommand("sidebar.dock", "Sidebar: Dock")];
  const current = navView(prefs);
  return [
    ...VIEW_COMMANDS.filter((command) => command.view !== current).map((command) => sidebarCommand(command.id, command.label)),
    sidebarCommand("sidebar.float", "Sidebar: Undock (float over the page)"),
  ];
}
