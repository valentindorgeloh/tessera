"use client";

/**
 * Project archive controls (docs/contracts/ui.md "Archives (E3)"), rendered
 * by the project frame (`ProjectFrame`, lane E4): `ProjectMenu` at the end of
 * the panel header row (beside the tabs) and `ProjectArchivedBanner` under the
 * panel header. Both take the project as a prop; neither reads `useProject()`, so
 * `/projects/archives` (outside the project layout) can reuse the restore
 * hook below.
 */
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "@/components/shell/dialogs";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useToast } from "@astryxdesign/core/Toast";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { archiveProjectAction, unarchiveProjectAction } from "@/app/actions/projects";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import type { Project } from "@/lib/tessera/types";
import { ArchiveIcon, GearIcon, RestoreIcon, TrashIcon } from "@/themes/catppuccin/icons";
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

/**
 * Archive, restore and delete of one project (P4 F2: the project menu and the
 * settings' danger zone share them): the pending state, the two confirmations
 * and their side effects. `dialogs` renders the AlertDialog and the delete
 * dialog next to whichever control opens them.
 */
function useProjectActions(project: ArchivableProject) {
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
      // An archived project leaves the sidebar and its recents. The last-project pointer stays (P3): its routes still render, read-only.
      forgetRecentsUnder(`/projects/${project.id}`);
      router.push("/projects/archives");
    });
  };

  const items: DropdownMenuOption[] = [
    isArchived
      ? { id: "restore", label: "Restore project", icon: RestoreIcon, isDisabled: isRestoring, onClick: restore }
      : { id: "archive", label: "Archive project", icon: ArchiveIcon, onClick: () => setConfirmArchive(true) },
    { id: "delete", label: "Delete project…", icon: TrashIcon, variant: "destructive", onClick: () => setConfirmDelete(true) },
  ];

  const dialogs = (
    <>
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

  return {
    isArchived,
    isRestoring,
    items,
    dialogs,
    restore,
    requestArchive: () => setConfirmArchive(true),
    requestDelete: () => setConfirmDelete(true),
  };
}

/** "Project actions" overflow menu: Project settings, then Archive project… (active) or Restore project (archived) and Delete project…. */
export function ProjectMenu({ project }: ProjectMenuProps) {
  const { items, dialogs } = useProjectActions(project);
  const menuItems: DropdownMenuOption[] = [
    { id: "settings", label: "Project settings", icon: GearIcon, href: `/projects/${project.id}/settings/general` },
    { type: "divider" },
    ...items,
  ];
  return (
    <>
      <MoreMenu label="Project actions" size="sm" items={menuItems} alignment="end" />
      {dialogs}
    </>
  );
}

/**
 * Danger zone of the General settings tab: Archive (Restore when archived) and
 * Delete project…, with the dialogs and side effects of the menu. Both stay
 * enabled on an archived project.
 */
export function ProjectDangerZone({ project }: ProjectMenuProps) {
  const { isArchived, isRestoring, restore, requestArchive, requestDelete, dialogs } = useProjectActions(project);
  return (
    <>
      <List hasDividers>
        <ListItem
          label="Archive project"
          description="It leaves the sidebar and becomes read-only until restored."
          endContent={
            isArchived ? (
              <Button variant="secondary" size="sm" label="Restore" isLoading={isRestoring} onClick={restore} />
            ) : (
              <Button variant="secondary" size="sm" label="Archive" onClick={requestArchive} />
            )
          }
        />
        <ListItem
          label="Delete project"
          description="Deletes its work items, cycles, modules and views."
          endContent={<Button variant="destructive" size="sm" label="Delete project…" onClick={requestDelete} />}
        />
      </List>
      {dialogs}
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
