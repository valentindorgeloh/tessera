"use client";

/**
 * Peek preferences (docs/contracts/ui.md "Routes and modes"): the panel's
 * width and whether the item opens as a side panel or a modal. They live in
 * localStorage under `tessera.peek.v1` as `{ width, mode }` and are read
 * after mount through `useSyncExternalStore`, the same pattern as the
 * recents store: the server snapshot is the default, so the first client
 * render matches the server markup and the stored values apply in an effect.
 */
import { useSyncExternalStore } from "react";

export const PEEK_STORAGE_KEY = "tessera.peek.v1";
export const PEEK_MIN_WIDTH = 360;
export const PEEK_MAX_WIDTH = 720;
export const PEEK_DEFAULT_WIDTH = 480;

/** The least width above the minimum that is worth a resize handle; under it the panel is as good as fixed (D13). */
export const PEEK_MIN_RESIZE_RANGE = 48;

/**
 * Whether a container of this width leaves the side panel nothing to resize
 * within: it cannot hold the minimum width plus a usable range. A panel whose
 * stored width merely reaches the container (a tablet, a drag to the
 * maximum) still has a range, so its handle stays and can be dragged back.
 * An unmeasured container (width 0) counts as having one.
 */
export function hasNoResizeRange(containerWidth: number): boolean {
  return containerWidth > 0 && containerWidth - PEEK_MIN_WIDTH < PEEK_MIN_RESIZE_RANGE;
}

export type PeekMode = "side" | "modal";

export type PeekPrefs = { width: number; mode: PeekMode };

/** What the server renders and what the client starts from before storage is read. */
export const DEFAULT_PEEK_PREFS: PeekPrefs = { width: PEEK_DEFAULT_WIDTH, mode: "side" };

/** The hook's snapshot: the preferences plus whether storage has been read. */
export type PeekPrefsSnapshot = PeekPrefs & { isLoaded: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Clamps a width to the resizable range; anything that is not a finite number falls back to the default. */
export function clampPeekWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return PEEK_DEFAULT_WIDTH;
  return Math.min(PEEK_MAX_WIDTH, Math.max(PEEK_MIN_WIDTH, Math.round(width)));
}

/**
 * Validates a stored value. Returns null for anything that is not an object;
 * a missing or unknown mode falls back to `side` and the width is clamped.
 */
export function parsePeekPrefs(raw: unknown): PeekPrefs | null {
  if (!isRecord(raw)) return null;
  const mode: PeekMode = raw.mode === "modal" ? "modal" : "side";
  return { width: clampPeekWidth(raw.width), mode };
}

// ---------------------------------------------------------------------------
// Store: one module-level state shared by every host mount, mirrored to
// localStorage.
// ---------------------------------------------------------------------------

const SERVER_SNAPSHOT: PeekPrefsSnapshot = { ...DEFAULT_PEEK_PREFS, isLoaded: false };

let snapshot: PeekPrefsSnapshot = SERVER_SNAPSHOT;
let loaded = false;
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

function getSnapshot(): PeekPrefsSnapshot {
  return snapshot;
}

function getServerSnapshot(): PeekPrefsSnapshot {
  return SERVER_SNAPSHOT;
}

function persist(prefs: PeekPrefs) {
  try {
    window.localStorage.setItem(PEEK_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or quota: the preference lives for this page only.
  }
}

/** Reads the stored preferences once per page load; later mounts reuse the module state. */
export function loadPeekPrefs(): void {
  if (loaded) return;
  loaded = true;
  let stored: PeekPrefs | null = null;
  try {
    const raw = window.localStorage.getItem(PEEK_STORAGE_KEY);
    stored = raw ? parsePeekPrefs(JSON.parse(raw)) : null;
  } catch {
    stored = null;
  }
  snapshot = { ...(stored ?? { width: snapshot.width, mode: snapshot.mode }), isLoaded: true };
  emit();
}

/**
 * Merges `patch` into the preferences, clamps the width and writes the result
 * to storage. Client-only (event handlers and effects): a save that comes
 * before any host has loaded the stored value, such as the full page's mode
 * switcher, reads it first so the patch never overwrites the other field
 * with its default.
 */
export function savePeekPrefs(patch: Partial<PeekPrefs>): void {
  loadPeekPrefs();
  const next: PeekPrefs = {
    width: patch.width === undefined ? snapshot.width : clampPeekWidth(patch.width),
    mode: patch.mode ?? snapshot.mode,
  };
  if (next.width === snapshot.width && next.mode === snapshot.mode) {
    // Nothing changed; still write, so a value repaired by parsePeekPrefs reaches storage.
    persist(next);
    return;
  }
  snapshot = { ...next, isLoaded: snapshot.isLoaded };
  persist(next);
  emit();
}

/** The current preferences; `isLoaded` turns true once `loadPeekPrefs` has run on the client. */
export function usePeekPrefs(): PeekPrefsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
