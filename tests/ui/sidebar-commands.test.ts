/**
 * Power K's sidebar commands (src/components/shell/sidebar-commands.ts,
 * decision 131): docked, the two other views and Undock; floating, only Dock
 * (nothing that opens or switches the overlay); none in the drawer. Each id
 * maps to its preference patch (`sidebarCommandPatch`).
 */
import { describe, expect, it } from "vitest";
import { matchesCommand } from "@/components/shell/command-source";
import { DEFAULT_NAV_PREFS, sidebarCommandPatch, type NavPrefs } from "@/components/shell/nav-prefs";
import { buildSidebarCommands } from "@/components/shell/sidebar-commands";

const prefs = (patch: Partial<NavPrefs>): NavPrefs => ({ ...DEFAULT_NAV_PREFS, ...patch });
const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("buildSidebarCommands", () => {
  it("docked Full lists the two rails and Undock", () => {
    expect(ids(buildSidebarCommands(prefs({}), false))).toEqual(["sidebar.labels", "sidebar.icons", "sidebar.float"]);
  });

  it("docked Icons only lists Full, Icons and labels and Undock", () => {
    expect(ids(buildSidebarCommands(prefs({ display: "rail", rail: "icons" }), false))).toEqual(["sidebar.full", "sidebar.labels", "sidebar.float"]);
  });

  it("docked Icons and labels lists Full, Icons only and Undock", () => {
    expect(ids(buildSidebarCommands(prefs({ display: "rail", rail: "labels" }), false))).toEqual(["sidebar.full", "sidebar.icons", "sidebar.float"]);
  });

  it("floating lists only Dock, whatever the stored view", () => {
    expect(ids(buildSidebarCommands(prefs({ dock: "floating" }), false))).toEqual(["sidebar.dock"]);
    expect(ids(buildSidebarCommands(prefs({ dock: "floating", display: "rail" }), false))).toEqual(["sidebar.dock"]);
  });

  it("lists nothing in the drawer", () => {
    expect(buildSidebarCommands(prefs({}), true)).toEqual([]);
    expect(buildSidebarCommands(prefs({ dock: "floating" }), true)).toEqual([]);
  });

  it("labels the commands like the menu, in Settings, with the decision's keywords", () => {
    const docked = buildSidebarCommands(prefs({ display: "rail" }), false);
    expect(docked.map((item) => item.label)).toEqual(["Sidebar: Full sidebar", "Sidebar: Icons and labels", "Sidebar: Undock (float over the page)"]);
    expect(buildSidebarCommands(prefs({ display: "full" }), false).map((item) => item.label)).toContain("Sidebar: Icons only");
    expect(buildSidebarCommands(prefs({ dock: "floating" }), false)[0]?.label).toBe("Sidebar: Dock");
    for (const item of docked) {
      expect(item.auxiliaryData).toMatchObject({ group: "Settings", kind: "command" });
    }
    for (const word of ["sidebar", "navigation", "rail", "collapse", "expand", "dock", "float", "icons", "labels", "full"]) {
      expect(matchesCommand(docked[0], word)).toBe(true);
    }
  });

  it("maps each id to its patch", () => {
    expect(sidebarCommandPatch("sidebar.full")).toEqual({ display: "full" });
    expect(sidebarCommandPatch("sidebar.labels")).toEqual({ display: "rail", rail: "labels" });
    expect(sidebarCommandPatch("sidebar.icons")).toEqual({ display: "rail", rail: "icons" });
    expect(sidebarCommandPatch("sidebar.float")).toEqual({ dock: "floating" });
    expect(sidebarCommandPatch("sidebar.dock")).toEqual({ dock: "docked" });
    expect(sidebarCommandPatch("sidebar.toggle")).toBeNull();
  });
});
