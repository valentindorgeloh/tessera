import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { getWorkItem, isTrackerError, readTessera, type WorkItemDetail } from "@/lib/tessera/server";
import { QuickDetail } from "./QuickDetail";

type Props = { params: Promise<{ projectId: string; workItemId: string }> };

/** Minimal work item page (P2a); lane D replaces it with the full detail and peek panel in P2b. */
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
  let item: WorkItemDetail;
  try {
    item = await readTessera((ctx) => getWorkItem(ctx, workItemId));
  } catch (err) {
    // The project's not-found boundary renders inside the frame.
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  // An item of another project is not reachable under this project's URL.
  if (item.project_id !== projectId) notFound();
  return <QuickDetail item={item} />;
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
