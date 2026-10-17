"use client";

/**
 * Archived projects at `/projects/archives` (docs/contracts/ui.md "Archives
 * (E3)"). The route sits next to `[projectId]`, outside the project layout,
 * so nothing here reads `useProject()`: the projects arrive as props. The
 * page's panel header holds the title, so this is the list alone. Rows link
 * to the project (its frame shows the archived Banner) and carry Restore and
 * a menu with Delete project…. `ArchivedProjectsLink` is the "Archived
 * projects" link on `/projects`.
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { ProjectToken } from "@/components/work-items/ProjectFrame";
import type { Project } from "@/lib/tessera/types";
import { ArchiveIcon, RestoreIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { useRestoreProject } from "./ProjectArchive";

export type ArchivedProjectsProps = { projects: Project[] };

export function ArchivedProjects({ projects }: ArchivedProjectsProps) {
  // The project the delete dialog is for; kept after closing so the dialog can animate out with its text.
  const [target, setTarget] = useState<Project | null>(null);
  const [isDeleteOpen, setDeleteOpen] = useState(false);

  const askDelete = (project: Project) => {
    setTarget(project);
    setDeleteOpen(true);
  };

  return (
    <VStack gap={5} className="tessera-archives-projects">
      {projects.length === 0 ? (
        <EmptyState
          icon={<ArchiveIcon />}
          title="No archived projects"
          description="Projects you archive leave the sidebar and are kept here, read-only, until you restore them."
        />
      ) : (
        <List hasDividers edgeCompensation="inline" aria-label="Archived projects">
          {projects.map((project) => (
            <ArchivedProjectRow key={project.id} project={project} onDelete={askDelete} />
          ))}
        </List>
      )}
      {target ? <DeleteProjectDialog project={target} isOpen={isDeleteOpen} onOpenChange={setDeleteOpen} /> : null}
    </VStack>
  );
}

function ArchivedProjectRow({ project, onDelete }: { project: Project; onDelete: (project: Project) => void }) {
  const { restore, isRestoring } = useRestoreProject(project);
  return (
    <ListItem
      href={`/projects/${project.id}/work-items`}
      label={project.name}
      description={
        // No hover card: the time sits inside the row's link or button, which holds no second control or tab stop.
        project.archived_at === null ? undefined : (
          <>
            Archived <RelativeTime value={project.archived_at} hasTooltip={false} />
          </>
        )
      }
      startContent={<ProjectToken project={{ identifier: project.identifier, logo: project.logo }} />}
      endContent={
        <HStack gap={1} vAlign="center">
          <Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} isLoading={isRestoring} onClick={restore} />
          <MoreMenu
            label="Project actions"
            size="sm"
            alignment="end"
            items={[{ id: "delete", label: "Delete project…", icon: TrashIcon, variant: "destructive", onClick: () => onDelete(project) }]}
          />
        </HStack>
      }
    />
  );
}

/** "Archived projects" link with the archive glyph, next to "New project" on `/projects`. */
export function ArchivedProjectsLink() {
  return (
    <Link href="/projects/archives" isStandalone>
      <HStack as="span" gap={1} vAlign="center">
        <Icon icon={ArchiveIcon} size="sm" />
        Archived projects
      </HStack>
    </Link>
  );
}
