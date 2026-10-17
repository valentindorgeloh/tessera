import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { CycleDetailScreen } from "@/components/planning/CycleDetailScreen";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { currentDigestSeq, getProject, getStoredDigest, isTrackerError, readTessera } from "@/lib/tessera/server";
import { ListSkeleton, ScopedWorkItems } from "@/app/(tessera)/projects/[projectId]/work-items/scoped-list";
import { loadCycleDetail } from "@/app/(tessera)/projects/[projectId]/cycles/cycle-data";

type Props = {
  params: Promise<{ projectId: string; cycleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Grouping by cycle means nothing inside one cycle. */
const HIDDEN_GROUP_FIELDS = ["cycle"] as const;

/**
 * One cycle (docs/contracts/ui.md "Routes and data loading"): the cycle with
 * its progress (points too with an active estimate), the "Add existing"
 * candidates and any stored digest in one read, then the scoped work items
 * list streamed in below the header. A cycle of another project is not found
 * here; a project with cycles turned off shows the feature-off state.
 */
export default function CyclePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<CycleSkeleton />}>
      <CycleData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CycleData({ params, searchParams }: Props) {
  const [{ projectId, cycleId }, query] = await Promise.all([params, searchParams]);
  await io();
  if (!IdSchema.safeParse(projectId).success || !IdSchema.safeParse(cycleId).success) notFound();
  let data: Awaited<ReturnType<typeof loadCycle>>;
  try {
    data = await loadCycle(projectId, cycleId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data === null) return <FeatureOffState feature="cycles" projectId={projectId} />;
  if (data.detail.cycle.project_id !== projectId) notFound();
  const takesItems = data.detail.cycle.archived_at === null && data.detail.cycle.status !== "completed";
  return (
    <CycleDetailScreen projectId={projectId} data={data.detail} digest={data.digest}>
      <Suspense fallback={<ListSkeleton />}>
        <ScopedWorkItems
          projectId={projectId}
          scope={{ type: "cycle", cycle_id: cycleId }}
          settingsScope={{ scope_type: "cycle", scope_id: cycleId }}
          query={query}
          scopeDefaults={{ cycle_id: cycleId }}
          canCreate={takesItems}
          hiddenGroupFields={HIDDEN_GROUP_FIELDS}
        />
      </Suspense>
    </CycleDetailScreen>
  );
}

function loadCycle(projectId: string, cycleId: string) {
  return readTessera((ctx) => {
    const project = getProject(ctx, projectId);
    if (!project.cycles_enabled) return null;
    const detail = loadCycleDetail(ctx, project, cycleId, true);
    const stored = getStoredDigest(ctx, "cycle", cycleId);
    const seq = currentDigestSeq(ctx, "cycle", cycleId);
    return { detail, digest: stored === null ? null : { ...stored, is_stale: seq > stored.input_seq } };
  });
}

function CycleSkeleton() {
  return (
    <VStack gap={4} padding={5}>
      <HStack gap={3} hAlign="between">
        <Skeleton width={240} height={28} />
        <Skeleton width={160} height={28} index={1} />
      </HStack>
      <Skeleton width={180} height={20} index={2} />
      <Skeleton height={36} index={3} />
      <Skeleton height={36} index={4} />
      <Skeleton height={36} index={5} />
    </VStack>
  );
}
