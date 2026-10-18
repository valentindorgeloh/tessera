/**
 * Tabs of the project frame (docs/contracts/ui.md "Integration (E4)"). Pure and
 * directive-free so Vitest covers it (tests/ui/project-tabs.test.ts); the frame
 * (./ProjectFrame.tsx) maps the keys to icons.
 */
import type { Project } from "@/lib/tessera/types";

export type ProjectTabKey = "work-items" | "cycles" | "modules" | "views" | "pages" | "intake" | "archives" | "settings";
export type ProjectTabDef = { key: ProjectTabKey; label: string; segment: string };

const WORK_ITEMS: ProjectTabDef = { key: "work-items", label: "Work items", segment: "work-items" };
const CYCLES: ProjectTabDef = { key: "cycles", label: "Cycles", segment: "cycles" };
const MODULES: ProjectTabDef = { key: "modules", label: "Modules", segment: "modules" };
const VIEWS: ProjectTabDef = { key: "views", label: "Views", segment: "views" };
const PAGES: ProjectTabDef = { key: "pages", label: "Pages", segment: "pages" };
const INTAKE: ProjectTabDef = { key: "intake", label: "Intake", segment: "intake" };
const ARCHIVES: ProjectTabDef = { key: "archives", label: "Archives", segment: "archives" };
// The settings index redirects to General; `/projects/<id>/settings/<tab>` still matches this segment.
const SETTINGS: ProjectTabDef = { key: "settings", label: "Settings", segment: "settings" };

/** Work items, then each enabled feature (Cycles, Modules, Views, Pages, Intake), then Archives and Settings. */
export function projectTabs(project: Pick<Project, "cycles_enabled" | "modules_enabled" | "views_enabled" | "pages_enabled" | "intake_enabled">): ProjectTabDef[] {
  const tabs = [WORK_ITEMS];
  if (project.cycles_enabled) tabs.push(CYCLES);
  if (project.modules_enabled) tabs.push(MODULES);
  if (project.views_enabled) tabs.push(VIEWS);
  if (project.pages_enabled) tabs.push(PAGES);
  if (project.intake_enabled) tabs.push(INTAKE);
  tabs.push(ARCHIVES, SETTINGS);
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
