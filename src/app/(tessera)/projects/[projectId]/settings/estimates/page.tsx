import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { EstimatesSettings } from "@/components/estimates/EstimatesSettings";
import { IdSchema } from "@/lib/tessera/schemas";
import { isTrackerError, listEstimates, readTessera } from "@/lib/tessera/server";
import type { EstimateView } from "@/lib/tessera/types";

type Props = { params: Promise<{ projectId: string }> };

/** `/projects/<id>/settings/estimates`. The project comes from the layout; this page loads every system, including archived ones. */
export default function EstimatesSettingsPage({ params }: Props) {
  return (
    <Suspense fallback={<EstimatesSkeleton />}>
      <EstimatesData params={params} />
    </Suspense>
  );
}

async function EstimatesData({ params }: Props) {
  const { projectId } = await params;
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let estimates: EstimateView[];
  try {
    estimates = await readTessera((ctx) => listEstimates(ctx, { project_id: projectId, include_archived: true }));
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  return <EstimatesSettings estimates={estimates} />;
}

function EstimatesSkeleton() {
  return (
    <VStack gap={2}>
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} height={36} index={index} />
      ))}
    </VStack>
  );
}
