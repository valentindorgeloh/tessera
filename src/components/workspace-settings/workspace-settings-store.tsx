"use client";

/**
 * Workspace settings store - provides client-side access to workspace settings
 * including week_start preference.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";

// Default workspace settings
const DEFAULT_SETTINGS = {
  name: "Tessera",
  week_start: 1, // Monday
};

// Store state
let workspaceSettings = DEFAULT_SETTINGS;
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

function readSettings() {
  return workspaceSettings;
}

/**
 * Server component that publishes workspace settings to the client.
 * Renders nothing; settings are consumed via useWorkspaceSettings().
 */
export function WorkspaceSettingsPublisher({ settings }: { settings: { name: string; week_start: number } }) {
  useLayoutEffect(() => {
    workspaceSettings = settings;
    emit();
  }, [settings]);
  return null;
}

/**
 * Client hook to read workspace settings.
 * Returns the current workspace settings.
 */
export function useWorkspaceSettings(): { name: string; week_start: number } {
  return useSyncExternalStore(
    subscribe,
    readSettings,
    () => DEFAULT_SETTINGS
  );
}

/**
 * Get the current week start setting from workspace settings.
 * Can be used in server components that have access to workspace settings.
 */
export function getWorkspaceWeekStart(settings?: { week_start?: number }): number {
  if (settings?.week_start !== undefined) {
    return settings.week_start;
  }
  return DEFAULT_SETTINGS.week_start;
}
