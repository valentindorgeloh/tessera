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
import { holdRail } from "./rail-motion";

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

/**
 * Tessera plays the collapse motion, not Astryx (decision 149). On a rail change Astryx's AppShell moves the content
 * column with a transform and cross-fades a copy of the old content into the new layout, which on a busy page reads as
 * a reload, and Astryx 0.7.11 has no option to keep the content still. So the change is made under the mark Astryx
 * reads as Reduce Motion (`data-astryx-reduced-motion` on `<html>`, private to Astryx and pinned by
 * tests/ui/nav-collapse-snap.test.ts), held for the commit and the frame after it: Astryx lands the rail and the
 * content at once, and every other motion is untouched. `rail-motion.ts` then glides the rail's real width and
 * crossfades its contents. A mark the theme set is left alone.
 */
export const SNAP_MARK = "data-astryx-reduced-motion";
let snapToken = 0;

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

/** Sets the flag; nobody is notified when the value is unchanged. */
export function setNavCollapsed(next: boolean): void {
  if (next === collapsed) return;
  holdRail(next, typeof document !== "undefined" && document.documentElement.hasAttribute(SNAP_MARK) && snapToken === 0);
  collapsed = next;
  snapNextChange();
  for (const listener of [...listeners]) listener();
}

export function toggleNavCollapsed(): void {
  setNavCollapsed(!collapsed);
}

/** The collapse flag, read in the consumer so a streamed subtree hydrates against the server's value. */
export function useNavCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getNavCollapsed, getServerNavCollapsed);
}
