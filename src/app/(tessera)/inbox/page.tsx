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
import { getStoredDigest, isTrackerError, listNotifications, readTessera } from "@/lib/tessera/server";
import type { DigestView } from "@/lib/tessera/types";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * `instant = false`: this page keeps no Suspense boundary of its own and
 * blocks (decision 156). A client navigation keeps the old page on screen
 * until this one is ready, so React never commits a skeleton and holds the
 * content for 300 ms, and a full load sends the page in the first HTML flush
 * instead of a streamed segment. The opt-out allows the blocking route and
 * turns off dev validation of instant navigation for this segment
 * (`02-route-segment-config/instant.md`).
 */
export const instant = false;

/**
 * Inbox at `/inbox` (docs/drafts/p7-plan.md §5). The list blocks (it comes in
 * the first HTML flush) and the selected item streams under its own Suspense
 * boundary.
 *
 * The list is the caller's notifications. Opening `?item=` loads that work item.
 * A stored inbox digest is read here and never generated; Summarise and
 * Refresh live on the card and post to `/api/ai/digest`.
 */
export default function InboxPage({ searchParams }: Props) {
  return <InboxList searchParams={searchParams} />;
}

async function InboxList({ searchParams }: Props) {
  const params = await searchParams;
  await io();
  const query = parseInboxQuery(params);
  const inbox: { notifications: InboxNote[]; digest: DigestView | null; actorId: string } = await readTessera((ctx) => ({
    notifications: listNotifications(ctx, { limit: 200 }),
    digest: getStoredDigest(ctx, "inbox", ctx.actor.id),
    actorId: ctx.actor.id,
  }));
  return (
    <InboxScreen query={query} notifications={inbox.notifications} digest={inbox.digest} actorId={inbox.actorId}>
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

function DetailSkeleton() {
  return (
    <VStack gap={3} padding={6} aria-busy="true" aria-label="Loading work item">
      <Skeleton width={96} height={20} />
      <Skeleton width="70%" height={36} index={1} />
      <Skeleton height={120} index={2} />
    </VStack>
  );
}
