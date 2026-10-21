"use client";

/**
 * States tab of the project settings (docs/drafts/p4-ui.md "States"): one list
 * per state group in the order backlog, unstarted, started, completed,
 * cancelled (triage is never shown), each with an "Add <group> state" button
 * and a row menu (edit, set as default, move up and down, delete). `usage` is
 * the count of work items per state id (`getTaxonomyUsage`, read by the page).
 * Everything is disabled in an archived project. Rows reorder by pointer drag
 * within their group (decision 105: each group is a container, a drop in
 * another group snaps back); Move up and Move down stay as the keyboard path.
 * The order updates optimistically (decision 13) and reverts with a toast.
 */
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { deleteStateAction, reorderStateAction, setDefaultStateAction } from "@/app/actions/states-labels";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import { failureText } from "@/components/planning/archive-rules";
import { RowDragOverlay, RowGrip, RowSlot } from "@/components/shared/RowDrag";
import { AlertDialog } from "@/components/shell/dialogs";
import { useProject } from "@/components/work-items/project-provider";
import { stateGroupVariant } from "@/components/work-items/properties";
import type { State, StateGroup } from "@/lib/tessera/types";
import { MoveDownIcon, MoveUpIcon, PencilIcon, PlusIcon, StateIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { DeleteStateDialog } from "./DeleteStateDialog";
import { StateDialog } from "./StateDialog";
import { SETTINGS_STATE_GROUPS, SETTINGS_STATE_GROUP_LABELS } from "./palette-labels";
import { moveStateInGroup, stateContainerId, stateDrop } from "./reorder-drop";
import { siblingMove } from "./sibling-moves";

export type StatesSettingsProps = { usage: Record<string, number> };

type DialogState = { mode: "create"; group: StateGroup } | { mode: "edit"; state: State };

function countText(count: number): string {
  return `${count} work ${count === 1 ? "item" : "items"}`;
}

export function StatesSettings({ usage }: StatesSettingsProps) {
  const { bundle } = useProject();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleting, setDeleting] = useState<State | null>(null);
  const isArchived = bundle.project.archived_at !== null;
  const [orderedStates, applyMove] = useOptimistic(bundle.states, (current: State[], move: { id: string; index: number }) => moveStateInGroup(current, move.id, move.index));

  const onDrop = (event: DragDropEvent) => {
    const drop = stateDrop(orderedStates, event);
    const moved = orderedStates.find((state) => state.id === event.id);
    // A drop in another group is not a move: nothing changes and the row snaps back.
    if (drop === null || moved === undefined) return;
    startTransition(async () => {
      applyMove({ id: drop.state_id, index: drop.index });
      const result = await reorderStateAction({ state_id: drop.state_id, ...drop.input });
      if (!result.ok) toast({ type: "error", body: failureText(`Could not move ${moved.name}`, result.message) });
    });
  };
  const { drag, registerContainer, registerItem, registerOverlay, itemHandlers } = usePointerDrag({
    onDrop,
    itemsOf: (container) => orderedStates.filter((state) => stateContainerId(state.state_group) === container).map((state) => state.id),
  });
  const dragged = drag ? orderedStates.find((state) => state.id === drag.id) : undefined;

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

  const menuFor = (state: State, groupIds: string[]): DropdownMenuOption[] => {
    const up = siblingMove(groupIds, state.id, "up");
    const down = siblingMove(groupIds, state.id, "down");
    const deleteBlock = state.is_default ? "The default state can't be deleted" : groupIds.length <= 1 ? "Each group keeps at least one state" : undefined;
    return [
      { id: "edit", label: "Edit…", icon: PencilIcon, onClick: () => setDialog({ mode: "edit", state }) },
      {
        id: "default",
        label: "Set as default",
        isDisabled: state.is_default,
        onClick: () => run(`Could not set ${state.name} as default`, () => setDefaultStateAction({ state_id: state.id })),
      },
      {
        id: "move-up",
        label: "Move up",
        icon: MoveUpIcon,
        isDisabled: up === null,
        onClick: () => up && run(`Could not move ${state.name}`, () => reorderStateAction({ state_id: state.id, ...up })),
      },
      {
        id: "move-down",
        label: "Move down",
        icon: MoveDownIcon,
        isDisabled: down === null,
        onClick: () => down && run(`Could not move ${state.name}`, () => reorderStateAction({ state_id: state.id, ...down })),
      },
      { type: "divider" },
      { id: "delete", label: "Delete…", icon: TrashIcon, variant: "destructive", isDisabled: deleteBlock !== undefined, description: deleteBlock, onClick: () => setDeleting(state) },
    ];
  };

  const deletingCount = deleting ? (usage[deleting.id] ?? 0) : 0;

  return (
    <VStack gap={6}>
      {SETTINGS_STATE_GROUPS.map((group) => {
        const states = orderedStates.filter((state) => state.state_group === group);
        const label = SETTINGS_STATE_GROUP_LABELS[group];
        const ids = states.map((state) => state.id);
        const container = stateContainerId(group);
        const canDrag = !isArchived;
        // The held row leaves its group; the dashed slot shows only in that group (a drop elsewhere snaps back).
        const rows: ReactNode[] = states
          .filter((state) => state.id !== drag?.id)
          .map((state) => (
            <ListItem
              key={state.id}
              ref={canDrag ? registerItem(state.id) : undefined}
              {...(canDrag ? itemHandlers(state.id, container) : {})}
              className={canDrag ? "tessera-row-draggable" : undefined}
              startContent={
                canDrag ? (
                  <HStack gap={2} vAlign="center">
                    <RowGrip />
                    <Icon icon={StateIcon} color={state.color} size="sm" />
                  </HStack>
                ) : (
                  <Icon icon={StateIcon} color={state.color} size="sm" />
                )
              }
              label={state.name}
              description={state.description === "" ? undefined : state.description}
              endContent={
                <HStack gap={2} vAlign="center">
                  {state.is_default ? <Token label="Default" size="sm" /> : null}
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {countText(usage[state.id] ?? 0)}
                  </Text>
                  <MoreMenu label={`Actions for ${state.name}`} size="sm" alignment="end" isDisabled={isArchived || isPending} items={menuFor(state, ids)} />
                </HStack>
              }
            />
          ));
        if (drag?.target && drag.target.container === container && drag.fromContainer === container) {
          rows.splice(Math.min(drag.target.index, rows.length), 0, <RowSlot key="slot" height={drag.height} />);
        }
        return (
          <List
            key={group}
            ref={registerContainer(container)}
            density="compact"
            hasDividers
            header={
              <HStack gap={2} vAlign="center">
                <StatusDot variant={stateGroupVariant(group)} label={label} />
                <Text weight="medium">{label}</Text>
                <IconButton label={`Add ${label} state`} variant="ghost" size="sm" icon={<Icon icon={PlusIcon} size="sm" />} isDisabled={isArchived} onClick={() => setDialog({ mode: "create", group })} />
              </HStack>
            }
          >
            {rows}
          </List>
        );
      })}
      {drag && dragged ? <RowDragOverlay registerOverlay={registerOverlay} icon={StateIcon} color={dragged.color} label={dragged.name} /> : null}
      {dialog ? (
        <StateDialog
          isOpen
          onOpenChange={(open) => !open && setDialog(null)}
          projectId={bundle.project.id}
          group={dialog.mode === "create" ? dialog.group : dialog.state.state_group}
          state={dialog.mode === "edit" ? dialog.state : undefined}
        />
      ) : null}
      {deleting && deletingCount > 0 ? <DeleteStateDialog isOpen onOpenChange={(open) => !open && setDeleting(null)} state={deleting} count={deletingCount} /> : null}
      <AlertDialog
        isOpen={deleting !== null && deletingCount === 0}
        onOpenChange={(open) => !isPending && !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "state"}?`}
        description="This can't be undone."
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isPending}
        onAction={() => {
          if (deleting) run(`Could not delete ${deleting.name}`, () => deleteStateAction({ state_id: deleting.id }), () => setDeleting(null));
        }}
      />
    </VStack>
  );
}
