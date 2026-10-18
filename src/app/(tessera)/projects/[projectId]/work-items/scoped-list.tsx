import type React from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { loadWorkItemDetail } from "@/app/(tessera)/work-items/load-detail";
import { PeekHost, type PeekData } from "@/components/detail/PeekHost";
import { toWeekStart } from "@/components/work-items/calendar-math";
import { listPaging } from "@/components/work-items/paging";
import type { ScopeDefaults, SettingsScope, UrlState, WorkItemsScope } from "@/components/work-items/types";
import { decodeUrlState, mergeDisplay, mergeFilters } from "@/components/work-items/url-state";
import { WorkItemsScreen, type WorkItemsScreenProps } from "@/components/work-items/WorkItemsScreen";
import { DEFAULT_DISPLAY, IdSchema } from "@/lib/tessera/schemas";
import { getViewSettings, isTrackerError, listWorkItems, readTessera } from "@/lib/tessera/server";
import { getWorkspaceSettings } from "@/lib/tessera/workspace/settings";
import type { Display, GroupBy } from "@/lib/tessera/types";

export type { WorkItemsScope };

/**
 * The work items list of a project, a cycle or a module (docs/contracts/ui.md
 * "Integration (E4)"). An async Server Component without a directive: it reads
 * through `@/lib/tessera/server`, which is why it lives under `src/app/`.
 * The project page renders it on its own; the cycle and module detail screens
 * render it as their children inside `<Suspense fallback={<ListSkeleton />}>`.
 *
 * The effective display and filters are defaults <- saved view settings of
 * `settingsScope` <- the URL's `q` state. `?peek=<id>` opens that item next to
 * the list through a second, separately guarded read. `title` and `count` name
 * the list's sub-header (default "Work items" and the list's total, also in a
 * cycle or module, whose own header above names the scope).
 */

export type { ScopeDefaults, SettingsScope };

export type ScopedWorkItemsProps = {
  projectId: string;
  scope: WorkItemsScope;
  /** view_settings row (decision 23): cycle → { "cycle", cycleId }. */
  settingsScope: SettingsScope;
  /** The page's awaited searchParams: q, peek, create. */
  query: Record<string, string | string[] | undefined>;
  /** New items join the cycle / module. */
  scopeDefaults?: ScopeDefaults;
  /** Default true; false for completed or archived cycles and archived modules. */
  canCreate?: boolean;
  /** Cycle scope ["cycle"], module scope ["module"]: grouping by these fields is dropped. */
  hiddenGroupFields?: readonly GroupBy[];
} & Pick<WorkItemsScreenProps, "title" | "count">;

const NO_HIDDEN_FIELDS: readonly GroupBy[] = [];

/** A grouping by a hidden field (saved or from the URL) falls back to no grouping. */
function withoutHiddenGroups(display: Display, hidden: readonly GroupBy[]): Display {
  if (hidden.length === 0) return display;
  const isHidden = (field: string | null) => field !== null && (hidden as readonly string[]).includes(field);
  if (!isHidden(display.group_by) && !isHidden(display.sub_group_by)) return display;
  return {
    ...display,
    group_by: isHidden(display.group_by) ? null : display.group_by,
    sub_group_by: isHidden(display.sub_group_by) ? null : display.sub_group_by,
  };
}

function loadWorkItems(scope: WorkItemsScope, settingsScope: SettingsScope, urlState: UrlState, hidden: readonly GroupBy[], cal: string | undefined) {
  return readTessera((ctx) => {
    const settings = getViewSettings(ctx, settingsScope.scope_type, settingsScope.scope_id);
    const display = withoutHiddenGroups(mergeDisplay(DEFAULT_DISPLAY, settings.display, urlState.display), hidden);
    const filters = mergeFilters({}, settings.filters, urlState.filters);
    const paging = listPaging(display, cal, ctx.today(), toWeekStart(getWorkspaceSettings(ctx).week_start));
    const result = listWorkItems(ctx, {
      scope,
      filters,
      display,
      ...paging,
      ...(urlState.rich_filters !== undefined ? { rich_filters: urlState.rich_filters } : {}),
    });
    return { settings, display, filters, result };
  });
}

export async function ScopedWorkItems({
  projectId,
  scope,
  settingsScope,
  query,
  scopeDefaults,
  canCreate = true,
  hiddenGroupFields = NO_HIDDEN_FIELDS,
  title,
  count,
}: ScopedWorkItemsProps): Promise<React.JSX.Element> {
  const urlState = decodeUrlState(typeof query.q === "string" ? query.q : undefined);
  const createOnOpen = canCreate && query.create === "1";
  const peekId = typeof query.peek === "string" && query.peek !== "" ? query.peek : null;
  await io();
  let data: Awaited<ReturnType<typeof loadWorkItems>>;
  try {
    data = await loadWorkItems(scope, settingsScope, urlState, hiddenGroupFields, typeof query.cal === "string" ? query.cal : undefined);
  } catch (err) {
    // Pages render in parallel with their layout: a missing or malformed project, cycle or module id lands here too.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  const peek = peekId === null ? null : await loadPeek(projectId, peekId);
  return (
    <PeekHost projectId={projectId} peek={peek}>
      <WorkItemsScreen
        projectId={projectId}
        listScope={scope}
        result={data.result}
        display={data.display}
        filters={data.filters}
        settingsDisplay={data.settings.display}
        createOnOpen={createOnOpen}
        settingsScope={settingsScope}
        scopeDefaults={scopeDefaults}
        canCreate={canCreate}
        hiddenGroupFields={hiddenGroupFields}
        title={title}
        count={count}
        saveView={scope.type === "project"}
        exportScope={{
          project_id: projectId,
          cycle_id: scope.type === "cycle" ? scope.cycle_id : undefined,
          module_id: scope.type === "module" ? scope.module_id : undefined,
        }}
      />
    </PeekHost>
  );
}

/**
 * The peeked item, guarded on its own: a malformed, unknown or deleted id,
 * or an item of another project, yields `data: null` (the panel's not-found
 * state) and never fails the list.
 */
export async function loadPeek(projectId: string, peekId: string): Promise<PeekData> {
  if (!IdSchema.safeParse(peekId).success) return { id: peekId, data: null };
  try {
    const data = await readTessera((ctx) => loadWorkItemDetail(ctx, peekId));
    return { id: peekId, data: data.item.project_id === projectId ? data : null };
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) return { id: peekId, data: null };
    throw err;
  }
}

export function ListSkeleton(): React.JSX.Element {
  return (
    <VStack gap={3} padding={5}>
      <HStack gap={2}>
        <Skeleton width="60%" height={32} />
        <Skeleton width={96} height={32} index={1} />
        <Skeleton width={128} height={32} index={2} />
      </HStack>
      <Skeleton width={160} height={20} index={3} />
      <Skeleton height={36} index={4} />
      <Skeleton height={36} index={5} />
      <Skeleton height={36} index={6} />
      <Skeleton height={36} index={7} />
    </VStack>
  );
}
