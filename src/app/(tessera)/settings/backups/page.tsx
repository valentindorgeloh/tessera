import { Suspense } from "react";
import { io } from "next/cache";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { BackupsScreen } from "@/components/backups/BackupsScreen";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { getWorkspaceSettings, listBackups, MEMORY_DB, nowIso, readTessera } from "@/lib/tessera/server";

/** Workspace backups (docs/drafts/p11-plan.md U2). */
export default function BackupsSettingsPage() {
  return (
    <Suspense fallback={<BackupsFallback />}>
      <BackupsBody />
    </Suspense>
  );
}

async function BackupsBody() {
  await io();
  const { backups, autoBackup, now } = await readTessera((ctx) => {
    const path = ctx.sqlite.name;
    return {
      backups: !path || path === MEMORY_DB ? [] : listBackups(path),
      autoBackup: getWorkspaceSettings(ctx).auto_backup,
      now: nowIso(),
    };
  });
  return <BackupsScreen backups={backups} autoBackup={autoBackup} now={now} />;
}

function BackupsFallback() {
  return (
    <PanelPage
      width="reading"
      header={
        <PanelHeader label="Settings">
          <PanelBar start={<PanelTitle>Settings</PanelTitle>} />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading backups">
        <Skeleton height="var(--size-element-md)" width="40%" />
        <Skeleton height="var(--size-element-lg)" index={1} />
      </VStack>
    </PanelPage>
  );
}
