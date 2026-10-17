import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { loadPageBundle, pageSpaces } from "@/app/(tessera)/pages/load-page";
import { PageScreen } from "@/components/pages/PageScreen";
import { pageHref } from "@/components/pages/page-tree";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string; pageId: string }> };

/** A project page. A page from another space redirects to its own route. */
export default function ProjectPageScreen({ params }: Props) {
  return (
    <Suspense fallback={<PageFallback />}>
      <PageData params={params} />
    </Suspense>
  );
}

async function PageData({ params }: Props) {
  const { projectId, pageId } = await params;
  await io();
  if (!IdSchema.safeParse(projectId).success || !IdSchema.safeParse(pageId).success) notFound();
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(projectId, pageId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data.bundle.page.project_id !== projectId) redirect(pageHref(data.bundle.page));
  if (!data.project.pages_enabled) return <FeatureOffState feature="pages" projectId={projectId} />;
  return (
    <PageScreen
      page={data.bundle.page}
      labels={data.bundle.labels}
      actors={data.bundle.actors}
      spaces={data.spaces}
      space={{ kind: "project", name: data.project.name, archived: data.project.archived_at !== null }}
    />
  );
}

function load(projectId: string, pageId: string) {
  return readTessera((ctx) => ({
    project: getProject(ctx, projectId),
    bundle: loadPageBundle(ctx, pageId),
    spaces: pageSpaces(ctx),
  }));
}

function PageFallback() {
  return (
    <VStack gap={4} padding={5}>
      <Skeleton width={240} height={28} />
      <Skeleton width={180} height={20} index={1} />
      <Skeleton height={32} index={2} />
      <Skeleton height={160} index={3} />
    </VStack>
  );
}
