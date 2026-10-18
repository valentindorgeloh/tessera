import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ActiveCyclesScreen, type ActiveCycleSection } from "@/components/planning/ActiveCyclesScreen";
import { getActiveCycles, listProjects, readTessera } from "@/lib/tessera/server";

/**
 * `/active-cycles` (docs/drafts/p9-plan.md U2). Cycles whose dates include
 * today, from `getActiveCycles`, kept in project order and only for live
 * projects that still have cycles turned on.
 */
export default function ActiveCyclesPage() {
  return (
    <Suspense fallback={<ActiveCyclesSkeleton />}>
      <ActiveCyclesData />
    </Suspense>
  );
}

async function ActiveCyclesData() {
  await io();
  const sections = await readTessera((ctx) => {
    const projects = listProjects(ctx, {});
    const active = getActiveCycles(ctx);
    const today = ctx.today();
    const rows: ActiveCycleSection[] = [];
    for (const project of projects) {
      if (project.archived_at !== null || !project.cycles_enabled) continue;
      for (const cycle of active) {
        if (cycle.project_id !== project.id) continue;
        rows.push({
          project: { id: project.id, name: project.name, identifier: project.identifier, logo: project.logo ?? null },
          data: { cycle, pointsProgress: null, candidates: [], today },
        });
      }
    }
    return rows;
  });
  return <ActiveCyclesScreen sections={sections} />;
}

function ActiveCyclesSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading active cycles">
      <Skeleton height="var(--size-element-md)" width="40%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}
