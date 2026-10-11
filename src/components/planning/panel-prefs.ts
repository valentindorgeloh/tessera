"use client";

/**
 * Planning side panel preferences (docs/contracts/ui.md "Shared planning
 * pieces"): whether the progress panel is open, which chart it shows and the
 * unit the cycle chart prefers. Stored in localStorage under
 * `tessera.planningPanel.v1` and read through `useSyncExternalStore` (the
 * peek-prefs.ts pattern): the server snapshot is the default, so the first
 * client render matches the server markup and the stored values apply once
 * `loadPanelPrefs` has run in an effect. Shared by cycles and modules
 * (modules use `open` only). The unit in use is `effectiveUnit` from
 * ./burndown.ts: a stored "points" waits for a cycle that has points.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ProgressMode } from "@/lib/tessera/types";
import type { ChartKind } from "./burndown";

export const PANEL_STORAGE_KEY = "tessera.planningPanel.v1";

export type PanelPrefs = { open: boolean; chart: ChartKind; unit: ProgressMode };

export const DEFAULT_PANEL_PREFS: PanelPrefs = { open: true, chart: "burndown", unit: "issues" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validates a stored value field by field; anything unknown falls back to the default. */
export function parsePanelPrefs(raw: unknown): PanelPrefs {
  if (!isRecord(raw)) return DEFAULT_PANEL_PREFS;
  return {
    open: typeof raw.open === "boolean" ? raw.open : DEFAULT_PANEL_PREFS.open,
    chart: raw.chart === "burnup" ? "burnup" : "burndown",
    unit: raw.unit === "points" ? "points" : "issues",
  };
}

let snapshot: PanelPrefs = DEFAULT_PANEL_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PanelPrefs {
  return snapshot;
}

function getServerSnapshot(): PanelPrefs {
  return DEFAULT_PANEL_PREFS;
}

/** Reads the stored preferences once per page load; later calls reuse the module state. */
export function loadPanelPrefs(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(PANEL_STORAGE_KEY);
    snapshot = raw ? parsePanelPrefs(JSON.parse(raw)) : snapshot;
  } catch {
    // Unreadable or blocked storage: keep the defaults.
  }
  emit();
}

/** Merges `patch` into the preferences and writes them; client-only (event handlers and effects). */
export function savePanelPrefs(patch: Partial<PanelPrefs>): void {
  loadPanelPrefs();
  snapshot = { ...snapshot, ...patch };
  try {
    window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode or quota: the preference lives for this page only.
  }
  emit();
}

/** The current preferences: the defaults in the server render and the hydration pass, the stored values after mount. */
export function usePanelPrefs(): PanelPrefs {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    loadPanelPrefs();
  }, []);
  return prefs;
}
