"use client";

/**
 * Project archive controls (docs/contracts/ui.md "Archives (E3)"), rendered
 * by the project frame (`ProjectFrame`, lane E4): `ProjectMenu` at the end of
 * the header row and `ProjectArchivedBanner` between the header row and the
 * tabs. Both take the project as a prop; neither reads `useProject()`, so
 * `/projects/archives` (outside the project layout) can reuse the restore
 * hook below.
 */
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useToast } from "@astryxdesign/core/Toast";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { archiveProjectAction, unarchiveProjectAction } from "@/app/actions/projects";
import type { Project } from "@/lib/tessera/types";
import { ArchiveIcon, RestoreIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { failureText } from "./archive-rules";
import { DeleteProjectDialog } from "./DeleteProjectDialog";

/** The project fields the archive controls read. */
export type ArchivableProject = Pick<Project, "id" | "identifier" | "name" | "archived_at">;

/**
 * Restores an archived project through `unarchiveProjectAction`; Toast "Restored WEB"
 * or "Could not restore WEB. <message>". The `refresh()` inside the action re-renders
 * the open page (the frame drops its Banner, `/projects/archives` drops the row).
 */
export function useRestoreProject(project: Pick<Project, "id" | "identifier">): { restore: () => void; isRestoring: boolean } {
  const toast = useToast();
  const [isRestoring, startTransition] = useTransition();
  const { id, identifier } = project;
  const restore = useCallback(() => {
    startTransition(async () => {
      const result = await unarchiveProjectAction({ project_id: id });
      if (result.ok) toast({ type: "info", body: `Restored ${identifier}` });
      else toast({ type: "error", body: failureText(`Could not restore ${identifier}`, result.message) });
    });
  }, [id, identifier, toast]);
  return { restore, isRestoring };
}

export type ProjectMenuProps = { project: ArchivableProject };

/** "Project actions" overflow menu: Archive project… (active) or Restore project (archived), and Delete project…. */
export function ProjectMenu({ project }: ProjectMenuProps) {
  const router = useRouter();
  const toast = useToast();
  const { restore, isRestoring } = useRestoreProject(project);
  const [isArchiving, startArchive] = useTransition();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isArchived = project.archived_at !== null;

  const archive = () => {
    startArchive(async () => {
      const result = await archiveProjectAction({ project_id: project.id });
      if (!result.ok) {
        toast({ type: "error", body: failureText(`Could not archive ${project.identifier}`, result.message) });
        return;
      }
      setConfirmArchive(false);
      toast({ type: "info", body: `Archived ${project.identifier}` });
      router.push("/projects/archives");
    });
  };

  const items: DropdownMenuOption[] = [
    isArchived
      ? { id: "restore", label: "Restore project", icon: RestoreIcon, isDisabled: isRestoring, onClick: restore }
      : { id: "archive", label: "Archive project", icon: ArchiveIcon, onClick: () => setConfirmArchive(true) },
    { id: "delete", label: "Delete project…", icon: TrashIcon, variant: "destructive", onClick: () => setConfirmDelete(true) },
  ];

  return (
    <>
      <MoreMenu label="Project actions" size="sm" items={items} alignment="end" />
      <AlertDialog
        isOpen={confirmArchive}
        onOpenChange={(open) => !isArchiving && setConfirmArchive(open)}
        title={`Archive ${project.identifier}?`}
        description="It leaves the sidebar and becomes read-only until restored."
        actionLabel="Archive"
        actionVariant="primary"
        isActionLoading={isArchiving}
        onAction={archive}
      />
      <DeleteProjectDialog project={project} isOpen={confirmDelete} onOpenChange={setConfirmDelete} />
    </>
  );
}

export type ProjectArchivedBannerProps = { project: ArchivableProject };

/** Info Banner "This project is archived" with a Restore button; null for an active project. */
export function ProjectArchivedBanner({ project }: ProjectArchivedBannerProps) {
  const { restore, isRestoring } = useRestoreProject(project);
  if (project.archived_at === null) return null;
  return (
    <Banner
      status="info"
      title="This project is archived"
      description="Restore it to make changes."
      endContent={<Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} isLoading={isRestoring} onClick={restore} />}
    />
  );
}
