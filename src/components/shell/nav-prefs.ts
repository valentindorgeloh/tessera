"use client";

/**
 * Sidebar preferences and the floating sidebar's open flag (decisions 128–131;
 * docs/contracts/ui.md "Shell" and "Sidebar views, motion, virtual lists,
 * calendar zoom").
 *
 * The sidebar streams in behind a Suspense boundary and hydrates after the top
 * bar and `mod+b` are live, so both values live in module stores read with
 * `useSyncExternalStore` in each consumer, never through a context value (the
 * streamed-subtree rule). A hydrating fibre reads the server snapshot (the
 * defaults, and `false` for the open flag), which matches the server HTML, and
 * re-renders with the stored value right after.
 *
 * The preferences are kept in `localStorage["tessera.nav.v1"]` (decision 130),
 * read lazily on the first client snapshot like the colour scheme
 * (color-scheme.ts). The open flag is session state and is never stored.
 */
import { useSyncExternalStore } from "react";

export type NavDisplay = "full" | "rail";
export type NavRail = "icons" | "labels";
export type NavDock = "docked" | "floating";
export type NavPrefs = { display: NavDisplay; rail: NavRail; dock: NavDock };
/** What the options menu's radio group and the Power K view commands pick. */
export type NavView = "full" | NavRail;

export const NAV_PREFS_STORAGE_KEY = "tessera.nav.v1";

export const DEFAULT_NAV_PREFS: NavPrefs = Object.freeze({ display: "full", rail: "icons", dock: "docked" });

function isDisplay(value: unknown): value is NavDisplay {
  return value === "full" || value === "rail";
}

function isRail(value: unknown): value is NavRail {
  return value === "icons" || value === "labels";
}

function isDock(value: unknown): value is NavDock {
  return value === "docked" || value === "floating";
}

/**
 * Decision 130: each field falls back to its default on its own; extra keys are
 * ignored. There is no branch for the never-shipped two-field draft shape: its
 * `display: "labels"` or `"icons"` is unknown and falls back to `full`.
 */
export function parseNavPrefs(raw: string | null): NavPrefs {
  if (raw === null) return DEFAULT_NAV_PREFS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_NAV_PREFS;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_NAV_PREFS;
  const record = parsed as Record<string, unknown>;
  return {
    display: isDisplay(record.display) ? record.display : DEFAULT_NAV_PREFS.display,
    rail: isRail(record.rail) ? record.rail : DEFAULT_NAV_PREFS.rail,
    dock: isDock(record.dock) ? record.dock : DEFAULT_NAV_PREFS.dock,
  };
}

/** JSON with exactly the three keys. */
export function serializeNavPrefs(prefs: NavPrefs): string {
  return JSON.stringify({ display: prefs.display, rail: prefs.rail, dock: prefs.dock });
}

export function navView(prefs: NavPrefs): NavView {
  return prefs.display === "full" ? "full" : prefs.rail;
}

export function navViewPatch(view: NavView): Partial<NavPrefs> {
  return view === "full" ? { display: "full" } : { display: "rail", rail: view };
}

/** A rail (either kind) is on screen only while docked. */
export function isRailShown(prefs: NavPrefs): boolean {
  return prefs.dock === "docked" && prefs.display === "rail";
}

function samePrefs(a: NavPrefs, b: NavPrefs): boolean {
  return a.display === b.display && a.rail === b.rail && a.dock === b.dock;
}

/**
 * Which motion a preference change made on this page plays (decisions 132 and 145; `applyNavChange` in
 * TesseraShell.tsx). `"rail"`: a docked collapse or expand (Full ↔ a rail), which Astryx's SideNav animates itself
 * (its `isCollapsed` flips). `"width"`: everything else, our WAAPI width animation on the sidebar panel: a switch
 * between the two rails, and every dock change. A dock change from or to a rail also flips `isCollapsed` (the floating
 * panel is always Full), but it remounts the SideNav (`useNavMountEpoch`), so Astryx never treats it as a collapse.
 */
export function navChangeMotion(before: NavPrefs, after: NavPrefs): "rail" | "width" {
  return before.dock === after.dock && isRailShown(before) !== isRailShown(after) ? "rail" : "width";
}

/**
 * Whether going from `before` to `after` must remount the SideNav: its `isCollapsed` flips (`isRailShown`) for a
 * reason other than a collapse or expand on this page. That is a dock change from or to a rail, and any change that
 * arrives from another tab (`fromOtherTab`), which applies without animation (decision 132). A new SideNav starts in
 * its new state with no rail motion (Astryx animates only a change after the rail's first paint).
 */
export function remountsSideNav(before: NavPrefs, after: NavPrefs, fromOtherTab = false): boolean {
  if (isRailShown(before) === isRailShown(after)) return false;
  return fromOtherTab || before.dock !== after.dock;
}

