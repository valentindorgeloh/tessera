"use client";

/**
 * Project frame (docs/contracts/ui.md "Project routes"): header with the
 * project's logo, name and identifier, and the tab strip under it. `TABS`
 * grows as later phases add cycles, modules, views, pages and settings.
 */
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading } from "@astryxdesign/core/Text";
import { Icon } from "@astryxdesign/core/Icon";
import { Token } from "@astryxdesign/core/Token";
import type { Project } from "@/lib/tessera/types";
import { KanbanIcon, resolveLogoIcon } from "@/themes/paper/icons";
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
    <Layout height="fill">
      <LayoutHeader hasDivider padding={0} label={project.name}>
        <HStack gap={3} vAlign="center" paddingInline={5} paddingBlockStart={4} paddingBlockEnd={2}>
          <ProjectToken project={project} />
          <Heading level={1} maxLines={1}>
            {project.name}
          </Heading>
        </HStack>
        <TabList value={active.key} onChange={() => {}} size="sm" layout="hug" isFullBleed>
          {TABS.map((tab) => (
            <Tab key={tab.key} value={tab.key} label={tab.label} icon={tab.icon} href={`/projects/${project.id}/${tab.segment}`} />
          ))}
        </TabList>
      </LayoutHeader>
      <LayoutContent padding={0} isScrollable label={active.label}>
        {children}
      </LayoutContent>
    </Layout>
  );
}
