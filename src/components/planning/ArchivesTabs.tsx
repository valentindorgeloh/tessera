"use client";

/**
 * Tabs of the project archives (docs/contracts/ui.md "Archives (E3)"), in
 * the archives' panel sub-header, docked on its hairline like the frame's own
 * tabs: Work items, Cycles, Modules, each a link to
 * `/projects/<id>/archives/<kind>`.
 * Navigation tabs, so no `role` and no `panelId`; the no-op `onChange` is the
 * frame's pattern for `href` tabs; the nav is named "Archives" so it is told
 * apart from the frame's own tabs. A feature that is turned off loses its
 * tab. The bundle is read optionally: for an unknown project the layout
 * renders the page bare and the page calls `notFound()`.
 */
import { usePathname } from "next/navigation";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useOptionalProject } from "@/components/work-items/project-provider";
import { activeArchiveKind, archiveTabs } from "./archive-rules";

export type ArchivesTabsProps = { projectId: string };

const ALL_FEATURES = { cycles_enabled: true, modules_enabled: true } as const;

export function ArchivesTabs({ projectId }: ArchivesTabsProps) {
  const pathname = usePathname();
  const context = useOptionalProject();
  const tabs = archiveTabs(context?.bundle.project ?? ALL_FEATURES);
  const activeKind = activeArchiveKind(pathname, projectId);
  return (
    <TabList aria-label="Archives" value={activeKind} onChange={() => {}} size="sm" layout="hug" className="tessera-archives-tabs">
      {tabs.map((tab) => (
        <Tab key={tab.kind} value={tab.kind} label={tab.label} href={`/projects/${projectId}/archives/${tab.kind}`} />
      ))}
    </TabList>
  );
}
