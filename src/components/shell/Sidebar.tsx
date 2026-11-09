"use client";

import { startTransition, useEffect, useOptimistic, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { SideNav, SideNavSection, useSideNavRenderMode } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { usePointerDrag } from "@/components/dnd/use-pointer-drag";
import { isFavoriteInTree, reorderByPlacement, stepPlacement, type FavoritesTree } from "@/components/favorites/tree";
import { LAST_PROJECT_STORAGE_KEY } from "@/components/work-items/project-provider";
import type { Project } from "@/lib/tessera/types";
import { AgentIcon, BellIcon, BurndownIcon, CycleIcon, DraftIcon, FolderIcon, HouseIcon, PageIcon, PlusIcon, TableIcon, UserIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { FavoritesSection } from "./FavoritesSection";
import { ProjectMenu, projectMove } from "./ProjectMenu";
import { ExpandedOnly, NewItemButton, RailItem, RowActions } from "./RailParts";
import { projectIdFromPath } from "./recents";
import { formatKeys, SHORTCUT_BY_ID } from "./shortcuts";
import { useSideNavChrome } from "./side-nav-chrome";
import { SidebarOptionsMenu } from "./SidebarOptionsMenu";
import { useShell } from "./TesseraShell";
import { useFloatingNav } from "./use-floating-nav";

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
 * beside the content panel, with no visible heading ("Work" is only its
 * landmark name): a quiet "New work item" button for the last visited (else
 * first) project, then Home, Inbox, Your work, Drafts, Wiki, Favourites, the
 * projects, and Workspace views,
 * Active cycles, Analytics and Agents. A project's own pages are the tabs
 * in its panel header (`ProjectFrame`), not children here. The view (Full,
 * Icons and labels, Icons only) and the dock come from the stored
 * preferences (decisions 128–130) through `useSideNavChrome()`; the rail
 * reaches the rows and the button through Astryx's collapse context
 * (RailParts.tsx), which the mobile drawer does not provide. Undocked, the
 * nav floats over the page (`useFloatingNav`, an edge strip opens it on
 * hover); "Sidebar options" sits in the footer except in the drawer. The width
 * and the last visited project are remembered in localStorage.
 */
export function Sidebar({ projects, unreadCount, draftCount, favorites }: { projects: Project[]; unreadCount: number; draftCount: number; favorites: FavoritesTree }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { navPrefs, openCreateProject } = useShell();
  const [ordered, applyOrder] = useOptimistic(projects, (_current: Project[], next: Project[]) => next);
  const { lastProjectId: lastProject } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resize = useSidebarResize();
  const chrome = useSideNavChrome();
  const isDrawer = useSideNavRenderMode() !== "default";
  const canHover = useMediaQuery("(hover: hover)", false);
  const { panelHandlers, edgeHandlers } = useFloatingNav({ panelId: "tessera-sidebar" });
  // The strip stays while the panel is open: it is part of the hover area, so a pointer resting there keeps the panel open.
  const hasEdge = navPrefs.dock === "floating" && !isDrawer && canHover;
  const activeProjectId = projectIdFromPath(pathname);

  useEffect(() => {
    if (activeProjectId && projects.some((project) => project.id === activeProjectId)) rememberProject(activeProjectId);
  }, [activeProjectId, projects]);

  const createTarget = ordered.find((project) => project.id === lastProject) ?? ordered[0] ?? null;
  const projectIds = ordered.map((project) => project.id);
  const moveProject = (projectId: string, direction: "up" | "down") => {
    const placement = stepPlacement(projectIds, projectId, direction);
    if (!placement) return;
    const next = reorderByPlacement(ordered, projectId, placement);
    startTransition(async () => {
      applyOrder(next);
      const result = await projectMove(projectId, placement);
      if (!result.ok) toast({ type: "error", body: result.message });
    });
  };
  const { registerContainer, registerItem, itemHandlers } = usePointerDrag({
    onDrop: (event) => {
      const placement = { before_id: event.before_id, after_id: event.after_id };
      const next = reorderByPlacement(ordered, event.id, placement);
      startTransition(async () => {
        applyOrder(next);
        const result = await projectMove(event.id, placement);
        if (!result.ok) toast({ type: "error", body: result.message });
      });
    },
    itemsOf: () => projectIds,
    ignoreSelector: 'button, input, textarea, select, [role="menuitem"], [role="menu"], [role="dialog"]',
  });
  const createTooltip = createTarget === null ? "Create a project first" : `Create a work item (${CREATE_ITEM_KEYS})`;
  const openCreate = () => {
    if (createTarget) router.push(`/projects/${createTarget.id}/work-items?create=1`);
  };

  return (
    <>
      {hasEdge ? <VStack className="tessera-nav-edge" aria-hidden="true" {...edgeHandlers} /> : null}
      <SideNav
        key={resize.key}
        {...chrome}
        {...panelHandlers}
        aria-label="Work"
        topContent={<NewItemButton label="New work item" tooltip={createTooltip} isDisabled={createTarget === null} onClick={openCreate} />}
        footerIcons={isDrawer ? undefined : <SidebarOptionsMenu />}
      >
        <SideNavSection title="Workspace" isHeaderHidden>
          <RailItem label="Home" icon={HouseIcon} href="/" isSelected={pathname === "/"} />
          <RailItem
            label="Inbox"
            icon={BellIcon}
            href="/inbox"
            isSelected={pathname === "/inbox"}
            endContent={unreadCount > 0 ? <Badge label={String(unreadCount)} /> : undefined}
          />
          <RailItem label="Your work" icon={UserIcon} href="/your-work/summary" isSelected={pathname === "/your-work" || pathname.startsWith("/your-work/")} />
          <RailItem
            label="Drafts"
            icon={DraftIcon}
            href="/drafts"
            isSelected={pathname === "/drafts"}
            endContent={draftCount > 0 ? <Badge label={String(draftCount)} /> : undefined}
          />
          <RailItem label="Wiki" icon={PageIcon} href="/wiki" isSelected={pathname === "/wiki" || pathname.startsWith("/pages/")} />
        </SideNavSection>
        <FavoritesSection tree={favorites} />
        <SideNavSection
          ref={registerContainer("projects")}
          title="Projects"
          endContent={
            <ExpandedOnly>
              <IconButton label="Create project" variant="ghost" size="sm" icon={<Icon icon={PlusIcon} />} tooltip="Create project" onClick={openCreateProject} />
            </ExpandedOnly>
          }
        >
          <RailItem label="Projects" icon={FolderIcon} href="/projects" isSelected={isProjectsPage(pathname)} />
          {ordered.length === 0 ? (
            <ExpandedOnly>
              <Text type="supporting" color="secondary" as="p">
                No projects yet.
              </Text>
            </ExpandedOnly>
          ) : (
            ordered.map((project, index) => (
              <RailItem
                key={project.id}
                ref={registerItem(project.id)}
                {...itemHandlers(project.id, "projects")}
                className="tessera-project-row"
                label={project.name}
                // The count sits in the actions slot, outside the link, so the link's
                // name carries it: "Website 48" (the visible label stays inside the name).
                aria-label={`${project.name} ${project.counts.total}`}
                icon={resolveLogoIcon(project.logo?.icon)}
                href={`/projects/${project.id}/work-items`}
                isSelected={project.id === activeProjectId}
                actions={
                  <RowActions count={project.counts.total}>
                    <ProjectMenu
                      project={project}
                      isFavorite={isFavoriteInTree(favorites, "project", project.id)}
                      canMoveUp={index > 0}
                      canMoveDown={index < ordered.length - 1}
                      onMove={(direction) => moveProject(project.id, direction)}
                    />
                  </RowActions>
                }
              />
            ))
          )}
        </SideNavSection>
        <SideNavSection title="Workspace" isHeaderHidden className="tessera-sidebar-last">
          <RailItem label="Workspace views" icon={TableIcon} href="/workspace-views" isSelected={pathname === "/workspace-views" || pathname.startsWith("/workspace-views/")} />
          <RailItem label="Active cycles" icon={CycleIcon} href="/active-cycles" isSelected={pathname === "/active-cycles" || pathname.startsWith("/active-cycles/")} />
          <RailItem label="Analytics" icon={BurndownIcon} href="/analytics/overview" isSelected={pathname === "/analytics" || pathname.startsWith("/analytics/")} />
          <RailItem label="Agents" icon={AgentIcon} href="/agents" isSelected={pathname === "/agents" || pathname.startsWith("/agents/")} />
        </SideNavSection>
      </SideNav>
    </>
  );
}
