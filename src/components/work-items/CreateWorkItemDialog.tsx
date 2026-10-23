"use client";

/**
 * "New work item" dialog (docs/contracts/ui.md "Work items screen"): name,
 * description and the common properties, submitted through
 * `createWorkItemAction`. "Create more" keeps the dialog open and resets the
 * name and description; closing with unsaved text asks first.
 */
import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { AlertDialog, Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createIntakeItemAction } from "@/app/actions/intake";
import { createWorkItemAction } from "@/app/actions/work-items";
import { SaveDraftDialog, type DraftSaveFields } from "@/components/drafts/SaveDraftDialog";
import type { CreateWorkItemInputType, Priority } from "@/lib/tessera/types";
import { useProject } from "./project-provider";
import { AssigneeControl, CycleControl, DateControl, EstimateControl, LabelControl, ModuleControl, PriorityControl, StateControl } from "./properties";

type CreateResult = Awaited<ReturnType<typeof createWorkItemAction>>;
export type CreatedWorkItem = Extract<CreateResult, { ok: true }>["data"];

export type CreateWorkItemDialogProps = {
  projectId: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Pre-filled fields, for example the group a quick-add row belongs to. */
  defaults?: Partial<Omit<CreateWorkItemInputType, "project_id">>;
  onCreated?: (item: CreatedWorkItem) => void;
  /** Intake hides state, cycle, modules and estimate, and does not offer "Save this draft?". */
  mode?: "work_item" | "intake";
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
  estimate_point_id: string | null;
};

type RequestCloseRef = RefObject<(() => void) | null>;

