import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { CrossProjectWorkList } from "@/app/(tessera)/work-items/cross-list";
import { RememberLabel } from "@/components/profile/RememberLabel";
import { IdSchema, STATIC_WORKSPACE_VIEWS, StaticViewKeySchema } from "@/lib/tessera/schemas";
import { getView, isFavorite, isTrackerError, readTessera, staticViewScope, staticViewSettingsId } from "@/lib/tessera/server";

type Props = {
  params: Promise<{ viewId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * One workspace view (docs/drafts/p9-plan.md U3). A static key opens the
 * virtual view. A saved view with a project redirects to that project.
 * Saved views are table-only and can be favourited.
 */
export default function WorkspaceViewPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ViewSkeleton />}>
      <ViewData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ViewData({ params, searchParams }: Props) {
  const [{ viewId }, query] = await Promise.all([params, searchParams]);
  await io();
  const staticKey = StaticViewKeySchema.safeParse(viewId);
  if (staticKey.success) {
    const spec = STATIC_WORKSPACE_VIEWS.find((view) => view.key === staticKey.data);
    if (!spec) notFound();
    return (
      <>
        <RememberLabel id={spec.key} label={spec.name} />
        <CrossProjectWorkList
          title={spec.name}
          scope={staticViewScope(spec.key)}
          settingsScope={{ scope_type: "workspace", scope_id: staticViewSettingsId(spec.key) }}
          query={query}
          forceTable
          showProjectColumn
        />
      </>
    );
  }
  if (!IdSchema.safeParse(viewId).success) notFound();
  let loaded: Awaited<ReturnType<typeof loadSaved>> | undefined;
  let missing = false;
  try {
    loaded = await loadSaved(viewId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) missing = true;
    else throw err;
  }
  if (missing || loaded === undefined) notFound();
  if (loaded.view.project_id !== null) return redirect(`/projects/${loaded.view.project_id}/views/${loaded.view.id}`);
  return (
    <CrossProjectWorkList
      title={loaded.view.name}
      scope={{ type: "view", view_id: loaded.view.id }}
      settingsScope={null}
      saved={{ filters: loaded.view.filters, display: loaded.view.display }}
      query={query}
      forceTable
      showProjectColumn
      view={loaded.view}
      isFavorite={loaded.isFavorite}
    />
  );
}

function loadSaved(viewId: string) {
  return readTessera((ctx) => ({ view: getView(ctx, viewId), isFavorite: isFavorite(ctx, "view", viewId) }));
}

function ViewSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading view">
      <Skeleton height="var(--size-element-md)" width="32%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}
