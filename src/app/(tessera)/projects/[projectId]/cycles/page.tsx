import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { CyclesScreen } from "@/components/planning/CyclesScreen";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import type { CycleDetailData } from "@/components/planning/types";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, listCycles, readTessera } from "@/lib/tessera/server";
import { loadCycleDetail } from "@/app/(tessera)/projects/[projectId]/cycles/cycle-data";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Cycles of a project (docs/contracts/ui.md "Routes and data loading"): the
 * non-archived cycles in engine order and, for the current one, its full
 * progress (points too with an active estimate) for the summary card. A
 * project with cycles turned off shows the feature-off state instead.
 * `?create=1` opens the create dialog.
 */
export default function CyclesPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<CyclesSkeleton />}>
      <CyclesData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CyclesData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const createOnOpen = query.create === "1";
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let data: Awaited<ReturnType<typeof loadCycles>>;
  try {
    data = await loadCycles(projectId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data === null) return <FeatureOffState feature="cycles" />;
  return <CyclesScreen projectId={projectId} cycles={data.cycles} active={data.active} today={data.today} createOnOpen={createOnOpen} />;
}

function loadCycles(projectId: string) {
  return readTessera((ctx) => {
    const project = getProject(ctx, projectId);
    if (!project.cycles_enabled) return null;
    const cycles = listCycles(ctx, projectId, {});
    const current = cycles.find((cycle) => cycle.status === "current");
    const active: CycleDetailData | null = current ? loadCycleDetail(ctx, project, current.id, false) : null;
    return { cycles, active, today: ctx.today() };
  });
}

function CyclesSkeleton() {
  return (
    <VStack gap={4} padding={5}>
      <HStack gap={3} hAlign="between">
        <Skeleton width={120} height={28} />
        <Skeleton width={112} height={28} index={1} />
      </HStack>
      <Skeleton height={200} index={2} />
      <Skeleton height={48} index={3} />
      <Skeleton height={48} index={4} />
      <Skeleton height={48} index={5} />
    </VStack>
  );
}
