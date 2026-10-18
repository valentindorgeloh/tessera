"use client";

import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createExportAction } from "@/app/actions/exports";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { ExportFormat, ExportScope, Filters, OrderBy, RichFilters } from "@/lib/tessera/types";
import { DownloadIcon } from "@/themes/catppuccin/icons";

export type ExportDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  scope: {
    project_id: string | null;
    cycle_id?: string;
    module_id?: string;
    view_id?: string;
    filters: Filters;
    rich_filters: RichFilters | null;
    order_by: OrderBy;
  };
};

export function ExportDialog({ isOpen, onOpenChange, title, scope }: ExportDialogProps) {
  const toast = useToast();
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [archived, setArchived] = useState(false);
  const [name, setName] = useState(title);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const payload: ExportScope = {
      project_id: scope.project_id,
      cycle_id: scope.cycle_id,
      module_id: scope.module_id,
      view_id: scope.view_id,
      filters: scope.filters,
      rich_filters: scope.rich_filters,
      order_by: scope.order_by,
      archived,
    };
    startTransition(async () => {
      const result = await createExportAction({ format, scope: payload, name: name.trim() || title });
      if (!result.ok) {
        toast({ type: "error", body: result.message });
        return;
      }
      if (result.data.status === "failed") {
        toast({ type: "error", body: result.data.error ?? "Export failed" });
        return;
      }
      setDownloadId(result.data.id);
      toast({ type: "info", body: `Exported ${result.data.row_count ?? 0} work items` });
    });
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label="Export work items">
      <Layout
        header={<DialogHeader title="Export work items" onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <TextInput label="Name" value={name} onChange={setName} />
              <SegmentedControl label="Format" size="sm" value={format} onChange={(value) => setFormat(value === "json" ? "json" : "csv")}>
                <SegmentedControlItem value="csv" label="CSV" />
                <SegmentedControlItem value="json" label="JSON" />
              </SegmentedControl>
              <Switch label="Include archived work items" value={archived} onChange={setArchived} />
              {downloadId ? <Text type="supporting">The file is ready.</Text> : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2}>
              <Button variant="secondary" size="sm" label="Cancel" onClick={() => onOpenChange(false)} />
              <Button variant="primary" size="sm" label="Export" onClick={submit} isLoading={isPending} />
              {downloadId ? <Button variant="secondary" size="sm" label="Download" icon={<DownloadIcon />} href={`/api/exports/${downloadId}`} /> : null}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
