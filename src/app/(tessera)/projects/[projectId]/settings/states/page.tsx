import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { StatesSettings } from "@/components/project-settings/StatesSettings";
import { IdSchema } from "@/lib/tessera/schemas";
import { getTaxonomyUsage, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string }> };

/**
 * `/projects/<id>/settings/states` (docs/drafts/p4-ui.md "Routes and data
 * loading"): one read, the work items per state (`getTaxonomyUsage`, archived
 * and triage items included) for the delete confirmations. The states
 * themselves come from the project bundle.
 */
export default function StatesSettingsPage({ params }: Props) {
  return (
    <Suspense fallback={<StatesSkeleton />}>
      <StatesData params={params} />
    </Suspense>
  );
}

async function StatesData({ params }: Props) {
  const { projectId } = await params;
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let usage: Record<string, number>;
  try {
    usage = (await readTessera((ctx) => getTaxonomyUsage(ctx, projectId))).states;
  } catch (err) {
    // Pages render in parallel with their layout: a missing project lands here too.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  return <StatesSettings usage={usage} />;
}

function StatesSkeleton() {
  return (
    <VStack gap={2}>
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} height={36} index={index} />
      ))}
    </VStack>
  );
}
