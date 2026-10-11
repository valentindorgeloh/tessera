import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { getCycle, IdSchema, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ cycleId: string }> };

/**
 * `/cycles/[cycleId]` (docs/contracts/ui.md "Integration (E4)"): the target of
 * a `cycle:<id>` editor link, which knows the cycle but not its project. It
 * redirects to `/projects/<project_id>/cycles/<id>`; a malformed or unknown id
 * renders the Tessera not-found screen. The tab is transient, like `/browse/`.
 */
export default function CycleAliasPage({ params }: Props) {
  return (
    <Suspense fallback={<AliasSkeleton />}>
      <CycleAlias params={params} />
    </Suspense>
  );
}

async function CycleAlias({ params }: Props) {
  const { cycleId } = await params;
  await io();
  if (!IdSchema.safeParse(cycleId).success) notFound();
  let projectId: string;
  try {
    projectId = await readTessera((ctx) => getCycle(ctx, cycleId).project_id);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  // redirect() throws, so it stays outside the try.
  return redirect(`/projects/${projectId}/cycles/${cycleId}`);
}

function AliasSkeleton() {
  return (
    <VStack gap={3} padding={5}>
      <Skeleton width={240} height={20} />
      <Skeleton width="70%" height={36} index={1} />
      <Skeleton height={120} index={2} />
    </VStack>
  );
}
