import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { PagesScreen } from "@/components/pages/PagesScreen";
import { pageSpaces } from "@/app/(tessera)/pages/load-page";
import { parsePageTab } from "@/components/pages/page-tree";
import { listPages, readTessera } from "@/lib/tessera/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Wiki at `/wiki`: pages with no project, on the Public, Private or Archived tab. */
export default function WikiPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<WikiFallback />}>
      <WikiData searchParams={searchParams} />
    </Suspense>
  );
}

async function WikiData({ searchParams }: Props) {
  const query = await searchParams;
  const tab = parsePageTab(query.tab);
  await io();
  const data = await readTessera((ctx) => ({
    pages: listPages(ctx, { project_id: null, tab }),
    spaces: pageSpaces(ctx),
  }));
  return <PagesScreen space={{ kind: "wiki" }} tab={tab} pages={data.pages} labels={null} spaces={data.spaces} />;
}

function WikiFallback() {
  return (
    <VStack gap={2} padding={4}>
      <Skeleton height={36} />
      <Skeleton height={36} index={1} />
      <Skeleton height={36} index={2} />
      <Skeleton height={36} index={3} />
      <Skeleton height={36} index={4} />
      <Skeleton height={36} index={5} />
    </VStack>
  );
}
