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
 *
 * A change of what the docked strip shows (a view or the dock) is Tessera's
 * motion, not Astryx's (decision 149; "Rail motion" below and rail-motion.ts).
 */
import { useSyncExternalStore } from "react";
import { endRailMotion, holdRail } from "./rail-motion";

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

/** What the docked strip beside the content shows: one of the three views, or nothing while undocked (decision 129). */
export type NavShape = NavView | "floating";

export function navShape(prefs: NavPrefs): NavShape {
  return prefs.dock === "floating" ? "floating" : navView(prefs);
}

/** The strip's width order: a change to a lower rank narrows it (and hides labels), one to a higher rank widens it. */
const SHAPE_RANK: Readonly<Record<NavShape, number>> = { floating: 0, icons: 1, labels: 2, full: 3 };

/** A change of the strip: whether it narrows, and whether it docks or undocks (the strip comes from or goes to 0). */
export type RailChange = { isCollapse: boolean; isDockChange: boolean };

/**
 * The strip change from `before` to `after`, or null when the strip stays as it is (decision 149, made to serve the
 * three views and the dock). Every change in it is one motion, `rail-motion.ts`: the strip's width glides and, for a
 * view change, a copy of the old rail crossfades to the new one; docking and undocking glide the width alone (the
 * floating panel has its own slide).
 */
export function railChange(before: NavShape, after: NavShape): RailChange | null {
  if (before === after) return null;
  return { isCollapse: SHAPE_RANK[after] < SHAPE_RANK[before], isDockChange: before === "floating" || after === "floating" };
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

// --- Rail motion (decision 149) ------------------------------------------------

/**
 * Tessera plays the strip's motion, not Astryx (decision 149). On a rail change Astryx's AppShell moves the content
 * column with a transform and cross-fades a copy of the old content into the new layout, which on a busy page reads as
 * a reload, and Astryx 0.7.11 has no option to keep the content still. So a change of the strip is made under the mark
 * Astryx reads as Reduce Motion (`data-astryx-reduced-motion` on `<html>`, private to Astryx and pinned by
 * tests/ui/nav-collapse-snap.test.ts), held for the commit and the frame after it: Astryx lands the rail and the
 * content at once (with a mouse; a coarse pointer gets Astryx's short cross-fade instead), and every other motion is
 * untouched. `rail-motion.ts` then glides the strip's real width. A mark the theme set is left alone.
 */
export const SNAP_MARK = "data-astryx-reduced-motion";
let snapToken = 0;
/** The strip a change made on this page asked to glide to; consumed by the commit that shows it (`prepareRailChange`). */
let pendingGlide: NavShape | null = null;

function snapNextChange(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.hasAttribute(SNAP_MARK) && snapToken === 0) return;
  const token = ++snapToken;
  root.setAttribute(SNAP_MARK, "");
  nextFrame(() =>
    nextFrame(() => {
      if (token !== snapToken) return;
      snapToken = 0;
      root.removeAttribute(SNAP_MARK);
    }),
  );
}

function nextFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => callback());
  else window.setTimeout(callback, 16);
}

/**
 * In the commit that changes the strip, before the DOM changes (`RailChangeSnapshot`): sets the mark for Astryx and,
 * when a change made on this page asked for it, holds the strip for Tessera's glide. A change from another tab, the
 * stored value arriving after hydration, or a resize drag lands at once (decisions 132 and 133). That commit is also
 * the one in which a sidebar that hydrated after a toggle catches up, after the mark `setNavPrefs` set has gone.
 */
export function prepareRailChange(before: NavShape, after: NavShape): void {
  if (typeof document === "undefined") return;
  const change = railChange(before, after);
  if (!change) return;
  const glides = pendingGlide === after;
  pendingGlide = null;
  if (glides) holdRail(change.isCollapse, document.documentElement.hasAttribute(SNAP_MARK) && snapToken === 0, { isDockChange: change.isDockChange });
  else endRailMotion();
  snapNextChange();
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
  // Never animated (decision 132): a glide this page asked for and has not shown yet is dropped too.
  pendingGlide = null;
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

/**
 * Merges, stores (try/catch: private mode still applies the change) and notifies; a no-op when nothing changes. A
 * change of the strip sets Astryx's mark and, unless `animate` is false (the resize drag), asks for the glide.
 */
export function setNavPrefs(patch: Partial<NavPrefs>, options?: { animate?: boolean }): void {
  const current = getPrefsSnapshot();
  const next: NavPrefs = {
    display: patch.display ?? current.display,
    rail: patch.rail ?? current.rail,
    dock: patch.dock ?? current.dock,
  };
  if (samePrefs(current, next)) return;
  if (remountsSideNav(current, next)) mountEpoch += 1;
  if (railChange(navShape(current), navShape(next))) {
    pendingGlide = options?.animate === false ? null : navShape(next);
    snapNextChange();
  }
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
