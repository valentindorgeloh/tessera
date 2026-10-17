import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { pageSpaces } from "@/app/(tessera)/pages/load-page";
import { PagesScreen } from "@/components/pages/PagesScreen";
import { parsePageTab } from "@/components/pages/page-tree";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, listLabels, listPages, readTessera } from "@/lib/tessera/server";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Project Pages tab. The frame already shows the title, so this page adds none. */
export default function ProjectPagesPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<PagesFallback />}>
      <PagesData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function PagesData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const tab = parsePageTab(query.tab);
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(projectId, tab);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data.pages === null || data.labels === null || data.spaces === null) return <FeatureOffState feature="pages" projectId={projectId} />;
  return <PagesScreen space={{ kind: "project", project: data.project }} tab={tab} pages={data.pages} labels={data.labels} spaces={data.spaces} />;
}

function load(projectId: string, tab: ReturnType<typeof parsePageTab>) {
  return readTessera((ctx) => {
    const project = getProject(ctx, projectId);
    if (!project.pages_enabled) return { project, pages: null, labels: null, spaces: null };
    return {
      project,
      pages: listPages(ctx, { project_id: projectId, tab }),
      labels: listLabels(ctx, projectId),
      spaces: pageSpaces(ctx),
    };
  });
}

function PagesFallback() {
  return (
    <VStack gap={2} padding={4}>
      <Skeleton height={36} />
      <Skeleton height={36} index={1} />
      <Skeleton height={36} index={2} />
      <Skeleton height={36} index={3} />
      <Skeleton height={36} index={4} />
      <Skeleton height={36} index={5} />
    </VStack>
  );
}
