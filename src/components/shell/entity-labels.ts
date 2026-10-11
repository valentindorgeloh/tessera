"use client";

/**
 * Entity labels for the tab bar (docs/contracts/ui.md "Routes and modes", tab
 * labels). A detail screen registers the label of the entity it shows
 * (`WEB-1 Set up hosting`) and the TabBar's lookup reads it, so a tab for
 * `/work-items/<id>` names the item instead of saying "Work item". The store
 * is never cleared: a tab keeps its label after the user navigates away.
 * Module state behind `useSyncExternalStore`; the server snapshot is empty.
 *
 * The labels are also mirrored to localStorage (`tessera.entityLabels.v1`,
 * newest last, at most MAX_ENTITY_LABELS entries) and read back after mount,
 * like the TabBar's own tabs, so every stored tab still reads "WEB-1 <title>"
 * right after a hard reload instead of "Work item" until it is visited again.
 */
import { useEffect, useSyncExternalStore } from "react";

export const ENTITY_LABELS_STORAGE_KEY = "tessera.entityLabels.v1";

/** Upper bound of remembered labels; the oldest entries drop first. */
export const MAX_ENTITY_LABELS = 200;

const EMPTY_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * `labels` with `id` mapped to `label` as the newest entry, trimmed to `max`
 * entries by dropping the oldest. Returns `labels` itself when the label is
 * already stored, so callers can skip the write and the re-render.
 */
export function withEntityLabel(labels: ReadonlyMap<string, string>, id: string, label: string, max: number = MAX_ENTITY_LABELS): ReadonlyMap<string, string> {
  if (labels.get(id) === label) return labels;
  const next = new Map(labels);
  next.delete(id);
  next.set(id, label);
  for (const oldest of next.keys()) {
    if (next.size <= max) break;
    next.delete(oldest);
  }
  return next;
}

/**
 * Reads the stored form, an array of `[id, label]` pairs oldest first.
 * Malformed entries are skipped; anything that is not an array yields an
 * empty map.
 */
export function parseEntityLabels(raw: unknown, max: number = MAX_ENTITY_LABELS): ReadonlyMap<string, string> {
  if (!Array.isArray(raw)) return EMPTY_LABELS;
  let labels: ReadonlyMap<string, string> = EMPTY_LABELS;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [id, label] = entry;
    if (typeof id !== "string" || typeof label !== "string" || id === "" || label === "") continue;
    labels = withEntityLabel(labels, id, label, max);
  }
  return labels;
}

/** The stored form of `labels`: `[id, label]` pairs, oldest first. */
export function serializeEntityLabels(labels: ReadonlyMap<string, string>): string {
  return JSON.stringify([...labels]);
}

// ---------------------------------------------------------------------------
// Store: one module-level map shared by every reader, mirrored to localStorage.
// ---------------------------------------------------------------------------

let labels: ReadonlyMap<string, string> = EMPTY_LABELS;
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

function getSnapshot(): ReadonlyMap<string, string> {
  return labels;
}

function getServerSnapshot(): ReadonlyMap<string, string> {
  return EMPTY_LABELS;
}

function persist() {
  try {
    window.localStorage.setItem(ENTITY_LABELS_STORAGE_KEY, serializeEntityLabels(labels));
  } catch {
    // Private mode or quota: labels live for this page only.
  }
}

/**
 * Merges the stored labels under the ones registered so far, once per page
 * load. Runs from effects only (never during render), so hydration always
 * starts from the empty server snapshot.
 */
function loadStoredLabels() {
  if (loaded) return;
  loaded = true;
  let stored: ReadonlyMap<string, string> = EMPTY_LABELS;
  try {
    const raw = window.localStorage.getItem(ENTITY_LABELS_STORAGE_KEY);
    stored = raw ? parseEntityLabels(JSON.parse(raw)) : EMPTY_LABELS;
  } catch {
    stored = EMPTY_LABELS;
  }
  if (stored.size === 0) return;
  // A label registered before the load is newer than the stored one for the same id.
  let merged = stored;
  for (const [id, label] of labels) merged = withEntityLabel(merged, id, label);
  labels = merged;
  emit();
}

/** Records (or updates) the label shown for `id`; a label equal to the stored one changes nothing. */
export function registerEntityLabel(id: string, label: string): void {
  loadStoredLabels();
  const next = withEntityLabel(labels, id, label);
  if (next === labels) return;
  labels = next;
  persist();
  emit();
}

/** Every registered label by entity id; a new map instance after each change. */
export function useEntityLabels(): ReadonlyMap<string, string> {
  useEffect(() => {
    loadStoredLabels();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
