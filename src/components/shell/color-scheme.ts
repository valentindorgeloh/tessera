"use client";

import { useSyncExternalStore } from "react";

/**
 * Colour scheme preference (docs/contracts/ui.md "Theme"). The values are the
 * Astryx `<Theme mode>` values: "dark" is Catppuccin Frappé, "light" is Latte
 * and "system" lets Astryx follow the OS. Stored in localStorage and read after
 * hydration, so the server and the first client render are always Frappé.
 */
export type ColorScheme = "dark" | "light" | "system";

export const COLOR_SCHEME_STORAGE_KEY = "tessera.scheme.v1";
export const DEFAULT_COLOR_SCHEME: ColorScheme = "dark";

export const COLOR_SCHEME_LABELS: Readonly<Record<ColorScheme, string>> = {
  dark: "Frappé (dark)",
  light: "Latte (light)",
  system: "Match system",
};

export function isColorScheme(value: unknown): value is ColorScheme {
  return value === "dark" || value === "light" || value === "system";
}

let scheme: ColorScheme | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readStored(): ColorScheme {
  try {
    const stored = window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    return isColorScheme(stored) ? stored : DEFAULT_COLOR_SCHEME;
  } catch {
    return DEFAULT_COLOR_SCHEME;
  }
}

/** Keeps other tabs in step when the choice changes in one of them. */
function onStorage(event: StorageEvent) {
  if (event.key !== COLOR_SCHEME_STORAGE_KEY) return;
  scheme = readStored();
  emit();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ColorScheme {
  scheme ??= readStored();
  return scheme;
}

function getServerSnapshot(): ColorScheme {
  return DEFAULT_COLOR_SCHEME;
}

/** The `useSyncExternalStore` triple, exported for tests/ui/color-scheme.test.ts. */
export const colorSchemeStore = { subscribe, getSnapshot, getServerSnapshot };

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setColorScheme(next: ColorScheme) {
  scheme = next;
  try {
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, next);
  } catch {
    // Not persisted in private mode; the session still switches.
  }
  emit();
}
