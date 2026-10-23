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
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Icon } from "@astryxdesign/core/Icon";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Token } from "@astryxdesign/core/Token";
import { ProjectArchivedBanner, ProjectMenu } from "@/components/planning/ProjectArchive";
import { FavoriteButton } from "@/components/shell/FavoriteButton";
import { PanelBar, PanelHeader, PanelTitle } from "@/components/shell/PanelHeader";
import { SectionMenu } from "@/components/shell/SectionMenu";
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

/** True when `pathname` is `/projects/<projectId>/<segment>/<id>` with exactly one id segment. */
function isDetailPath(pathname: string, projectId: string, segment: string): boolean {
  const prefix = `/projects/${projectId}/${segment}/`;
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length).replace(/\/+$/, "");
  return rest.length > 0 && !rest.includes("/");
}

/**
 * True on `/projects/<projectId>/work-items/<itemId>`, the page whose body holds
 * the item title as the document's h1. There the frame's title steps down to
 * level 2, so the page keeps one level-1 heading (the backlog's "two h1" entry).
 */
export function isWorkItemPagePath(pathname: string, projectId: string): boolean {
  return isDetailPath(pathname, projectId, "work-items");
}

/** True on `/projects/<projectId>/pages/<pageId>`, whose body holds the page title as the h1 (PageTitle). */
export function isProjectPageDetailPath(pathname: string, projectId: string): boolean {
  return isDetailPath(pathname, projectId, "pages");
}

/** The widths where shell.css folds the non-current tabs to their icon (decision 14); the server renders false, so no tooltip mounts there. */
const FOLD_BAND_QUERY = "(min-width: 600px) and (max-width: 1279px)";

export function ProjectFrame({ children }: { children: ReactNode }) {
  const { bundle } = useProject();
  const pathname = usePathname();
  const { project } = bundle;
  const tabs = projectTabs(project);
  const isFoldBand = useMediaQuery(FOLD_BAND_QUERY);
  const active = activeProjectTab(pathname, project.id, tabs);
  // A work item page and a project page own the document's h1 in their body, so the frame title steps down there.
  const titleLevel = isWorkItemPagePath(pathname, project.id) || isProjectPageDetailPath(pathname, project.id) ? 2 : 1;
  return (
    // Header and content go in their slots: as children both landed in the content slot, so the 100%-high
    // LayoutContent sat under the header and the shell scrolled by the header's height.
    <Layout
      height="fill"
      header={
        <>
          <PanelHeader label={project.name}>
            <PanelBar
              className="tessera-project-bar"
              start={
                <>
                  {/* 1280px and up: labelled tabs. 600 to 1279px: the bar takes two rows and only the current tab keeps its label, the others fold to their icon with a tooltip. Below 600px the SectionMenu replaces the strip (shell.css switches the two; decision 14). */}
                  <ProjectToken project={project} size="sm" className="tessera-project-frame-token" />
                  <PanelTitle className="tessera-project-frame-title" accessibilityLevel={titleLevel}>
                    {project.name}
                  </PanelTitle>
                  <Divider orientation="vertical" className="tessera-panel-bar-divider" />
                  <SectionMenu
                    label={`${project.name} pages`}
                    currentKey={active?.key ?? null}
                    className="tessera-section-menu--project"
                    entries={tabs.map((tab) => ({
                      key: tab.key,
                      label: tab.label,
                      href: `/projects/${project.id}/${tab.segment}`,
                      icon: TAB_ICONS[tab.key],
                      endContent: tab.key === "intake" && bundle.intake_open > 0 ? <Badge label={String(bundle.intake_open)} /> : undefined,
                    }))}
                  />
                  <TabList value={active?.key ?? ""} onChange={() => {}} size="sm" layout="hug" aria-label={`${project.name} pages`} className="tessera-project-tabs">
                    {tabs.map((tab) => (
                      // focusTrigger "always": the roving strip gives the other tabs tabindex -1, which Tooltip's "auto" reads as not focusable. TabList finds a tab by [data-tab-value], so the wrapper does not matter to it.
                      // isOpen false (not just isEnabled) when the tab is current or the band is not folded: isEnabled only stops a tooltip from opening, so one opened by keyboard on the tab that then becomes current would stay over the title. undefined keeps it uncontrolled otherwise.
                      <Tooltip key={tab.key} content={tab.label} isEnabled={isFoldBand && tab.key !== active?.key} isOpen={isFoldBand && tab.key !== active?.key ? undefined : false} focusTrigger="always">
                        <Tab
                          value={tab.key}
                          label={tab.label}
                          icon={TAB_ICONS[tab.key]}
                          href={`/projects/${project.id}/${tab.segment}`}
                          // The label stays the accessible name when shell.css folds the other tabs to their icon (decision 14).
                          aria-label={tab.label}
                          endContent={tab.key === "intake" && bundle.intake_open > 0 ? <Badge label={String(bundle.intake_open)} /> : undefined}
                        />
                      </Tooltip>
                    ))}
                  </TabList>
                </>
              }
              end={
                // The class lets shell.css space the two 28px buttons to a 44px pitch under a coarse pointer (decision 14, option A).
                <HStack className="tessera-project-bar-actions" gap={1} vAlign="center">
                  <FavoriteButton entityType="project" entityId={project.id} />
                  <ProjectMenu project={project} />
                </HStack>
              }
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
