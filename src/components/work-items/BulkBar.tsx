"use client";

/**
 * Actions for the selected work items. Edits and archive apply at once; a
 * refusal (mixed archive) stays in a toast and the selection stays. Delete
 * asks first. "Copy to project…" and "Move to project…" open
 * BulkTransferDialog (decision 107); the move confirms inside the dialog.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu, DropdownMenuCheckboxItem } from "@astryxdesign/core/DropdownMenu";
import { useEntryAnimation } from "@astryxdesign/core/hooks";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import {
  bulkArchiveWorkItemsAction,
  bulkDeleteWorkItemsAction,
  bulkUnarchiveWorkItemsAction,
  bulkUpdateWorkItemsAction,
} from "@/app/actions/work-items";
import { AlertDialog } from "@/components/shell/dialogs";
import { BulkTransferDialog } from "@/components/work-items/BulkTransferDialog";
import { useProject } from "@/components/work-items/project-provider";
import { hasUnloaded, loadedOfTotal } from "@/components/work-items/paging";
import { CycleControl, DateControl, EstimateControl, PriorityControl, StateControl } from "@/components/work-items/properties";
import type { Priority, WorkItem } from "@/lib/tessera/types";
import { ArchiveIcon, CopyIcon, MoveToProjectIcon, RestoreIcon, TrashIcon } from "@/themes/catppuccin/icons";

export type BulkBarProps = {
  items: readonly WorkItem[];
  selected: ReadonlySet<string>;
  onClear: () => void;
  variant?: "active" | "archived";
  /** Rows the list holds and the size of the whole filtered set. A selection reaches only the loaded rows (decision 114). */
  loaded?: number;
  total?: number;
};

