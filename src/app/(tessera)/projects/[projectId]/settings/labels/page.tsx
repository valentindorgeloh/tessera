import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { LabelsSettings } from "@/components/project-settings/LabelsSettings";
import { IdSchema } from "@/lib/tessera/schemas";
import { getTaxonomyUsage, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string }> };

/**
 * `/projects/<id>/settings/labels` (docs/drafts/p4-ui.md "Routes and data
 * loading"): one read, the work items per label (`getTaxonomyUsage`, archived
 * and triage items included) for the delete confirmations. The labels
 * themselves come from the project bundle.
 */
export default function LabelsSettingsPage({ params }: Props) {
  return (
    <Suspense fallback={<LabelsSkeleton />}>
      <LabelsData params={params} />
    </Suspense>
  );
}

async function LabelsData({ params }: Props) {
  const { projectId } = await params;
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let usage: Record<string, number>;
  try {
    usage = (await readTessera((ctx) => getTaxonomyUsage(ctx, projectId))).labels;
  } catch (err) {
    // Pages render in parallel with their layout: a missing project lands here too.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  return <LabelsSettings usage={usage} />;
}

function LabelsSkeleton() {
  return (
    <VStack gap={2}>
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} height={36} index={index} />
      ))}
    </VStack>
  );
}
