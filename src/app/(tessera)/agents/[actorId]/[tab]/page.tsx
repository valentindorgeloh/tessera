import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ProfilePage } from "@/app/(tessera)/your-work/profile-page";
import { IdSchema, ProfileTabSchema } from "@/lib/tessera/schemas";
import { USER_ACTOR_ID } from "@/lib/tessera/server";

type Props = {
  params: Promise<{ actorId: string; tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The user id is known from the URL, so the redirect blocks instead of prerendering. */
export const instant = false;

/** `/agents/<id>/<tab>` (docs/drafts/p9-plan.md U3). The user id redirects to Your work. */
export default async function AgentTabPage({ params, searchParams }: Props) {
  const route = await params;
  const tab = ProfileTabSchema.safeParse(route.tab);
  // Before the suspended read, so the redirect is the response rather than a render error.
  if (route.actorId === USER_ACTOR_ID) {
    if (!tab.success) notFound();
    redirect(`/your-work/${tab.data}`);
  }
  return (
    <Suspense fallback={<AgentSkeleton />}>
      <AgentData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AgentData({ params, searchParams }: Props) {
  const [route, query] = await Promise.all([params, searchParams]);
  await io();
  if (!IdSchema.safeParse(route.actorId).success) notFound();
  const tab = ProfileTabSchema.safeParse(route.tab);
  if (!tab.success) notFound();
  return <ProfilePage actorId={route.actorId} tab={tab.data} query={query} basePath={`/agents/${route.actorId}`} />;
}

function AgentSkeleton() {
  return (
    <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading agent">
      <Skeleton height="var(--size-element-md)" width="40%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}
