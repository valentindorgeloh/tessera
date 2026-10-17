import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { ListSkeleton } from "@/app/(tessera)/projects/[projectId]/work-items/scoped-list";
import { FeatureOffState } from "@/components/planning/FeatureOffState";
import { IdSchema } from "@/lib/tessera/schemas";
import { getProject, getView, isTrackerError, readTessera } from "@/lib/tessera/server";
import { ViewWorkItems } from "./view-list";

type Props = {
  params: Promise<{ projectId: string; viewId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * One saved view (docs/drafts/p4-ui.md "View page"): the view row is read
 * first (a view of another project is not found; a project with views turned
 * off shows the feature-off state), then the work items list streams in below
 * it. Unsaved changes live in the URL's `q` (decision 32).
 */
export default function ViewPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ViewData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ViewData({ params, searchParams }: Props) {
  const [{ projectId, viewId }, query] = await Promise.all([params, searchParams]);
  await io();
  if (!IdSchema.safeParse(projectId).success || !IdSchema.safeParse(viewId).success) notFound();
  let data: Awaited<ReturnType<typeof loadView>>;
  try {
    data = await loadView(projectId, viewId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data === null) return <FeatureOffState feature="views" projectId={projectId} />;
  if (data.view.project_id !== projectId) notFound();
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ViewWorkItems projectId={projectId} view={data.view} query={query} />
    </Suspense>
  );
}

function loadView(projectId: string, viewId: string) {
  return readTessera((ctx) => {
    const project = getProject(ctx, projectId);
    if (!project.views_enabled) return null;
    return { view: getView(ctx, viewId) };
  });
}
