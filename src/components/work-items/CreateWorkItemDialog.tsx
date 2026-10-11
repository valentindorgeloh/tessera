"use client";

/**
 * "New work item" dialog (docs/contracts/ui.md "Work items screen"): name,
 * description and the common properties, submitted through
 * `createWorkItemAction`. "Create more" keeps the dialog open and resets the
 * name and description; closing with unsaved text asks first.
 */
import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createWorkItemAction } from "@/app/actions/work-items";
import type { CreateWorkItemInputType, Priority } from "@/lib/tessera/types";
import { useProject } from "./project-provider";
import { AssigneeControl, CycleControl, DateControl, LabelControl, ModuleControl, PriorityControl, StateControl } from "./properties";

type CreateResult = Awaited<ReturnType<typeof createWorkItemAction>>;
export type CreatedWorkItem = Extract<CreateResult, { ok: true }>["data"];

export type CreateWorkItemDialogProps = {
  projectId: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Pre-filled fields, for example the group a quick-add row belongs to. */
  defaults?: Partial<Omit<CreateWorkItemInputType, "project_id">>;
  onCreated?: (item: CreatedWorkItem) => void;
};

type Draft = {
  name: string;
  description: string;
  state_id: string;
  priority: Priority;
  assignee_ids: string[];
  label_ids: string[];
  cycle_id: string | null;
  module_ids: string[];
  start_date: string | null;
  target_date: string | null;
};

type RequestCloseRef = RefObject<(() => void) | null>;

