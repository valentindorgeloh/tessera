import { Suspense } from "react";
import { io } from "next/cache";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { listPages, readTessera } from "@/lib/tessera/server";

/** Wiki at `/wiki`: pages with no project, in tree order. */
export default function WikiPage() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Wiki">
          <PanelBar start={<PanelTitle>Wiki</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={4}>
        <Suspense fallback={<Skeleton height={36} />}>
          <WikiList />
        </Suspense>
      </VStack>
    </PanelPage>
  );
}

async function WikiList() {
  await io();
  const pages = await readTessera((ctx) => listPages(ctx, { project_id: null }));
  return (
    <List density="compact" aria-label="Pages">
      {pages.map((item) => (
        <ListItem key={item.id} label={item.name} href={`/pages/${item.id}`} />
      ))}
    </List>
  );
}
