import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { CrossProjectWorkList } from "@/app/(tessera)/work-items/cross-list";
import { ProfileActivity } from "@/components/profile/ProfileActivity";
import { ProfileScreen } from "@/components/profile/ProfileScreen";
import { ProfileSummary } from "@/components/profile/ProfileSummary";
import { TAB_LABELS } from "@/components/profile/profile-format";
import { getProfileSummary, isTrackerError, listActivity, readTessera } from "@/lib/tessera/server";
import type { ActivityLogEntry, ProfileTab } from "@/lib/tessera/types";

/** Newest rows on one activity page. One extra is not requested: a full page offers Load more. */
const ACTIVITY_LIMIT = 50;

type Query = Record<string, string | string[] | undefined>;

export type ProfilePageProps = {
  actorId: string;
  tab: ProfileTab;
  query: Query;
  /** `/your-work` or `/agents/<id>`. */
  basePath: string;
};

function beforeSeq(query: Query): number | undefined {
  const raw = query.before;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Shared body of `/your-work/<tab>` and `/agents/<id>/<tab>`
 * (docs/drafts/p9-plan.md U3). Summary reads `getProfileSummary`. Work tabs
 * use the profile list. Activity pages with `?before`.
 */
export async function ProfilePage({ actorId, tab, query, basePath }: ProfilePageProps) {
  const before = beforeSeq(query);
  await io();
  let loaded: { summary: Awaited<ReturnType<typeof getProfileSummary>>; activity: ActivityLogEntry[] } | undefined;
  let missing = false;
  try {
    loaded = await readTessera((ctx) => {
      const summary = getProfileSummary(ctx, { actor_id: actorId });
      const activity =
        tab === "activity"
          ? listActivity(ctx, before === undefined ? { actor_id: actorId, limit: ACTIVITY_LIMIT } : { actor_id: actorId, limit: ACTIVITY_LIMIT, before_seq: before })
          : [];
      return { summary, activity };
    });
  } catch (err) {
    if (isTrackerError(err) && err.code === "NOT_FOUND") missing = true;
    else throw err;
  }
  if (missing || loaded === undefined) notFound();
  const activityBase = `${basePath}/activity`;
  const oldest = loaded.activity[0]?.seq;
  const workTab = tab === "assigned" || tab === "created" || tab === "subscribed" ? tab : null;
  return (
    <ProfileScreen actor={loaded.summary.actor} tab={tab} basePath={basePath}>
      {tab === "summary" ? <ProfileSummary summary={loaded.summary} /> : null}
      {tab === "activity" ? (
        <ProfileActivity
          entries={loaded.activity}
          olderHref={loaded.activity.length >= ACTIVITY_LIMIT && oldest !== undefined ? `${activityBase}?before=${oldest}` : null}
          newerHref={before === undefined ? null : activityBase}
        />
      ) : null}
      {workTab ? (
        <Suspense fallback={<WorkListSkeleton />}>
          <CrossProjectWorkList
            title={TAB_LABELS[workTab]}
            scope={{ type: "profile", actor_id: actorId, tab: workTab }}
            settingsScope={{ scope_type: "profile", scope_id: actorId }}
            query={query}
          />
        </Suspense>
      ) : null}
    </ProfileScreen>
  );
}

function WorkListSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading work items">
      <Skeleton height="var(--size-element-md)" width="28%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}
