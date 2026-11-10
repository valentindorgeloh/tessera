"use client";

/**
 * The SideNav frame for the stored sidebar view and dock (decisions 128–129):
 * the collapse and resize configs, our `id` and class, and the `data-*`,
 * `inert` and `style` that `nav.css` keys on. `Sidebar` and `SidebarSkeleton`
 * both spread `useSideNavChrome()`, so the skeleton that shows while the
 * sidebar streams has the same frame (a stored rail shows as the rail).
 *
 * `isDrawer` comes from Astryx's render-mode context, which AppShell provides
 * around each SideNav mount and which is fixed for that mount, so it is safe
 * inside the streamed boundary (unlike `useAppShellMobile()`). In the drawer
 * SideNav renders no `<nav>`, so only its children and footer matter there.
 */
import type { CSSProperties } from "react";
import type { SideNavProps } from "@astryxdesign/core/SideNav";
import { useSideNavRenderMode, type SideNavCollapsibleConfig } from "@astryxdesign/core/SideNav";
import { cssVars } from "@/components/shared/css-vars";
import { isRailShown, useNavMountEpoch, useNavOpen, useNavPrefs, type NavPrefs, type NavRail } from "./nav-prefs";
import { useSidebarResize } from "./Sidebar";
import { useShell } from "./TesseraShell";

/** SideNav's own `resizable` object type (Astryx's `ResizableConfig`). */
export type SideNavResizable = Exclude<SideNavProps["resizable"], boolean | undefined>;

export type SideNavChromeInput = {
  prefs: NavPrefs;
  isOpen: boolean;
  isDrawer: boolean;
  width: number;
  /** `resize.resizable` from `useSidebarResize()`. */
  resizable: SideNavResizable;
  /** `(c) => setNavCollapsed(c, { animate: false })`: the resize drag below Astryx's threshold. */
  onCollapsedChange: (collapsed: boolean) => void;
};

export type SideNavChrome = {
  collapsible: SideNavCollapsibleConfig;
  resizable: SideNavResizable | undefined;
  id: "tessera-sidebar";
  className: "tessera-sidebar";
  "data-dock": "floating" | undefined;
  "data-open": "" | undefined;
  "data-rail": NavRail | undefined;
  inert: boolean;
  style: CSSProperties | undefined;
};

export function sideNavChrome(input: SideNavChromeInput): SideNavChrome {
  const { prefs } = input;
  if (prefs.dock === "floating" && !input.isDrawer) {
    // Always the Full view, never resizable; closed, it is inert and slid out (nav.css).
    return {
      collapsible: { isCollapsed: false, hasButton: false },
      resizable: undefined,
      id: "tessera-sidebar",
      className: "tessera-sidebar",
      "data-dock": "floating",
      "data-open": input.isOpen ? "" : undefined,
      "data-rail": undefined,
      inert: !input.isOpen,
      style: cssVars({ "--tessera-nav-float-width": `${input.width}px` }),
    };
  }
  const isRail = isRailShown(prefs);
  return {
    collapsible: { isCollapsed: isRail, onCollapsedChange: input.onCollapsedChange, hasButton: false },
    resizable: input.resizable,
    id: "tessera-sidebar",
    className: "tessera-sidebar",
    "data-dock": undefined,
    "data-open": undefined,
    "data-rail": isRail ? prefs.rail : undefined,
    inert: false,
    style: undefined,
  };
}

/** The chrome for the current preferences, open flag, stored width and render mode. */
export function useSideNavChrome(): SideNavChrome {
  const prefs = useNavPrefs();
  const isOpen = useNavOpen();
  const resize = useSidebarResize();
  const isDrawer = useSideNavRenderMode() !== "default";
  const { setNavCollapsed } = useShell();
  return sideNavChrome({
    prefs,
    isOpen,
    isDrawer,
    width: resize.resizable.defaultWidth,
    resizable: resize.resizable,
    onCollapsedChange: (collapsed) => setNavCollapsed(collapsed, { animate: false }),
  });
}

/**
 * The SideNav's `key`: the stored width's key (`useSidebarResize`) and the remount counter (`useNavMountEpoch`), so a
 * dock change from or to a rail, or a change from another tab, mounts a new SideNav instead of playing Astryx's rail
 * motion (`remountsSideNav` in nav-prefs.ts). `Sidebar` and `SidebarSkeleton` both use it.
 */
export function useSideNavKey(): string {
  const resize = useSidebarResize();
  const epoch = useNavMountEpoch();
  return `${resize.key}.${epoch}`;
}
