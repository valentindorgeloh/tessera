"use client";

/**
 * Transfer the open work items of a completed cycle (docs/contracts/ui.md
 * "Cycles (E1)"): to a current, upcoming or draft cycle of the project, or out
 * of any cycle ("No cycle"). The first transfer freezes the source's progress,
 * which the dialog says before it runs; a cycle frozen earlier keeps its
 * snapshot, and the dialog says that instead. Targets come from the bundle (it
 * holds no archived cycles); the option description carries the status.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { transferCycleWorkItemsAction } from "@/app/actions/cycles";
import { useProject } from "@/components/work-items/project-provider";
import type { Cycle } from "@/lib/tessera/types";
import { CYCLE_STATUS_LABEL, transferTargets, transferText } from "./cycle-format";

export type TransferDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Completed, not archived; N = cycle.open_count. */
  cycle: Cycle;
};

/** The Selector value for "out of any cycle" (the DisplayMenu NONE pattern). */
export const NO_CYCLE = "__none__";

function workItems(n: number): string {
  return n === 1 ? "1 work item" : `${n} work items`;
}

export function TransferDialog({ isOpen, onOpenChange, cycle }: TransferDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label="Transfer open items">
      {isOpen ? <TransferForm onOpenChange={onOpenChange} cycle={cycle} /> : null}
    </Dialog>
  );
}

function TransferForm({ onOpenChange, cycle }: Omit<TransferDialogProps, "isOpen">) {
  const toast = useToast();
  const { bundle } = useProject();
  const [isPending, startTransition] = useTransition();
  const targets = transferTargets(bundle.cycles, cycle.id);
  const [value, setValue] = useState<string>(targets[0]?.id ?? NO_CYCLE);
  const count = cycle.open_count;

  const options: SelectorOptionData[] = [
    ...targets.map((target) => ({ value: target.id, label: target.name, description: CYCLE_STATUS_LABEL[target.status] })),
    { value: NO_CYCLE, label: "No cycle", description: "The items leave every cycle" },
  ];

  const submit = () => {
    if (isPending) return;
    const toCycle = value === NO_CYCLE ? null : (targets.find((target) => target.id === value) ?? null);
    startTransition(async () => {
      const result = await transferCycleWorkItemsAction({ cycle_id: cycle.id, to_cycle_id: toCycle?.id ?? null });
      if (!result.ok) {
        toast({ type: "error", body: `Could not transfer the open items of ${cycle.name}: ${result.message}` });
        return;
      }
      const moved = workItems(result.data.moved);
      toast({ type: "info", body: toCycle ? `Moved ${moved} to ${toCycle.name}` : `Moved ${moved} out of the cycle` });
      onOpenChange(false);
    });
  };

  const close = () => {
    if (!isPending) onOpenChange(false);
  };

  return (
    <Layout
      header={<DialogHeader title="Transfer open items" onOpenChange={close} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Text>{transferText(cycle.name, count, cycle.progress_snapshot !== null)}</Text>
            <Selector label="Move to" options={options} value={value} onChange={setValue} />
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={close} isDisabled={isPending} />
            <Button variant="primary" label={`Transfer ${workItems(count)}`} onClick={submit} isLoading={isPending} isDisabled={count === 0} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
