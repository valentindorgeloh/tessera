"use client";

/**
 * Archives › Cycles (docs/contracts/ui.md "Archives (E3)"): one row per
 * archived cycle linking to its detail (which shows the archived Banner),
 * with Restore and a menu holding Delete…. Restore needs no other cycles: the
 * engine answers CONFLICT when the dates now overlap an active cycle and its
 * message names that cycle, so the Toast reads "Could not restore Sprint 1.
 * The dates overlap cycle "Sprint 3"."
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
import { deleteCycleAction, unarchiveCycleAction } from "@/app/actions/cycles";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { forgetTabsUnder } from "@/components/shell/TabBar";
import type { Cycle } from "@/lib/tessera/types";
import { CycleIcon, RestoreIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { failureText } from "./archive-rules";
import { CYCLE_STATUS_LABEL, cycleStatusVariant, formatCycleRange } from "./cycle-format";

export type ArchivedCyclesProps = { projectId: string; cycles: Cycle[] };

export function ArchivedCycles({ projectId, cycles }: ArchivedCyclesProps) {
  const toast = useToast();
  const [deleting, setDeleting] = useState<Cycle | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const confirmDelete = () => {
    const cycle = deleting;
    if (cycle === null) return;
    startDelete(async () => {
      const result = await deleteCycleAction({ cycle_id: cycle.id });
      if (!result.ok) {
        toast({ type: "error", body: failureText(`Could not delete ${cycle.name}`, result.message) });
        return;
      }
      setDeleting(null);
      toast({ type: "info", body: `Deleted ${cycle.name}` });
      forgetTabsUnder(`/projects/${projectId}/cycles/${cycle.id}`);
    });
  };

  if (cycles.length === 0) {
    return (
      <VStack paddingInline={5} paddingBlock={6}>
        <EmptyState icon={<CycleIcon />} title="No archived cycles" description="Completed cycles you archive are kept here with their progress, until you restore them." />
      </VStack>
    );
  }

  // The extra end padding lets the last row's menu scroll clear of the bottom-end toasts and the dev indicator.
  return (
    <VStack gap={0} paddingInline={3} paddingBlockStart={2} paddingBlockEnd={10} className="tessera-archives-list">
      <List hasDividers aria-label="Archived cycles">
        {cycles.map((cycle) => (
          <ArchivedCycleRow key={cycle.id} projectId={projectId} cycle={cycle} onDelete={setDeleting} />
        ))}
      </List>
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDeleting) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "cycle"}?`}
        description="Its work items stay and leave the cycle."
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </VStack>
  );
}

type RowProps = { projectId: string; cycle: Cycle; onDelete: (cycle: Cycle) => void };

function ArchivedCycleRow({ projectId, cycle, onDelete }: RowProps) {
  const toast = useToast();
  const [isRestoring, startRestore] = useTransition();

  const restore = () => {
    startRestore(async () => {
      const result = await unarchiveCycleAction({ cycle_id: cycle.id });
      if (result.ok) toast({ type: "info", body: `Restored ${cycle.name}` });
      else toast({ type: "error", body: failureText(`Could not restore ${cycle.name}`, result.message) });
    });
  };

  return (
    <ListItem
      href={`/projects/${projectId}/cycles/${cycle.id}`}
      label={cycle.name}
      description={
        // No hover card: the time sits inside the row's link or button, which holds no second control or tab stop.
        <>
          {formatCycleRange(cycle.start_date, cycle.end_date)}
          {cycle.archived_at === null ? null : (
            <>
              {" · Archived "}
              <RelativeTime value={cycle.archived_at} hasTooltip={false} />
            </>
          )}
        </>
      }
      startContent={<StatusDot variant={cycleStatusVariant(cycle.status)} label={CYCLE_STATUS_LABEL[cycle.status]} />}
      endContent={
        <HStack gap={1} vAlign="center">
          <Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} isLoading={isRestoring} onClick={restore} />
          <MoreMenu
            label="Cycle actions"
            size="sm"
            alignment="end"
            items={[{ id: "delete", label: "Delete…", icon: TrashIcon, variant: "destructive", onClick: () => onDelete(cycle) }]}
          />
        </HStack>
      }
    />
  );
}
