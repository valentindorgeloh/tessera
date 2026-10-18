import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { AgentsScreen } from "@/components/profile/AgentsScreen";
import { listAgentProfiles, readTessera } from "@/lib/tessera/server";

/** `/agents` (docs/drafts/p9-plan.md U3). */
export default function AgentsPage() {
  return (
    <Suspense fallback={<AgentsSkeleton />}>
      <AgentsData />
    </Suspense>
  );
}

async function AgentsData() {
  await io();
  const rows = await readTessera((ctx) => listAgentProfiles(ctx));
  return <AgentsScreen rows={rows} />;
}

function AgentsSkeleton() {
  return (
    <VStack gap={3} padding={4} aria-busy="true" aria-label="Loading agents">
      <Skeleton height="var(--size-element-md)" width="30%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height="var(--size-element-lg)" index={2} />
    </VStack>
  );
}
