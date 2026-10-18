import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ProfilePage } from "@/app/(tessera)/your-work/profile-page";
import { ProfileTabSchema } from "@/lib/tessera/schemas";
import { USER_ACTOR_ID } from "@/lib/tessera/server";

type Props = {
  params: Promise<{ tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** `/your-work/<tab>` (docs/drafts/p9-plan.md U3). */
export default function YourWorkTabPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <YourWorkData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function YourWorkData({ params, searchParams }: Props) {
  const [route, query] = await Promise.all([params, searchParams]);
  await io();
  const tab = ProfileTabSchema.safeParse(route.tab);
  if (!tab.success) notFound();
  return <ProfilePage actorId={USER_ACTOR_ID} tab={tab.data} query={query} basePath="/your-work" />;
}

function ProfileSkeleton() {
  return (
    <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading your work">
      <Skeleton height="var(--size-element-md)" width="40%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}
