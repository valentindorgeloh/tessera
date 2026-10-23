"use client";

/**
 * Workspace backups list (docs/drafts/p11-plan.md U2): daily toggle, Back up now.
 */
import { useState, useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { createBackupAction } from "@/app/actions/maintenance";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspace-settings";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { WorkspaceSettingsChrome } from "@/components/workspace-settings/WorkspaceSettingsChrome";
import { FILE_NAME_COLUMN, SHORT_COLUMN, TIME_COLUMN, TOKEN_COLUMN } from "@/components/workspace-settings/table-widths";
import type { BackupFile } from "@/lib/tessera/types";
import { BackupIcon } from "@/themes/catppuccin/icons";
import { autoBackupStale, BACKUP_KIND_LABEL, formatBackupSize } from "./backup-format";

export type BackupsScreenProps = {
  backups: BackupFile[];
  autoBackup: boolean;
  /** Server clock used for the stale banner; never Date.now() in render. */
  now: string;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  size: string;
  createdAt: string;
  check: string;
};

export function BackupsScreen({ backups, autoBackup, now }: BackupsScreenProps) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(autoBackup);
  const [isSaving, startSave] = useTransition();
  const [isBackingUp, startBackup] = useTransition();

  const lastAuto = backups.find((file) => file.kind === "auto")?.created_at ?? null;
  const stale = enabled && autoBackupStale(lastAuto, now);

  const data: Row[] = backups.map((file) => ({
    id: file.path,
    name: file.name,
    kind: BACKUP_KIND_LABEL[file.kind],
    size: formatBackupSize(file.size),
    createdAt: file.created_at,
    check: file.check ?? "—",
  }));

  const toggleDaily = (value: boolean) => {
    setEnabled(value);
    startSave(async () => {
      const result = await updateWorkspaceSettingsAction({ auto_backup: value });
      if (!result.ok) {
        setEnabled(!value);
        toast({ type: "error", body: `Could not update daily backups. ${result.message}` });
        return;
      }
      toast({ type: "info", body: value ? "Daily backups on" : "Daily backups off" });
    });
  };

  const backUpNow = () => {
    startBackup(async () => {
      const result = await createBackupAction({ confirm: true });
      if (!result.ok) {
        toast({ type: "error", body: `Could not create a backup. ${result.message}` });
        return;
      }
      toast({ type: "info", body: "Backup created" });
    });
  };

  return (
    <WorkspaceSettingsChrome
      tab="backups"
      end={
        <Button size="sm" variant="primary" label="Back up now" onClick={backUpNow} isLoading={isBackingUp} />
      }
    >
      <VStack gap={4} paddingInline={4} className="tessera-settings-body">
        <VStack gap={2}>
          <Switch label="Daily backups" size="sm" value={enabled} onChange={toggleDaily} isDisabled={isSaving} />
          <Text type="supporting" color="secondary">
            Automatic copies keep the newest per day for 7 days, per week for 4 weeks and per month for 12 months. Manual
            copies keep 20; migration copies keep 10.
          </Text>
        </VStack>
        {stale ? (
          <Banner
            status="warning"
            title="No recent automatic backup"
            description="The last automatic backup is older than 48 hours, or none exists yet."
          />
        ) : null}
        {backups.length === 0 ? (
          <EmptyState
            icon={<Icon icon={BackupIcon} size="lg" color="secondary" />}
            title="No backups yet"
            description="Back up now writes a manual copy next to the database file."
          />
        ) : (
          <Table<Row>
            density="compact"
            idKey="id"
            data={data}
            columns={[
              {
                key: "name",
                header: "File",
                width: FILE_NAME_COLUMN,
                renderCell: (row) => (
                  <HStack gap={2} align="center">
                    <Icon icon={BackupIcon} />
                    <Text>{row.name}</Text>
                  </HStack>
                ),
              },
              {
                key: "kind",
                header: "Kind",
                width: TOKEN_COLUMN,
                renderCell: (row) => <Token label={row.kind} size="sm" />,
              },
              {
                key: "size",
                header: "Size",
                width: SHORT_COLUMN,
                renderCell: (row) => <Text color="secondary">{row.size}</Text>,
              },
              {
                key: "created",
                header: "Created",
                width: TIME_COLUMN,
                renderCell: (row) => <RelativeTime value={row.createdAt} type="supporting" color="secondary" hasTooltip={false} />,
              },
              {
                key: "check",
                header: "Check",
                width: SHORT_COLUMN,
                renderCell: (row) => <Text color="secondary">{row.check}</Text>,
              },
            ]}
          />
        )}
      </VStack>
    </WorkspaceSettingsChrome>
  );
}
