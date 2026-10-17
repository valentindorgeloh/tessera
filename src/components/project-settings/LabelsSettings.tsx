"use client";

/**
 * Labels tab of the project settings (docs/drafts/p4-ui.md "Labels"): one list
 * of the top-level labels, each followed by its sub-labels, with a row menu
 * (edit, add sub-label, move to, move up and down, delete). `usage` is the
 * count of work items per label id (`getTaxonomyUsage`, read by the page).
 * Everything is disabled in an archived project.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { deleteLabelAction, reorderLabelAction, updateLabelAction } from "@/app/actions/states-labels";
import { failureText } from "@/components/planning/archive-rules";
import { AlertDialog } from "@/components/shell/dialogs";
import { useProject } from "@/components/work-items/project-provider";
import type { Label } from "@/lib/tessera/types";
import { MoveDownIcon, MoveUpIcon, PencilIcon, PlusIcon, TagIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { LabelDialog } from "./LabelDialog";
import { siblingMove } from "./sibling-moves";

export type LabelsSettingsProps = { usage: Record<string, number> };

/** The dialog the screen has open: create (with an optional parent) or edit. */
type DialogState = { mode: "create"; parentId: string | null } | { mode: "edit"; label: Label };

export function countText(count: number): string {
  return `${count} work ${count === 1 ? "item" : "items"}`;
}

export function LabelsSettings({ usage }: LabelsSettingsProps) {
  const { bundle } = useProject();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);
  const isArchived = bundle.project.archived_at !== null;

  const topLevel = bundle.labels.filter((label) => label.parent_id === null);
  const childrenOf = (id: string) => bundle.labels.filter((label) => label.parent_id === id);
  const rows = topLevel.flatMap((label) => [label, ...childrenOf(label.id)]);

  const run = (what: string, action: () => Promise<{ ok: true } | { ok: false; message: string }>, onDone?: () => void) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ type: "error", body: failureText(what, result.message) });
        return;
      }
      onDone?.();
    });
  };

  const menuFor = (label: Label): DropdownMenuOption[] => {
    const isChild = label.parent_id !== null;
    const siblings = (isChild ? childrenOf(label.parent_id as string) : topLevel).map((sibling) => sibling.id);
    const up = siblingMove(siblings, label.id, "up");
    const down = siblingMove(siblings, label.id, "down");
    const hasChildren = !isChild && childrenOf(label.id).length > 0;
    const targets = topLevel.filter((other) => other.id !== label.id && other.id !== label.parent_id);
    const moveTo = (parentId: string | null) => run(`Could not move ${label.name}`, () => updateLabelAction({ label_id: label.id, parent_id: parentId }));
    const moveItems: DropdownMenuOption[] = [...(isChild ? [{ id: "top-level", label: "Top level", onClick: () => moveTo(null) }] : []), ...targets.map((target) => ({ id: target.id, label: target.name, onClick: () => moveTo(target.id) }))];
    return [
      { id: "edit", label: "Edit…", icon: PencilIcon, onClick: () => setDialog({ mode: "edit", label }) },
      ...(isChild ? [] : [{ id: "add-child", label: "Add sub-label", icon: PlusIcon, onClick: () => setDialog({ mode: "create", parentId: label.id }) }]),
      hasChildren
        ? // No `items` here: Astryx's data path renders a nested-`items` row as a submenu and drops its `description`,
          // while a leaf row forwards it. The row is disabled and never opens, so a leaf shows the reason.
          { id: "move-to", label: "Move to", description: "Labels with sub-labels stay top level", isDisabled: true }
        : { id: "move-to", label: "Move to", isDisabled: moveItems.length === 0, items: moveItems },
      {
        id: "move-up",
        label: "Move up",
        icon: MoveUpIcon,
        isDisabled: up === null,
        onClick: () => up && run(`Could not move ${label.name}`, () => reorderLabelAction({ label_id: label.id, ...up })),
      },
      {
        id: "move-down",
        label: "Move down",
        icon: MoveDownIcon,
        isDisabled: down === null,
        onClick: () => down && run(`Could not move ${label.name}`, () => reorderLabelAction({ label_id: label.id, ...down })),
      },
      { type: "divider" },
      { id: "delete", label: "Delete…", icon: TrashIcon, variant: "destructive", onClick: () => setDeleting(label) },
    ];
  };

  const deleteDescription = (label: Label) => {
    const children = childrenOf(label.id).length;
    const base = `Removes it from ${usage[label.id] ?? 0} work items and from saved views.`;
    return children > 0 ? `${base} Its ${children} sub-labels are deleted too.` : base;
  };

  return (
    <VStack gap={3}>
      <HStack justify="end">
        <Button variant="primary" size="sm" label="New label" icon={<PlusIcon />} isDisabled={isArchived} onClick={() => setDialog({ mode: "create", parentId: null })} />
      </HStack>
      {rows.length === 0 ? (
        <EmptyState isCompact title="No labels yet" />
      ) : (
        <List density="compact" hasDividers>
          {rows.map((label) => (
            <ListItem
              key={label.id}
              className={label.parent_id === null ? undefined : "tessera-settings-child"}
              startContent={<Icon icon={TagIcon} color={label.color} size="sm" />}
              label={label.name}
              endContent={
                <HStack gap={2} vAlign="center">
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {countText(usage[label.id] ?? 0)}
                  </Text>
                  <MoreMenu label={`Actions for ${label.name}`} size="sm" alignment="end" isDisabled={isArchived || isPending} items={menuFor(label)} />
                </HStack>
              }
            />
          ))}
        </List>
      )}
      {dialog ? (
        <LabelDialog
          isOpen
          onOpenChange={(open) => !open && setDialog(null)}
          projectId={bundle.project.id}
          label={dialog.mode === "edit" ? dialog.label : undefined}
          parentId={dialog.mode === "create" ? dialog.parentId : undefined}
        />
      ) : null}
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !isPending && !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "label"}?`}
        description={deleting ? deleteDescription(deleting) : ""}
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isPending}
        onAction={() => {
          if (deleting) run(`Could not delete ${deleting.name}`, () => deleteLabelAction({ label_id: deleting.id }), () => setDeleting(null));
        }}
      />
    </VStack>
  );
}
