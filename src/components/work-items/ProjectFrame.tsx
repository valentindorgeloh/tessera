"use client";

/**
 * Project frame (docs/contracts/ui.md "Project routes", P3 "Integration (E4)"):
 * the project's panel header, one 52px row with the project's token and name,
 * a hairline, the project's pages as tabs (the tab under the current route is
 * selected, its indicator sitting on the header's hairline) and the project
 * menu at the row's end. The tabs follow the feature toggles
 * (./project-tabs.ts): Work items, Cycles, Modules and Views when enabled,
 * Archives and Settings always; a route of a feature that is turned off selects no tab. They are the
 * project's only navigation: the sidebar lists projects, not their pages. An
 * archived project shows its Banner under the header, outside the scroller.
 * Later phases add pages to the tabs.
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Divider } from "@astryxdesign/core/Divider";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import { ProjectArchivedBanner, ProjectMenu } from "@/components/planning/ProjectArchive";
import { PanelBar, PanelHeader, PanelTitle } from "@/components/shell/PanelHeader";
import type { Project } from "@/lib/tessera/types";
import { ArchiveIcon, CycleIcon, GearIcon, IntakeIcon, KanbanIcon, ModuleIcon, PageIcon, ViewIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { activeProjectTab, projectTabs, type ProjectTabKey } from "./project-tabs";
import { useProject } from "./project-provider";

const TAB_ICONS: Record<ProjectTabKey, ReactNode> = {
  "work-items": <KanbanIcon />,
  cycles: <CycleIcon />,
  modules: <ModuleIcon />,
  views: <ViewIcon />,
  pages: <PageIcon />,
  intake: <IntakeIcon />,
  archives: <ArchiveIcon />,
  settings: <GearIcon />,
};

/** The project's identifier as a Token carrying its logo icon and colour. */
export function ProjectToken({ project, size = "md", className }: { project: Pick<Project, "identifier" | "logo">; size?: "sm" | "md" | "lg"; className?: string }) {
  return <Token label={project.identifier} icon={<Icon icon={resolveLogoIcon(project.logo?.icon)} />} color={project.logo?.color ?? "gray"} size={size} className={className} />;
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
        <>
          <PanelHeader label={project.name}>
            <PanelBar
              start={
                <>
                  {/* On a narrow panel the token and the name keep their room and the tabs scroll (shell.css). */}
                  <ProjectToken project={project} size="sm" className="tessera-project-frame-token" />
                  <PanelTitle className="tessera-project-frame-title">{project.name}</PanelTitle>
                  <Divider orientation="vertical" className="tessera-panel-bar-divider" />
                  <TabList value={active?.key ?? ""} onChange={() => {}} size="sm" layout="hug" aria-label={`${project.name} pages`} className="tessera-project-tabs">
                    {tabs.map((tab) => (
                      <Tab
                        key={tab.key}
                        value={tab.key}
                        label={tab.label}
                        icon={TAB_ICONS[tab.key]}
                        href={`/projects/${project.id}/${tab.segment}`}
                        endContent={tab.key === "intake" && bundle.intake_open > 0 ? <Badge label={String(bundle.intake_open)} /> : undefined}
                      />
                    ))}
                  </TabList>
                </>
              }
              end={<ProjectMenu project={project} />}
            />
          </PanelHeader>
          {project.archived_at !== null ? (
            <VStack paddingInline={4} paddingBlock={2}>
              <ProjectArchivedBanner project={project} />
            </VStack>
          ) : null}
        </>
      }
      content={
        <LayoutContent padding={0} isScrollable label={active?.label ?? project.name}>
          {children}
        </LayoutContent>
      }
    />
  );
}
