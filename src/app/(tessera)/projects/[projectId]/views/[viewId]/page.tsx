import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { lookupScoped } from "@/app/(tessera)/projects/[projectId]/scope-lookup";
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
 * first, before the feature toggle (../../scope-lookup.ts): an unknown, deleted
 * or foreign view is not found whether views are on or off, so the shell never
 * records it as a recent; only a real view of a project with views turned off
 * shows the feature-off state. The work items list then streams in below it. Unsaved changes live in the URL's `q` (decision 32).
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
  if (data.kind === "missing") notFound();
  if (data.kind === "feature_off") return <FeatureOffState feature="views" projectId={projectId} />;
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ViewWorkItems projectId={projectId} view={data.value} query={query} />
    </Suspense>
  );
}

function loadView(projectId: string, viewId: string) {
  return readTessera((ctx) =>
    lookupScoped(getProject(ctx, projectId), {
      isEnabled: (project) => project.views_enabled,
      load: () => getView(ctx, viewId),
      projectIdOf: (view) => view.project_id,
    }),
  );
}
