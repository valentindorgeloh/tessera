"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import type { Project } from "@/lib/tessera/types";
import { FolderIcon, HouseIcon, KanbanIcon, PlusIcon, SquaresFourIcon } from "@/themes/paper/icons";
import { useShell } from "./TesseraShell";

export const SIDEBAR_STORAGE_KEY = "tessera.sidebar.v1";
export const LAST_PROJECT_STORAGE_KEY = "tessera.lastProject.v1";

export type ProjectNavItem = { key: string; label: string; href: string; icon: IconType };

/**
 * Sub-items under a project in the tree. Extension point for later lanes:
 * append Cycles, Modules, Views, Pages, Intake and Settings here according to
 * the project's feature toggles, in the order of docs/PLAN.md section 6.
 */
export function projectNavItems(project: Project): ProjectNavItem[] {
  return [{ key: "work-items", label: "Work items", href: `/projects/${project.id}/work-items`, icon: KanbanIcon }];
}

/** Project id from `/projects/[id]/...`, else null. */
export function projectIdFromPath(pathname: string): string | null {
  const match = /^\/projects\/([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// ---------------------------------------------------------------------------
// Preferences store (localStorage), read after mount so server and client
// render the same markup during hydration.
// ---------------------------------------------------------------------------

type SidebarPrefs = {
  /** Project id → expanded; a missing id uses the default (expanded while active). */
  expanded: Readonly<Record<string, boolean>>;
  lastProjectId: string | null;
};

const EMPTY_PREFS: SidebarPrefs = { expanded: {}, lastProjectId: null };

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

function readExpanded(): Readonly<Record<string, boolean>> {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return {};
    const stored = (parsed as { expanded?: unknown }).expanded;
    if (typeof stored !== "object" || stored === null) return {};
    const expanded: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(stored)) if (typeof value === "boolean") expanded[id] = value;
    return expanded;
  } catch {
    return {};
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
  prefs = { expanded: readExpanded(), lastProjectId: readLastProject() };
  emit();
}

function setExpanded(projectId: string, expanded: boolean) {
  prefs = { ...prefs, expanded: { ...prefs.expanded, [projectId]: expanded } };
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ expanded: prefs.expanded }));
  } catch {
    // Not persisted in private mode; the session still works.
  }
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * SideNav of the Tessera shell (docs/contracts/ui.md "Shell"): Tessera
 * heading, "New work item" for the last visited (else first) project, Home
 * and Projects, and the projects tree with per-project children from
 * `projectNavItems`. Workspace items that arrive in later phases are added
 * here when their routes exist. Collapse state comes from the shell
 * (`mod+b`); expanded projects and the last visited project are remembered
 * in localStorage.
 */
export function Sidebar({ projects }: { projects: Project[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isNavCollapsed, setNavCollapsed } = useShell();
  const { expanded, lastProjectId } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const activeProjectId = projectIdFromPath(pathname);

  useEffect(() => {
    loadPrefs();
  }, []);

  useEffect(() => {
    if (activeProjectId && projects.some((project) => project.id === activeProjectId)) rememberProject(activeProjectId);
  }, [activeProjectId, projects]);

  const createTarget = projects.find((project) => project.id === lastProjectId) ?? projects[0] ?? null;
  const createTooltip = createTarget === null ? "Create a project first" : "Create a work item";
  const openCreate = () => {
    if (createTarget) router.push(`/projects/${createTarget.id}/work-items?create=1`);
  };

  return (
    <SideNav
      aria-label="Tessera"
      collapsible={{ isCollapsed: isNavCollapsed, onCollapsedChange: setNavCollapsed, hasButton: true }}
      header={
        <SideNavHeading
          heading="Tessera"
          headingHref="/home"
          icon={<NavIcon icon={<Icon icon={SquaresFourIcon} size="sm" />} />}
        />
      }
      topContent={
        isNavCollapsed ? (
          <IconButton
            label="New work item"
            variant="primary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            isDisabled={createTarget === null}
            tooltip={createTooltip}
            onClick={openCreate}
          />
        ) : (
          <Button
            label="New work item"
            variant="primary"
            size="sm"
            width="100%"
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
        <SideNavItem label="Projects" icon={FolderIcon} href="/projects" isSelected={pathname === "/projects"} />
      </SideNavSection>
      <SideNavSection title="Projects">
        {projects.length === 0 ? (
          <Text type="supporting" color="secondary" as="p">
            No projects yet.
          </Text>
        ) : (
          projects.map((project) => {
            const items = projectNavItems(project);
            const isActive = project.id === activeProjectId;
            const isExpanded = expanded[project.id] ?? isActive;
            return (
              <SideNavItem
                key={project.id}
                label={project.name}
                icon={FolderIcon}
                href={items[0]?.href}
                isSelected={isActive && !items.some((item) => isUnder(pathname, item.href))}
                endContent={
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {project.counts.total}
                  </Text>
                }
                collapsible={{
                  isCollapsed: !isExpanded,
                  onCollapsedChange: (collapsed) => setExpanded(project.id, !collapsed),
                }}
              >
                {items.map((item) => (
                  <SideNavItem
                    key={item.key}
                    label={item.label}
                    icon={item.icon}
                    href={item.href}
                    isSelected={isUnder(pathname, item.href)}
                  />
                ))}
              </SideNavItem>
            );
          })
        )}
      </SideNavSection>
    </SideNav>
  );
}
