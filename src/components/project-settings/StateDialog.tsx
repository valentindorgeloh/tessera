"use client";

/**
 * Create and edit dialog of a state (docs/drafts/p4-ui.md "States"): name,
 * palette colour and description. The group is fixed (it is chosen by the
 * "Add <group> state" button and cannot change later). A CONFLICT (name taken)
 * shows on the name field.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { createStateAction, updateStateAction } from "@/app/actions/states-labels";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { PaletteColor, State, StateGroup } from "@/lib/tessera/types";
import { PaletteColorSelector } from "./PaletteColorSelector";
import { SETTINGS_STATE_GROUP_LABELS } from "./palette-labels";

export type StateDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  projectId: string;
  group: StateGroup;
  /** The state being edited; absent creates one in `group`. */
  state?: State;
};

function groupLabel(group: StateGroup): string {
  return group === "triage" ? "Triage" : SETTINGS_STATE_GROUP_LABELS[group];
}

export function StateDialog({ isOpen, onOpenChange, ...props }: StateDialogProps) {
  const title = props.state ? `Edit ${props.state.name}` : `New ${groupLabel(props.group)} state`;
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={title}>
      {isOpen ? <StateForm title={title} onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function StateForm({ title, onOpenChange, projectId, group, state }: Omit<StateDialogProps, "isOpen"> & { title: string }) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(state?.name ?? "");
  const [color, setColor] = useState<PaletteColor>(state?.color ?? "gray");
  const [description, setDescription] = useState(state?.description ?? "");
  const [error, setError] = useState<{ field: "name" | "form"; message: string } | null>(null);

  const trimmed = name.trim();
  const changed = state === undefined || trimmed !== state.name || color !== state.color || description !== state.description;
  const canSubmit = trimmed !== "" && changed && !isPending;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = state
        ? await updateStateAction({
            state_id: state.id,
            ...(trimmed !== state.name ? { name: trimmed } : {}),
            ...(color !== state.color ? { color } : {}),
            ...(description !== state.description ? { description } : {}),
          })
        : await createStateAction({ project_id: projectId, name: trimmed, state_group: group as Exclude<StateGroup, "triage">, color, description });
      if (!result.ok) {
        setError(result.code === "CONFLICT" ? { field: "name", message: "A state with this name exists" } : { field: "form", message: result.message });
        return;
      }
      onOpenChange(false);
    });
  };

  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={() => !isPending && onOpenChange(false)} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4} className="tessera-settings-fields">
            <FormLayout>
              <TextInput
                label="Name"
                value={name}
                hasAutoFocus
                isRequired
                onChange={setName}
                onEnter={submit}
                status={error?.field === "name" ? { type: "error", message: error.message } : undefined}
              />
              <PaletteColorSelector label="Colour" value={color} onChange={setColor} />
              <TextArea label="Description" value={description} onChange={setDescription} rows={2} isOptional />
            </FormLayout>
            {error?.field === "form" ? <FieldStatus type="error" message={error.message} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="primary" label={state ? "Save" : "Create state"} onClick={submit} isLoading={isPending} isDisabled={!canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
