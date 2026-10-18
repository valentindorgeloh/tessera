"use client";

/**
 * Per-row project context for a list that holds items from many projects.
 * Property controls read `useProject()`, so a cell wraps itself in the row's
 * bundle. With no bundles registered the children render as they do on a
 * single-project list.
 */
import { createContext, useContext, type ReactNode } from "react";
import { ProjectScope } from "./project-provider";
import type { ProjectBundle } from "./types";

const BundlesContext = createContext<Readonly<Record<string, ProjectBundle>> | null>(null);

export function BundlesProvider({ bundles, children }: { bundles: Readonly<Record<string, ProjectBundle>>; children: ReactNode }) {
  return <BundlesContext.Provider value={bundles}>{children}</BundlesContext.Provider>;
}

export function useBundles(): Readonly<Record<string, ProjectBundle>> | null {
  return useContext(BundlesContext);
}

export function RowProject({ projectId, children }: { projectId: string; children: ReactNode }) {
  const bundle = useContext(BundlesContext)?.[projectId];
  if (!bundle) return children;
  return <ProjectScope bundle={bundle}>{children}</ProjectScope>;
}
