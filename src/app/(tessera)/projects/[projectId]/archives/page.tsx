import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { IdSchema } from "@/lib/tessera/schemas";

type Props = { params: Promise<{ projectId: string }> };

/**
 * `/projects/<id>/archives` has no list of its own and lands on the archived
 * work items (docs/contracts/ui.md "Routes and data loading"). No reads: an
 * unknown project id reaches the not-found screen from the target page.
 */
export default function ArchivesIndexPage({ params }: Props) {
  return (
    <Suspense fallback={<IndexSkeleton />}>
      <ArchivesRedirect params={params} />
    </Suspense>
  );
}

async function ArchivesRedirect({ params }: Props) {
  const { projectId } = await params;
  if (!IdSchema.safeParse(projectId).success) notFound();
  return redirect(`/projects/${projectId}/archives/work-items`);
}

function IndexSkeleton() {
  return (
    <VStack gap={3} padding={5}>
      <Skeleton height={44} />
      <Skeleton height={44} index={1} />
    </VStack>
  );
}
