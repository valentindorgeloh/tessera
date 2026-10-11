"use client";

/**
 * Project frame (docs/contracts/ui.md "Project routes", P3 "Integration (E4)"):
 * header with the project's logo, name and identifier and the project menu,
 * the archived Banner when the project is archived, and the tab strip under
 * it. The tabs follow the feature toggles (./project-tabs.ts); a route of a
 * feature that is turned off selects no tab. Later phases add views, pages
 * and settings there.
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import { ProjectArchivedBanner, ProjectMenu } from "@/components/planning/ProjectArchive";
import type { Project } from "@/lib/tessera/types";
import { ArchiveIcon, CycleIcon, KanbanIcon, ModuleIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { activeProjectTab, projectTabs, type ProjectTabKey } from "./project-tabs";
import { useProject } from "./project-provider";

const TAB_ICONS: Record<ProjectTabKey, ReactNode> = {
  "work-items": <KanbanIcon />,
  cycles: <CycleIcon />,
  modules: <ModuleIcon />,
  archives: <ArchiveIcon />,
};

/** The project's identifier as a Token carrying its logo icon and colour. */
export function ProjectToken({ project, size = "md" }: { project: Pick<Project, "identifier" | "logo">; size?: "sm" | "md" | "lg" }) {
  return <Token label={project.identifier} icon={<Icon icon={resolveLogoIcon(project.logo?.icon)} />} color={project.logo?.color ?? "gray"} size={size} />;
}

export function ProjectFrame({ children }: { children: ReactNode }) {
  const { bundle } = useProject();
  const pathname = usePathname();
  const { project } = bundle;
  const tabs = projectTabs(project);
  const active = activeProjectTab(pathname, project.id, tabs);
  return (
    // Header and content go in their slots: as children both landed in the content slot, so the 100%-high
    // LayoutContent sat under the header and the shell scrolled by the header's height.
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={0} label={project.name}>
          <HStack gap={3} vAlign="center" paddingInline={5} paddingBlockStart={4} paddingBlockEnd={2}>
            <StackItem size="fill">
              <HStack gap={3} vAlign="center">
                <ProjectToken project={project} />
                <Heading level={1} maxLines={1}>
                  {project.name}
                </Heading>
              </HStack>
            </StackItem>
            <ProjectMenu project={project} />
          </HStack>
          {project.archived_at !== null ? (
            <VStack paddingInline={5} paddingBlockEnd={2}>
              <ProjectArchivedBanner project={project} />
            </VStack>
          ) : null}
          <TabList value={active?.key ?? ""} onChange={() => {}} size="sm" layout="hug" isFullBleed>
            {tabs.map((tab) => (
              <Tab key={tab.key} value={tab.key} label={tab.label} icon={TAB_ICONS[tab.key]} href={`/projects/${project.id}/${tab.segment}`} />
            ))}
          </TabList>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0} isScrollable label={active?.label ?? project.name}>
          {children}
        </LayoutContent>
      }
    />
  );
}
