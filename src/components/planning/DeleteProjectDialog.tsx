"use client";

/**
 * "Delete project" dialog (docs/contracts/ui.md "Archives (E3)"): the user
 * types the project identifier before the destructive button enables
 * (`confirmsDelete`: trimmed, any case). Deletes through
 * `deleteProjectAction` and lands on `/projects`; a failure shows inline and
 * the dialog stays open. A successful delete also closes the project's tabs
 * and forgets it as the last visited project, which the off-project
 * shortcuts (`g c`, `n m`, …) would otherwise still open. Rendered by `ProjectMenu` (project frame) and by
 * `ArchivedProjects` (`/projects/archives`), so it takes the project as a prop
 * and never reads `useProject()`.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteProjectAction } from "@/app/actions/projects";
import { forgetTabsUnder } from "@/components/shell/TabBar";
import { forgetLastProject } from "@/components/shell/useShortcuts";
import type { Project } from "@/lib/tessera/types";
import { confirmsDelete } from "./archive-rules";

export type DeleteProjectDialogProps = {
  project: Pick<Project, "id" | "identifier" | "name">;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteProjectDialog({ project, isOpen, onOpenChange }: DeleteProjectDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={`Delete ${project.name}?`}>
      {/* Mounted only while open, so the typed text starts empty every time. */}
      {isOpen ? <DeleteProjectForm project={project} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function DeleteProjectForm({ project, onOpenChange }: Pick<DeleteProjectDialogProps, "project" | "onOpenChange">) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canDelete = confirmsDelete(project.identifier, typed) && !isPending;

  const submit = () => {
    if (!canDelete) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteProjectAction({ project_id: project.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast({ type: "info", body: `Deleted ${project.name}` });
      onOpenChange(false);
      forgetTabsUnder(`/projects/${project.id}`);
      forgetLastProject(project.id);
      router.push("/projects");
    });
  };

  return (
    <Layout
      header={<DialogHeader title={`Delete ${project.name}?`} onOpenChange={() => !isPending && onOpenChange(false)} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Text type="body">{`Deletes ${project.identifier} with its work items, cycles, modules and views.`}</Text>
            <TextInput
              label={`Type ${project.identifier} to confirm`}
              value={typed}
              onChange={setTyped}
              onEnter={submit}
              hasAutoFocus
              autoComplete="off"
            />
            {error ? <FieldStatus type="error" message={error} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="destructive" label="Delete project" onClick={submit} isLoading={isPending} isDisabled={!canDelete} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
