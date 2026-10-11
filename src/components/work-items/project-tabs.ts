/**
 * Tabs of the project frame (docs/contracts/ui.md "Integration (E4)"). Pure and
 * directive-free so Vitest covers it (tests/ui/project-tabs.test.ts); the frame
 * (./ProjectFrame.tsx) maps the keys to icons.
 */
import type { Project } from "@/lib/tessera/types";

export type ProjectTabKey = "work-items" | "cycles" | "modules" | "archives";
export type ProjectTabDef = { key: ProjectTabKey; label: string; segment: string };

const WORK_ITEMS: ProjectTabDef = { key: "work-items", label: "Work items", segment: "work-items" };
const CYCLES: ProjectTabDef = { key: "cycles", label: "Cycles", segment: "cycles" };
const MODULES: ProjectTabDef = { key: "modules", label: "Modules", segment: "modules" };
const ARCHIVES: ProjectTabDef = { key: "archives", label: "Archives", segment: "archives" };

/** Work items, Cycles (when enabled), Modules (when enabled), Archives (always), in display order. */
export function projectTabs(project: Pick<Project, "cycles_enabled" | "modules_enabled">): ProjectTabDef[] {
  const tabs = [WORK_ITEMS];
  if (project.cycles_enabled) tabs.push(CYCLES);
  if (project.modules_enabled) tabs.push(MODULES);
  tabs.push(ARCHIVES);
  return tabs;
}

/**
 * The tab whose segment opens `pathname` under `/projects/<projectId>/`; the
 * project root selects the first tab. Null for another project's path, an
 * unknown segment, or a route of a feature that is turned off (no tab selected).
 */
export function activeProjectTab(pathname: string, projectId: string, tabs: readonly ProjectTabDef[]): ProjectTabDef | null {
  const root = `/projects/${projectId}`;
  if (pathname !== root && !pathname.startsWith(`${root}/`)) return null;
  const segment = pathname.slice(root.length).split("/").filter(Boolean)[0];
  if (segment === undefined) return tabs[0] ?? null;
  return tabs.find((tab) => tab.segment === segment) ?? null;
}
