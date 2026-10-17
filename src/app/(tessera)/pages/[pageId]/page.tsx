import { Suspense } from "react";
import { io } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { IdSchema } from "@/lib/tessera/schemas";
import { getPage, isTrackerError, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ pageId: string }> };

/** Wiki page, or a redirect when the page belongs to a project (decision 45). */
export default function PageScreen({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton height={48} />}>
      <PageData params={params} />
    </Suspense>
  );
}

async function PageData({ params }: Props) {
  const { pageId } = await params;
  await io();
  if (!IdSchema.safeParse(pageId).success) notFound();
  let page;
  try {
    page = await readTessera((ctx) => getPage(ctx, pageId));
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) notFound();
    throw err;
  }
  if (page.project_id) redirect(`/projects/${page.project_id}/pages/${page.id}`);
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label={page.name}>
          <PanelBar start={<PanelTitle>{page.name}</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={3} padding={4}>
        <Text type="body">{page.description_md || "This page is empty."}</Text>
      </VStack>
    </PanelPage>
  );
}
