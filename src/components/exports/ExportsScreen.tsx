"use client";

/**
 * Workspace exports list (docs/drafts/p10-plan.md U2): download or delete past jobs.
 */
import { useRef, useState, useTransition } from "react";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteExportAction } from "@/app/actions/exports";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { AlertDialog } from "@/components/shell/dialogs";
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

  return (
    <WorkspaceSettingsChrome tab="exports">
      <VStack gap={4} padding={6}>
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
            columns={[
              { key: "name", header: "Name", renderCell: (row) => <Text>{row.name}</Text> },
              {
                key: "format",
                header: "Format",
                renderCell: (row) => <Token label={row.format} size="sm" />,
              },
              {
                key: "rows",
                header: "Rows",
                align: "end",
                renderCell: (row) => <Text hasTabularNumbers>{row.rows}</Text>,
              },
              {
                key: "status",
                header: "Status",
                renderCell: (row) => <StatusDot variant={statusVariant(row.status)} label={STATUS_LABEL[row.status]} />,
              },
              {
                key: "created",
                header: "Created",
                renderCell: (row) => <RelativeTime value={row.createdAt} type="supporting" color="secondary" hasTooltip={false} />,
              },
              {
                key: "actions",
                header: "",
                align: "end",
                renderCell: (row) => (
                  <HStack gap={1} hAlign="end">
                    {row.canDownload ? (
                      <IconButton
                        label="Download"
                        variant="ghost"
                        size="sm"
                        icon={<DownloadIcon />}
                        href={`/api/exports/${row.id}`}
                      />
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
              },
            ]}
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
