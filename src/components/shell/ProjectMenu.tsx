"use client";

/**
 * The sidebar project's `…` menu (docs/drafts/p9-plan.md U2): settings,
 * archives, the link, favourites, a draft, archive, and move up / down.
 * Archive uses the same confirmation as the project frame.
 */
import { useState, useTransition } from "react";
import type { DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { useClipboard } from "@astryxdesign/core/hooks";
import { useToast } from "@astryxdesign/core/Toast";
import { useRouter } from "next/navigation";
import { archiveProjectAction, reorderProjectAction } from "@/app/actions/projects";
import { AlertDialog } from "@/components/shell/dialogs";
import { useFavoriteToggle } from "@/components/shell/FavoriteButton";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import type { Project } from "@/lib/tessera/types";
import { ArchiveIcon, DraftIcon, GearIcon, LinkIcon, MoveDownIcon, MoveUpIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";

export type ProjectMenuProps = {
  project: Pick<Project, "id" | "identifier" | "name">;
  isFavorite?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: "up" | "down") => void;
};

export function ProjectMenu({ project, isFavorite = false, canMoveUp, canMoveDown, onMove }: ProjectMenuProps) {
  const router = useRouter();
  const toast = useToast();
  const clipboard = useClipboard({ announce: "Copied" });
  const favorite = useFavoriteToggle("project", project.id, isFavorite);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [isArchiving, startArchive] = useTransition();

  const copyLink = () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    void clipboard.copy(`${origin}/projects/${project.id}/work-items`);
  };

  const archive = () => {
    startArchive(async () => {
      const result = await archiveProjectAction({ project_id: project.id });
      if (!result.ok) {
        toast({ type: "error", body: result.message });
        return;
      }
      setConfirmArchive(false);
      toast({ type: "info", body: `Archived ${project.identifier}` });
      forgetRecentsUnder(`/projects/${project.id}`);
      router.push("/projects/archives");
    });
  };

  const items: DropdownMenuOption[] = [
    { id: "settings", label: "Settings", icon: GearIcon, href: `/projects/${project.id}/settings/general` },
    { id: "archives", label: "Archives", icon: ArchiveIcon, href: `/projects/${project.id}/archives` },
    { id: "copy", label: "Copy link", icon: LinkIcon, onClick: copyLink },
    { id: "favorite", label: favorite.label, icon: resolveLogoIcon("Star"), onClick: favorite.toggle },
    { id: "draft", label: "Draft work item", icon: DraftIcon, href: `/drafts?draft=new&project=${project.id}` },
    { id: "archive", label: "Archive project", icon: ArchiveIcon, onClick: () => setConfirmArchive(true) },
    { id: "up", label: "Move up", icon: MoveUpIcon, isDisabled: !canMoveUp, onClick: () => onMove("up") },
    { id: "down", label: "Move down", icon: MoveDownIcon, isDisabled: !canMoveDown, onClick: () => onMove("down") },
  ];

  return (
    <>
      <MoreMenu label={`Actions for ${project.name}`} size="sm" items={items} placement="below" alignment="end" />
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
    </>
  );
}

/** Reorder helper kept next to the menu so the sidebar can share one call. */
export function projectMove(projectId: string, placement: { before_id?: string; after_id?: string }) {
  return reorderProjectAction({ project_id: projectId, ...placement });
}