export function CreateWorkItemDialog({ projectId, isOpen, onOpenChange, defaults, onCreated, mode = "work_item" }: CreateWorkItemDialogProps) {
  // Escape reaches the Dialog as onOpenChange(false); routing it through the form's
  // requestClose keeps the "discard this work item?" prompt for a dirty draft.
  const requestCloseRef = useRef<(() => void) | null>(null);
  const [isDiscardOpen, setDiscardOpen] = useState(false);
  const [saveFields, setSaveFields] = useState<DraftSaveFields | null>(null);
  const handleOpenChange = (open: boolean) => {
    if (open) onOpenChange(true);
    else if (requestCloseRef.current) requestCloseRef.current();
    else onOpenChange(false);
  };
  return (
    <>
      {/* Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later. */}
      <Dialog isOpen={isOpen} onOpenChange={handleOpenChange} purpose="form" width={600} aria-label={mode === "intake" ? "New intake item" : "New work item"}>
        {/* Mounted only while open so every session starts from a fresh draft. */}
        {isOpen ? (
          <CreateWorkItemForm
            projectId={projectId}
            mode={mode}
            onOpenChange={onOpenChange}
            defaults={defaults}
            onCreated={onCreated}
            requestCloseRef={requestCloseRef}
            onDiscardRequest={(fields) => {
              if (mode === "work_item") setSaveFields(fields);
              else setDiscardOpen(true);
            }}
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
      <SaveDraftDialog
        isOpen={saveFields !== null}
        onOpenChange={(open) => !open && setSaveFields(null)}
        fields={saveFields ?? { project_id: projectId }}
        onDiscard={() => {
          setSaveFields(null);
          onOpenChange(false);
        }}
      />
    </>
  );
}

type CreateWorkItemFormProps = Omit<CreateWorkItemDialogProps, "isOpen"> & {
  requestCloseRef: RequestCloseRef;
  /** The draft has text and the user wants to close: the dialog shows the discard or save prompt. */
  onDiscardRequest: (fields: DraftSaveFields) => void;
};

function CreateWorkItemForm({ projectId, mode = "work_item", onOpenChange, defaults, onCreated, requestCloseRef, onDiscardRequest }: CreateWorkItemFormProps) {
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
    estimate_point_id: defaults?.estimate_point_id ?? null,
  });
  const [createMore, setCreateMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }));
  const isDirty = draft.name.trim() !== "" || draft.description.trim() !== "";
  const canSubmit = draft.name.trim() !== "" && draft.state_id !== "" && !isPending;

  const requestClose = () => {
    if (isPending) return;
    if (isDirty) {
      onDiscardRequest({
        project_id: projectId,
        name: draft.name.trim(),
        description_md: draft.description,
        priority: draft.priority,
        label_ids: draft.label_ids,
        assignee_ids: draft.assignee_ids,
        start_date: draft.start_date,
        target_date: draft.target_date,
        ...(mode === "work_item"
          ? { state_id: draft.state_id, cycle_id: draft.cycle_id, module_ids: draft.module_ids, estimate_point_id: draft.estimate_point_id }
          : {}),
      });
    } else onOpenChange(false);
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
    if (mode === "work_item" && draft.estimate_point_id) input.estimate_point_id = draft.estimate_point_id;
    startTransition(async () => {
      if (mode === "intake") {
        const result = await createIntakeItemAction({
          project_id: projectId,
          name: input.name,
          description_md: input.description_md,
          priority: input.priority,
          label_ids: input.label_ids,
          assignee_ids: input.assignee_ids,
          start_date: input.start_date,
          target_date: input.target_date,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        toast({ type: "info", body: `Created ${result.data.key}` });
        onOpenChange(false);
        return;
      }
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
      header={<DialogHeader title={mode === "intake" ? "New intake item" : "New work item"} subtitle={bundle.project.name} onOpenChange={requestClose} hasDivider />}
      content={
        <LayoutContent isScrollable>
          <VStack gap={4}>
            <FormLayout>
              <TextInput label="Name" className="tessera-wi-field" value={draft.name} onChange={(name) => patch({ name })} hasAutoFocus isRequired placeholder="What needs to be done?" onEnter={submit} />
              <TextArea label="Description" value={draft.description} onChange={(description) => patch({ description })} rows={4} isOptional placeholder="Add context, links or acceptance criteria" />
              {/* One wrapping row of the same compact chips the list rows use (class tessera-wi-props), dates included, so every control shares a height and a row centre. */}
              <HStack gap={2} vAlign="center" wrap="wrap" className="tessera-wi-props tessera-wi-form-props">
                {mode === "work_item" ? <StateControl compact value={draft.state_id} onChange={(state_id) => patch({ state_id })} /> : null}
                <PriorityControl compact hasLabel value={draft.priority} onChange={(priority) => patch({ priority })} />
                <AssigneeControl compact value={draft.assignee_ids} onChange={(assignee_ids) => patch({ assignee_ids })} />
                <LabelControl compact value={draft.label_ids} onChange={(label_ids) => patch({ label_ids })} />
                {mode === "work_item" && bundle.project.cycles_enabled ? <CycleControl compact value={draft.cycle_id} onChange={(cycle_id) => patch({ cycle_id })} /> : null}
                {mode === "work_item" && bundle.project.modules_enabled ? <ModuleControl compact value={draft.module_ids} onChange={(module_ids) => patch({ module_ids })} /> : null}
                {mode === "work_item" ? <EstimateControl size="sm" value={draft.estimate_point_id} onChange={(estimate_point_id) => patch({ estimate_point_id })} /> : null}
                <DateControl compact hasEmptyLabel label="Start date" value={draft.start_date} max={draft.target_date} onChange={(start_date) => patch({ start_date })} />
                <DateControl compact hasEmptyLabel label="Target date" value={draft.target_date} min={draft.start_date} onChange={(target_date) => patch({ target_date })} />
              </HStack>
            </FormLayout>
            {error ? <FieldStatus type="error" message={error} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} vAlign="center" hAlign="end">
            {mode === "work_item" ? <Switch label="Create more" size="sm" value={createMore} onChange={setCreateMore} labelPosition="start" /> : null}
            <Button variant="ghost" label="Cancel" onClick={requestClose} />
            <Button variant="primary" label={mode === "intake" ? "Add to Intake" : "Create"} onClick={submit} isLoading={isPending} isDisabled={mode === "intake" ? draft.name.trim() === "" || isPending : !canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
