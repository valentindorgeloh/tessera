import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { IdSchema } from "@/lib/tessera/schemas";

type Props = { params: Promise<{ actorId: string }> };

/**
 * `/agents/<id>` opens the summary tab. The params read sits under Suspense
 * (same shape as the project settings index), so `next build` can prerender
 * the shell.
 */
export default function AgentIndexPage({ params }: Props) {
  return (
    <Suspense fallback={<IndexSkeleton />}>
      <AgentRedirect params={params} />
    </Suspense>
  );
}

async function AgentRedirect({ params }: Props) {
  const { actorId } = await params;
  if (!IdSchema.safeParse(actorId).success) notFound();
  return redirect(`/agents/${actorId}/summary`);
}

function IndexSkeleton() {
  return (
    <VStack gap={3}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
    </VStack>
  );
}
