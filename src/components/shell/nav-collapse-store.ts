"use client";

/**
 * Sidebar collapse flag (docs/contracts/ui.md "Shell"). The sidebar streams in
 * behind a Suspense boundary and hydrates after the top bar and `mod+b` are
 * already live. If the flag lived in `TesseraShell` state and travelled
 * through a context value, a toggle in that gap would re-render every
 * ancestor of the still-dehydrated boundary, but React 19.3 would not notice
 * the change for the boundary itself (its element comes from the RSC payload,
 * so its props never differ). The boundary would then hydrate reading the new
 * value against server HTML rendered expanded, throw error 418 and
 * client-render the whole sidebar.
 *
 * Module state behind `useSyncExternalStore` fixes that: a fibre that is
 * hydrating reads `getServerNavCollapsed` (always false, which matches the
 * server HTML) at any lane, then re-renders with the real value right after.
 * The flag is not persisted, so a reload starts expanded. The server never
 * writes it.
 */
import { useSyncExternalStore } from "react";

let collapsed = false;
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNavCollapsed(): boolean {
  return collapsed;
}

/** What the server rendered and what a hydrating fibre reads: expanded. */
export function getServerNavCollapsed(): boolean {
  return false;
}

/** Sets the flag; nobody is notified when the value is unchanged. */
export function setNavCollapsed(next: boolean): void {
  if (next === collapsed) return;
  collapsed = next;
  for (const listener of [...listeners]) listener();
}

export function toggleNavCollapsed(): void {
  setNavCollapsed(!collapsed);
}

/** The collapse flag, read in the consumer so a streamed subtree hydrates against the server's value. */
export function useNavCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getNavCollapsed, getServerNavCollapsed);
}
