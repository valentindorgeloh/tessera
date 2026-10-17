import { Suspense } from "react";
import { io } from "next/cache";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { DetailPage } from "@/app/(tessera)/work-items/DetailPage";
import { loadProjectBundle, loadWorkItemDetail } from "@/app/(tessera)/work-items/load-detail";
import { InboxScreen } from "@/components/inbox/InboxScreen";
import { parseInboxQuery, type InboxNote } from "@/components/inbox/inbox-format";
import { ProjectProvider } from "@/components/work-items/project-provider";
import { isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Inbox at `/inbox` (docs/drafts/p7-plan.md §5). The list and the selected
 * item each stream under their own Suspense boundary.
 *
 * ASSUMPTION: `listNotifications` is not exported, so the list is empty until
 * `notifications.ts` lands. Opening `?item=` still loads that work item.
 */
export default function InboxPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxList searchParams={searchParams} />
    </Suspense>
  );
}

async function InboxList({ searchParams }: Props) {
  const params = await searchParams;
  await io();
  const query = parseInboxQuery(params);
  // ASSUMPTION: listNotifications(ctx, { tab, unread_only, limit: 200 }) is not exported yet.
  const notifications: InboxNote[] = [];
  return (
    <InboxScreen query={query} notifications={notifications}>
      <Suspense fallback={<DetailSkeleton />}>
        <InboxItem itemId={query.item} />
      </Suspense>
    </InboxScreen>
  );
}

async function InboxItem({ itemId }: { itemId: string | null }) {
  if (itemId === null) return null;
  await io();
  let loaded: { data: ReturnType<typeof loadWorkItemDetail>; bundle: ReturnType<typeof loadProjectBundle> } | "missing";
  try {
    loaded = await readTessera((ctx) => {
      const data = loadWorkItemDetail(ctx, itemId);
      return { data, bundle: loadProjectBundle(ctx, data.item.project_id) };
    });
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) loaded = "missing";
    else throw err;
  }
  if (loaded === "missing") return <EmptyState title="This work item was deleted" headingLevel={2} />;
  return (
    <ProjectProvider bundle={loaded.bundle}>
      <DetailPage data={loaded.data} scope="global" />
    </ProjectProvider>
  );
}

function InboxSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading inbox">
      <Skeleton height="var(--size-element-md)" width="40%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}

function DetailSkeleton() {
  return (
    <VStack gap={3} padding={6} aria-busy="true" aria-label="Loading work item">
      <Skeleton width={96} height={20} />
      <Skeleton width="70%" height={36} index={1} />
      <Skeleton height={120} index={2} />
    </VStack>
  );
}
