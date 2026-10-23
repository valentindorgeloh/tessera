"use client";

/**
 * Workspace exports list (docs/drafts/p10-plan.md U2): download or delete past jobs.
 */
import { useRef, useState, useTransition } from "react";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteExportAction } from "@/app/actions/exports";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { AlertDialog } from "@/components/shell/dialogs";
import { StatusLabel } from "@/components/workspace-settings/StatusLabel";
import { ACTIONS_COLUMN, EXPORTS_FULL_WIDTH, SHORT_COLUMN, TIME_COLUMN, TITLE_COLUMN, TITLE_COLUMN_FOLDED, TOKEN_COLUMN } from "@/components/workspace-settings/table-widths";
import { useNarrowContainer } from "@/components/workspace-settings/use-narrow-container";
import { WorkspaceSettingsChrome } from "@/components/workspace-settings/WorkspaceSettingsChrome";
import type { ExportJobView, ExportStatus } from "@/lib/tessera/types";
import { DownloadIcon, ExportIcon, TrashIcon } from "@/themes/catppuccin/icons";

export type ExportsScreenProps = { exports: ExportJobView[] };

type Row = {
  id: string;
  name: string;
  format: string;
  rows: string;
  status: ExportStatus;
  createdAt: string;
  canDownload: boolean;
};

const STATUS_LABEL: Record<ExportStatus, string> = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

function statusVariant(status: ExportStatus): "accent" | "success" | "error" | "neutral" {
  if (status === "done") return "success";
  if (status === "failed") return "error";
  if (status === "running") return "accent";
  return "neutral";
}

export function ExportsScreen({ exports: jobs }: ExportsScreenProps) {
  const toast = useToast();
  const [remove, setRemove] = useState<ExportJobView | null>(null);
  const [isDeleting, startDelete] = useTransition();
  // A second confirm for the same export (double click, or a re-run of the transition) must not delete or toast again.
  const deletingId = useRef<string | null>(null);
  // Below the full table's floors, format, rows and age fold under the name so Download and Delete stay in view.
  const { ref: bodyRef, isNarrow } = useNarrowContainer(EXPORTS_FULL_WIDTH);

  const data: Row[] = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    format: job.format.toUpperCase(),
    rows: job.row_count === null ? "—" : String(job.row_count),
    status: job.status,
    createdAt: job.created_at,
    canDownload: job.status === "done" && job.file_name !== null,
  }));

  const confirmDelete = () => {
    if (remove === null || deletingId.current === remove.id) return;
    const target = remove;
    deletingId.current = target.id;
    startDelete(async () => {
      let result: Awaited<ReturnType<typeof deleteExportAction>>;
      try {
        result = await deleteExportAction({ export_id: target.id });
      } finally {
        deletingId.current = null;
      }
      if (!result.ok) {
        toast({ type: "error", body: `Could not delete ${target.name}. ${result.message}` });
        return;
      }
      setRemove(null);
      // uniqueID makes the toast idempotent if the confirm ever runs twice.
      toast({ type: "info", body: `Deleted ${target.name}`, uniqueID: `export-deleted-${target.id}` });
    });
  };

  const nameColumn: TableColumn<Row> = { key: "name", header: "Name", width: TITLE_COLUMN, renderCell: (row) => <Text>{row.name}</Text> };
  const foldedNameColumn: TableColumn<Row> = {
    key: "name",
    header: "Name",
    width: TITLE_COLUMN_FOLDED,
    renderCell: (row) => (
      <VStack gap={1}>
        <Text>{row.name}</Text>
        <HStack gap={1} wrap="wrap">
          <Text type="supporting" color="secondary">
            {row.format}
            {row.rows === "—" ? "" : ` · ${row.rows} rows`} ·
          </Text>
          <RelativeTime value={row.createdAt} type="supporting" color="secondary" hasTooltip={false} />
        </HStack>
      </VStack>
    ),
  };
  const formatColumn: TableColumn<Row> = {
    key: "format",
    header: "Format",
    width: SHORT_COLUMN,
    renderCell: (row) => <Token label={row.format} size="sm" />,
  };
  const rowsColumn: TableColumn<Row> = {
    key: "rows",
    header: "Rows",
    width: SHORT_COLUMN,
    align: "end",
    renderCell: (row) => <Text hasTabularNumbers>{row.rows}</Text>,
  };
  const statusColumn: TableColumn<Row> = {
    key: "status",
    header: "Status",
    width: TOKEN_COLUMN,
    renderCell: (row) => <StatusLabel variant={statusVariant(row.status)} label={STATUS_LABEL[row.status]} />,
  };
  const createdColumn: TableColumn<Row> = {
    key: "created",
    header: "Created",
    width: TIME_COLUMN,
    renderCell: (row) => <RelativeTime value={row.createdAt} type="supporting" color="secondary" hasTooltip={false} />,
  };
  const actionsColumn: TableColumn<Row> = {
    key: "actions",
    header: "",
    width: ACTIONS_COLUMN,
    align: "end",
    renderCell: (row) => (
      <HStack gap={1} hAlign="end">
        {row.canDownload ? (
          <IconButton label="Download" variant="ghost" size="sm" icon={<DownloadIcon />} href={`/api/exports/${row.id}`} />
        ) : null}
        <IconButton
          label="Delete"
          variant="ghost"
          size="sm"
          icon={<TrashIcon />}
          onClick={() => setRemove(jobs.find((job) => job.id === row.id) ?? null)}
        />
      </HStack>
    ),
  };

  return (
    <WorkspaceSettingsChrome tab="exports">
      <VStack gap={4} paddingInline={4} className="tessera-settings-body" ref={bodyRef}>
        {jobs.length === 0 ? (
          <EmptyState
            icon={<Icon icon={ExportIcon} size="lg" color="secondary" />}
            title="No exports yet"
            description="Use Export… on a work items list to write a CSV or JSON file."
          />
        ) : (
          <Table<Row>
            density="compact"
            idKey="id"
            data={data}
            columns={isNarrow ? [foldedNameColumn, statusColumn, actionsColumn] : [nameColumn, formatColumn, rowsColumn, statusColumn, createdColumn, actionsColumn]}
          />
        )}
      </VStack>
      <AlertDialog
        isOpen={remove !== null}
        onOpenChange={(open) => !isDeleting && !open && setRemove(null)}
        title="Delete export"
        description={remove === null ? "" : `${remove.name} and its file are removed.`}
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </WorkspaceSettingsChrome>
  );
}
