import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { ExportsScreen } from "@/components/exports/ExportsScreen";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { listExports, readTessera } from "@/lib/tessera/server";

/** Workspace export jobs (docs/drafts/p10-plan.md U2). */
export default function ExportsSettingsPage() {
  return (
    <Suspense fallback={<ExportsFallback />}>
      <ExportsBody />
    </Suspense>
  );
}

async function ExportsBody() {
  await io();
  const jobs = await readTessera((ctx) => listExports(ctx, { limit: 100 }));
  return <ExportsScreen exports={jobs} />;
}

function ExportsFallback() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Settings">
          <PanelBar start={<PanelTitle>Settings</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading exports">
        <Skeleton height="var(--size-element-md)" width="40%" />
        <Skeleton height="var(--size-element-lg)" index={1} />
      </VStack>
    </PanelPage>
  );
}