export function BulkBar({ items, selected, onClear, variant = "active", loaded, total }: BulkBarProps) {
  const toast = useToast();
  const { bundle } = useProject();
  // The bar mounts when the first row is ticked, so it rises into place (Astryx's `slideUp`: null on first paint and
  // while hydrating, off under Reduce Motion). It leaves at once when the selection clears.
  const entry = useEntryAnimation("slideUp");
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transfer, setTransfer] = useState<"copy" | "move" | null>(null);
  const chosen = items.filter((item) => selected.has(item.id));
  const ids = chosen.map((item) => item.id);
  const count = ids.length;
  if (count === 0) return null;

  const finish = (result: { ok: true } | { ok: false; message: string }, done: string) => {
    if (!result.ok) {
      toast({ type: "error", body: result.message });
      return;
    }
    toast({ type: "info", body: done });
    onClear();
  };

  const patch = (fields: { state_id?: string; priority?: Priority; cycle_id?: string | null; estimate_point_id?: string | null; start_date?: string | null; target_date?: string | null }) => {
    startTransition(async () => {
      finish(await bulkUpdateWorkItemsAction({ ids, patch: fields }), `Updated ${count} work items`);
    });
  };

  const membership = (id: string, on: boolean, add: "add_label_ids" | "add_assignee_ids" | "add_module_ids", remove: "remove_label_ids" | "remove_assignee_ids" | "remove_module_ids") => {
    startTransition(async () => {
      const result = on
        ? await bulkUpdateWorkItemsAction({ ids, [add]: [id] })
        : await bulkUpdateWorkItemsAction({ ids, [remove]: [id] });
      finish(result, `Updated ${count} work items`);
    });
  };

  const everyHas = (field: "label_ids" | "assignee_ids" | "module_ids", id: string) => chosen.every((item) => item[field].includes(id));

  return (
    <>
      <HStack gap={2} vAlign="center" wrap="wrap" className="tessera-bulk-bar" role="region" aria-label="Bulk actions" xstyle={entry ?? undefined}>
        {/* The count, its note and Clear: part of the bar's own row on wide screens (display: contents), the first row of a phone's two (bulk.css). */}
        <HStack gap={2} vAlign="center" className="tessera-bulk-summary">
          <Text weight="medium">{count} selected</Text>
          {loaded !== undefined && total !== undefined && hasUnloaded(loaded, total) ? (
            <Text type="supporting" color="secondary">
              Loaded rows only ({loadedOfTotal(loaded, total)})
            </Text>
          ) : null}
          <Button variant="ghost" size="sm" label="Clear" onClick={onClear} />
        </HStack>
        {/* Wide: the actions flow in the bar (display: contents). A phone: one scrolling row under the count (bulk.css). */}
        <HStack gap={2} vAlign="center" className="tessera-bulk-actions">
          {variant === "archived" ? (
            <Button
              variant="secondary"
              size="sm"
              label="Restore"
              icon={<RestoreIcon />}
              isLoading={isPending}
              onClick={() => {
                startTransition(async () => {
                  finish(await bulkUnarchiveWorkItemsAction({ ids }), `Restored ${count} work items`);
                });
              }}
            />
          ) : (
            <>
              <StateControl value={chosen[0]?.state_id ?? ""} onChange={(state_id) => patch({ state_id })} compact />
              <PriorityControl value={chosen[0]?.priority ?? "none"} onChange={(priority) => patch({ priority })} compact />
              {bundle.project.cycles_enabled ? <CycleControl value={chosen[0]?.cycle_id ?? null} onChange={(cycle_id) => patch({ cycle_id })} compact /> : null}
              <DateControl label="Start date" compact value={chosen[0]?.start_date ?? null} onChange={(start_date) => patch({ start_date })} />
              <DateControl label="Target date" compact value={chosen[0]?.target_date ?? null} onChange={(target_date) => patch({ target_date })} />
              <EstimateControl value={chosen[0]?.estimate_point_id ?? null} onChange={(estimate_point_id) => patch({ estimate_point_id })} size="sm" />
              <MembershipMenu label="Labels" rows={bundle.labels} checked={(id) => everyHas("label_ids", id)} onToggle={(id, on) => membership(id, on, "add_label_ids", "remove_label_ids")} />
              <MembershipMenu label="Assignees" rows={bundle.actors.filter((actor) => actor.kind !== "system")} checked={(id) => everyHas("assignee_ids", id)} onToggle={(id, on) => membership(id, on, "add_assignee_ids", "remove_assignee_ids")} />
              {bundle.project.modules_enabled ? (
                <MembershipMenu label="Modules" rows={bundle.modules} checked={(id) => everyHas("module_ids", id)} onToggle={(id, on) => membership(id, on, "add_module_ids", "remove_module_ids")} />
              ) : null}
              <Button variant="secondary" size="sm" label="Copy to project…" icon={<CopyIcon />} onClick={() => setTransfer("copy")} />
              <Button variant="secondary" size="sm" label="Move to project…" icon={<MoveToProjectIcon />} onClick={() => setTransfer("move")} />
              <Button
                variant="secondary"
                size="sm"
                label="Archive"
                icon={<ArchiveIcon />}
                isLoading={isPending}
                onClick={() => {
                  startTransition(async () => {
                    finish(await bulkArchiveWorkItemsAction({ ids }), `Archived ${count} work items`);
                  });
                }}
              />
            </>
          )}
          <Button variant="ghost" size="sm" label="Delete" icon={<TrashIcon />} onClick={() => setConfirmDelete(true)} />
        </HStack>
      </HStack>
      {transfer !== null ? (
        <BulkTransferDialog
          isOpen
          onOpenChange={(open) => !open && setTransfer(null)}
          mode={transfer}
          ids={ids}
          sourceProjectIds={[...new Set(chosen.map((item) => item.project_id))]}
          projects={bundle.projects}
          onDone={onClear}
        />
      ) : null}
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${count} work items?`}
        description="The work items and their sub-items are deleted. The keys are not reused."
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isPending}
        onAction={() => {
          startTransition(async () => {
            const result = await bulkDeleteWorkItemsAction({ ids });
            setConfirmDelete(false);
            finish(result, `Deleted ${count} work items`);
          });
        }}
      />
    </>
  );
}

function MembershipMenu({
  label,
  rows,
  checked,
  onToggle,
}: {
  label: string;
  rows: readonly { id: string; name: string }[];
  checked: (id: string) => boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <DropdownMenu button={{ label, size: "sm", variant: "secondary" }}>
      {rows.map((row) => (
        <DropdownMenuCheckboxItem key={row.id} label={row.name} value={checked(row.id)} hasCloseOnSelect={false} onChange={(on) => onToggle(row.id, on)} />
      ))}
    </DropdownMenu>
  );
}
