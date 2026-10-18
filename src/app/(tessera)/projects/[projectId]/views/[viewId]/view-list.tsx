import type React from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { loadPeek } from "@/app/(tessera)/projects/[projectId]/work-items/scoped-list";
import { PeekHost } from "@/components/detail/PeekHost";
import { ViewBar } from "@/components/views/ViewBar";
import { ViewLockIndicator } from "@/components/views/ViewRow";
import { ViewMenu } from "@/components/views/ViewMenu";
import { isViewModified, viewScopeDefaults, type ViewState } from "@/components/views/view-state";
import { pageSizeFor } from "@/components/work-items/paging";
import { decodeUrlState, mergeDisplay, mergeFilters } from "@/components/work-items/url-state";
import { WorkItemsScreen } from "@/components/work-items/WorkItemsScreen";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import { isTrackerError, listWorkItems, readTessera } from "@/lib/tessera/server";
import type { View } from "@/lib/tessera/types";

/**
 * The work items list of a saved view (docs/drafts/p4-ui.md "View page"): an
 * async Server Component without a directive, like the scoped list. The saved
 * state is the view row; the effective state is that with the URL's `q` laid
 * over it (decision 32), so every unsaved change lives in the URL and
 * `isModified` is recomputed here on each render. The list is read through
 * the engine's view scope with the effective filters and display, and
 * `?peek=<id>` opens that item next to the list.
 */


export type ViewWorkItemsProps = {
  projectId: string;
  view: View;
  /** The page's awaited searchParams: q, peek, create. */
  query: Record<string, string | string[] | undefined>;
};

export async function ViewWorkItems({ projectId, view, query }: ViewWorkItemsProps): Promise<React.JSX.Element> {
  const urlState = decodeUrlState(typeof query.q === "string" ? query.q : undefined);
  const savedRich = view.rich_filters;
  const saved: ViewState = { filters: view.filters, display: mergeDisplay(DEFAULT_DISPLAY, view.display), rich_filters: savedRich };
  const effective: ViewState = {
    filters: mergeFilters({}, view.filters, urlState.filters),
    display: mergeDisplay(DEFAULT_DISPLAY, view.display, urlState.display),
    rich_filters: urlState.rich_filters !== undefined ? urlState.rich_filters : savedRich,
  };
  const peekId = typeof query.peek === "string" && query.peek !== "" ? query.peek : null;
  await io();
  let result: Awaited<ReturnType<typeof loadItems>>;
  try {
    result = await loadItems(view.id, effective);
  } catch (err) {
    // The view may have been deleted since the page loaded; a malformed id lands here too.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  const peek = peekId === null ? null : await loadPeek(projectId, peekId);
  return (
    <PeekHost projectId={projectId} peek={peek}>
      <WorkItemsScreen
        projectId={projectId}
        listScope={{ type: "view", view_id: view.id }}
        result={result}
        display={effective.display}
        filters={effective.filters}
        richFilters={effective.rich_filters ?? null}
        settingsDisplay={saved.display}
        settingsScope={null}
        scopeDefaults={viewScopeDefaults(effective.filters)}
        title={view.name}
        createOnOpen={query.create === "1"}
        titleAdornment={view.is_locked ? <ViewLockIndicator /> : undefined}
        allowSelection={!view.is_locked}
        subheaderEnd={<ViewMenu projectId={projectId} view={view} placement="header" />}
        filtersEnd={<ViewBar projectId={projectId} view={view} isModified={isViewModified(saved, effective)} effective={effective} />}
        exportScope={{ project_id: projectId, view_id: view.id }}
      />
    </PeekHost>
  );
}

function loadItems(viewId: string, effective: ViewState) {
  return readTessera((ctx) =>
    listWorkItems(ctx, {
      scope: { type: "view", view_id: viewId },
      filters: effective.filters,
      display: effective.display,
      ...pageSizeFor(effective.display),
      ...(effective.rich_filters !== undefined ? { rich_filters: effective.rich_filters } : {}),
    }),
  );
}
