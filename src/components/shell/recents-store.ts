"use client";

/**
 * Recents store (docs/contracts/ui.md "Shell"): the visited routes from
 * ./recents.ts, mirrored to localStorage (`tessera.recents.v1`), plus the
 * project names the Tessera layout reads on the server, so a recent under
 * `/projects/<id>` is labelled by its project. `RecentsTracker` records the
 * visits; Home's recents list and Power K read them. Module state behind
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
  parseRecents,
  type LabelledRecent,
  type ProjectNameMap,
} from "./recents";

type RecentsState = { recents: readonly string[]; projectNames: ProjectNameMap };

const EMPTY_STATE: RecentsState = { recents: [], projectNames: {} };

let state: RecentsState = EMPTY_STATE;
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
  let stored: readonly string[] = [];
  try {
    const raw = window.localStorage.getItem(RECENTS_STORAGE_KEY);
    stored = raw ? parseRecents(JSON.parse(raw)) : [];
  } catch {
    stored = [];
  }
  let merged = stored;
  for (const path of [...state.recents].reverse()) merged = addRecent(merged, path);
  state = { ...state, recents: merged };
  emit();
}

function persist() {
  try {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(state.recents));
  } catch {
    // Private mode or quota: recents live for this page only.
  }
}

/** Records a visit to `path`; Home, the root and redirect aliases are ignored (`isRecordable`). */
export function recordVisit(path: string): void {
  loadStoredRecents();
  const next = addRecent(state.recents, path);
  if (next === state.recents) return;
  state = { ...state, recents: next };
  persist();
  emit();
}

/** The project names recents under `/projects/<id>` are labelled with. */
export function setRecentProjectNames(projectNames: ProjectNameMap): void {
  if (state.projectNames === projectNames) return;
  state = { ...state, projectNames };
  emit();
}

function label(recents: RecentsState, entityLabels: ReadonlyMap<string, string>, limit?: number): LabelledRecent[] {
  const lookup = { ...lookupFromNames(recents.projectNames), workItemLabel: (id: string) => entityLabels.get(id) };
  return labelRecents(limit === undefined ? recents.recents : recents.recents.slice(0, limit), lookup);
}

/** The recents right now, labelled, for event handlers (Power K reads them when it opens). */
export function readRecents(limit?: number): LabelledRecent[] {
  loadStoredRecents();
  return label(state, readEntityLabels(), limit);
}

/** The labelled recents, newest first; empty during the server render and hydration. */
export function useRecents(limit?: number): LabelledRecent[] {
  useEffect(() => {
    loadStoredRecents();
  }, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const entityLabels = useEntityLabels();
  return useMemo(() => label(snapshot, entityLabels, limit), [snapshot, entityLabels, limit]);
}
