import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { PeekHost } from "@/components/detail/PeekHost";
import { ArchivedWorkItems } from "@/components/planning/ArchivedWorkItems";
import { IdSchema } from "@/lib/tessera/schemas";
import { isTrackerError, listWorkItems, readTessera, type WorkItem } from "@/lib/tessera/server";
import { loadPeek } from "../../work-items/scoped-list";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** At most this many archived items are listed (the project list's limit); filters and paging arrive with views in P4. */
const LIMIT = 2000;

/**
 * Archives › Work items (docs/contracts/ui.md "Archives (E3)"): the project's
 * archived work items, last updated first, with Restore and Delete per row.
 * Rows open the peek (`?peek=<id>`), which shows the archived Banner and its
 * own Restore.
 */
export default function ArchivedWorkItemsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<RowsSkeleton />}>
      <ArchivedWorkItemsData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ArchivedWorkItemsData({ params, searchParams }: Props) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  await io();
  if (!IdSchema.safeParse(projectId).success) notFound();
  let items: WorkItem[];
  try {
    items = await readTessera(
      (ctx) => listWorkItems(ctx, { scope: { type: "archived", project_id: projectId }, display: { order_by: "-updated_at" }, limit: LIMIT }).items,
    );
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  const peekId = typeof query.peek === "string" && query.peek !== "" ? query.peek : null;
  const peek = peekId === null ? null : await loadPeek(projectId, peekId);
  return (
    <PeekHost projectId={projectId} peek={peek}>
      <ArchivedWorkItems projectId={projectId} items={items} />
    </PeekHost>
  );
}

function RowsSkeleton() {
  return (
    <VStack gap={2} paddingInline={5} paddingBlock={4}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
      <Skeleton height={44} index={2} />
    </VStack>
  );
}
