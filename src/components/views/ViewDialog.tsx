"use client";

/**
 * Create and edit a saved view (docs/drafts/p4-ui.md "ViewDialog"): name,
 * description, logo icon and colour. Opened as "New view" (the list), "Save
 * view" (the project list's button), "Save as new view" (a view's unsaved
 * changes) or `Edit <name>`. With `initial` the new view takes those filters
 * and display. A name that is taken (CONFLICT) shows on the name field; any
 * other failure under the form. Creating opens the new view; editing sends
 * only the changed fields.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { createViewAction, updateViewAction } from "@/app/actions/views";
import { PaletteColorSelector } from "@/components/project-settings/PaletteColorSelector";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { PaletteColor, View } from "@/lib/tessera/types";
import { PROJECT_LOGO_ICON_NAMES, resolveLogoIcon, type ProjectLogoIconName } from "@/themes/catppuccin/icons";
import { normalizeFilters, type ViewState } from "./view-state";

export type ViewDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Null creates a workspace view and opens it under `/workspace-views`. */
  projectId: string | null;
  mode: "create" | "edit";
  /** "New view" (list), "Save view" (SaveViewButton), "Save as new view" (ViewBar), `Edit ${view.name}` (ViewMenu). */
  title: string;
  /** The view being edited (mode edit). */
  view?: View;
  /** Filters and display a new view starts with (Save view, Save as new view); absent: no filters and the default display. */
  initial?: ViewState;
};

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;
const DEFAULT_ICON: ProjectLogoIconName = "Folder";
const DEFAULT_COLOR: PaletteColor = "blue";

const ICON_OPTIONS: SelectorOptionData[] = PROJECT_LOGO_ICON_NAMES.map((value) => ({ value, label: value }));

function isLogoIconName(value: string): value is ProjectLogoIconName {
  return (PROJECT_LOGO_ICON_NAMES as readonly string[]).includes(value);
}

export function ViewDialog({ isOpen, onOpenChange, ...props }: ViewDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={520} aria-label={props.title}>
      {isOpen ? <ViewForm onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function ViewForm({ projectId, onOpenChange, mode, title, view, initial }: Omit<ViewDialogProps, "isOpen">) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(view?.name ?? "");
  const [description, setDescription] = useState(view?.description ?? "");
  const [icon, setIcon] = useState<ProjectLogoIconName>((view?.logo?.icon as ProjectLogoIconName | undefined) ?? DEFAULT_ICON);
  const [color, setColor] = useState<PaletteColor>(view?.logo?.color ?? DEFAULT_COLOR);
  const [error, setError] = useState<{ field: "name" | "form"; message: string } | null>(null);

  const trimmed = name.trim();
  const nameError = name.length > NAME_MAX ? `Use at most ${NAME_MAX} characters.` : null;
  const canSubmit = trimmed !== "" && nameError === null && !isPending;
  const logo = { icon, color };
  const logoChanged =
    icon !== (view?.logo?.icon ?? DEFAULT_ICON) || color !== (view?.logo?.color ?? DEFAULT_COLOR);

  const fail = (code: string, message: string) => setError(code === "CONFLICT" ? { field: "name", message: "A view with this name exists" } : { field: "form", message });

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      if (mode === "edit" && view) {
        const patch: { name?: string; description?: string; logo?: { icon: string; color: PaletteColor } } = {};
        if (trimmed !== view.name) patch.name = trimmed;
        if (description.trim() !== view.description) patch.description = description.trim();
        if (logoChanged) patch.logo = logo;
        if (Object.keys(patch).length === 0) {
          onOpenChange(false);
          return;
        }
        const result = await updateViewAction({ view_id: view.id, ...patch });
        if (!result.ok) return fail(result.code, result.message);
        toast({ type: "info", body: "Saved" });
        onOpenChange(false);
        return;
      }
      const result = await createViewAction({
        project_id: projectId,
        name: trimmed,
        description: description.trim() ? description.trim() : undefined,
        filters: initial ? normalizeFilters(initial.filters) : undefined,
        display: initial?.display,
        rich_filters: initial?.rich_filters,
        logo,
      });
      if (!result.ok) return fail(result.code, result.message);
      onOpenChange(false);
      router.push(projectId === null ? `/workspace-views/${result.data.id}` : `/projects/${projectId}/views/${result.data.id}`);
    });
  };

  const close = () => {
    if (!isPending) onOpenChange(false);
  };

  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={close} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <FormLayout>
              <TextInput
                label="Name"
                value={name}
                hasAutoFocus
                isRequired
                placeholder="Open bugs"
                onChange={(value) => {
                  setName(value);
                  if (error?.field === "name") setError(null);
                }}
                onEnter={submit}
                status={nameError ? { type: "error", message: nameError } : error?.field === "name" ? { type: "error", message: error.message } : undefined}
              />
              <TextArea label="Description" value={description} onChange={setDescription} rows={3} maxLength={DESCRIPTION_MAX} isOptional />
              <HStack gap={3} vAlign="end" wrap="wrap">
                <Selector
                  label="Icon"
                  options={ICON_OPTIONS}
                  value={icon}
                  onChange={(value) => isLogoIconName(value) && setIcon(value)}
                  renderOption={(option) => <Token label={option.label ?? option.value} size="sm" icon={<Icon icon={resolveLogoIcon(option.value)} />} />}
                />
                <PaletteColorSelector label="Colour" value={color} onChange={setColor} />
              </HStack>
            </FormLayout>
            {initial ? (
              <Text type="supporting" color="secondary">
                Uses the current filters and display.
              </Text>
            ) : null}
            {error?.field === "form" ? <FieldStatus type="error" message={error.message} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={close} isDisabled={isPending} />
            <Button variant="primary" label={mode === "create" ? "Create view" : "Save"} onClick={submit} isLoading={isPending} isDisabled={!canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
