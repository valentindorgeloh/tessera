"use client";

/**
 * Power K's palette, loaded on demand (decision 142). The Astryx CommandPalette and
 * ./palette-parts.tsx were about 46 KB gzipped in the first load of every route, for a
 * surface that is closed until `mod+k`. CommandBar renders `LazyPalette` only after the
 * first open, and `usePalettePreload` starts the `import()` when the browser is idle, so
 * the palette is normally in before anyone asks for it. An open that comes first renders
 * nothing until the module resolves (a few milliseconds on a warm cache), then mounts the
 * palette open: CommandBar keeps the opening's query and scope, so the typed key is kept.
 * The loaded module sits in a store read with `useSyncExternalStore` (../charts/lazy-module.ts),
 * not behind `next/dynamic`, which would hold its fallback for 300 ms.
 */
import { useEffect } from "react";
import { createLazyModule } from "@/components/charts/lazy-module";
import type { PalettePanelProps } from "./palette-parts";

const partsModule = createLazyModule(() => import("./palette-parts"));

/** Without requestIdleCallback (Safari) the preload waits this long; with it, the callback may be postponed by at most this long. */
const PRELOAD_DELAY_MS = 1500;

/** Fetches the palette chunk when the browser is idle after mount (CommandBar calls it once). */
export function usePalettePreload(): void {
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(partsModule.preload, { timeout: PRELOAD_DELAY_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(partsModule.preload, PRELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
}

/** Starts the fetch at once (the first open calls it, so a palette opened before the idle callback ran is not waiting on the timer). */
export function preloadPalette(): void {
  partsModule.preload();
}

export function LazyPalette(props: PalettePanelProps) {
  const parts = partsModule.useLoaded();
  useEffect(() => {
    partsModule.preload();
  }, []);
  return parts ? <parts.PalettePanel {...props} /> : null;
}
