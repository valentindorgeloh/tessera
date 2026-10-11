import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ArchivedProjects } from "@/components/planning/ArchivedProjects";
import { listProjects, readTessera } from "@/lib/tessera/server";

/**
 * Archived projects at `/projects/archives` (docs/contracts/ui.md "Archives
 * (E3)"): a static segment next to `[projectId]`, so the project layout does
 * not wrap it and the list gets its data as props.
 */
export default function ArchivedProjectsPage() {
  return (
    <VStack padding={6} className="tessera-archives-page">
      <Suspense fallback={<ProjectsSkeleton />}>
        <ArchivedProjectsData />
      </Suspense>
    </VStack>
  );
}

async function ArchivedProjectsData() {
  await io();
  const projects = await readTessera((ctx) => listProjects(ctx, { archived: true }));
  return <ArchivedProjects projects={projects} />;
}

function ProjectsSkeleton() {
  return (
    <VStack gap={5}>
      <Skeleton width={240} height={32} />
      <VStack gap={2}>
        <Skeleton height={44} index={1} />
        <Skeleton height={44} index={2} />
      </VStack>
    </VStack>
  );
}
