import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { PageScreen } from "@/components/pages/PageScreen";
import { loadPageBundle, pageSpaces } from "@/app/(tessera)/pages/load-page";
import { IdSchema } from "@/lib/tessera/schemas";
import { isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ pageId: string }> };

/** A wiki page. A project page redirects to its project route. */
export default function WikiPageScreen({ params }: Props) {
  return (
    <Suspense fallback={<PageFallback />}>
      <PageData params={params} />
    </Suspense>
  );
}

async function PageData({ params }: Props) {
  const { pageId } = await params;
  await io();
  if (!IdSchema.safeParse(pageId).success) notFound();
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(pageId);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (data.page.project_id) redirect(`/projects/${data.page.project_id}/pages/${data.page.id}`);
  return <PageScreen page={data.page} labels={data.labels} actors={data.actors} spaces={data.spaces} space={{ kind: "wiki" }} />;
}

function load(pageId: string) {
  return readTessera((ctx) => ({ ...loadPageBundle(ctx, pageId), spaces: pageSpaces(ctx) }));
}

function PageFallback() {
  return (
    <VStack gap={4} padding={5}>
      <Skeleton width={240} height={28} />
      <Skeleton width={180} height={20} index={1} />
      <Skeleton height={32} index={2} />
      <Skeleton height={160} index={3} />
    </VStack>
  );
}
