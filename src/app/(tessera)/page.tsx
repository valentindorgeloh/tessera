import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { HomeScreen } from "@/components/home/HomeScreen";
import type { HomeSummary } from "@/components/home/home-format";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { digestsEnabled, type WorkspaceSettingsView } from "@/components/workspace-settings/settings-format";
import { getHomeSummary, getWorkspaceSettings, readTessera } from "@/lib/tessera/server";

/**
 * Home at `/` (docs/drafts/p9-plan.md U1). One read of the home summary after
 * `io()`. Opening the page does not generate a digest. Recents stay in the
 * browser and render inside the client screen.
 */
export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeBody />
    </Suspense>
  );
}

async function HomeBody() {
  await io();
  const loaded: { summary: HomeSummary; settings: WorkspaceSettingsView } = await readTessera((ctx) => ({
    summary: getHomeSummary(ctx),
    settings: getWorkspaceSettings(ctx),
  }));
  return <HomeScreen summary={loaded.summary} digestEnabled={digestsEnabled(loaded.settings)} />;
}

function HomeFallback() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Home">
          <PanelBar start={<PanelTitle>Home</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading home">
        <Skeleton height="var(--size-element-lg)" />
        <Skeleton height="var(--size-element-lg)" index={1} />
        <Skeleton height="var(--size-element-lg)" index={2} />
      </VStack>
    </PanelPage>
  );
}
