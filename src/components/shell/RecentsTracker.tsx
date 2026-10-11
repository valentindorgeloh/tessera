"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PEEK_PARAM } from "@/components/detail/peek-url";
import { normalizePath, type ProjectNameMap } from "./recents";
import { recordVisit, setRecentProjectNames } from "./recents-store";

/**
 * Records every visited route in the recents store (./recents-store.ts) and
 * hands it the project names the Tessera layout read. A work item opened in
 * the peek counts as a visit to its full page, so it shows up in the recents
 * like one opened directly. Renders nothing; it reads `usePathname()` and
 * `useSearchParams()`, which are request-bound, so the layout mounts it in
 * its own Suspense boundary.
 */
export function RecentsTracker({ projectNames }: { projectNames: ProjectNameMap }) {
  const pathname = usePathname();
  const peek = useSearchParams().get(PEEK_PARAM);

  useEffect(() => {
    setRecentProjectNames(projectNames);
  }, [projectNames]);

  useEffect(() => {
    recordVisit(pathname);
  }, [pathname]);

  useEffect(() => {
    // The peek lives on the work items list only (`/projects/<id>/work-items?peek=<item>`).
    const list = normalizePath(pathname);
    if (peek && /^\/projects\/[^/]+\/work-items$/.test(list)) recordVisit(`${list}/${encodeURIComponent(peek)}`);
  }, [pathname, peek]);

  return null;
}
