"use client";

/**
 * The view's "…" menu (docs/drafts/p4-ui.md "ViewMenu"), one control for a
 * list row and the view page's header: Edit…, Duplicate, Lock or Unlock,
 * Move up and Move down (row only, with neighbours), Delete…. It owns the edit
 * dialog and the delete confirmation. A locked view cannot be edited or
 * deleted (the items say so); an archived project disables the whole menu.
 * Every failure shows an error Toast with the engine's message.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteViewAction, duplicateViewAction, lockViewAction, reorderViewAction, unlockViewAction } from "@/app/actions/views";
import { AlertDialog } from "@/components/shell/dialogs";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import { useProject } from "@/components/work-items/project-provider";
import type { View } from "@/lib/tessera/types";
import { CopyIcon, LockIcon, MoveDownIcon, MoveUpIcon, PencilIcon, TrashIcon, UnlockIcon } from "@/themes/catppuccin/icons";
import { ViewDialog } from "./ViewDialog";

export type ViewMenuProps = {
  projectId: string;
  view: View;
  placement: "row" | "header";
  /** The neighbouring rows' ids in the shown order (row placement). */
  previousId?: string;
  nextId?: string;
  /** Row placement: Move up and Move down show (false while the list is searched). */
  canReorder?: boolean;
};

export function ViewMenu({ projectId, view, placement, previousId, nextId, canReorder = false }: ViewMenuProps) {
  const router = useRouter();
  const toast = useToast();
  const { bundle } = useProject();
  const [isEditOpen, setEditOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const [, startTransition] = useTransition();

  const fail = (verb: string, message: string) => toast({ type: "error", body: `Could not ${verb} ${view.name}: ${message}` });

  const duplicate = () =>
    startTransition(async () => {
      const result = await duplicateViewAction({ view_id: view.id });
      if (!result.ok) {
        fail("duplicate", result.message);
        return;
      }
      toast({ type: "info", body: `Duplicated as ${result.data.name}` });
      router.push(`/projects/${projectId}/views/${result.data.id}`);
    });

  const setLocked = (isLocked: boolean) =>
    startTransition(async () => {
      const result = isLocked ? await lockViewAction({ view_id: view.id }) : await unlockViewAction({ view_id: view.id });
      if (!result.ok) fail(isLocked ? "lock" : "unlock", result.message);
    });

  const move = (verb: string, input: { after_id: string } | { before_id: string }) =>
    startTransition(async () => {
      const result = await reorderViewAction({ view_id: view.id, ...input });
      if (!result.ok) fail(verb, result.message);
    });

  const confirmDelete = () =>
    startDelete(async () => {
      const result = await deleteViewAction({ view_id: view.id });
      if (!result.ok) {
        fail("delete", result.message);
        return;
      }
      setDeleteOpen(false);
      toast({ type: "info", body: `Deleted ${view.name}` });
      forgetRecentsUnder(`/projects/${projectId}/views/${view.id}`);
      if (placement === "header") router.push(`/projects/${projectId}/views`);
    });

  const items: DropdownMenuOption[] = [
    { id: "edit", label: "Edit…", icon: <PencilIcon />, isDisabled: view.is_locked, description: view.is_locked ? "Unlock the view to edit it" : undefined, onClick: () => setEditOpen(true) },
    { id: "duplicate", label: "Duplicate", icon: <CopyIcon />, onClick: duplicate },
    view.is_locked
      ? { id: "unlock", label: "Unlock view", icon: <UnlockIcon />, onClick: () => setLocked(false) }
      : { id: "lock", label: "Lock view", icon: <LockIcon />, onClick: () => setLocked(true) },
  ];
  if (placement === "row" && canReorder) {
    items.push(
      { id: "move-up", label: "Move up", icon: <MoveUpIcon />, isDisabled: previousId === undefined, onClick: () => previousId !== undefined && move("move", { after_id: previousId }) },
      { id: "move-down", label: "Move down", icon: <MoveDownIcon />, isDisabled: nextId === undefined, onClick: () => nextId !== undefined && move("move", { before_id: nextId }) },
    );
  }
  items.push(
    { type: "divider" },
    {
      id: "delete",
      label: "Delete…",
      icon: <TrashIcon />,
      variant: "destructive",
      isDisabled: view.is_locked,
      description: view.is_locked ? "Unlock the view to delete it" : undefined,
      onClick: () => setDeleteOpen(true),
    },
  );

  return (
    <>
      <MoreMenu label="View actions" size="sm" items={items} placement="below" alignment="end" isDisabled={bundle.project.archived_at !== null} />
      <ViewDialog isOpen={isEditOpen} onOpenChange={setEditOpen} projectId={projectId} mode="edit" title={`Edit ${view.name}`} view={view} />
      <AlertDialog
        isOpen={isDeleteOpen}
        onOpenChange={(open) => !isDeleting && setDeleteOpen(open)}
        title={`Delete ${view.name}?`}
        description="The saved filters and display are removed. Work items are not affected."
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </>
  );
}
