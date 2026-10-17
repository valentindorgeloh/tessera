"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { setProjectFeatures, type ProjectFeatureMap } from "./project-features";
import type { ProjectNameMap } from "./recents";
import { recordVisit, setRecentProjectNames } from "./recents-store";

/**
 * Records every visited route in the recents store (./recents-store.ts) and
 * hands it the project names the Tessera layout read, and Power K and the
 * shortcuts the projects' feature flags (./project-features.ts). A work item opened in
 * the peek is recorded by the peek host once it has loaded
 * (src/components/detail/PeekHost.tsx), as a visit to its full page. Renders
 * nothing; it reads the request-bound `usePathname()`, so the layout mounts
 * it in its own Suspense boundary.
 */
export function RecentsTracker({ projectNames, projectFeatures }: { projectNames: ProjectNameMap; projectFeatures: ProjectFeatureMap }) {
  const pathname = usePathname();

  useEffect(() => {
    setProjectFeatures(projectFeatures);
  }, [projectFeatures]);

  useEffect(() => {
    setRecentProjectNames(projectNames);
  }, [projectNames]);

  useEffect(() => {
    recordVisit(pathname);
  }, [pathname]);

  return null;
}
