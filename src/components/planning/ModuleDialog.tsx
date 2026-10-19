"use client";

/**
 * Create and edit dialog for modules (docs/contracts/ui.md "Modules (E2)"):
 * name, description, status (Planned by default, decision 5), lead, members
 * and the start and target dates as two Astryx `DateInput`s linked by
 * `min` / `max` (not `DateControl`, which has no `status`, mismatch 29).
 * Create sends `createModuleAction`; edit sends only the changed fields to
 * `updateModuleAction` and the members to `setModuleMembersAction`.
 *
 * Errors follow `CreateProjectDialog`: `CONFLICT` (names are unique per
 * project) shows on the Name field, a `VALIDATION` about the dates on the
 * Target date field, anything else as an error Toast while the dialog stays
 * open. The status selector and its label are exported for the detail header.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector, type SelectorOptionData, type SelectorSize } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createModuleAction, setModuleMembersAction, updateModuleAction } from "@/app/actions/modules";
import { useProject } from "@/components/work-items/project-provider";
import { AssigneeControl } from "@/components/work-items/properties/AssigneeControl";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import type { Module, ModuleStatus } from "@/lib/tessera/types";
import { LeadControl } from "./LeadControl";
import {
  MODULE_STATUS_LABEL,
  MODULE_STATUSES,
  changedModuleFields,
  isModuleStatus,
  moduleDateError,
  moduleStatusVariant,
  sameMembers,
  type ModuleFormValues,
} from "./module-format";

/** What the edit form reads: a list `Module` and a `ModuleDetail` both fit. */
export type EditableModule = Pick<Module, "id" | "name" | "description_md" | "status" | "lead_actor_id" | "start_date" | "target_date" | "member_ids">;

export type ModuleDialogProps = {
  projectId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit when set. */
  module?: EditableModule;
};

const NAME_MAX = 120;

/** StatusDot plus the status label, for the selector rows and trigger. */
export function ModuleStatusLabel({ status }: { status: ModuleStatus }) {
  const label = MODULE_STATUS_LABEL[status];
  return (
    <HStack gap={1.5} vAlign="center">
      <StatusDot variant={moduleStatusVariant(status)} label={label} />
      <Text type="inherit" maxLines={1} hasTruncateTooltip={false}>
        {label}
      </Text>
    </HStack>
  );
}

export type ModuleStatusControlProps = {
  value: ModuleStatus;
  onChange: (status: ModuleStatus) => void;
  readOnly?: boolean;
  size?: SelectorSize;
};

/** Ghost selector over the six module statuses; its label is hidden because the row or header names it. */
export function ModuleStatusControl({ value, onChange, readOnly = false, size = "md" }: ModuleStatusControlProps) {
  const options: SelectorOptionData[] = MODULE_STATUSES.map((status) => ({ value: status, label: MODULE_STATUS_LABEL[status] }));
  const render = (option: SelectorOptionData) => (isModuleStatus(option.value) ? <ModuleStatusLabel status={option.value} /> : option.label);
  return (
    <Selector
      label="Status"
      isLabelHidden
      variant="ghost"
      size={size}
      options={options}
      value={value}
      onChange={(next) => {
        if (isModuleStatus(next) && next !== value) onChange(next);
      }}
      isReadOnly={readOnly}
      renderOption={render}
      renderValue={render}
    />
  );
}

export function ModuleDialog({ projectId, isOpen, onOpenChange, module }: ModuleDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560} aria-label={module ? "Edit module" : "New module"}>
      {/* Mounted only while open so every session starts from the module's current values. */}
      {isOpen ? <ModuleForm projectId={projectId} onOpenChange={onOpenChange} module={module} /> : null}
    </Dialog>
  );
}

