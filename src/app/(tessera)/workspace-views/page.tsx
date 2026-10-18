import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { WorkspaceViewsScreen } from "@/components/views/WorkspaceViewsScreen";
import { favoriteIds, getCounts, listViews, readTessera } from "@/lib/tessera/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** `/workspace-views` (docs/drafts/p9-plan.md U3). `?create=1` opens New view. */
export default function WorkspaceViewsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<ViewsSkeleton />}>
      <ViewsData searchParams={searchParams} />
    </Suspense>
  );
}

async function ViewsData({ searchParams }: Props) {
  const query = await searchParams;
  await io();
  const data = await readTessera((ctx) => {
    const views = listViews(ctx, { project_id: null });
    const counts: Record<string, number> = {};
    for (const view of views) counts[view.id] = getCounts(ctx, { type: "view", view_id: view.id }).total;
    return { views, counts, favorites: [...favoriteIds(ctx, "view")] };
  });
  return <WorkspaceViewsScreen views={data.views} counts={data.counts} favoriteIds={data.favorites} createOnOpen={query.create === "1"} />;
}

function ViewsSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading workspace views">
      <Skeleton height="var(--size-element-md)" width="36%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
      <Skeleton height="var(--size-element-lg)" index={3} />
    </VStack>
  );
}
