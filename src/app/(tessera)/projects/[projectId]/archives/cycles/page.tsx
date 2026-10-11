import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ArchivedCycles } from "@/components/planning/ArchivedCycles";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, listCycles, readTessera, type Cycle } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string }> };

/**
 * Archives › Cycles (docs/contracts/ui.md "Archives (E3)"): the project's
 * archived cycles with Restore and Delete. While cycles are turned off for
 * the project the page shows the feature-off state and skips the list.
 */
export default function ArchivedCyclesPage({ params }: Props) {
  return (
    <Suspense fallback={<RowsSkeleton />}>
      <ArchivedCyclesData params={params} />
    </Suspense>
  );
}

async function ArchivedCyclesData({ params }: Props) {
  const { projectId } = await params;
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let data: { enabled: boolean; cycles: Cycle[] };
  try {
    data = await readTessera((ctx) => {
      const project = getProject(ctx, projectId);
      if (!project.cycles_enabled) return { enabled: false, cycles: [] };
      return { enabled: true, cycles: listCycles(ctx, project.id, { archived: true }) };
    });
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (!data.enabled) return <FeatureOffState feature="cycles" />;
  return <ArchivedCycles projectId={projectId} cycles={data.cycles} />;
}

function RowsSkeleton() {
  return (
    <VStack gap={2} paddingInline={5} paddingBlock={4}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
    </VStack>
  );
}
