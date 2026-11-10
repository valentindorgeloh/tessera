"use client";

/**
 * A module loaded on demand without suspending (decision 142). `next/dynamic` and
 * `React.lazy` suspend on their first render even with the chunk cached, and React then
 * holds the revealed fallback for 300 ms (the same reason `detail/peek-detail-lazy.tsx`
 * hands the loaded component over itself). This keeps the loaded module in a module-level
 * store instead: `preload()` starts the `import()` once (repeating it is free; a failed
 * load is retried by the next call), and `useLoaded()` reads the store with
 * `useSyncExternalStore`, so a component shows its placeholder until the module is in and
 * the module itself after, in one commit and with no Suspense boundary. The server
 * snapshot is always null, so hydration matches the server's placeholder.
 */
import { useSyncExternalStore } from "react";

export type LazyModule<T> = {
  /** The loaded module, or null until `import()` has resolved (always null on the server and while hydrating). */
  useLoaded: () => T | null;
  /**
   * Starts the `import()` if it has not started; call it from an effect or an idle callback.
   * The promise settles true once the module is in and false when the load failed.
   */
  preload: () => Promise<boolean>;
};

const noSnapshot = () => null;

export function createLazyModule<T>(load: () => Promise<T>): LazyModule<T> {
  let loaded: T | null = null;
  let pending: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getSnapshot = () => loaded;
  return {
    useLoaded: () => useSyncExternalStore(subscribe, getSnapshot, noSnapshot),
    preload: () => {
      pending ??= load().then(
        (module) => {
          loaded = module;
          for (const listener of listeners) listener();
          return true;
        },
        () => {
          pending = null;
          return false;
        },
      );
      return pending;
    },
  };
}
