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
import { useAnnounce } from "@astryxdesign/core/hooks";
import { Switch } from "@astryxdesign/core/Switch";
import { Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { createBackupAction } from "@/app/actions/maintenance";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspace-settings";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { EntryBanner } from "@/components/shared/EntryBanner";
import { WorkspaceSettingsChrome } from "@/components/workspace-settings/WorkspaceSettingsChrome";
import {
  BACKUPS_FULL_WIDTH,
  FILE_NAME_COLUMN,
  FILE_NAME_COLUMN_FOLDED,
  SHORT_COLUMN,
  TIME_COLUMN,
  TOKEN_COLUMN,
} from "@/components/workspace-settings/table-widths";
import { useNarrowContainer } from "@/components/workspace-settings/use-narrow-container";
import type { BackupFile } from "@/lib/tessera/types";
import { BackupIcon } from "@/themes/catppuccin/icons";
import { autoBackupStale, BACKUP_KIND_LABEL, formatBackupSize } from "./backup-format";

const STALE_TITLE = "No recent automatic backup";
const STALE_DESCRIPTION = "The last automatic backup is older than 48 hours, or none exists yet.";

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
  const announce = useAnnounce();
  const [enabled, setEnabled] = useState(autoBackup);
  // The stale banner is page content when the screen mounts with it, and slides in only when the switch brings it in (decided by the event, not by the render).
  const [brought, setBrought] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isBackingUp, startBackup] = useTransition();

  // Below the full table's floors (decision 14: no hidden sideways swipe), size, age and check fold under the file name.
  const { ref: bodyRef, isNarrow } = useNarrowContainer(BACKUPS_FULL_WIDTH);

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
    if (value) setBrought(true);
    startSave(async () => {
      const result = await updateWorkspaceSettingsAction({ auto_backup: value });
      if (!result.ok) {
        setEnabled(!value);
        toast({ type: "error", body: `Could not update daily backups. ${result.message}` });
        return;
      }
      toast({ type: "info", body: value ? "Daily backups on" : "Daily backups off" });
      // Turning daily backups on is what shows the stale warning below, so it is told here, in answer to the switch: a page that loads with the warning has it as plain content.
      if (value && autoBackupStale(lastAuto, now)) announce(`${STALE_TITLE}. ${STALE_DESCRIPTION}`);
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

  const fileCell = (row: Row) => (
    <HStack gap={2} align="center">
      <Icon icon={BackupIcon} />
      <Text>{row.name}</Text>
    </HStack>
  );
  const fileColumn: TableColumn<Row> = { key: "name", header: "File", width: FILE_NAME_COLUMN, renderCell: fileCell };
  const foldedFileColumn: TableColumn<Row> = {
    key: "name",
    header: "File",
    width: FILE_NAME_COLUMN_FOLDED,
    renderCell: (row) => (
      <VStack gap={1}>
        {fileCell(row)}
        <HStack gap={1} wrap="wrap">
          <Text type="supporting" color="secondary">
            {row.size}
            {row.check === "—" ? "" : ` · ${row.check}`} ·
          </Text>
          <RelativeTime value={row.createdAt} type="supporting" color="secondary" hasTooltip={false} />
        </HStack>
      </VStack>
    ),
  };
  const kindColumn: TableColumn<Row> = {
    key: "kind",
    header: "Kind",
    width: TOKEN_COLUMN,
    renderCell: (row) => <Token label={row.kind} size="sm" />,
  };
  const sizeColumn: TableColumn<Row> = {
    key: "size",
    header: "Size",
    width: SHORT_COLUMN,
    renderCell: (row) => <Text color="secondary">{row.size}</Text>,
  };
  const createdColumn: TableColumn<Row> = {
    key: "created",
    header: "Created",
    width: TIME_COLUMN,
    renderCell: (row) => <RelativeTime value={row.createdAt} type="supporting" color="secondary" hasTooltip={false} />,
  };
  const checkColumn: TableColumn<Row> = {
    key: "check",
    header: "Check",
    width: SHORT_COLUMN,
    renderCell: (row) => <Text color="secondary">{row.check}</Text>,
  };

  return (
    <WorkspaceSettingsChrome
      tab="backups"
      end={
        <Button size="sm" variant="primary" label="Back up now" onClick={backUpNow} isLoading={isBackingUp} />
      }
    >
      <VStack gap={4} paddingInline={4} className="tessera-settings-body" ref={bodyRef}>
        <VStack gap={2}>
          <Switch label="Daily backups" size="sm" value={enabled} onChange={toggleDaily} isDisabled={isSaving} />
          <Text type="supporting" color="secondary">
            Automatic copies keep the newest per day for 7 days, per week for 4 weeks and per month for 12 months. Manual
            copies keep 20; migration copies keep 10.
          </Text>
        </VStack>
        {stale ? (
          brought ? (
            <EntryBanner status="warning" title={STALE_TITLE} description={STALE_DESCRIPTION} />
          ) : (
            <Banner status="warning" title={STALE_TITLE} description={STALE_DESCRIPTION} />
          )
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
            columns={isNarrow ? [foldedFileColumn, kindColumn] : [fileColumn, kindColumn, sizeColumn, createdColumn, checkColumn]}
          />
        )}
      </VStack>
    </WorkspaceSettingsChrome>
  );
}
