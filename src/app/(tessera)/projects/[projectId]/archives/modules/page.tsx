import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ArchivedModules } from "@/components/planning/ArchivedModules";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, listModules, readTessera, type Module } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string }> };

/**
 * Archives › Modules (docs/contracts/ui.md "Archives (E3)"): the project's
 * archived modules with Restore and Delete. While modules are turned off for
 * the project the page shows the feature-off state and skips the list.
 */
export default function ArchivedModulesPage({ params }: Props) {
  return (
    <Suspense fallback={<RowsSkeleton />}>
      <ArchivedModulesData params={params} />
    </Suspense>
  );
}

async function ArchivedModulesData({ params }: Props) {
  const { projectId } = await params;
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let data: { enabled: boolean; modules: Module[] };
  try {
    data = await readTessera((ctx) => {
      const project = getProject(ctx, projectId);
      if (!project.modules_enabled) return { enabled: false, modules: [] };
      return { enabled: true, modules: listModules(ctx, project.id, { archived: true }) };
    });
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (!data.enabled) return <FeatureOffState feature="modules" projectId={projectId} />;
  return <ArchivedModules projectId={projectId} modules={data.modules} />;
}

function RowsSkeleton() {
  return (
    <VStack gap={2} paddingInline={5} paddingBlock={4}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
    </VStack>
  );
}
