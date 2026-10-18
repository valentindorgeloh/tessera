"use client";

/**
 * Create or rename a favourites folder (docs/drafts/p9-plan.md U2). Names are
 * free text, 1 to 80 characters, and need not be unique.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createFavoriteFolderAction, renameFavoriteFolderAction } from "@/app/actions/favorites";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";

const NAME_MAX = 80;

export type FavoriteDialogProps = {
  mode: "create" | "rename";
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string;
  initialName?: string;
};

export function FavoriteDialog({ isOpen, onOpenChange, ...props }: FavoriteDialogProps) {
  const title = props.mode === "create" ? "New folder" : "Rename folder";
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={420} aria-label={title}>
      {isOpen ? <FolderForm title={title} onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function FolderForm({ mode, title, onOpenChange, folderId, initialName = "" }: Omit<FavoriteDialogProps, "isOpen"> & { title: string }) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [isPending, startTransition] = useTransition();
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= NAME_MAX && !isPending && (mode === "create" || folderId !== undefined);

  const submit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createFavoriteFolderAction({ name: trimmed })
          : await renameFavoriteFolderAction({ folder_id: folderId ?? "", name: trimmed });
      if (!result.ok) {
        toast({ type: "error", body: result.message });
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
          <TextInput label="Name" value={name} onChange={(value) => setName(value.slice(0, NAME_MAX))} />
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button variant="secondary" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="primary" label={mode === "create" ? "Create" : "Save"} onClick={submit} isDisabled={!canSubmit} isLoading={isPending} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
