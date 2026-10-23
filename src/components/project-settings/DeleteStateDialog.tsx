"use client";

/**
 * Delete a state that still holds work items (docs/drafts/p4-ui.md "States"):
 * a form dialog, since an AlertDialog's description is a string. The items move
 * to the chosen state (any other non-triage state of the project, the default
 * one preselected) when `deleteStateAction` runs with `move_to_state_id`.
 * Every failure (including RULE state_not_empty after stale usage) shows inline
 * and in a Toast.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector, type SelectorOptionType } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteStateAction } from "@/app/actions/states-labels";
import { failureText } from "@/components/planning/archive-rules";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { useProject } from "@/components/work-items/project-provider";
import type { State } from "@/lib/tessera/types";
import { SETTINGS_STATE_GROUPS, SETTINGS_STATE_GROUP_LABELS } from "./palette-labels";

export type DeleteStateDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  state: State;
  /** Work items in the state, archived ones included. */
  count: number;
};

export function DeleteStateDialog({ isOpen, onOpenChange, state, count }: DeleteStateDialogProps) {
  const title = `Delete ${state.name}?`;
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={title}>
      {isOpen ? <DeleteStateForm title={title} onOpenChange={onOpenChange} state={state} count={count} /> : null}
    </Dialog>
  );
}

function DeleteStateForm({ title, onOpenChange, state, count }: Omit<DeleteStateDialogProps, "isOpen"> & { title: string }) {
  const { bundle } = useProject();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const others = bundle.states.filter((other) => other.id !== state.id && other.state_group !== "triage");
  const fallback = others.find((other) => other.is_default) ?? others[0];
  const [target, setTarget] = useState(fallback?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const options: SelectorOptionType[] = SETTINGS_STATE_GROUPS.flatMap((group) => {
    const inGroup = others.filter((other) => other.state_group === group);
    return inGroup.length === 0 ? [] : [{ type: "section" as const, title: SETTINGS_STATE_GROUP_LABELS[group], options: inGroup.map((other) => ({ value: other.id, label: other.name })) }];
  });

  const submit = () => {
    if (target === "" || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteStateAction({ state_id: state.id, move_to_state_id: target });
      if (!result.ok) {
        setError(result.message);
        toast({ type: "error", body: failureText(`Could not delete ${state.name}`, result.message) });
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
            <Text type="body">{`${count} work ${count === 1 ? "item is" : "items are"} in ${state.name}, archived ones included. Move them to:`}</Text>
            <Selector label="Move to" options={options} value={target} onChange={setTarget} />
            {error ? <FieldStatus type="error" message={error} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="destructive" label="Delete state" onClick={submit} isLoading={isPending} isDisabled={target === ""} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
