"use client";

/**
 * "Save this draft?" when the create dialog closes with text in it.
 * Intake mode does not offer this.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { createDraftAction } from "@/app/actions/drafts";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { failureText } from "@/components/planning/archive-rules";

export type DraftSaveFields = Parameters<typeof createDraftAction>[0];

export type SaveDraftDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  fields: DraftSaveFields;
  onDiscard: () => void;
};

export function SaveDraftDialog({ isOpen, onOpenChange, fields, onDiscard }: SaveDraftDialogProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await createDraftAction(fields);
      if (!result.ok) {
        setError(failureText("Could not save the draft", result.message));
        return;
      }
      toast({
        type: "info",
        body: "Draft saved",
        endContent: <Button variant="ghost" size="sm" label="Open drafts" href="/drafts" />,
      });
      onOpenChange(false);
      onDiscard();
    });
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={420} aria-label="Save this draft?">
      <Layout
        header={<DialogHeader title="Save this draft?" onOpenChange={onOpenChange} />}
        content={
          <LayoutContent>
            <VStack gap={2}>
              <Text type="body">You can finish it later from Drafts.</Text>
              {error ? (
                <Text type="supporting" color="secondary">
                  {error}
                </Text>
              ) : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button variant="ghost" label="Keep editing" onClick={() => onOpenChange(false)} />
              <Button variant="secondary" label="Discard" onClick={onDiscard} />
              <Button variant="primary" label="Save draft" isLoading={isPending} onClick={save} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
