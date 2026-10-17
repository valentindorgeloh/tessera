import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { IdSchema } from "@/lib/tessera/schemas";

type Props = { params: Promise<{ projectId: string }> };

/**
 * `/projects/<id>/settings` has no screen of its own and lands on General
 * (docs/drafts/p4-ui.md "Routes and data loading"). No reads: an unknown
 * project id reaches the not-found screen from the target page.
 */
export default function SettingsIndexPage({ params }: Props) {
  return (
    <Suspense fallback={<IndexSkeleton />}>
      <SettingsRedirect params={params} />
    </Suspense>
  );
}

async function SettingsRedirect({ params }: Props) {
  const { projectId } = await params;
  if (!IdSchema.safeParse(projectId).success) notFound();
  return redirect(`/projects/${projectId}/settings/general`);
}

function IndexSkeleton() {
  return (
    <VStack gap={3}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
    </VStack>
  );
}
