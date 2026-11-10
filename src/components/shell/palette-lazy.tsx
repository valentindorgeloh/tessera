"use client";

/**
 * Power K's palette, loaded on demand (decision 142). The Astryx CommandPalette and
 * ./palette-parts.tsx were about 46 KB gzipped in the first load of every route, for a
 * surface that is closed until `mod+k`. CommandBar renders `LazyPalette` only after the
 * first open, and `usePalettePreload` starts the `import()` when the browser is idle, so
 * the palette is normally in before anyone asks for it. An open that comes first renders
 * nothing until the module resolves (a few milliseconds on a warm cache), then mounts the
 * palette open: CommandBar keeps the opening's query and scope, so the key the top bar's field
 * passed is kept. The keys typed after the opening but before the module is in are kept here:
 * while the palette is open and not yet loaded, a capture listener on `document` takes the
 * printable keys and Backspace into `query` (it starts as the opening's query), and the palette
 * mounts with that as its first query. Escape closes the opening, and keys with Meta, Ctrl or
 * Alt are not text, so they pass. The listener is gone in the commit that mounts the palette,
 * so no key is taken once the module is in.
 * The loaded module sits in a store read with `useSyncExternalStore` (../charts/lazy-module.ts),
 * not behind `next/dynamic`, which would hold its fallback for 300 ms.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { createLazyModule } from "@/components/charts/lazy-module";
import type { PalettePanelProps } from "./palette-parts";
import { isApplePlatform } from "./shortcuts";

const partsModule = createLazyModule(() => import("./palette-parts"));

/** Without requestIdleCallback (Safari) the preload waits this long; with it, the callback may be postponed by at most this long. */
const PRELOAD_DELAY_MS = 1500;

/** Fetches the palette chunk when the browser is idle after mount (CommandBar calls it once). */
export function usePalettePreload(): void {
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => void partsModule.preload(), { timeout: PRELOAD_DELAY_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(() => void partsModule.preload(), PRELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
}

/** Starts the fetch at once (the first open calls it, so a palette opened before the idle callback ran is not waiting on the timer). */
export function preloadPalette(): void {
  void partsModule.preload();
}

export function LazyPalette(props: PalettePanelProps) {
  const parts = partsModule.useLoaded();
  const { isOpen, onOpenChange } = props;
  // The query the palette mounts with: the opening's query, then the keys typed until the module is in. CommandBar
  // keys this component by opening, so it is read once per opening.
  const [query, setQuery] = useState(props.initialQuery);
  const isLoaded = parts !== null;
  // Layout effect, so the listener is on in the commit that opens the palette and off in the commit that mounts it.
  useLayoutEffect(() => {
    if (isLoaded || !isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey) return;
      const isPlain = !event.ctrlKey && !event.altKey;
      if (isPlain && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (isPlain && event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        setQuery((current) => current.slice(0, -1));
        return;
      }
      // A printable key is one character; "Enter", "ArrowDown", "Dead" and the like are longer names. Option on a Mac
      // and AltGr elsewhere type characters too (a German "@"); Ctrl and a plain Alt are shortcuts.
      if (event.key.length !== 1) return;
      const typesWithModifier = event.getModifierState("AltGraph") || (event.altKey && !event.ctrlKey && isApplePlatform());
      if (!isPlain && !typesWithModifier) return;
      event.preventDefault();
      event.stopPropagation();
      setQuery((current) => current + event.key);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isLoaded, isOpen, onOpenChange]);
  // A chunk that fails to load must not leave CommandBar open with nothing on screen (it disables every shortcut while open): hand the close back, and the next open retries.
  useEffect(() => {
    let isCurrent = true;
    void partsModule.preload().then((isLoaded) => {
      if (!isLoaded && isCurrent) onOpenChange(false);
    });
    return () => {
      isCurrent = false;
    };
  }, [onOpenChange]);
  return parts ? <parts.PalettePanel {...props} initialQuery={query} /> : null;
}
