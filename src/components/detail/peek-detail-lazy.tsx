"use client";

/**
 * The peek's detail, loaded on demand (decision 142). PeekHost used to import
 * `WorkItemDetail` statically, which put the editor (Tiptap, ProseMirror,
 * lowlight, yjs) into the first load of every list route (work items, cycle,
 * module, view, archived work items). `next/dynamic` splits it into its own
 * chunk (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md, "Importing
 * Named Exports"; the call sits at module top level so Next can match the chunk
 * to it). Until the chunk is there the slot shows `PeekSkeleton`, the same
 * skeleton the slot shows before the host has a mount node, so a peek opened
 * early is never an empty panel and nothing jumps when the chunk arrives.
 * `PeekDetail` is what PeekHost renders: the lazy component until the chunk
 * has loaded, the loaded component itself after (see its comment: the lazy one
 * would hold its fallback for 300 ms even from a warm cache).
 *
 * The chunk is fetched ahead of the first click: `schedulePreload` fires
 * `preloadPeekDetail` when the browser is idle (requestIdleCallback, or a
 * 1500 ms timer where it does not exist) or on the first pointer or focus
 * contact with a list row, whichever comes first. `scripts/check-bundle.ts`
 * keeps the editor out of the route's first load (`scripts/bundle-baseline.json`).
 */
import { useLayoutEffect, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import type { WorkItemDetailProps } from "./types";

/** The peek's loading skeleton: title, property line and body block. */
export function PeekSkeleton() {
  return (
    <VStack gap={3} padding={4}>
      <Skeleton width="40%" height={20} />
      <Skeleton width="80%" height={32} index={1} />
      <Skeleton width="100%" height={160} index={2} />
    </VStack>
  );
}

export type LazyWorkItemDetailProps = WorkItemDetailProps & {
  /** True once the loaded detail is in the DOM, false when it leaves: PeekHost moves focus into it only then (peek-cover.ts needs controls to focus). */
  onMountedChange?: (isMounted: boolean) => void;
};

/** The loaded detail, set by whichever import finishes first (the render or the preload), so both paths hand React the same component. */
let loadedDetail: ComponentType<LazyWorkItemDetailProps> | null = null;

function toMountedDetail({ WorkItemDetail }: typeof import("./WorkItemDetail")): ComponentType<LazyWorkItemDetailProps> {
  loadedDetail ??= function MountedDetail({ onMountedChange, ...props }: LazyWorkItemDetailProps) {
    // A layout effect: it runs after the detail's DOM is attached, in the commit that shows it.
    useLayoutEffect(() => {
      onMountedChange?.(true);
      return () => onMountedChange?.(false);
    }, [onMountedChange]);
    return <WorkItemDetail {...props} />;
  };
  return loadedDetail;
}

export const LazyWorkItemDetail = dynamic<LazyWorkItemDetailProps>(() => import("./WorkItemDetail").then(toMountedDetail), { loading: () => <PeekSkeleton /> });

/**
 * What PeekHost renders. A `next/dynamic` component always suspends on its first render, even with the chunk in the
 * browser cache, and React holds a revealed fallback for 300 ms before it shows the content, so a preloaded detail
 * would still take 300 ms to appear. Once the chunk is loaded a new peek therefore renders the loaded component
 * itself, in the commit that opens it; before that it renders the lazy one (skeleton, then content). The choice is
 * made when the peek mounts and kept, so the detail is never remounted under the user's editor.
 */
export function PeekDetail(props: LazyWorkItemDetailProps) {
  const [Detail] = useState(() => loadedDetail ?? LazyWorkItemDetail);
  return <Detail {...props} />;
}

/** Starts fetching the detail chunk. Repeating it is free (the bundler loads a module once); a failed fetch is retried by the next call or by the render. */
export function preloadPeekDetail(): void {
  import("./WorkItemDetail").then(toMountedDetail).catch(() => {});
}

/** The row class whose first pointer or focus contact signals intent to open a peek (ListLayout, ArchivedWorkItems). */
export const PEEK_ROW_SELECTOR = ".tessera-wi-row";
/** Without requestIdleCallback (Safari) the preload waits this long; with it, the callback may be postponed by at most this long. */
export const PRELOAD_DELAY_MS = 1500;

/** The part of `window` that `schedulePreload` uses, so tests can pass a stand-in. */
export type PreloadWindow = {
  requestIdleCallback?(callback: () => void, options?: { timeout: number }): number;
  cancelIdleCallback?(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
  document: Pick<Document, "addEventListener" | "removeEventListener">;
};

const INTENT_EVENTS = ["pointerover", "focusin"] as const;

/**
 * Calls `fn` at most once: when the browser is idle, or on the first
 * `pointerover` or `focusin` on a `.tessera-wi-row`, whichever comes first.
 * The idle callback, the timer and the document listeners are all gone once it
 * fires. Returns a cancel function for an unmount that comes first.
 */
export function schedulePreload(win: PreloadWindow, fn: () => void): () => void {
  let isDone = false;
  let idleHandle: number | null = null;
  let timerHandle: number | null = null;

  const onIntent = (event: Event) => {
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (typeof target?.closest === "function" && target.closest(PEEK_ROW_SELECTOR) !== null) fire();
  };
  const stop = () => {
    isDone = true;
    if (idleHandle !== null) win.cancelIdleCallback?.(idleHandle);
    if (timerHandle !== null) win.clearTimeout(timerHandle);
    idleHandle = null;
    timerHandle = null;
    for (const name of INTENT_EVENTS) win.document.removeEventListener(name, onIntent);
  };
  function fire() {
    if (isDone) return;
    stop();
    fn();
  }

  if (typeof win.requestIdleCallback === "function") idleHandle = win.requestIdleCallback(fire, { timeout: PRELOAD_DELAY_MS });
  else timerHandle = win.setTimeout(fire, PRELOAD_DELAY_MS);
  for (const name of INTENT_EVENTS) win.document.addEventListener(name, onIntent, { passive: true });
  return stop;
}
