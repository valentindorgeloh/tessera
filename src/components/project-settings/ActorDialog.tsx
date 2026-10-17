"use client";

/**
 * Edit dialog of an agent actor (docs/drafts/p4-ui.md "Agents"): name and
 * palette colour, saved through `updateActorAction` with only the changed
 * fields. A CONFLICT (another actor has the name) shows on the name field.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { updateActorAction } from "@/app/actions/settings";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { ActorRow, PaletteColor } from "@/lib/tessera/types";
import { PaletteColorSelector } from "./PaletteColorSelector";

export type ActorDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  actor: ActorRow;
};

export function ActorDialog({ isOpen, onOpenChange, actor }: ActorDialogProps) {
  const title = `Edit ${actor.name}`;
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480} aria-label={title}>
      {isOpen ? <ActorForm actor={actor} title={title} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function ActorForm({ actor, title, onOpenChange }: { actor: ActorRow; title: string; onOpenChange: (isOpen: boolean) => void }) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(actor.name);
  const [color, setColor] = useState<PaletteColor>(actor.color);
  const [error, setError] = useState<{ field: "name" | "form"; message: string } | null>(null);

  const trimmed = name.trim();
  const changed = trimmed !== actor.name || color !== actor.color;
  const canSave = changed && trimmed !== "" && !isPending;

  const submit = () => {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const result = await updateActorAction({
        actor_id: actor.id,
        ...(trimmed !== actor.name ? { name: trimmed } : {}),
        ...(color !== actor.color ? { color } : {}),
      });
      if (!result.ok) {
        setError({ field: result.code === "CONFLICT" ? "name" : "form", message: result.code === "CONFLICT" ? "An actor with this name exists" : result.message });
        return;
      }
      toast({ type: "info", body: "Agent saved" });
      onOpenChange(false);
    });
  };

  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={() => !isPending && onOpenChange(false)} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
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
            </FormLayout>
            {error?.field === "form" ? <FieldStatus type="error" message={error.message} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="primary" label="Save" onClick={submit} isLoading={isPending} isDisabled={!canSave} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
