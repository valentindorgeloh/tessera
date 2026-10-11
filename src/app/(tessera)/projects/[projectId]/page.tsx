import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { getProject, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string }> };

/**
 * Project index: `/projects/<id>` has no screen of its own and lands on the
 * work items. The route exists so that an unknown project id renders the
 * Tessera not-found screen; without a page here the router has nothing to
 * match and serves Next's bare 404. Pages render in parallel with their
 * layout, so the project is checked here too and a missing one calls
 * `notFound()` instead of redirecting to another missing page.
 */
export default function ProjectIndexPage({ params }: Props) {
  return (
    <Suspense fallback={<IndexSkeleton />}>
      <ProjectRedirect params={params} />
    </Suspense>
  );
}

async function ProjectRedirect({ params }: Props) {
  const { projectId } = await params;
  await io();
  let id: string;
  try {
    id = (await readTessera((ctx) => getProject(ctx, projectId))).id;
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  return redirect(`/projects/${id}/work-items`);
}

function IndexSkeleton() {
  return (
    <VStack gap={3} padding={5}>
      <Skeleton width="60%" height={32} />
      <Skeleton height={36} index={1} />
      <Skeleton height={36} index={2} />
    </VStack>
  );
}
