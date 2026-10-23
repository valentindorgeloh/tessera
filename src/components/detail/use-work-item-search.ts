"use client";

/**
 * Debounced work item search against `GET /api/search`, shared by the parent
 * picker (scoped to the project) and the "Add relation" dialog (no scope, so a
 * relation can cross projects). The previous request is aborted on every new
 * query. An empty query fetches nothing (the route returns no hits for it).
 */
import { useEffect, useState } from "react";

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 8;

/** The route URL for `query`; `projectId` null leaves the scope off (every project). */
export function searchUrl(query: string, projectId: string | null): string {
  const scope = projectId === null ? "" : `&scope=${encodeURIComponent(projectId)}`;
  return `/api/search?q=${encodeURIComponent(query)}${scope}&types=work_item&limit=${SEARCH_LIMIT}`;
}

export type SearchState<Hit> = { status: "idle" | "loading" | "ready" | "unavailable"; hits: Hit[] };

export function useWorkItemSearch<Hit>(query: string, projectId: string | null, isOpen: boolean, parse: (payload: unknown) => Hit[]): SearchState<Hit> {
  const [state, setState] = useState<SearchState<Hit>>({ status: "idle", hits: [] });
  useEffect(() => {
    if (!isOpen || query.trim() === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((previous) => ({ ...previous, status: "loading" }));
      try {
        const response = await fetch(searchUrl(query, projectId), { signal: controller.signal });
        if (!response.ok) {
          setState({ status: response.status === 404 ? "unavailable" : "ready", hits: [] });
          return;
        }
        setState({ status: "ready", hits: parse(await response.json()) });
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("[tessera] work item search failed", err);
        setState({ status: "unavailable", hits: [] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, parse, projectId, query]);
  return state;
}
