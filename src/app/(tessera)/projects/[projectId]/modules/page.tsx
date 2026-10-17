import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { ModulesScreen } from "@/components/planning/ModulesScreen";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, listModules, readTessera } from "@/lib/tessera/server";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Modules of a project (docs/contracts/ui.md "Routes and data loading"): one
 * read for the project (its `modules_enabled` toggle), the non-archived
 * modules in engine order and today's date. With modules turned off the page
 * shows `FeatureOffState` and skips the list. `?create=1` opens the create
 * dialog (Power K `n m`).
 */
export default function ModulesPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ModulesSkeleton />}>
      <ModulesData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ModulesData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const createOnOpen = query.create === "1";
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let data: Awaited<ReturnType<typeof loadModules>>;
  try {
    data = await loadModules(projectId);
  } catch (err) {
    // Pages render in parallel with their layout: a missing project lands here too.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data === null) return <FeatureOffState feature="modules" projectId={projectId} />;
  return <ModulesScreen projectId={projectId} modules={data.modules} today={data.today} createOnOpen={createOnOpen} />;
}

/** null when the project has modules turned off; the list is not read then. */
function loadModules(projectId: string) {
  return readTessera((ctx) => {
    const project = getProject(ctx, projectId);
    if (!project.modules_enabled) return null;
    return { modules: listModules(ctx, projectId, {}), today: ctx.today() };
  });
}

function ModulesSkeleton() {
  return (
    <VStack gap={3} padding={5}>
      <HStack gap={2} hAlign="between">
        <Skeleton width={120} height={28} />
        <Skeleton width={120} height={28} index={1} />
      </HStack>
      <Skeleton height={52} index={2} />
      <Skeleton height={52} index={3} />
      <Skeleton height={52} index={4} />
    </VStack>
  );
}
