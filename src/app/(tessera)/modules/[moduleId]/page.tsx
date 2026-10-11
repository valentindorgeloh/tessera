import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { getModule, IdSchema, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ moduleId: string }> };

/**
 * `/modules/[moduleId]` (docs/contracts/ui.md "Integration (E4)"): the target of
 * a `module:<id>` editor link, which knows the module but not its project. It
 * redirects to `/projects/<project_id>/modules/<id>`; a malformed or unknown id
 * renders the Tessera not-found screen. The tab is transient, like `/browse/`.
 */
export default function ModuleAliasPage({ params }: Props) {
  return (
    <Suspense fallback={<AliasSkeleton />}>
      <ModuleAlias params={params} />
    </Suspense>
  );
}

async function ModuleAlias({ params }: Props) {
  const { moduleId } = await params;
  await io();
  if (!IdSchema.safeParse(moduleId).success) notFound();
  let projectId: string;
  try {
    projectId = await readTessera((ctx) => getModule(ctx, moduleId).project_id);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  // redirect() throws, so it stays outside the try.
  return redirect(`/projects/${projectId}/modules/${moduleId}`);
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
