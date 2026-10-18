"use client";

/**
 * Copy or move one work item into another live project. Move leaves the
 * current project out of the list. The note states what the tools keep.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { copyWorkItemAction } from "@/app/actions/detail";
import { moveWorkItemToProjectAction } from "@/app/actions/work-items";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { failureText } from "@/components/planning/archive-rules";

const COPY_RULES = "The copy keeps description, priority, dates and labels with the same name; cycle, modules, estimate and assignees are cleared.";
const MOVE_RULES = "The item gets a new key. Labels and the state are matched by name; cycle, modules, estimate and parent are cleared; sub-items stay.";

export type ProjectTransferDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  mode: "copy" | "move";
  workItemId: string;
  projectId: string;
  projects: readonly { id: string; name: string; identifier: string }[];
};

export function ProjectTransferDialog({ isOpen, onOpenChange, mode, workItemId, projectId, projects }: ProjectTransferDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={mode === "copy" ? "Copy to project" : "Move to project"}>
      {isOpen ? (
        <TransferForm mode={mode} workItemId={workItemId} projectId={projectId} projects={projects} onOpenChange={onOpenChange} />
      ) : null}
    </Dialog>
  );
}

function TransferForm({ mode, workItemId, projectId, projects, onOpenChange }: Omit<ProjectTransferDialogProps, "isOpen">) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const choices = projects.filter((project) => mode === "copy" || project.id !== projectId);
  const [target, setTarget] = useState(choices[0]?.id ?? "");
  const options: SelectorOptionData[] = choices.map((project) => ({ value: project.id, label: `${project.identifier} ${project.name}` }));

  const submit = () => {
    if (target === "") return;
    startTransition(async () => {
      if (mode === "copy") {
        const result = await copyWorkItemAction({ work_item_id: workItemId, project_id: target });
        if (!result.ok) {
          toast({ type: "error", body: failureText("Could not copy the work item", result.message) });
          return;
        }
        const copied = result.data;
        toast({
          type: "info",
          body: `Copied as ${copied.key}`,
          endContent: <Button variant="ghost" size="sm" label="Open" href={`/projects/${copied.project_id}/work-items/${copied.id}`} />,
        });
        onOpenChange(false);
        return;
      }
      const result = await moveWorkItemToProjectAction({ work_item_id: workItemId, project_id: target });
      if (!result.ok) {
        toast({ type: "error", body: failureText("Could not move the work item", result.message) });
        return;
      }
      onOpenChange(false);
      router.push(`/projects/${target}/work-items/${workItemId}`);
    });
  };

  return (
    <Layout
      header={<DialogHeader title={mode === "copy" ? "Copy to project" : "Move to project"} onOpenChange={onOpenChange} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={3}>
            <Selector label="Project" options={options} value={target} onChange={setTarget} isDisabled={options.length === 0} placeholder="No other project" />
            <Text type="supporting" color="secondary">
              {mode === "copy" ? COPY_RULES : MOVE_RULES}
            </Text>
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} />
            <Button variant="primary" label={mode === "copy" ? "Copy" : "Move"} isDisabled={target === ""} isLoading={isPending} onClick={submit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
