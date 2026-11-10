import { io } from "next/cache";
import { PagesScreen } from "@/components/pages/PagesScreen";
import { pageSpaces } from "@/app/(tessera)/pages/load-page";
import { parsePageTab } from "@/components/pages/page-tree";
import { listPages, readTessera } from "@/lib/tessera/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * `instant = false`: this page keeps no Suspense boundary of its own. The
 * frame's boundary in `(tessera)/layout.tsx` covers a cold load, and a client
 * navigation keeps the old page on screen until this one is ready, so React
 * never commits a skeleton and holds the content for 300 ms. The opt-out
 * turns off dev validation of instant navigation for this segment
 * (`02-route-segment-config/instant.md`).
 */
export const instant = false;

/** Wiki at `/wiki`: pages with no project, on the Public, Private or Archived tab. */
export default function WikiPage({ searchParams }: Props) {
  return <WikiData searchParams={searchParams} />;
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
