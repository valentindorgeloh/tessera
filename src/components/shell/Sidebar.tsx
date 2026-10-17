"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { LAST_PROJECT_STORAGE_KEY } from "@/components/work-items/project-provider";
import type { Project } from "@/lib/tessera/types";
import { FolderIcon, HouseIcon, PageIcon, PlusIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { projectIdFromPath } from "./recents";
import { formatKeys, SHORTCUT_BY_ID } from "./shortcuts";
import { useShell } from "./TesseraShell";

export { LAST_PROJECT_STORAGE_KEY };

/** Width of the sidebar (docs/contracts/ui.md "Shell"): 250px by default, resizable from 236 to 350px. */
export const SIDEBAR_WIDTH = { defaultWidth: 250, minWidth: 236, maxWidth: 350 } as const;
export const SIDEBAR_WIDTH_STORAGE_KEY = "tessera.sidebarWidth.v1";

/** The global create chord for the "New work item" tooltip ("N then I"; plain letters read the same on every platform). */
const CREATE_ITEM_KEYS = formatKeys(SHORTCUT_BY_ID.get("create.workItem")?.keys ?? "n i", false);

/** The Projects row is selected on the projects list and on the archived projects (`/projects/archives`, a static segment next to `[projectId]`). */
function isProjectsPage(pathname: string): boolean {
  return pathname === "/projects" || pathname === "/projects/archives" || pathname.startsWith("/projects/archives/");
}

// ---------------------------------------------------------------------------
// Preferences (localStorage), read after mount so server and client render the
// same markup during hydration: the last visited project (ProjectProvider
// writes the same key) and the sidebar width. Astryx's own `autoSaveId` reads
// the width during the first render, which would not match the server's.
// ---------------------------------------------------------------------------

type SidebarPrefs = { lastProjectId: string | null; width: number | null };

const EMPTY_PREFS: SidebarPrefs = { lastProjectId: null, width: null };

let prefs: SidebarPrefs = EMPTY_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SidebarPrefs {
  return prefs;
}

function getServerSnapshot(): SidebarPrefs {
  return EMPTY_PREFS;
}

function readWidth(): number | null {
  try {
    const width = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(width) && width >= SIDEBAR_WIDTH.minWidth && width <= SIDEBAR_WIDTH.maxWidth ? width : null;
  } catch {
    return null;
  }
}

function readLastProject(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadPrefs() {
  if (loaded) return;
  loaded = true;
  prefs = { lastProjectId: readLastProject(), width: readWidth() };
  emit();
}

function rememberProject(projectId: string) {
  if (prefs.lastProjectId === projectId) return;
  prefs = { ...prefs, lastProjectId: projectId };
  try {
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // Not persisted in private mode.
  }
  emit();
}

/**
 * Stores a width the user dragged to. The snapshot keeps the width it loaded,
 * so the SideNav is not remounted in the middle of a drag.
 */
function saveWidth(width: number) {
  if (width < SIDEBAR_WIDTH.minWidth || width > SIDEBAR_WIDTH.maxWidth) return;
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Not persisted in private mode.
  }
}

/**
 * The SideNav `resizable` config and a `key` for it. The stored width arrives
 * after mount; the key changes with it, so the SideNav remounts once with the
 * stored width as its default instead of hydrating with a different one.
 */
export function useSidebarResize(): { key: string; resizable: { defaultWidth: number; minWidth: number; maxWidth: number; onWidthChange: (width: number) => void } } {
  const { width } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    loadPrefs();
  }, []);
  return {
    key: width === null ? "default" : `w${width}`,
    resizable: { ...SIDEBAR_WIDTH, defaultWidth: width ?? SIDEBAR_WIDTH.defaultWidth, onWidthChange: saveWidth },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SideNav of the Tessera shell (docs/contracts/ui.md "Shell"), on the wash
 * beside the content panel: the "Work" heading, a quiet "New work item"
 * button for the last visited (else first) project, Home, the workspace
 * items that exist (Projects) and the projects as flat rows (logo, name,
 * count; the current one selected) under a "Projects" section whose "+"
 * opens Create project. A project's own pages are the tabs in its panel
 * header (`ProjectFrame`), not children here. Collapse state comes from the
 * shell (`mod+b`, the top bar's toggle); the width and the last visited
 * project are remembered in localStorage.
 */
export function Sidebar({ projects }: { projects: Project[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isNavCollapsed, setNavCollapsed, openCreateProject } = useShell();
  const { lastProjectId: lastProject } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resize = useSidebarResize();
  const activeProjectId = projectIdFromPath(pathname);

  useEffect(() => {
    if (activeProjectId && projects.some((project) => project.id === activeProjectId)) rememberProject(activeProjectId);
  }, [activeProjectId, projects]);

  const createTarget = projects.find((project) => project.id === lastProject) ?? projects[0] ?? null;
  const createTooltip = createTarget === null ? "Create a project first" : `Create a work item (${CREATE_ITEM_KEYS})`;
  const openCreate = () => {
    if (createTarget) router.push(`/projects/${createTarget.id}/work-items?create=1`);
  };

  return (
    <SideNav
      key={resize.key}
      aria-label="Work"
      collapsible={{ isCollapsed: isNavCollapsed, onCollapsedChange: setNavCollapsed, hasButton: false }}
      resizable={resize.resizable}
      header={<SideNavHeading heading="Work" headingHref="/home" />}
      topContent={
        isNavCollapsed ? (
          <IconButton
            label="New work item"
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={createTarget === null}
            tooltip={createTooltip}
            onClick={openCreate}
          />
        ) : (
          <Button
            label="New work item"
            variant="secondary"
            size="sm"
            width="100%"
            className="tessera-sidebar-new"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={createTarget === null}
            tooltip={createTooltip}
            onClick={openCreate}
          />
        )
      }
    >
      <SideNavSection title="Workspace" isHeaderHidden>
        <SideNavItem label="Home" icon={HouseIcon} href="/home" isSelected={pathname === "/home"} />
        <SideNavItem label="Wiki" icon={PageIcon} href="/wiki" isSelected={pathname === "/wiki" || pathname.startsWith("/pages/")} />
        <SideNavItem label="Projects" icon={FolderIcon} href="/projects" isSelected={isProjectsPage(pathname)} />
      </SideNavSection>
      <SideNavSection
        title="Projects"
        endContent={<IconButton label="Create project" variant="ghost" size="sm" icon={<Icon icon={PlusIcon} />} tooltip="Create project" onClick={openCreateProject} />}
      >
        {projects.length === 0 ? (
          <Text type="supporting" color="secondary" as="p">
            No projects yet.
          </Text>
        ) : (
          projects.map((project) => (
            <SideNavItem
              key={project.id}
              label={project.name}
              icon={resolveLogoIcon(project.logo?.icon)}
              href={`/projects/${project.id}/work-items`}
              isSelected={project.id === activeProjectId}
              endContent={
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {project.counts.total}
                </Text>
              }
            />
          ))
        )}
      </SideNavSection>
    </SideNav>
  );
}
