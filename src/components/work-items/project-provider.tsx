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

export function buildProjectContext(bundle: ProjectBundle): ProjectContextValue {
  const firstStateByGroup = new Map<StateGroup, State>();
  for (const state of bundle.states) {
    if (!firstStateByGroup.has(state.state_group)) firstStateByGroup.set(state.state_group, state);
  }
  return {
    bundle,
    statesById: byId(bundle.states),
    labelsById: byId(bundle.labels),
    actorsById: byId(bundle.actors),
    cyclesById: byId(bundle.cycles),
    modulesById: byId(bundle.modules),
    firstStateByGroup,
  };
}

export function ProjectProvider({ bundle, children }: { bundle: ProjectBundle; children: ReactNode }) {
  const value = useMemo(() => buildProjectContext(bundle), [bundle]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, bundle.project.id);
    } catch {
      // Not persisted in private mode; the sidebar falls back to the first project.
    }
  }, [bundle.project.id]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
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
