"use client";

/**
 * Recents store (docs/contracts/ui.md "Shell"): the visited routes from
 * ./recents.ts, mirrored to localStorage (`tessera.recents.v1`), plus the
 * project names the Tessera layout reads on the server, so a recent under
 * `/projects/<id>` is labelled by its project. `RecentsTracker` and the peek
 * host record the visits; Home's recents list and Power K read them. Every
 * write starts from the stored list, and a `storage` listener follows other
 * tabs, so tabs never erase each other's visits. Module state behind
 * `useSyncExternalStore`; the server snapshot is empty, so nothing renders
 * until the first client effect has loaded the stored list (hydration-safe).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readEntityLabels, useEntityLabels } from "./entity-labels";
import {
  RECENTS_STORAGE_KEY,
  addRecent,
  labelRecents,
  lookupFromNames,
  normalizePath,
  parseRecents,
  removeRecentsUnder,
  type LabelledRecent,
  type ProjectNameMap,
} from "./recents";

type RecentsState = { recents: readonly string[]; projectNames: ProjectNameMap; isLoaded: boolean };

const EMPTY_STATE: RecentsState = { recents: [], projectNames: {}, isLoaded: false };

let state: RecentsState = EMPTY_STATE;
let loaded = false;
/** The address a not-found screen is showing (`useMissingRoute`); a visit recorded for it afterwards is skipped. */
let missingPath: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((path, index) => path === b[index]);
}

/** The stored list; null when storage cannot be read (private mode), and callers keep the in-memory list. */
function readStored(): readonly string[] | null {
  try {
    const raw = window.localStorage.getItem(RECENTS_STORAGE_KEY);
    return raw ? parseRecents(JSON.parse(raw)) : [];
  } catch {
    return null;
  }
}

/** Keeps Home's list and Power K in step with visits recorded in other tabs. */
function onStorage(event: StorageEvent) {
  if (event.key !== RECENTS_STORAGE_KEY || !loaded) return;
  const stored = readStored();
  if (stored === null || sameList(stored, state.recents)) return;
  state = { ...state, recents: stored };
  emit();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): RecentsState {
  return state;
}

function getServerSnapshot(): RecentsState {
  return EMPTY_STATE;
}

/** Reads the stored list once per page load; visits recorded before the load stay in front. */
function loadStoredRecents() {
  if (loaded) return;
  loaded = true;
  let merged = readStored() ?? [];
  for (const path of [...state.recents].reverse()) merged = addRecent(merged, path);
  state = { ...state, recents: merged, isLoaded: true };
  emit();
}

function persist(recents: readonly string[]) {
  try {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // Private mode or quota: recents live for this page only.
  }
}

/** Applies `change` to the stored list (so visits other tabs recorded since this one loaded survive) and stores the result. */
function update(change: (recents: readonly string[]) => readonly string[]) {
  loadStoredRecents();
  const base = readStored() ?? state.recents;
  const next = change(base);
  if (next !== base) persist(next);
  if (sameList(next, state.recents)) return;
  state = { ...state, recents: next };
  emit();
}

/** Records a visit to `path`; Home, the root and redirect aliases are ignored (`isRecordable`). */
export function recordVisit(path: string): void {
  const key = normalizePath(path);
  if (key === missingPath) return;
  missingPath = null;
  update((recents) => addRecent(recents, key));
}

/**
 * Forgets `path` and the routes under it: a deleted work item, cycle or
 * module, every route of a deleted or archived project (`/projects/<id>`), a
 * page that showed not-found.
 */
export function forgetRecentsUnder(path: string): void {
  update((recents) => removeRecentsUnder(recents, path));
}

/**
 * For not-found screens: the address on screen leaves the recents (a recent
 * of an item deleted elsewhere goes away once it has led here), and the visit
 * the recents tracker records for it, before or after this effect, does not
 * stay.
 */
export function useMissingRoute(): void {
  useEffect(() => {
    const key = normalizePath(window.location.pathname);
    missingPath = key;
    forgetRecentsUnder(key);
  }, []);
}

/** The project names recents under `/projects/<id>` are labelled with. */
export function setRecentProjectNames(projectNames: ProjectNameMap): void {
  if (state.projectNames === projectNames) return;
  state = { ...state, projectNames };
  emit();
}

/** Detail screens register work item labels and cycle and module names in one store (./entity-labels.ts), keyed by id. */
function label(recents: RecentsState, entityLabels: ReadonlyMap<string, string>, limit?: number): LabelledRecent[] {
  const byId = (id: string) => entityLabels.get(id);
  const lookup = { ...lookupFromNames(recents.projectNames), workItemLabel: byId, entityLabel: byId };
  return labelRecents(limit === undefined ? recents.recents : recents.recents.slice(0, limit), lookup);
}

/** The recents right now, labelled, for event handlers (Power K reads them when it opens). */
export function readRecents(limit?: number): LabelledRecent[] {
  loadStoredRecents();
  return label(state, readEntityLabels(), limit);
}

/**
 * The labelled recents, newest first, and whether the stored list has been
 * read; empty and not loaded during the server render and hydration.
 */
export function useRecents(limit?: number): { recents: LabelledRecent[]; isLoaded: boolean } {
  useEffect(() => {
    loadStoredRecents();
  }, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const entityLabels = useEntityLabels();
  const recents = useMemo(() => label(snapshot, entityLabels, limit), [snapshot, entityLabels, limit]);
  return { recents, isLoaded: snapshot.isLoaded };
}
