import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { getWorkItemByKey, IdSchema, isTrackerError, parseKey, readTessera, type WorkItemDetail } from "@/lib/tessera/server";

type Props = { params: Promise<{ key: string }> };

/**
 * `/browse/[key]` (docs/contracts/ui.md "Routes and modes"): a human key
 * such as `WEB-1` (any case) or an item id lands on the item's full page in
 * its project. Anything that is neither a key nor an id, and any key or id
 * the engine does not know, renders the Tessera not-found screen.
 */
export default function BrowsePage({ params }: Props) {
  return (
    <Suspense fallback={<BrowseSkeleton />}>
      <BrowseData params={params} />
    </Suspense>
  );
}

async function BrowseData({ params }: Props) {
  const { key } = await params;
  await io();
  if (parseKey(key) === null && !IdSchema.safeParse(key).success) notFound();
  let item: WorkItemDetail;
  try {
    item = await readTessera((ctx) => getWorkItemByKey(ctx, key));
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  // redirect() throws, so it stays outside the try.
  return redirect(`/projects/${item.project_id}/work-items/${item.id}`);
}

function BrowseSkeleton() {
  return (
    <VStack gap={3} padding={5}>
      <Skeleton width={240} height={20} />
      <Skeleton width="70%" height={36} index={1} />
      <Skeleton height={120} index={2} />
    </VStack>
  );
}
