import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { ViewsScreen } from "@/components/views/ViewsScreen";
import { IdSchema } from "@/lib/tessera/schemas";
import { getCounts, getProject, isTrackerError, listViews, readTessera } from "@/lib/tessera/server";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Saved views of a project (docs/drafts/p4-ui.md "Routes and data loading"):
 * one read for the project, its views in manual order and each view's work
 * item count. A project with views turned off shows the feature-off state
 * instead. `?create=1` opens the New view dialog.
 */
export default function ViewsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ViewsSkeleton />}>
      <ViewsData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ViewsData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const createOnOpen = query.create === "1";
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let data: Awaited<ReturnType<typeof loadViews>>;
  try {
    data = await loadViews(projectId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data === null) return <FeatureOffState feature="views" projectId={projectId} />;
  return <ViewsScreen projectId={projectId} views={data.views} counts={data.counts} createOnOpen={createOnOpen} />;
}

function loadViews(projectId: string) {
  return readTessera((ctx) => {
    const project = getProject(ctx, projectId);
    if (!project.views_enabled) return null;
    const views = listViews(ctx, { project_id: projectId });
    const counts: Record<string, number> = {};
    for (const view of views) counts[view.id] = getCounts(ctx, { type: "view", view_id: view.id }).total;
    return { views, counts };
  });
}

function ViewsSkeleton() {
  return (
    <VStack gap={4} padding={5}>
      <HStack gap={3} hAlign="between">
        <Skeleton width={120} height={28} />
        <Skeleton width={112} height={28} index={1} />
      </HStack>
      <Skeleton height={44} index={2} />
      <Skeleton height={44} index={3} />
      <Skeleton height={44} index={4} />
      <Skeleton height={44} index={5} />
    </VStack>
  );
}
