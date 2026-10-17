import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ArchivedProjects } from "@/components/planning/ArchivedProjects";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { listProjects, readTessera } from "@/lib/tessera/server";

/**
 * Archived projects at `/projects/archives` (docs/contracts/ui.md "Archives
 * (E3)"): a static segment next to `[projectId]`, so the project layout does
 * not wrap it and the list gets its data as props. A reading page like
 * `/projects`: the title in the panel header, the rows in the column under it.
 */
export default function ArchivedProjectsPage() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Archived projects">
          <PanelBar start={<PanelTitle>Archived projects</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={5} padding={6}>
        <Suspense fallback={<ProjectsSkeleton />}>
          <ArchivedProjectsData />
        </Suspense>
      </VStack>
    </PanelPage>
  );
}

async function ArchivedProjectsData() {
  await io();
  const projects = await readTessera((ctx) => listProjects(ctx, { archived: true }));
  return <ArchivedProjects projects={projects} />;
}

function ProjectsSkeleton() {
  return (
    <VStack gap={2}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
    </VStack>
  );
}
