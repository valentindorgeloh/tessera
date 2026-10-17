"use client";

/**
 * Archives › Modules (docs/contracts/ui.md "Archives (E3)"): one row per
 * archived module linking to its detail (which shows the archived Banner and
 * read-only controls), with Restore and a menu holding Delete….
 */
import { useState, useTransition } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteModuleAction, unarchiveModuleAction } from "@/app/actions/modules";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import type { Module } from "@/lib/tessera/types";
import { ModuleIcon, RestoreIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { failureText } from "./archive-rules";
import { DELETE_MODULE_DESCRIPTION, MODULE_STATUS_LABEL, deleteModuleTitle, formatModuleRange, moduleStatusVariant } from "./module-format";

export type ArchivedModulesProps = { projectId: string; modules: Module[] };

export function ArchivedModules({ projectId, modules }: ArchivedModulesProps) {
  const toast = useToast();
  const [deleting, setDeleting] = useState<Module | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const confirmDelete = () => {
    const target = deleting;
    if (target === null) return;
    startDelete(async () => {
      const result = await deleteModuleAction({ module_id: target.id });
      if (!result.ok) {
        toast({ type: "error", body: failureText(`Could not delete ${target.name}`, result.message) });
        return;
      }
      setDeleting(null);
      toast({ type: "info", body: `Deleted ${target.name}` });
      forgetRecentsUnder(`/projects/${projectId}/modules/${target.id}`);
    });
  };

  if (modules.length === 0) {
    return (
      <VStack paddingInline={4} paddingBlock={6}>
        <EmptyState icon={<ModuleIcon />} title="No archived modules" description="Completed or cancelled modules you archive are kept here, read-only, until you restore them." />
      </VStack>
    );
  }

  // The list is inset 8px and a row's text 8px more (Astryx's item inset), on the panel header's 16px. The extra end
  // padding lets the last row's menu scroll clear of the bottom-end toasts and the dev indicator.
  return (
    <VStack gap={0} paddingInline={2} paddingBlockStart={2} paddingBlockEnd={10} className="tessera-archives-list">
      <List hasDividers aria-label="Archived modules">
        {modules.map((item) => (
          <ArchivedModuleRow key={item.id} projectId={projectId} module={item} onDelete={setDeleting} />
        ))}
      </List>
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDeleting) setDeleting(null);
        }}
        title={deleteModuleTitle(deleting?.name ?? "module")}
        description={DELETE_MODULE_DESCRIPTION}
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </VStack>
  );
}

type RowProps = { projectId: string; module: Module; onDelete: (module: Module) => void };

function ArchivedModuleRow({ projectId, module: item, onDelete }: RowProps) {
  const toast = useToast();
  const [isRestoring, startRestore] = useTransition();

  const restore = () => {
    startRestore(async () => {
      const result = await unarchiveModuleAction({ module_id: item.id });
      if (result.ok) toast({ type: "info", body: `Restored ${item.name}` });
      else toast({ type: "error", body: failureText(`Could not restore ${item.name}`, result.message) });
    });
  };

  return (
    <ListItem
      href={`/projects/${projectId}/modules/${item.id}`}
      label={item.name}
      description={
        // No hover card: the time sits inside the row's link or button, which holds no second control or tab stop.
        <>
          {`${MODULE_STATUS_LABEL[item.status]} · ${formatModuleRange(item.start_date, item.target_date)}`}
          {item.archived_at === null ? null : (
            <>
              {" · Archived "}
              <RelativeTime value={item.archived_at} hasTooltip={false} />
            </>
          )}
        </>
      }
      startContent={<StatusDot variant={moduleStatusVariant(item.status)} label={MODULE_STATUS_LABEL[item.status]} />}
      endContent={
        <HStack gap={1} vAlign="center">
          <Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} isLoading={isRestoring} onClick={restore} />
          <MoreMenu
            label="Module actions"
            size="sm"
            alignment="end"
            items={[{ id: "delete", label: "Delete…", icon: TrashIcon, variant: "destructive", onClick: () => onDelete(item) }]}
          />
        </HStack>
      }
    />
  );
}
