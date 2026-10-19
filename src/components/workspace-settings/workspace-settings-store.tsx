"use client";

/**
 * Workspace settings store - provides client-side access to workspace settings
 * including the week_start preference.
 *
 * Three writers keep it current: the publisher (re-run on every server
 * render, so a refresh() after a save reaches it), `publishWorkspaceSettings`
 * (the settings screen, the moment a save succeeds), and nothing else. Until
 * one of them has run, `useWeekStart` answers with the value the server
 * rendered into the page (the project bundle), so server HTML and first
 * paint already use the workspace's first weekday instead of Monday.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";
import { toWeekStart, WEEK_STARTS_ON, type WeekStart } from "@/components/work-items/calendar-math";

type WorkspaceSettingsSnapshot = { name: string; week_start: number };

type StoreState = WorkspaceSettingsSnapshot & {
  /** False until the publisher or a save has supplied real values; the defaults below are placeholders. */
  isPublished: boolean;
};

// Default workspace settings
const DEFAULT_SETTINGS: WorkspaceSettingsSnapshot = {
  name: "Tessera",
  week_start: WEEK_STARTS_ON,
};

const DEFAULT_STATE: StoreState = { ...DEFAULT_SETTINGS, isPublished: false };

// Store state
let state: StoreState = DEFAULT_STATE;
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

function readState() {
  return state;
}

function serverState() {
  return DEFAULT_STATE;
}

/** Replaces the store's values; a no-op (no re-render) when nothing changed. */
function write(next: Partial<WorkspaceSettingsSnapshot>) {
  const merged: StoreState = { name: next.name ?? state.name, week_start: next.week_start ?? state.week_start, isPublished: true };
  if (state.isPublished && merged.name === state.name && merged.week_start === state.week_start) return;
  state = merged;
  emit();
}

/**
 * Publishes new values from client code, for a save that just succeeded.
 * The server render that follows (refresh()) publishes the same values again.
 */
export function publishWorkspaceSettings(next: Partial<WorkspaceSettingsSnapshot>) {
  write(next);
}

/**
 * Server component that publishes workspace settings to the client.
 * Renders nothing; settings are consumed via useWorkspaceSettings().
 */
export function WorkspaceSettingsPublisher({ settings }: { settings: WorkspaceSettingsSnapshot }) {
  const { name, week_start } = settings;
  useLayoutEffect(() => {
    write({ name, week_start });
  }, [name, week_start]);
  return null;
}

/**
 * Client hook to read workspace settings.
 * Returns the current workspace settings.
 */
export function useWorkspaceSettings(): WorkspaceSettingsSnapshot {
  return useSyncExternalStore(subscribe, readState, serverState);
}

/**
 * The workspace's first weekday for calendars and date pickers. `fromServer`
 * is the value the server rendered into the page (`bundle.week_start`): it
 * answers until the store has real values, which covers server HTML and the
 * first client render; after that the store wins, being the freshest value.
 */
export function useWeekStart(fromServer?: number): WeekStart {
  const current = useSyncExternalStore(subscribe, readState, serverState);
  return toWeekStart(current.isPublished || fromServer === undefined ? current.week_start : fromServer);
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
