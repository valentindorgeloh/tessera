import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { loadWorkItemDetail } from "@/app/(tessera)/work-items/load-detail";
import { IntakeDetail } from "@/components/intake/IntakeDetail";
import { nextOpenItem, parseIntakeQuery } from "@/components/intake/intake-format";
import { IntakeScreen } from "@/components/intake/IntakeScreen";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { getIntakeItemForWorkItem, getProject, isTrackerError, listIntakeItems, readTessera } from "@/lib/tessera/server";
import type { IntakeItemView, IntakeListResult } from "@/lib/tessera/types";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/projects/<id>/intake`. The list and the selected item each stream under their own Suspense boundary. */
export default function IntakePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<IntakeSkeleton />}>
      <IntakeList params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function IntakeList({ params, searchParams }: Props) {
  const [{ projectId }, raw] = await Promise.all([params, searchParams]);
  const query = parseIntakeQuery(raw);
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let loaded: { enabled: false } | { enabled: true; list: IntakeListResult } | "missing";
  try {
    loaded = await readTessera((ctx) => {
      const project = getProject(ctx, projectId);
      if (!project.intake_enabled) return { enabled: false as const };
      return {
        enabled: true as const,
        list: listIntakeItems(ctx, { project_id: projectId, tab: query.tab, search: query.q === "" ? undefined : query.q }),
      };
    });
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) loaded = "missing";
    else throw err;
  }
  if (loaded === "missing") notFound();
  if (!loaded.enabled) return <FeatureOffState feature="intake" projectId={projectId} />;
  const openIds = query.tab === "open" ? loaded.list.items.map((item) => item.work_item_id) : [];
  return (
    <IntakeScreen projectId={projectId} query={query} items={loaded.list.items} counts={loaded.list.counts}>
      <Suspense fallback={<DetailSkeleton />}>
        <SelectedItem projectId={projectId} itemId={query.item} query={query} openIds={openIds} />
      </Suspense>
    </IntakeScreen>
  );
}

async function SelectedItem({
  projectId,
  itemId,
  query,
  openIds,
}: {
  projectId: string;
  itemId: string | null;
  query: ReturnType<typeof parseIntakeQuery>;
  openIds: readonly string[];
}) {
  if (itemId === null) return null;
  await io();
  let loaded: { view: IntakeItemView; detail: ReturnType<typeof loadWorkItemDetail> } | null;
  try {
    loaded = await readTessera((ctx) => {
      const view = getIntakeItemForWorkItem(ctx, itemId);
      if (!view) return null;
      return { view, detail: loadWorkItemDetail(ctx, itemId) };
    });
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) loaded = null;
    else throw err;
  }
  if (loaded === null || loaded.detail.item.project_id !== projectId) return <EmptyState title="This intake item is gone" headingLevel={2} />;
  return <IntakeDetail view={loaded.view} detail={loaded.detail} query={query} nextItemId={nextOpenItem(openIds, itemId)} />;
}

function IntakeSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading intake">
      <Skeleton height="var(--size-element-md)" width="40%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}

function DetailSkeleton() {
  return (
    <VStack gap={3} padding={6} aria-busy="true" aria-label="Loading intake item">
      <Skeleton width={96} height={20} />
      <Skeleton width="70%" height={36} index={1} />
    </VStack>
  );
}
