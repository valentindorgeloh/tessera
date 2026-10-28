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
 *
 * A second, lean context (`useProjectRow()`, decision 141) carries what a row
 * and its property controls read. The full bundle changes on every write (the
 * cursor, the counts, a cycle's progress, an agent's `last_seen_at`), so a
 * memoized row that read it would redraw on every write; the row bundle drops
 * those fields from its type and keeps its identity while the rest is equal.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { ActorRow, Cycle, EstimateView, Label, Module, Project, State, StateGroup } from "@/lib/tessera/types";
import { useShared } from "./stable";
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

/** `row` without the listed fields, for the row bundle's lean types. */
function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const copy: Partial<T> = { ...row };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

/** The fields a write changes without a row ever drawing them: counts, progress, membership lists, who was seen when. */
export type RowProjectData = Omit<Project, "counts" | "next_sequence" | "updated_at" | "updated_by">;
export type RowCycle = Omit<Cycle, "progress" | "open_count">;
export type RowModule = Omit<Module, "progress" | "member_ids" | "links_count">;
export type RowActor = Omit<ActorRow, "last_seen_at" | "updated_at" | "updated_by">;

/** What a list row, its property controls and the group markers read of the project bundle. */
export type RowBundle = {
  project: RowProjectData;
  states: State[];
  labels: Label[];
  cycles: RowCycle[];
  modules: RowModule[];
  actors: RowActor[];
  today: string;
  week_start?: number;
  estimate: EstimateView | null;
};

export type ProjectRowContextValue = {
  bundle: RowBundle;
  statesById: ReadonlyMap<string, State>;
  labelsById: ReadonlyMap<string, Label>;
  actorsById: ReadonlyMap<string, RowActor>;
  modulesById: ReadonlyMap<string, RowModule>;
};

const ProjectRowContext = createContext<ProjectRowContextValue | null>(null);

export function toRowBundle(bundle: ProjectBundle): RowBundle {
  return {
    project: without(bundle.project, "counts", "next_sequence", "updated_at", "updated_by"),
    states: bundle.states,
    labels: bundle.labels,
    cycles: bundle.cycles.map((cycle) => without(cycle, "progress", "open_count")),
    modules: bundle.modules.map((mod) => without(mod, "progress", "member_ids", "links_count")),
    actors: bundle.actors.map((actor) => without(actor, "last_seen_at", "updated_at", "updated_by")),
    today: bundle.today,
    week_start: bundle.week_start,
    estimate: bundle.estimate,
  };
}

export function buildProjectRowContext(bundle: RowBundle): ProjectRowContextValue {
  return {
    bundle,
    statesById: byId(bundle.states),
    labelsById: byId(bundle.labels),
    actorsById: byId(bundle.actors),
    modulesById: byId(bundle.modules),
  };
}

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
  // `useShared` keeps the row bundle's identity while its content is equal, so the row context below only changes
  // when a row could draw something else (a renamed state, a new label), not on every write.
  const rowBundle = useShared(useMemo(() => toRowBundle(bundle), [bundle]));
  const rowValue = useMemo(() => buildProjectRowContext(rowBundle), [rowBundle]);
  return (
    <ProjectContext.Provider value={value}>
      <ProjectRowContext.Provider value={rowValue}>{children}</ProjectRowContext.Provider>
    </ProjectContext.Provider>
  );
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

/**
 * The lean context of a row and its property controls; throws outside a project route. It does not change on a
 * write that leaves the row's inputs alone, so a memoized row that reads it stays put (decision 141).
 */
export function useProjectRow(): ProjectRowContextValue {
  const value = useContext(ProjectRowContext);
  if (!value) throw new Error("useProjectRow must be used inside ProjectProvider");
  return value;
}
