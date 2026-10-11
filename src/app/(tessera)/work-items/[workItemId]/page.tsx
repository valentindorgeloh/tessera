import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ProjectProvider } from "@/components/work-items/project-provider";
import { isTrackerError, readTessera } from "@/lib/tessera/server";
import { DetailPage } from "../DetailPage";
import { loadProjectBundle, loadWorkItemDetail } from "../load-detail";

type Props = { params: Promise<{ workItemId: string }> };

/**
 * Global work item page (docs/contracts/ui.md "Routes and modes"): the
 * detail outside the project frame, reachable from search, links and the
 * tab bar. It loads its own project bundle, so the property controls work
 * exactly as they do under `/projects/[projectId]/...`.
 */
export default function GlobalWorkItemPage({ params }: Props) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <WorkItemData params={params} />
    </Suspense>
  );
}

async function WorkItemData({ params }: Props) {
  const { workItemId } = await params;
  await io();
  let data: Awaited<ReturnType<typeof loadDetail>>;
  try {
    data = await loadDetail(workItemId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  return (
    <ProjectProvider bundle={data.bundle}>
      <DetailPage data={data.detail} scope="global" />
    </ProjectProvider>
  );
}

/** One read for the item and its project's bundle. */
function loadDetail(workItemId: string) {
  return readTessera((ctx) => {
    const detail = loadWorkItemDetail(ctx, workItemId);
    return { detail, bundle: loadProjectBundle(ctx, detail.item.project_id) };
  });
}

function DetailSkeleton() {
  return (
    <VStack gap={3} padding={5}>
      <Skeleton width={240} height={20} />
      <Skeleton width="70%" height={36} index={1} />
      <Skeleton height={120} index={2} />
    </VStack>
  );
}
