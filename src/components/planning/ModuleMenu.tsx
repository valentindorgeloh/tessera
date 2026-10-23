"use client";

/**
 * The module's `…` menu (docs/contracts/ui.md "Modules (E2)"), built from
 * `moduleActions(module)`: Edit…, Archive (enabled only for completed or
 * cancelled modules), Restore (archived), Delete… (confirmed with an
 * `AlertDialog`: "Its work items stay and leave the module."). It owns the edit
 * dialog and the confirmation so the list row and the detail header render
 * the same control. Failures show an error Toast with the engine's message.
 */
import { useState, useTransition } from "react";
import { AlertDialog } from "@/components/shell/dialogs";
import type { DropdownMenuItemData } from "@astryxdesign/core/DropdownMenu";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import type { ButtonSize } from "@astryxdesign/core/Button";
import { useToast } from "@astryxdesign/core/Toast";
import { archiveModuleAction, deleteModuleAction, unarchiveModuleAction } from "@/app/actions/modules";
import { useFavoriteToggle } from "@/components/shell/FavoriteButton";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import { useOptionalProject } from "@/components/work-items/project-provider";
import { ArchiveIcon, PencilIcon, RestoreIcon, TrashIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { ModuleDialog, type EditableModule } from "./ModuleDialog";
import { DELETE_MODULE_DESCRIPTION, deleteModuleTitle, moduleActions, type ModuleActionId } from "./module-format";

export type ModuleMenuProps = {
  projectId: string;
  module: EditableModule & { archived_at: string | null };
  size?: ButtonSize;
  /** After a successful delete; the detail page leaves for the modules list. */
  onDeleted?: () => void;
};

/**
 * Component references, not elements: Astryx sizes a component icon to the
 * menu's 16px icon box, where a rendered `<PencilIcon />` keeps the font-size
 * 14px and would sit beside the 16px favourite star.
 */
const ICONS: Record<ModuleActionId, typeof PencilIcon> = {
  edit: PencilIcon,
  archive: ArchiveIcon,
  restore: RestoreIcon,
  delete: TrashIcon,
};

type Outcome = { ok: true } | { ok: false; message: string };

export function ModuleMenu({ projectId, module, size = "sm", onDeleted }: ModuleMenuProps) {
  const toast = useToast();
  // Core change (P4 F3.4): the menu of a module in an archived project is disabled, in the list row and the detail header alike.
  const projectArchived = (useOptionalProject()?.bundle.project.archived_at ?? null) !== null;
  const [isEditOpen, setEditOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const [, startTransition] = useTransition();
  const favorite = useFavoriteToggle("module", module.id);

  const run = (call: () => Promise<Outcome>, done: string, failed: string) => {
    startTransition(async () => {
      const result = await call();
      if (result.ok) toast({ type: "info", body: done });
      else toast({ type: "error", body: `${failed}: ${result.message}` });
    });
  };

  const handlers: Record<ModuleActionId, () => void> = {
    edit: () => setEditOpen(true),
    archive: () => run(() => archiveModuleAction({ module_id: module.id }), `Archived ${module.name}`, `Could not archive ${module.name}`),
    restore: () => run(() => unarchiveModuleAction({ module_id: module.id }), `Restored ${module.name}`, `Could not restore ${module.name}`),
    delete: () => setDeleteOpen(true),
  };

  const items: DropdownMenuItemData[] = [
    { id: "favorite", label: favorite.label, icon: resolveLogoIcon("Star"), onClick: favorite.toggle },
    ...moduleActions(module).map((action) => ({
    id: action.id,
    label: action.label,
    icon: ICONS[action.id],
    isDisabled: action.isDisabled,
    description: action.description,
    variant: action.variant,
    onClick: handlers[action.id],
  })),
  ];

  const confirmDelete = () => {
    startDelete(async () => {
      const result = await deleteModuleAction({ module_id: module.id });
      if (!result.ok) {
        toast({ type: "error", body: `Could not delete ${module.name}: ${result.message}` });
        return;
      }
      setDeleteOpen(false);
      toast({ type: "info", body: `Deleted ${module.name}` });
      forgetRecentsUnder(`/projects/${projectId}/modules/${module.id}`);
      onDeleted?.();
    });
  };

  return (
    <>
      <MoreMenu label={`Actions for ${module.name}`} size={size} items={items} placement="below" alignment="end" isDisabled={projectArchived} />
      {module.archived_at === null ? <ModuleDialog projectId={projectId} isOpen={isEditOpen} onOpenChange={setEditOpen} module={module} /> : null}
      <AlertDialog
        isOpen={isDeleteOpen}
        onOpenChange={(open) => {
          if (!isDeleting) setDeleteOpen(open);
        }}
        title={deleteModuleTitle(module.name)}
        description={DELETE_MODULE_DESCRIPTION}
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </>
  );
}
