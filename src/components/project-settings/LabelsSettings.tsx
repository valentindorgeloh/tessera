"use client";

/**
 * Labels tab of the project settings (docs/drafts/p4-ui.md "Labels"): one list
 * of the top-level labels, each followed by its sub-labels, with a row menu
 * (edit, add sub-label, move to, move up and down, delete). `usage` is the
 * count of work items per label id (`getTaxonomyUsage`, read by the page).
 * Everything is disabled in an archived project. Rows reorder by pointer drag
 * (decision 105): the top level and each parent's children are the containers,
 * and a drop into another container reparents and reorders in one
 * `reorder_label` call (an empty parent shows a nesting zone while a label is
 * held; a label with sub-labels stays top level). Move to, Move up and Move
 * down stay as the keyboard path. The order updates optimistically (decision
 * 13) and reverts with a toast.
 */
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
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
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import { failureText } from "@/components/planning/archive-rules";
import { RowDragOverlay, RowGrip, RowSlot } from "@/components/shared/RowDrag";
import { AlertDialog } from "@/components/shell/dialogs";
import { useProject } from "@/components/work-items/project-provider";
import type { Label } from "@/lib/tessera/types";
import { MoveDownIcon, MoveUpIcon, PencilIcon, PlusIcon, TagIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { LabelDialog } from "./LabelDialog";
import { LABEL_TOP_CONTAINER, labelContainerId, labelDrop, labelDropRefusal, labelsIn, moveLabel } from "./reorder-drop";
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

  const [labels, applyMove] = useOptimistic(bundle.labels, (current: Label[], move: { id: string; parentId: string | null; index: number }) => moveLabel(current, move.id, move.parentId, move.index));
  const topLevel = labelsIn(labels, null);
  const childrenOf = (id: string) => labelsIn(labels, id);

  const onDrop = (event: DragDropEvent) => {
    const drop = labelDrop(labels, event);
    const moved = labels.find((label) => label.id === event.id);
    // A drop the one-level rule refuses is not a move: nothing changes and the row snaps back.
    if (drop === null || moved === undefined) return;
    startTransition(async () => {
      applyMove({ id: drop.label_id, parentId: drop.parent_id, index: drop.index });
      const result = await reorderLabelAction({ label_id: drop.label_id, parent_id: drop.parent_id, before_id: drop.before_id, after_id: drop.after_id });
      if (!result.ok) toast({ type: "error", body: failureText(`Could not move ${moved.name}`, result.message) });
    });
  };
  const { drag, registerContainer, registerItem, registerOverlay, itemHandlers } = usePointerDrag({
    onDrop,
    itemsOf: (container) => {
      if (container === LABEL_TOP_CONTAINER) return topLevel.map((label) => label.id);
      return labels.filter((label) => labelContainerId(label.parent_id) === container).map((label) => label.id);
    },
  });
  const dragged = drag ? labels.find((label) => label.id === drag.id) : undefined;
  const canDrag = !isArchived;
  /** Whether the held label may land in `parentId`'s container (the one-level rule). */
  const accepts = (parentId: string | null) => drag !== null && labelDropRefusal(labels, drag.id, parentId) === null;
  const slotIn = (parentId: string | null) =>
    drag?.target && drag.target.container === labelContainerId(parentId) && accepts(parentId) ? drag.target.index : null;

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

  const labelRow = (label: Label) => {
    const isChild = label.parent_id !== null;
    return (
      <ListItem
        key={label.id}
        ref={canDrag ? registerItem(label.id) : undefined}
        {...(canDrag ? itemHandlers(label.id, labelContainerId(label.parent_id)) : {})}
        className={[isChild ? "tessera-settings-child" : "", canDrag ? "tessera-row-draggable" : ""].filter(Boolean).join(" ") || undefined}
        startContent={
          canDrag ? (
            <HStack gap={2} vAlign="center">
              <RowGrip />
              <Icon icon={TagIcon} color={label.color} size="sm" />
            </HStack>
          ) : (
            <Icon icon={TagIcon} color={label.color} size="sm" />
          )
        }
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
    );
  };

  /** One parent's children as their own list, so the container has its own box to drop into. */
  const childrenBlock = (parent: Label): ReactNode => {
    const children = childrenOf(parent.id).filter((child) => child.id !== drag?.id);
    const slotAt = slotIn(parent.id);
    if (children.length === 0 && !(drag && accepts(parent.id))) return null;
    if (children.length === 0 && slotAt === null) {
      // Empty parent while a label is held: a zone to nest under it.
      return (
        <VStack ref={registerContainer(labelContainerId(parent.id))} className="tessera-label-nest-zone" vAlign="center" paddingInline={4}>
          <Text type="supporting" color="secondary">
            Drop to nest under {parent.name}
          </Text>
        </VStack>
      );
    }
    const rows: ReactNode[] = children.map(labelRow);
    if (slotAt !== null && drag) rows.splice(Math.min(slotAt, rows.length), 0, <RowSlot key="slot" height={drag.height} />);
    return (
      <List ref={registerContainer(labelContainerId(parent.id))} density="compact" hasDividers className="tessera-label-children">
        {rows}
      </List>
    );
  };

  // The held label leaves the list (a parent takes its children with it); a dashed slot shows where it lands.
  const groups: ReactNode[] = topLevel
    .filter((parent) => parent.id !== drag?.id)
    .map((parent) => (
      <VStack key={parent.id} gap={0} className="tessera-label-group">
        <List density="compact" hasDividers>
          {labelRow(parent)}
        </List>
        {childrenBlock(parent)}
      </VStack>
    ));
  const topSlot = slotIn(null);
  if (topSlot !== null && drag) {
    groups.splice(
      Math.min(topSlot, groups.length),
      0,
      <VStack key="slot" gap={0} className="tessera-label-group">
        <List density="compact">
          <RowSlot height={drag.height} />
        </List>
      </VStack>,
    );
  }

  return (
    <VStack gap={3}>
      <HStack justify="end">
        <Button variant="primary" size="sm" label="New label" icon={<PlusIcon />} isDisabled={isArchived} onClick={() => setDialog({ mode: "create", parentId: null })} />
      </HStack>
      {topLevel.length === 0 ? (
        <EmptyState isCompact title="No labels yet" />
      ) : (
        <VStack gap={0} ref={registerContainer(LABEL_TOP_CONTAINER)}>
          {groups}
        </VStack>
      )}
      {drag && dragged ? <RowDragOverlay registerOverlay={registerOverlay} icon={TagIcon} color={dragged.color} label={dragged.name} /> : null}
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
