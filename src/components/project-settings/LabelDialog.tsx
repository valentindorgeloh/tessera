"use client";

/**
 * Create and edit dialog of a label (docs/drafts/p4-ui.md "Labels"): name,
 * palette colour and parent. The parent is "None" or a top-level label other
 * than the label itself; a label that has children stays top level, so its
 * selector is disabled. A CONFLICT (name taken) shows on the name field.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { createLabelAction, updateLabelAction } from "@/app/actions/states-labels";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { useProject } from "@/components/work-items/project-provider";
import type { Label, PaletteColor } from "@/lib/tessera/types";
import { PaletteColorSelector } from "./PaletteColorSelector";

export type LabelDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  projectId: string;
  /** The label being edited; absent creates one. */
  label?: Label;
  /** Parent preselected when creating (the "Add sub-label" row action). */
  parentId?: string | null;
};

const NONE = "__none__";

export function LabelDialog({ isOpen, onOpenChange, ...props }: LabelDialogProps) {
  const title = props.label ? `Edit ${props.label.name}` : "New label";
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={title}>
      {isOpen ? <LabelForm title={title} onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function LabelForm({ title, onOpenChange, projectId, label, parentId }: Omit<LabelDialogProps, "isOpen"> & { title: string }) {
  const { bundle } = useProject();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState<PaletteColor>(label?.color ?? "gray");
  const [parent, setParent] = useState(label ? (label.parent_id ?? NONE) : (parentId ?? NONE));
  const [error, setError] = useState<{ field: "name" | "form"; message: string } | null>(null);

  const hasChildren = label ? bundle.labels.some((other) => other.parent_id === label.id) : false;
  const options: SelectorOptionData[] = [
    { value: NONE, label: "None" },
    ...bundle.labels.filter((other) => other.parent_id === null && other.id !== label?.id).map((other) => ({ value: other.id, label: other.name })),
  ];

  const trimmed = name.trim();
  const parentValue = parent === NONE ? null : parent;
  const changed = label === undefined || trimmed !== label.name || color !== label.color || parentValue !== label.parent_id;
  const canSubmit = trimmed !== "" && changed && !isPending;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = label
        ? await updateLabelAction({
            label_id: label.id,
            ...(trimmed !== label.name ? { name: trimmed } : {}),
            ...(color !== label.color ? { color } : {}),
            ...(parentValue !== label.parent_id ? { parent_id: parentValue } : {}),
          })
        : await createLabelAction({ project_id: projectId, name: trimmed, color, ...(parentValue ? { parent_id: parentValue } : {}) });
      if (!result.ok) {
        setError(result.code === "CONFLICT" ? { field: "name", message: "A label with this name exists" } : { field: "form", message: result.message });
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
              <Selector label="Parent" options={options} value={parent} onChange={setParent} isDisabled={hasChildren} />
            </FormLayout>
            {error?.field === "form" ? <FieldStatus type="error" message={error.message} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="primary" label={label ? "Save" : "Create label"} onClick={submit} isLoading={isPending} isDisabled={!canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