export function CreateWorkItemDialog({ projectId, isOpen, onOpenChange, defaults, onCreated }: CreateWorkItemDialogProps) {
  // Escape reaches the Dialog as onOpenChange(false); routing it through the form's
  // requestClose keeps the "discard this work item?" prompt for a dirty draft.
  const requestCloseRef = useRef<(() => void) | null>(null);
  const [isDiscardOpen, setDiscardOpen] = useState(false);
  const handleOpenChange = (open: boolean) => {
    if (open) onOpenChange(true);
    else if (requestCloseRef.current) requestCloseRef.current();
    else onOpenChange(false);
  };
  return (
    <>
      <Dialog isOpen={isOpen} onOpenChange={handleOpenChange} purpose="form" width={600}>
        {/* Mounted only while open so every session starts from a fresh draft. */}
        {isOpen ? (
          <CreateWorkItemForm
            projectId={projectId}
            onOpenChange={onOpenChange}
            defaults={defaults}
            onCreated={onCreated}
            requestCloseRef={requestCloseRef}
            onDiscardRequest={() => setDiscardOpen(true)}
          />
        ) : null}
      </Dialog>
      {/* A sibling of the form dialog rather than a child: a nested <dialog> inherits the outer
          dialog's padding tokens, which pushed this prompt's heading onto its edge, and Astryx
          advises against nesting dialogs. */}
      <AlertDialog
        isOpen={isDiscardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this work item?"
        description="The name and description you typed will be lost."
        cancelLabel="Keep editing"
        actionLabel="Discard"
        actionVariant="destructive"
        onAction={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

type CreateWorkItemFormProps = Omit<CreateWorkItemDialogProps, "isOpen"> & {
  requestCloseRef: RequestCloseRef;
  /** The draft has text and the user wants to close: the dialog shows the discard prompt. */
  onDiscardRequest: () => void;
};

function CreateWorkItemForm({ projectId, onOpenChange, defaults, onCreated, requestCloseRef, onDiscardRequest }: CreateWorkItemFormProps) {
  const { bundle } = useProject();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const defaultStateId = defaults?.state_id ?? bundle.states.find((state) => state.is_default)?.id ?? bundle.states[0]?.id ?? "";
  const [draft, setDraft] = useState<Draft>({
    name: defaults?.name ?? "",
    description: defaults?.description_md ?? "",
    state_id: defaultStateId,
    priority: defaults?.priority ?? "none",
    assignee_ids: defaults?.assignee_ids ?? [],
    label_ids: defaults?.label_ids ?? [],
    cycle_id: defaults?.cycle_id ?? null,
    module_ids: defaults?.module_ids ?? [],
    start_date: defaults?.start_date ?? null,
    target_date: defaults?.target_date ?? null,
  });
  const [createMore, setCreateMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }));
  const isDirty = draft.name.trim() !== "" || draft.description.trim() !== "";
  const canSubmit = draft.name.trim() !== "" && draft.state_id !== "" && !isPending;

  const requestClose = () => {
    if (isPending) return;
    if (isDirty) onDiscardRequest();
    else onOpenChange(false);
  };

  // The dialog's Escape handling calls whatever is registered here (see CreateWorkItemDialog).
  useEffect(() => {
    requestCloseRef.current = requestClose;
    return () => {
      requestCloseRef.current = null;
    };
  });

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    const input: CreateWorkItemInputType = {
      project_id: projectId,
      name: draft.name.trim(),
      state_id: draft.state_id,
      priority: draft.priority,
      source: "in_app",
    };
    if (draft.description.trim()) input.description_md = draft.description;
    if (draft.assignee_ids.length > 0) input.assignee_ids = draft.assignee_ids;
    if (draft.label_ids.length > 0) input.label_ids = draft.label_ids;
    if (draft.cycle_id) input.cycle_id = draft.cycle_id;
    if (draft.module_ids.length > 0) input.module_ids = draft.module_ids;
    if (draft.start_date) input.start_date = draft.start_date;
    if (draft.target_date) input.target_date = draft.target_date;
    startTransition(async () => {
      const result = await createWorkItemAction(input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast({ type: "info", body: `Created ${result.data.key}` });
      onCreated?.(result.data);
      if (createMore) patch({ name: "", description: "" });
      else onOpenChange(false);
    });
  };

  // The Dialog's Layout slots: header, body and footer take the dialog's own padding, so the
  // title sits inside the padded header instead of on the dialog's edge.
  return (
    <Layout
      header={<DialogHeader title="New work item" subtitle={bundle.project.name} onOpenChange={requestClose} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <FormLayout>
              <TextInput label="Name" value={draft.name} onChange={(name) => patch({ name })} hasAutoFocus isRequired placeholder="What needs to be done?" onEnter={submit} />
              <TextArea label="Description" value={draft.description} onChange={(description) => patch({ description })} rows={4} isOptional placeholder="Add context, links or acceptance criteria" />
              <HStack gap={4} wrap="wrap">
                <StateControl value={draft.state_id} onChange={(state_id) => patch({ state_id })} />
                <PriorityControl value={draft.priority} onChange={(priority) => patch({ priority })} />
                <AssigneeControl value={draft.assignee_ids} onChange={(assignee_ids) => patch({ assignee_ids })} />
                <LabelControl value={draft.label_ids} onChange={(label_ids) => patch({ label_ids })} />
                {bundle.project.cycles_enabled ? <CycleControl value={draft.cycle_id} onChange={(cycle_id) => patch({ cycle_id })} /> : null}
                {bundle.project.modules_enabled ? <ModuleControl value={draft.module_ids} onChange={(module_ids) => patch({ module_ids })} /> : null}
                <DateControl label="Start date" value={draft.start_date} max={draft.target_date} onChange={(start_date) => patch({ start_date })} />
                <DateControl label="Target date" value={draft.target_date} min={draft.start_date} onChange={(target_date) => patch({ target_date })} />
              </HStack>
            </FormLayout>
            {error ? <FieldStatus type="error" message={error} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} vAlign="center" hAlign="end">
            <Switch label="Create more" size="sm" value={createMore} onChange={setCreateMore} labelPosition="start" />
            <Button variant="ghost" label="Cancel" onClick={requestClose} />
            <Button variant="primary" label="Create" onClick={submit} isLoading={isPending} isDisabled={!canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
