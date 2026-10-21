"use client";

/**
 * Copy or move the selected work items into another live project (decision
 * 107, docs/drafts/p10-plan.md "Bulk bar"). One call, all or nothing. A move
 * asks for confirmation inside the dialog: the old keys stop resolving, so the
 * action button is destructive and named for the count. Project choices follow
 * the single-item dialog (detail/ProjectTransferDialog.tsx): a copy may land in
 * any live project, the source included; a move leaves out every project that
 * holds a selected item, since the engine refuses a move into the item's own project.
 */
import { useState, useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { bulkTransferWorkItemsAction } from "@/app/actions/work-items";
import { failureText } from "@/components/planning/archive-rules";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";

/** decision 107: `bulk_transfer_work_items` takes at most 100 ids. */
export const BULK_TRANSFER_LIMIT = 100;

const COPY_RULES = "Copies keep description, priority, dates and labels with the same name; cycle, modules, estimate and assignees are cleared.";
const MOVE_RULES = "Items get new keys. Labels and states are matched by name; cycle, modules, estimate and parent are cleared; sub-items stay in this project.";

/** The projects the dialog offers: every one for a copy, all but the source projects for a move. */
export function transferChoices<T extends { id: string }>(projects: readonly T[], mode: "copy" | "move", sourceProjectIds: readonly string[]): T[] {
  return projects.filter((project) => mode === "copy" || !sourceProjectIds.includes(project.id));
}

export type BulkTransferDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  mode: "copy" | "move";
  ids: readonly string[];
  /** Projects that hold the selected items (more than one in a cross-project list). A move never targets them. */
  sourceProjectIds: readonly string[];
  projects: readonly { id: string; name: string; identifier: string }[];
  /** Called after a successful transfer, e.g. to clear the selection. */
  onDone: () => void;
};

export function BulkTransferDialog({ isOpen, onOpenChange, mode, ids, sourceProjectIds, projects, onDone }: BulkTransferDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={mode === "copy" ? "Copy to project" : "Move to project"}>
      {isOpen ? <TransferForm mode={mode} ids={ids} sourceProjectIds={sourceProjectIds} projects={projects} onOpenChange={onOpenChange} onDone={onDone} /> : null}
    </Dialog>
  );
}

function TransferForm({ mode, ids, sourceProjectIds, projects, onOpenChange, onDone }: Omit<BulkTransferDialogProps, "isOpen">) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const choices = transferChoices(projects, mode, sourceProjectIds);
  const [target, setTarget] = useState(choices[0]?.id ?? "");
  const options: SelectorOptionData[] = choices.map((project) => ({ value: project.id, label: `${project.identifier} ${project.name}` }));
  const count = ids.length;
  const noun = count === 1 ? "work item" : "work items";
  const tooMany = count > BULK_TRANSFER_LIMIT;
  const targetName = choices.find((project) => project.id === target)?.identifier ?? "";

  const submit = () => {
    if (target === "" || tooMany) return;
    startTransition(async () => {
      const result = await bulkTransferWorkItemsAction({ work_item_ids: [...ids], project_id: target, mode, ...(mode === "move" ? { confirm: true } : {}) });
      if (!result.ok) {
        toast({ type: "error", body: failureText(mode === "copy" ? "Could not copy the work items" : "Could not move the work items", result.message) });
        return;
      }
      toast({
        type: "info",
        body: `${mode === "copy" ? "Copied" : "Moved"} ${result.data.length} ${result.data.length === 1 ? "work item" : "work items"} to ${targetName}`,
        endContent: <Button variant="ghost" size="sm" label="Open project" href={`/projects/${target}/work-items`} />,
      });
      onOpenChange(false);
      onDone();
    });
  };

  return (
    <Layout
      header={<DialogHeader title={mode === "copy" ? `Copy ${count} ${noun} to project` : `Move ${count} ${noun} to project`} onOpenChange={onOpenChange} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={3}>
            <Selector label="Project" options={options} value={target} onChange={setTarget} isDisabled={options.length === 0} placeholder="No other project" />
            <Text type="supporting" color="secondary">
              {mode === "copy" ? COPY_RULES : MOVE_RULES}
            </Text>
            {mode === "move" ? (
              <Banner status="warning" container="section" title="Old keys stop resolving" description="If any item cannot move, none of them moves." />
            ) : null}
            {tooMany ? <Banner status="warning" container="section" title={`Select at most ${BULK_TRANSFER_LIMIT} work items`} description={`${count} are selected.`} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} />
            <Button
              variant={mode === "move" ? "destructive" : "primary"}
              label={mode === "copy" ? `Copy ${count} ${noun}` : `Move ${count} ${noun}`}
              isDisabled={target === "" || tooMany}
              isLoading={isPending}
              onClick={submit}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
