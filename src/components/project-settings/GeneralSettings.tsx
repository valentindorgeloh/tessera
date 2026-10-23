"use client";

/**
 * General tab of the project settings (docs/drafts/p4-ui.md "General"): name,
 * identifier (decision 29: old keys keep working), description, logo icon and
 * colour, then the danger zone. The saved values come from the project bundle;
 * a save sends only the changed fields. Everything is disabled in an archived
 * project except the danger zone's Restore.
 */
import { useState, useTransition } from "react";
import { notFound } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import { updateProjectAction } from "@/app/actions/projects";
import { failureText } from "@/components/planning/archive-rules";
import { ProjectDangerZone } from "@/components/planning/ProjectArchive";
import { renameEntityLabelKeys } from "@/components/shell/entity-labels";
import { useOptionalProject } from "@/components/work-items/project-provider";
import type { PaletteColor, Project } from "@/lib/tessera/types";
import { PROJECT_LOGO_ICON_NAMES, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { identifierError, sanitizeIdentifier } from "./identifier";
import { PaletteColorSelector } from "./PaletteColorSelector";

const ICON_OPTIONS: SelectorOptionData[] = PROJECT_LOGO_ICON_NAMES.map((value) => ({ value, label: value }));

/** What the logo selectors show for a project without a logo (CreateProjectDialog's defaults). */
const DEFAULT_ICON = "Folder";
const DEFAULT_COLOR: PaletteColor = "blue";

export function GeneralSettings() {
  const context = useOptionalProject();
  // The project layout steps aside for an unknown id; the page is then the not-found screen.
  if (!context) notFound();
  return <GeneralForm project={context.bundle.project} />;
}

type FieldError = { field: "name" | "identifier"; message: string };

function GeneralForm({ project }: { project: Project }) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(project.name);
  const [identifier, setIdentifier] = useState(project.identifier);
  const [description, setDescription] = useState(project.description_md);
  const [icon, setIcon] = useState(project.logo?.icon ?? DEFAULT_ICON);
  const [color, setColor] = useState<PaletteColor>(project.logo?.color ?? DEFAULT_COLOR);
  const [error, setError] = useState<FieldError | null>(null);

  const isArchived = project.archived_at !== null;
  const trimmedName = name.trim();
  const identifierProblem = identifierError(identifier);
  const identifierChanged = identifier !== project.identifier;
  const logoChanged = icon !== (project.logo?.icon ?? DEFAULT_ICON) || color !== (project.logo?.color ?? DEFAULT_COLOR);
  const hasChanges = trimmedName !== project.name || identifierChanged || description !== project.description_md || logoChanged;
  const canSave = hasChanges && trimmedName !== "" && identifierProblem === null && !isPending && !isArchived;

  const save = () => {
    if (!canSave) return;
    setError(null);
    const saved = project.identifier;
    startTransition(async () => {
      const result = await updateProjectAction({
        project_id: project.id,
        ...(trimmedName !== project.name ? { name: trimmedName } : {}),
        ...(identifierChanged ? { identifier } : {}),
        ...(description !== project.description_md ? { description_md: description } : {}),
        ...(logoChanged ? { logo: { icon, color } } : {}),
      });
      if (!result.ok) {
        if (result.code === "CONFLICT") {
          const isIdentifier = /identifier/i.test(result.message);
          setError({ field: isIdentifier ? "identifier" : "name", message: isIdentifier ? `Another project uses ${identifier}` : "A project with this name exists" });
          return;
        }
        toast({ type: "error", body: failureText("Could not save the project", result.message) });
        return;
      }
      if (identifierChanged) renameEntityLabelKeys(saved, identifier);
      toast({ type: "info", body: "Project saved" });
    });
  };

  return (
    <>
      <FormLayout>
        <TextInput
          label="Name"
          value={name}
          isRequired
          isDisabled={isArchived}
          onChange={(value) => {
            setName(value);
            if (error?.field === "name") setError(null);
          }}
          status={error?.field === "name" ? { type: "error", message: error.message } : undefined}
        />
        <TextInput
          label="Identifier"
          description={`Work items are keyed like ${identifier || "KEY"}-12.`}
          value={identifier}
          isRequired
          isDisabled={isArchived}
          onChange={(value) => {
            setIdentifier(sanitizeIdentifier(value));
            if (error?.field === "identifier") setError(null);
          }}
          status={
            error?.field === "identifier"
              ? { type: "error", message: error.message }
              : identifierProblem !== null
                ? { type: "error", message: identifierProblem }
                : undefined
          }
        />
        {identifierChanged ? (
          <Banner status="info" container="section" title={`Keys become ${identifier}-12`} description={`Old ${project.identifier}- links and /browse addresses keep working.`} />
        ) : null}
        <TextArea label="Description" value={description} onChange={setDescription} rows={4} isOptional isDisabled={isArchived} />
        {/* Labels share one line and both controls are the standard 32px field (size md), so their centres line up. */}
        <HStack gap={3} vAlign="start" wrap="wrap">
          <Selector
            label="Icon"
            size="md"
            options={ICON_OPTIONS}
            value={icon}
            isDisabled={isArchived}
            onChange={setIcon}
            renderOption={(option) => <Token label={option.label ?? option.value} size="sm" icon={<Icon icon={resolveLogoIcon(option.value)} />} />}
            // The trigger shows the icon and its name in plain text: a Token with an icon is 26px tall and made this field taller than its neighbour.
            renderValue={(option) => (
              <HStack gap={2} vAlign="center">
                <Icon icon={resolveLogoIcon(option.value)} size="sm" />
                <Text>{option.label ?? option.value}</Text>
              </HStack>
            )}
          />
          <PaletteColorSelector label="Colour" value={color} onChange={setColor} isDisabled={isArchived} />
        </HStack>
      </FormLayout>
      <HStack justify="end">
        <Button variant="primary" label="Save changes" isDisabled={!canSave} isLoading={isPending} onClick={save} />
      </HStack>
      <VStack gap={3} className="tessera-settings-danger">
        <Heading level={5}>Danger zone</Heading>
        <ProjectDangerZone project={project} />
      </VStack>
    </>
  );
}
