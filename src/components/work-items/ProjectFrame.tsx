"use client";

/**
 * Project frame (docs/contracts/ui.md "Project routes"): the project's panel
 * header, one 52px row with the project's token and name, a hairline and the
 * project's pages as tabs (the tab under the current route is selected, its
 * indicator sitting on the header's hairline). The tabs are the project's
 * only navigation: the sidebar lists projects, not their pages. `TABS` grows
 * as later phases add cycles, modules, views, pages and settings.
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Divider } from "@astryxdesign/core/Divider";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import { PanelBar, PanelHeader, PanelTitle } from "@/components/shell/PanelHeader";
import type { Project } from "@/lib/tessera/types";
import { KanbanIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { useProject } from "./project-provider";

export type ProjectTab = {
  key: string;
  label: string;
  /** Path segment under `/projects/[projectId]/`. */
  segment: string;
  icon: ReactNode;
};

/** Tabs of the project frame in display order; later phases append cycles, modules, views, pages and settings. */
export const TABS: readonly ProjectTab[] = [{ key: "work-items", label: "Work items", segment: "work-items", icon: <KanbanIcon /> }];

/** The project's identifier as a Token carrying its logo icon and colour. */
export function ProjectToken({ project, size = "md" }: { project: Pick<Project, "identifier" | "logo">; size?: "sm" | "md" | "lg" }) {
  return <Token label={project.identifier} icon={<Icon icon={resolveLogoIcon(project.logo?.icon)} />} color={project.logo?.color ?? "gray"} size={size} />;
}

function currentSegment(pathname: string, projectId: string): string {
  const prefix = `/projects/${projectId}/`;
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  return rest.split("/")[0] || TABS[0].segment;
}

export function ProjectFrame({ children }: { children: ReactNode }) {
  const { bundle } = useProject();
  const pathname = usePathname();
  const { project } = bundle;
  const active = TABS.find((tab) => tab.segment === currentSegment(pathname, project.id)) ?? TABS[0];
  return (
    // Header and content go in their slots: as children both landed in the content slot, so the 100%-high
    // LayoutContent sat under the header and the shell scrolled by the header's height.
    <Layout
      height="fill"
      header={
        <PanelHeader label={project.name}>
          <PanelBar
            start={
              <>
                <ProjectToken project={project} size="sm" />
                <PanelTitle>{project.name}</PanelTitle>
                <Divider orientation="vertical" className="tessera-panel-bar-divider" />
                <TabList value={active.key} onChange={() => {}} size="sm" layout="hug" aria-label={`${project.name} pages`} className="tessera-project-tabs">
                  {TABS.map((tab) => (
                    <Tab key={tab.key} value={tab.key} label={tab.label} icon={tab.icon} href={`/projects/${project.id}/${tab.segment}`} />
                  ))}
                </TabList>
              </>
            }
          />
        </PanelHeader>
      }
      content={
        <LayoutContent padding={0} isScrollable label={active.label}>
          {children}
        </LayoutContent>
      }
    />
  );
}