type IsoDate = Parameters<typeof DateInput>[0]["value"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A stored `YYYY-MM-DD` narrowed to DateInput's template type; undefined for null. */
function asIsoDate(value: string | null): IsoDate {
  // The engine stores dates through IsoDateSchema, so the regex only guards against bad rows.
  return value && ISO_DATE.test(value) ? (value as NonNullable<IsoDate>) : undefined;
}

type FieldError = { field: "name" | "target_date"; message: string };

function initialValues(module: EditableModule | undefined): ModuleFormValues {
  return {
    name: module?.name ?? "",
    description_md: module?.description_md ?? "",
    status: module?.status ?? "planned",
    lead_actor_id: module?.lead_actor_id ?? null,
    start_date: module?.start_date ?? null,
    target_date: module?.target_date ?? null,
  };
}

function ModuleForm({ projectId, onOpenChange, module }: Omit<ModuleDialogProps, "isOpen">) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const { bundle } = useProject();
  const weekStartsOn = useWeekStart(bundle.week_start);
  // The values this session opened with: a save sends only what the person changed against them, so a
  // change made elsewhere while the dialog is open (another tab, an agent) survives untouched fields.
  const [baseline] = useState(() => ({ values: initialValues(module), members: module?.member_ids ?? [] }));
  const [values, setValues] = useState<ModuleFormValues>(baseline.values);
  const [members, setMembers] = useState<string[]>(baseline.members);
  const [error, setError] = useState<FieldError | null>(null);

  const patch = (next: Partial<ModuleFormValues>) => {
    setValues((previous) => ({ ...previous, ...next }));
    if (error?.field === "name" && next.name !== undefined) setError(null);
    if (error?.field === "target_date" && (next.start_date !== undefined || next.target_date !== undefined)) setError(null);
  };

  const name = values.name.trim();
  const nameTooLong = name.length > NAME_MAX;
  const canSubmit = name !== "" && !nameTooLong && !isPending;

  /** Field errors stay on their field; everything else is a Toast and the dialog stays open. */
  const showFailure = (failure: { code: string; message: string; details?: unknown }) => {
    if (failure.code === "CONFLICT") {
      setError({ field: "name", message: "A module with this name exists" });
      return;
    }
    const dateMessage = failure.code === "VALIDATION" ? moduleDateError(failure.details) : null;
    if (dateMessage !== null) {
      setError({ field: "target_date", message: dateMessage });
      return;
    }
    toast({ type: "error", body: `Could not save the module: ${failure.message}` });
  };

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    const next: ModuleFormValues = { ...values, name };
    startTransition(async () => {
      if (!module) {
        const result = await createModuleAction({
          project_id: projectId,
          name,
          description_md: next.description_md.trim() ? next.description_md : undefined,
          status: next.status,
          lead_actor_id: next.lead_actor_id,
          member_ids: members,
          start_date: next.start_date,
          target_date: next.target_date,
        });
        if (!result.ok) return showFailure(result);
        toast({ type: "info", body: `Created ${result.data.name}` });
        onOpenChange(false);
        return;
      }
      const changed = changedModuleFields(baseline.values, next);
      if (Object.keys(changed).length > 0) {
        const result = await updateModuleAction({ module_id: module.id, ...changed });
        if (!result.ok) return showFailure(result);
      }
      if (!sameMembers(baseline.members, members)) {
        const result = await setModuleMembersAction({ module_id: module.id, actor_ids: members });
        if (!result.ok) return showFailure(result);
      }
      onOpenChange(false);
    });
  };

  const close = () => {
    if (!isPending) onOpenChange(false);
  };

  return (
    <Layout
      header={<DialogHeader title={module ? "Edit module" : "New module"} onOpenChange={close} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <FormLayout>
              <TextInput
                label="Name"
                value={values.name}
                hasAutoFocus
                isRequired
                placeholder="Launch, Onboarding, Billing"
                onChange={(value) => patch({ name: value })}
                onEnter={submit}
                status={
                  error?.field === "name"
                    ? { type: "error", message: error.message }
                    : nameTooLong
                      ? { type: "error", message: `Use at most ${NAME_MAX} characters` }
                      : undefined
                }
              />
              <TextArea
                label="Description"
                value={values.description_md}
                onChange={(value) => patch({ description_md: value })}
                rows={3}
                isOptional
                placeholder="What this module delivers"
              />
            </FormLayout>
            <MetadataList columns="single" label={{ position: "start", width: 104 }} className="tessera-modules-props">
              <MetadataListItem label="Status">
                <ModuleStatusControl value={values.status} onChange={(status) => patch({ status })} />
              </MetadataListItem>
              <MetadataListItem label="Lead">
                <LeadControl compact value={values.lead_actor_id} onChange={(lead_actor_id) => patch({ lead_actor_id })} />
              </MetadataListItem>
              <MetadataListItem label="Members">
                <AssigneeControl label="Members" value={members} onChange={setMembers} />
              </MetadataListItem>
              <MetadataListItem label="Start date">
                <DateInput
                  label="Start date"
                  isLabelHidden
                  size="sm"
                  width="fill"
                  value={asIsoDate(values.start_date)}
                  max={asIsoDate(values.target_date)}
                  onChange={(value) => patch({ start_date: value ?? null })}
                  hasClear
                  format="date"
                  placeholder="No start date"
                  weekStartsOn={weekStartsOn}
                  presentation="popover"
                />
              </MetadataListItem>
              <MetadataListItem label="Target date">
                <DateInput
                  label="Target date"
                  isLabelHidden
                  size="sm"
                  width="fill"
                  value={asIsoDate(values.target_date)}
                  min={asIsoDate(values.start_date)}
                  onChange={(value) => patch({ target_date: value ?? null })}
                  hasClear
                  format="date"
                  placeholder="No target date"
                  weekStartsOn={weekStartsOn}
                  presentation="popover"
                  status={error?.field === "target_date" ? { type: "error", message: error.message } : undefined}
                />
              </MetadataListItem>
            </MetadataList>
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={close} isDisabled={isPending} />
            <Button variant="primary" label={module ? "Save" : "Create module"} onClick={submit} isLoading={isPending} isDisabled={!canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
