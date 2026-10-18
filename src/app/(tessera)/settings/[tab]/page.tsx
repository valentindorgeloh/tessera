import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { WorkspaceSettingsScreen } from "@/components/workspace-settings/WorkspaceSettingsScreen";
import { isSettingsTab, type WorkspaceSettingsView } from "@/components/workspace-settings/settings-format";
import { getWorkspaceSettings, readTessera } from "@/lib/tessera/server";

type Props = { params: Promise<{ tab: string }> };

/** Workspace settings (docs/drafts/p9-plan.md U1). Only General and AI exist. */
export default function WorkspaceSettingsPage({ params }: Props) {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsBody params={params} />
    </Suspense>
  );
}

async function SettingsBody({ params }: Props) {
  const { tab } = await params;
  if (!isSettingsTab(tab)) notFound();
  await io();
  const settings: WorkspaceSettingsView = await readTessera((ctx) => getWorkspaceSettings(ctx));
  return <WorkspaceSettingsScreen tab={tab} settings={settings} />;
}

function SettingsFallback() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Settings">
          <PanelBar start={<PanelTitle>Settings</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading settings">
        <Skeleton height="var(--size-element-md)" width="40%" />
        <Skeleton height="var(--size-element-lg)" index={1} />
      </VStack>
    </PanelPage>
  );
}
