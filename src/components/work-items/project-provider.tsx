"use client";

/**
 * Project context (docs/contracts/ui.md "ProjectBundle and ProjectProvider").
 * The project layout loads the bundle once; every property control, layout
 * and dialog under it reads states, labels, cycles, modules and actors from
 * `useProject()` instead of fetching. Lookup maps are built once per bundle.
 *
 * After mount the project id is written to localStorage
 * (`tessera.lastProject.v1`) so the sidebar's "New work item" button targets
 * the project the user looked at last.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { ActorRow, Cycle, Label, Module, State, StateGroup } from "@/lib/tessera/types";
import type { ProjectBundle } from "./types";

/** Same key the sidebar reads (src/components/shell/Sidebar.tsx). */
export const LAST_PROJECT_STORAGE_KEY = "tessera.lastProject.v1";

export type ProjectContextValue = {
  bundle: ProjectBundle;
  statesById: ReadonlyMap<string, State>;
  labelsById: ReadonlyMap<string, Label>;
  actorsById: ReadonlyMap<string, ActorRow>;
  cyclesById: ReadonlyMap<string, Cycle>;
  modulesById: ReadonlyMap<string, Module>;
  /** First state of each group in sequence order; quick-add in a state_group group uses it. */
  firstStateByGroup: ReadonlyMap<StateGroup, State>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

function byId<T extends { id: string }>(rows: T[]): ReadonlyMap<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/** First state of each group, in the order the states are listed. */
export function firstStateByGroupOf(states: readonly State[]): ReadonlyMap<StateGroup, State> {
  const first = new Map<StateGroup, State>();
  for (const state of states) {
    if (!first.has(state.state_group)) first.set(state.state_group, state);
  }
  return first;
}

export function buildProjectContext(bundle: ProjectBundle): ProjectContextValue {
  return {
    bundle,
    statesById: byId(bundle.states),
    labelsById: byId(bundle.labels),
    actorsById: byId(bundle.actors),
    cyclesById: byId(bundle.cycles),
    modulesById: byId(bundle.modules),
    firstStateByGroup: firstStateByGroupOf(bundle.states),
  };
}

/** Project context without remembering the project. A cross-project row uses this so the host list does not overwrite the last-opened project. */
export function ProjectScope({ bundle, children }: { bundle: ProjectBundle; children: ReactNode }) {
  const value = useMemo(() => buildProjectContext(bundle), [bundle]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function ProjectProvider({ bundle, children }: { bundle: ProjectBundle; children: ReactNode }) {
  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, bundle.project.id);
    } catch {
      // Not persisted in private mode; the sidebar falls back to the first project.
    }
  }, [bundle.project.id]);

  return <ProjectScope bundle={bundle}>{children}</ProjectScope>;
}

/** The current project's context, or null outside a project route (the project not-found boundary renders bare for an unknown project). */
export function useOptionalProject(): ProjectContextValue | null {
  return useContext(ProjectContext);
}

/** The current project's bundle and lookup maps; throws outside a project route. */
export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject must be used inside ProjectProvider");
  return value;
}
