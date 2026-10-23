"use client";

/**
 * One draft: project, name, description and, once a project is chosen, the
 * property controls. The first save creates the row. Creating the work item
 * moves the draft into the project.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createDraftAction, deleteDraftAction, moveDraftToProjectAction, updateDraftAction } from "@/app/actions/drafts";
import { AlertDialog, Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { failureText } from "@/components/planning/archive-rules";
import { useOptionalProject } from "@/components/work-items/project-provider";
import { AssigneeControl, CycleControl, DateControl, EstimateControl, LabelControl, ModuleControl, PriorityControl, StateControl } from "@/components/work-items/properties";
import type { DraftView, Priority } from "@/lib/tessera/types";

const NONE = "__none__";

type ProjectOption = { id: string; name: string; identifier: string };

export type DraftDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  draft: DraftView | null;
  projects: readonly ProjectOption[];
};

export function DraftDialog({ isOpen, onOpenChange, draft, projects }: DraftDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={640} aria-label={draft ? "Edit draft" : "New draft"}>
      {isOpen ? <DraftForm draft={draft} projects={projects} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function DraftForm({ draft, projects, onOpenChange }: Omit<DraftDialogProps, "isOpen">) {
  const router = useRouter();
  const toast = useToast();
  const context = useOptionalProject();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(draft?.name ?? "");
  const [description, setDescription] = useState(draft?.description_md ?? "");
  const [priority, setPriority] = useState<Priority>(draft?.priority ?? "none");
  const [stateId, setStateId] = useState(draft?.state_id ?? context?.bundle.states.find((state) => state.is_default)?.id ?? "");
  const [labelIds, setLabelIds] = useState<string[]>(draft?.label_ids ?? []);
  const [moduleIds, setModuleIds] = useState<string[]>(draft?.module_ids ?? []);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(draft?.assignee_ids ?? []);
  const [cycleId, setCycleId] = useState<string | null>(draft?.cycle_id ?? null);
  const [estimatePointId, setEstimatePointId] = useState<string | null>(draft?.estimate_point_id ?? null);
  const [startDate, setStartDate] = useState<string | null>(draft?.start_date ?? null);
  const [targetDate, setTargetDate] = useState<string | null>(draft?.target_date ?? null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const projectId = draft?.project_id ?? context?.bundle.project.id ?? null;
  const options: SelectorOptionData[] = [{ value: NONE, label: "No project" }, ...projects.map((project) => ({ value: project.id, label: `${project.identifier} ${project.name}` }))];

  const fields = () => ({
    name: name.trim(),
    description_md: description,
    priority,
    ...(projectId
      ? {
          project_id: projectId,
          state_id: stateId || null,
          label_ids: labelIds,
          module_ids: moduleIds,
          assignee_ids: assigneeIds,
          cycle_id: cycleId,
          estimate_point_id: estimatePointId,
          start_date: startDate,
          target_date: targetDate,
        }
      : {}),
  });

  const fail = (what: string, message: string) => {
    setError(failureText(what, message));
    toast({ type: "error", body: failureText(what, message) });
  };

  const save = () => {
    if (!draft && name.trim() === "" && description.trim() === "") return;
    setError(null);
    startTransition(async () => {
      if (draft) {
        const result = await updateDraftAction({ draft_id: draft.id, ...fields() });
        if (!result.ok) fail("Could not save the draft", result.message);
        else toast({ type: "info", body: "Draft saved" });
        return;
      }
      const result = await createDraftAction(fields());
      if (!result.ok) {
        fail("Could not save the draft", result.message);
        return;
      }
      toast({ type: "info", body: "Draft saved" });
      const next = projectId ? `/drafts?draft=${result.data.id}&project=${projectId}` : `/drafts?draft=${result.data.id}`;
      router.replace(next);
    });
  };

  const changeProject = (next: string) => {
    const project = next === NONE ? null : next;
    startTransition(async () => {
      if (!draft) {
        const created = await createDraftAction({ ...fields(), project_id: project });
        if (!created.ok) {
          fail("Could not save the draft", created.message);
          return;
        }
        router.push(project ? `/drafts?draft=${created.data.id}&project=${project}` : `/drafts?draft=${created.data.id}`);
        return;
      }
      const result = await updateDraftAction({ draft_id: draft.id, project_id: project });
      if (!result.ok) {
        fail("Could not move the draft", result.message);
        return;
      }
      router.push(project ? `/drafts?draft=${draft.id}&project=${project}` : `/drafts?draft=${draft.id}`);
    });
  };

  const createItem = () => {
    if (!draft || !projectId || name.trim() === "") return;
    startTransition(async () => {
      const saved = await updateDraftAction({ draft_id: draft.id, ...fields() });
      if (!saved.ok) {
        fail("Could not save the draft", saved.message);
        return;
      }
      const result = await moveDraftToProjectAction({ draft_id: draft.id, project_id: projectId });
      if (!result.ok) {
        fail("Could not create the work item", result.message);
        return;
      }
      const dropped = result.data.dropped;
      toast({
        type: "info",
        body: dropped.length > 0 ? `Created ${result.data.work_item.key}. Dropped: ${dropped.join(", ")}` : `Created ${result.data.work_item.key}`,
        endContent: <Button variant="ghost" size="sm" label="Open" href={`/projects/${projectId}/work-items/${result.data.work_item.id}`} />,
      });
      router.push("/drafts");
    });
  };

  const remove = () => {
    if (!draft) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const result = await deleteDraftAction({ draft_id: draft.id });
      setConfirmDelete(false);
      if (!result.ok) fail("Could not delete the draft", result.message);
      else {
        toast({ type: "info", body: "Draft deleted" });
        router.push("/drafts");
      }
    });
  };

  const bundle = context?.bundle;

  return (
    <>
      <Layout
        header={<DialogHeader title={draft ? "Edit draft" : "New draft"} onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent>
            <VStack gap={4} className="tessera-drafts-fields">
              <Selector label="Project" hasClear={false} options={options} value={projectId ?? NONE} onChange={changeProject} />
              <TextInput label="Name" value={name} onChange={setName} onEnter={save} onBlur={save} placeholder="Untitled draft" />
              <TextArea label="Description" value={description} onChange={setDescription} onBlur={save} rows={4} />
              {bundle && projectId ? (
                <HStack gap={3} wrap="wrap">
                  <StateControl value={stateId} onChange={setStateId} />
                  <PriorityControl value={priority} onChange={setPriority} />
                  <LabelControl value={labelIds} onChange={setLabelIds} />
                  <AssigneeControl value={assigneeIds} onChange={setAssigneeIds} />
                  {bundle.project.cycles_enabled ? <CycleControl value={cycleId} onChange={setCycleId} /> : null}
                  {bundle.project.modules_enabled ? <ModuleControl value={moduleIds} onChange={setModuleIds} /> : null}
                  <EstimateControl value={estimatePointId} onChange={setEstimatePointId} />
                  <DateControl label="Start date" value={startDate} max={targetDate} onChange={setStartDate} />
                  <DateControl label="Target date" value={targetDate} min={startDate} onChange={setTargetDate} />
                </HStack>
              ) : null}
              {error ? <FieldStatus type="error" message={error} /> : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            {/* Wraps: on a phone the three labels ("Delete draft", "Save draft", "Create work item") do not fit one row and were cut to "Delete dr…". */}
            <HStack gap={2} hAlign="end" wrap="wrap" className="tessera-drafts-footer">
              <Button variant="ghost" label="Delete draft" onClick={() => (draft ? setConfirmDelete(true) : onOpenChange(false))} />
              <Button variant="secondary" label="Save draft" isLoading={isPending} onClick={save} />
              <Button variant="primary" label="Create work item" isDisabled={!draft || !projectId || name.trim() === ""} isLoading={isPending} onClick={createItem} />
            </HStack>
          </LayoutFooter>
        }
      />
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this draft?"
        description="The draft is removed. It does not become a work item."
        actionLabel="Delete"
        actionVariant="destructive"
        onAction={remove}
      />
    </>
  );
}
