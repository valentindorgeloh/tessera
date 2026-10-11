"use client";

/**
 * "New project" dialog (docs/contracts/ui.md "Projects"): name, identifier
 * suggested from the name, description, logo icon and colour. Submits
 * `createProjectAction` and lands on the new project's work items; a CONFLICT
 * (name or identifier taken) shows inline.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FieldStatus } from "@astryxdesign/core/FieldStatus";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { createProjectAction } from "@/app/actions/projects";
import { PROJECT_IDENTIFIER_PATTERN, PaletteColorSchema } from "@/lib/tessera/schemas";
import type { PaletteColor } from "@/lib/tessera/types";
import { PROJECT_LOGO_ICON_NAMES, PlusIcon, resolveLogoIcon, type ProjectLogoIconName } from "@/themes/paper/icons";

export type CreateProjectDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

const COLOR_LABELS: Record<PaletteColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  gray: "Gray",
};

function isPaletteColor(value: string): value is PaletteColor {
  return (PaletteColorSchema.options as readonly string[]).includes(value);
}

function isLogoIconName(value: string): value is ProjectLogoIconName {
  return (PROJECT_LOGO_ICON_NAMES as readonly string[]).includes(value);
}

/** Up to 12 upper-case letters and digits from the name's words, starting with a letter: "Web app" -> "WEB", "2nd try" -> "NDTRY". */
export function suggestIdentifier(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const raw = words.length > 1 ? words.map((word) => word[0]).join("") : (words[0] ?? "");
  const base = raw.length >= 2 ? raw : (words.join("") ?? "");
  return base.replace(/^[^A-Z]+/, "").slice(0, 12);
}

export function CreateProjectDialog({ isOpen, onOpenChange }: CreateProjectDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={520}>
      {isOpen ? <CreateProjectForm onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function CreateProjectForm({ onOpenChange }: Pick<CreateProjectDialogProps, "onOpenChange">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [isIdentifierTouched, setIdentifierTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<ProjectLogoIconName>("Folder");
  const [color, setColor] = useState<PaletteColor>("blue");
  const [error, setError] = useState<{ field: "name" | "identifier" | "form"; message: string } | null>(null);

  const identifierValid = PROJECT_IDENTIFIER_PATTERN.test(identifier);
  const canSubmit = name.trim() !== "" && identifierValid && !isPending;

  const iconOptions: SelectorOptionData[] = PROJECT_LOGO_ICON_NAMES.map((value) => ({ value, label: value }));
  const colorOptions: SelectorOptionData[] = PaletteColorSchema.options.map((value) => ({ value, label: COLOR_LABELS[value] }));

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await createProjectAction({
        name: name.trim(),
        identifier,
        description_md: description.trim() ? description : undefined,
        logo: { icon, color },
      });
      if (!result.ok) {
        const message = result.message;
        const field = result.code === "CONFLICT" ? (/identifier/i.test(message) ? "identifier" : "name") : "form";
        setError({ field, message });
        return;
      }
      onOpenChange(false);
      router.push(`/projects/${result.data.id}/work-items`);
    });
  };

  // The Dialog's Layout slots: header, body and footer take the dialog's own padding, so the
  // title sits inside the padded header instead of on the dialog's edge.
  return (
    <Layout
      header={<DialogHeader title="New project" onOpenChange={() => !isPending && onOpenChange(false)} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
        <FormLayout>
          <TextInput
            label="Name"
            value={name}
            hasAutoFocus
            isRequired
            placeholder="Website, Mobile app, Q3 launch"
            onChange={(value) => {
              setName(value);
              if (!isIdentifierTouched) setIdentifier(suggestIdentifier(value));
            }}
            onEnter={submit}
            status={error?.field === "name" ? { type: "error", message: error.message } : undefined}
          />
          <TextInput
            label="Identifier"
            description="2 to 12 letters or digits, starting with a letter. Work items are keyed like WEB-12."
            value={identifier}
            isRequired
            placeholder="WEB"
            onChange={(value) => {
              setIdentifierTouched(true);
              setIdentifier(value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
            }}
            onEnter={submit}
            status={
              error?.field === "identifier"
                ? { type: "error", message: error.message }
                : identifier && !identifierValid
                  ? { type: "error", message: "Use 2 to 12 letters or digits, starting with a letter." }
                  : undefined
            }
          />
          <TextArea label="Description" value={description} onChange={setDescription} rows={3} isOptional placeholder="What this project is for" />
          <HStack gap={3} vAlign="end" wrap="wrap">
            <Selector
              label="Icon"
              options={iconOptions}
              value={icon}
              onChange={(value) => isLogoIconName(value) && setIcon(value)}
              renderOption={(option) => {
                return <Token label={option.label ?? option.value} size="sm" icon={<Icon icon={resolveLogoIcon(option.value)} />} />;
              }}
            />
            <Selector
              label="Colour"
              options={colorOptions}
              value={color}
              onChange={(value) => isPaletteColor(value) && setColor(value)}
              renderOption={(option) => <Token label={option.label ?? option.value} size="sm" color={isPaletteColor(option.value) ? option.value : "gray"} />}
            />
            <Token label={identifier || "KEY"} icon={<Icon icon={resolveLogoIcon(icon)} />} color={color} />
          </HStack>
        </FormLayout>
            {error?.field === "form" ? <FieldStatus type="error" message={error.message} /> : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} isDisabled={isPending} />
            <Button variant="primary" label="Create project" onClick={submit} isLoading={isPending} isDisabled={!canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}

/** "New project" button owning the dialog's open state, for the projects page header. */
export function NewProjectButton() {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" label="New project" icon={<PlusIcon />} onClick={() => setOpen(true)} />
      <CreateProjectDialog isOpen={isOpen} onOpenChange={setOpen} />
    </>
  );
}
