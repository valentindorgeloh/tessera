import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, listPages, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string }> };

/** Project pages tab. The frame already shows the title, so this page is only the tree. */
export default function ProjectPagesPage({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton height={36} />}>
      <PagesData params={params} />
    </Suspense>
  );
}

async function PagesData({ params }: Props) {
  const { projectId } = await params;
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let project;
  try {
    project = await readTessera((ctx) => getProject(ctx, projectId));
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (!project.pages_enabled) return <FeatureOffState feature="pages" projectId={projectId} />;
  const pages = await readTessera((ctx) => listPages(ctx, { project_id: projectId }));
  return (
    <VStack gap={4} padding={4}>
      <List density="compact" aria-label="Pages">
        {pages.map((item) => (
          <ListItem key={item.id} label={item.name} href={`/projects/${projectId}/pages/${item.id}`} />
        ))}
      </List>
    </VStack>
  );
}
