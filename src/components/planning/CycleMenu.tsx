"use client";

/**
 * The cycle's `…` menu (docs/contracts/ui.md "Cycles (E1)"), built from
 * `cycleActions(cycle, today)`: Edit…, Transfer open items…, Archive
 * (disabled with its reason before the end date), Restore, Delete… (disabled
 * on a completed cycle that is not archived). It owns the transfer dialog and
 * the delete confirmation so the list row and the detail header render the
 * same control; the edit dialog is owned here too unless the caller controls
 * it (the detail page opens it from the chart's "Add dates" as well).
 * Failures show an error Toast with the engine's message.
 */
import { useState, useTransition, type ReactNode } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import type { ButtonSize } from "@astryxdesign/core/Button";
import type { DropdownMenuItemData } from "@astryxdesign/core/DropdownMenu";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useToast } from "@astryxdesign/core/Toast";
import { archiveCycleAction, deleteCycleAction, unarchiveCycleAction } from "@/app/actions/cycles";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import type { Cycle } from "@/lib/tessera/types";
import { ArchiveIcon, PencilIcon, RestoreIcon, TransferIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { CycleDialog } from "./CycleDialog";
import { cycleActions, type CycleActionId } from "./cycle-format";
import { TransferDialog } from "./TransferDialog";

export type CycleMenuProps = {
  projectId: string;
  cycle: Cycle;
  today: string;
  size?: ButtonSize;
  /** After a successful delete; the detail page leaves for the cycles list. */
  onDeleted?: () => void;
  /** Controlled edit dialog (the detail page); uncontrolled when absent. */
  isEditOpen?: boolean;
  onEditOpenChange?: (open: boolean) => void;
};

const ICONS: Record<CycleActionId, ReactNode> = {
  edit: <PencilIcon />,
  transfer: <TransferIcon />,
  archive: <ArchiveIcon />,
  restore: <RestoreIcon />,
  delete: <TrashIcon />,
};

/** "Could not restore Sprint 1. The dates overlap cycle "Sprint 3"." */
export function failureText(verb: string, name: string, message: string): string {
  const detail = message.trim();
  return `Could not ${verb} ${name}.${detail ? ` ${/[.!?]$/.test(detail) ? detail : `${detail}.`}` : ""}`;
}

export function CycleMenu({ projectId, cycle, today, size = "sm", onDeleted, isEditOpen: editOpenProp, onEditOpenChange }: CycleMenuProps) {
  const toast = useToast();
  const [editOpenState, setEditOpenState] = useState(false);
  const [isTransferOpen, setTransferOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const [, startTransition] = useTransition();

  const isEditOpen = editOpenProp ?? editOpenState;
  const setEditOpen = (open: boolean) => {
    if (onEditOpenChange) onEditOpenChange(open);
    else setEditOpenState(open);
  };

  const run = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string, verb: string) => {
    startTransition(async () => {
      const result = await call();
      if (result.ok) toast({ type: "info", body: done });
      else toast({ type: "error", body: failureText(verb, cycle.name, result.message) });
    });
  };

  const handlers: Record<CycleActionId, () => void> = {
    edit: () => setEditOpen(true),
    transfer: () => setTransferOpen(true),
    archive: () => run(() => archiveCycleAction({ cycle_id: cycle.id }), `Archived ${cycle.name}`, "archive"),
    restore: () => run(() => unarchiveCycleAction({ cycle_id: cycle.id }), `Restored ${cycle.name}`, "restore"),
    delete: () => setDeleteOpen(true),
  };

  const items: DropdownMenuItemData[] = cycleActions(cycle, today).map((action) => ({
    id: action.id,
    label: action.label,
    icon: ICONS[action.id],
    isDisabled: action.isDisabled,
    description: action.description,
    variant: action.variant,
    onClick: handlers[action.id],
  }));

  const confirmDelete = () => {
    startDelete(async () => {
      const result = await deleteCycleAction({ cycle_id: cycle.id });
      if (!result.ok) {
        toast({ type: "error", body: failureText("delete", cycle.name, result.message) });
        return;
      }
      setDeleteOpen(false);
      toast({ type: "info", body: `Deleted ${cycle.name}` });
      forgetRecentsUnder(`/projects/${projectId}/cycles/${cycle.id}`);
      onDeleted?.();
    });
  };

  return (
    <>
      <MoreMenu label={`Actions for ${cycle.name}`} size={size} items={items} placement="below" alignment="end" />
      <CycleDialog projectId={projectId} isOpen={isEditOpen} onOpenChange={setEditOpen} cycle={cycle} />
      <TransferDialog isOpen={isTransferOpen} onOpenChange={setTransferOpen} cycle={cycle} />
      <AlertDialog
        isOpen={isDeleteOpen}
        onOpenChange={(open) => !isDeleting && setDeleteOpen(open)}
        title={`Delete ${cycle.name}?`}
        description="Its work items stay and leave the cycle."
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </>
  );
}