// --- Preferences store -------------------------------------------------------

let prefs: NavPrefs | null = null;
/** Counts the changes that remount the SideNav (`remountsSideNav`); part of its `key` (side-nav-chrome.ts). */
let mountEpoch = 0;
const prefsListeners = new Set<() => void>();

function emitPrefs() {
  for (const listener of [...prefsListeners]) listener();
}

function readStored(): NavPrefs {
  try {
    return parseNavPrefs(window.localStorage.getItem(NAV_PREFS_STORAGE_KEY));
  } catch {
    return DEFAULT_NAV_PREFS;
  }
}

/** Keeps other tabs in step: they apply the change without animation. */
function onStorage(event: StorageEvent) {
  if (event.key !== NAV_PREFS_STORAGE_KEY) return;
  const next = readStored();
  if (prefs !== null && samePrefs(prefs, next)) return;
  if (prefs !== null && remountsSideNav(prefs, next, true)) mountEpoch += 1;
  prefs = next;
  emitPrefs();
}

function subscribePrefs(listener: () => void): () => void {
  if (prefsListeners.size === 0) window.addEventListener("storage", onStorage);
  prefsListeners.add(listener);
  return () => {
    prefsListeners.delete(listener);
    if (prefsListeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getPrefsSnapshot(): NavPrefs {
  if (typeof window === "undefined") return DEFAULT_NAV_PREFS;
  prefs ??= readStored();
  return prefs;
}

function getPrefsServerSnapshot(): NavPrefs {
  return DEFAULT_NAV_PREFS;
}

/** The `useSyncExternalStore` triple, exported for tests (like `colorSchemeStore`). */
export const navPrefsStore = { subscribe: subscribePrefs, getSnapshot: getPrefsSnapshot, getServerSnapshot: getPrefsServerSnapshot };

/** The current preferences, for event handlers and callbacks. */
export function getNavPrefs(): NavPrefs {
  return getPrefsSnapshot();
}

export function useNavPrefs(): NavPrefs {
  return useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getPrefsServerSnapshot);
}

/** The SideNav remount counter; 0 on the server and until the first change that remounts it. */
export function getNavMountEpoch(): number {
  return mountEpoch;
}

function getMountEpochServerSnapshot(): number {
  return 0;
}

/** The remount counter for the SideNav's `key` (`useSideNavKey()` in side-nav-chrome.ts). */
export function useNavMountEpoch(): number {
  return useSyncExternalStore(subscribePrefs, getNavMountEpoch, getMountEpochServerSnapshot);
}

/** Merges, stores (try/catch: private mode still applies the change) and notifies; a no-op when nothing changes. */
export function setNavPrefs(patch: Partial<NavPrefs>): void {
  const current = getPrefsSnapshot();
  const next: NavPrefs = {
    display: patch.display ?? current.display,
    rail: patch.rail ?? current.rail,
    dock: patch.dock ?? current.dock,
  };
  if (samePrefs(current, next)) return;
  if (remountsSideNav(current, next)) mountEpoch += 1;
  prefs = next;
  try {
    window.localStorage.setItem(NAV_PREFS_STORAGE_KEY, serializeNavPrefs(next));
  } catch {
    // Not persisted in private mode; this page still switches.
  }
  emitPrefs();
}

// --- Floating open flag (session only) ---------------------------------------

let isOpen = false;
const openListeners = new Set<() => void>();

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

export function getNavOpen(): boolean {
  return isOpen;
}

function getOpenServerSnapshot(): boolean {
  return false;
}

/** The open flag's `useSyncExternalStore` triple, exported for tests. */
export const navOpenStore = { subscribe: subscribeOpen, getSnapshot: getNavOpen, getServerSnapshot: getOpenServerSnapshot };

export function useNavOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, getNavOpen, getOpenServerSnapshot);
}

/** Opens or closes the floating overlay; notifies only on a change and never touches storage. */
export function setNavOpenFlag(open: boolean): void {
  if (open === isOpen) return;
  isOpen = open;
  for (const listener of [...openListeners]) listener();
}

// --- Power K sidebar commands (decision 131) ----------------------------------

export const SIDEBAR_COMMAND_PREFIX = "sidebar.";
export type SidebarCommandId = "sidebar.full" | "sidebar.labels" | "sidebar.icons" | "sidebar.float" | "sidebar.dock";

export function sidebarCommandPatch(id: string): Partial<NavPrefs> | null {
  switch (id) {
    case "sidebar.full":
      return navViewPatch("full");
    case "sidebar.labels":
      return navViewPatch("labels");
    case "sidebar.icons":
      return navViewPatch("icons");
    case "sidebar.float":
      return { dock: "floating" };
    case "sidebar.dock":
      return { dock: "docked" };
    default:
      return null;
  }
}
