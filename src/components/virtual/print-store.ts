"use client";

/**
 * Whether the page is printing (decision 135: windowing is off while printing, so a print shows every loaded row).
 * `beforeprint` emits inside `flushSync`, so the full list is in the DOM before the browser lays out the print;
 * `afterprint` and a `matchMedia("print")` listener emit too. The listeners are attached on the first subscribe and
 * detached on the last unsubscribe. The server snapshot is false.
 */
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

const listeners = new Set<() => void>();
let printing = false;
let detach: (() => void) | null = null;

function set(next: boolean): void {
  if (next === printing) return;
  printing = next;
  for (const listener of [...listeners]) listener();
}

function attach(): () => void {
  if (typeof window === "undefined") return () => {};
  const onBefore = () => flushSync(() => set(true));
  const onAfter = () => set(false);
  const query = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
  const onQuery = (event: MediaQueryListEvent) => set(event.matches);
  window.addEventListener("beforeprint", onBefore);
  window.addEventListener("afterprint", onAfter);
  query?.addEventListener("change", onQuery);
  return () => {
    window.removeEventListener("beforeprint", onBefore);
    window.removeEventListener("afterprint", onAfter);
    query?.removeEventListener("change", onQuery);
  };
}

export const printStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    detach ??= attach();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && detach) {
        detach();
        detach = null;
      }
    };
  },
  getSnapshot(): boolean {
    return printing;
  },
  getServerSnapshot(): boolean {
    return false;
  },
};

export function usePrinting(): boolean {
  return useSyncExternalStore(printStore.subscribe, printStore.getSnapshot, printStore.getServerSnapshot);
}
