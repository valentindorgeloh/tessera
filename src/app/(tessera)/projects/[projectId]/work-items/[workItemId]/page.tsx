import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { DetailPage } from "@/app/(tessera)/work-items/DetailPage";
import { loadWorkItemDetail } from "@/app/(tessera)/work-items/load-detail";
import { isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ projectId: string; workItemId: string }> };

/** Full work item page inside the project frame (docs/contracts/ui.md "Routes and modes"). */
export default function WorkItemPage({ params }: Props) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <WorkItemData params={params} />
    </Suspense>
  );
}

async function WorkItemData({ params }: Props) {
  const { projectId, workItemId } = await params;
  await io();
  let data: Awaited<ReturnType<typeof loadDetail>>;
  try {
    data = await loadDetail(workItemId);
  } catch (err) {
    // The project's not-found boundary renders inside the frame.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  // An item of another project is not reachable under this project's URL.
  if (data.item.project_id !== projectId) notFound();
  return <DetailPage data={data} scope="project" />;
}

function loadDetail(workItemId: string) {
  return readTessera((ctx) => loadWorkItemDetail(ctx, workItemId));
}

function DetailSkeleton() {
  return (
    <VStack gap={3} padding={6} className="tessera-wi-detail">
      <Skeleton width={96} height={20} />
      <Skeleton width="70%" height={36} index={1} />
      <Skeleton height={120} index={2} />
    </VStack>
  );
}
