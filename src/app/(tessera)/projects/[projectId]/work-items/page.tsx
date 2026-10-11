import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { loadWorkItemDetail } from "@/app/(tessera)/work-items/load-detail";
import { PeekHost, type PeekData } from "@/components/detail/PeekHost";
import type { UrlState } from "@/components/work-items/types";
import { decodeUrlState, mergeDisplay, mergeFilters } from "@/components/work-items/url-state";
import { WorkItemsScreen } from "@/components/work-items/WorkItemsScreen";
import { DEFAULT_DISPLAY, IdSchema } from "@/lib/tessera/schemas";
import { getViewSettings, isTrackerError, listWorkItems, readTessera } from "@/lib/tessera/server";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Page size; the engine caps a list at 5000 rows and P2 adds paging. */
const LIMIT = 2000;

/**
 * Work items of a project (docs/contracts/ui.md "Work items screen"). The
 * effective display and filters are defaults <- saved view settings <- the
 * URL's `q` state, so a link carries its view and a plain navigation keeps
 * the saved one. `?peek=<id>` opens that item next to the list (P2b, the
 * PeekHost): it is loaded in a second, separately guarded read so a stale or
 * foreign id shows the panel's not-found state instead of 404ing the list.
 */
export default function WorkItemsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <WorkItemsData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function WorkItemsData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const urlState = decodeUrlState(typeof query.q === "string" ? query.q : undefined);
  const createOnOpen = query.create === "1";
  const peekId = typeof query.peek === "string" && query.peek !== "" ? query.peek : null;
  await io();
  let data: Awaited<ReturnType<typeof loadWorkItems>>;
  try {
    data = await loadWorkItems(projectId, urlState);
  } catch (err) {
    // Pages render in parallel with their layout: a missing or malformed project id lands here too.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  const peek = peekId === null ? null : await loadPeek(projectId, peekId);
  return (
    <PeekHost projectId={projectId} peek={peek}>
      <WorkItemsScreen
        projectId={projectId}
        result={data.result}
        display={data.display}
        filters={data.filters}
        settingsDisplay={data.settings.display}
        createOnOpen={createOnOpen}
      />
    </PeekHost>
  );
}

/**
 * The peeked item, guarded on its own: a malformed, unknown or deleted id,
 * or an item of another project, yields `data: null` (the panel's not-found
 * state) and never fails the list.
 */
async function loadPeek(projectId: string, peekId: string): Promise<PeekData> {
  if (!IdSchema.safeParse(peekId).success) return { id: peekId, data: null };
  try {
    const data = await readTessera((ctx) => loadWorkItemDetail(ctx, peekId));
    return { id: peekId, data: data.item.project_id === projectId ? data : null };
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) return { id: peekId, data: null };
    throw err;
  }
}

function loadWorkItems(projectId: string, urlState: UrlState) {
  return readTessera((ctx) => {
    const settings = getViewSettings(ctx, "project", projectId);
    const display = mergeDisplay(DEFAULT_DISPLAY, settings.display, urlState.display);
    const filters = mergeFilters({}, settings.filters, urlState.filters);
    const result = listWorkItems(ctx, { scope: { type: "project", project_id: projectId }, filters, display, limit: LIMIT });
    return { settings, display, filters, result };
  });
}

function ListSkeleton() {
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
