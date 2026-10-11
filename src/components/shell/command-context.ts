"use client";

/**
 * Contextual actions for Power K and the item shortcuts (docs/contracts/ui.md
 * "Power K and shortcuts (D4)"). `WorkItemDetail` registers the open item and
 * the handlers that open its property controls; the shortcut dispatcher and
 * the palette's "Actions" group read them through `useCommandContext()`.
 *
 * Module store with `useSyncExternalStore`; the server snapshot is null so
 * the first client render matches the server markup. The surface here is the
 * one the contract fixes for both lanes.
 */
import { useSyncExternalStore } from "react";
import type { ShortcutId } from "./shortcuts";

export type CommandItem = { id: string; key: string; title: string; projectId: string; url: string };

export type CommandContextValue = {
  item: CommandItem;
  actions: Partial<Record<ShortcutId, () => void>>;
  /**
   * Optional (additive to the contract surface): palette labels that depend on the item's state, such as
   * "Subscribe" / "Unsubscribe" for `item.subscribe`; without one the registry's label shows.
   */
  labels?: Partial<Record<ShortcutId, string>>;
};

let current: CommandContextValue | null = null;
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

function getSnapshot(): CommandContextValue | null {
  return current;
}

function getServerSnapshot(): CommandContextValue | null {
  return null;
}

/**
 * Makes `value` the active context and returns the unregister function. A
 * later registration replaces an earlier one; unregistering clears the
 * context only while it is still the active one, so a detail that unmounts
 * after another opened does not wipe the newer registration.
 */
export function registerCommandContext(value: CommandContextValue): () => void {
  current = value;
  emit();
  return () => {
    if (current !== value) return;
    current = null;
    emit();
  };
}

/** The registered context, or null when no work item is open. */
export function useCommandContext(): CommandContextValue | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
