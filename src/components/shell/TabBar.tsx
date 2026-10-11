"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ContextMenu } from "@astryxdesign/core/ContextMenu";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { FolderIcon, HouseIcon, KanbanIcon, ListBulletsIcon, PageIcon, XIcon } from "@/themes/paper/icons";
import {
  EMPTY_TABS,
  TABS_STORAGE_KEY,
  addTab,
  closeOtherTabs,
  closeTab,
  isTypingTarget,
  labelTabs,
  lookupFromNames,
  parseTabsState,
  type ProjectNameMap,
  type TabIconKey,
  type TabsState,
} from "./tab-registry";

const HOME_PATH = "/home";
const CLOSE_CLASS = "tessera-tab-close";

const TAB_ICONS: Record<TabIconKey, IconType> = {
  home: HouseIcon,
  projects: FolderIcon,
  "work-items": KanbanIcon,
  "work-item": ListBulletsIcon,
  page: PageIcon,
};

// ---------------------------------------------------------------------------
// Store: one module-level state shared by every TabBar mount, mirrored to
// localStorage. The server snapshot is always empty, so nothing renders until
// the first client effect has loaded the stored tabs (hydration-safe).
// ---------------------------------------------------------------------------

let state: TabsState = EMPTY_TABS;
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

function getSnapshot(): TabsState {
  return state;
}

function getServerSnapshot(): TabsState {
  return EMPTY_TABS;
}

function commit(next: TabsState) {
  if (next === state) return;
  state = next;
  try {
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or quota: tabs simply do not persist.
  }
  emit();
}

/** Reads the stored tabs once per page load; later mounts reuse the module state. */
function loadStoredTabs() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    const parsed = raw ? parseTabsState(JSON.parse(raw)) : null;
    if (parsed) state = parsed;
  } catch {
    state = EMPTY_TABS;
  }
  emit();
}

function isCloseTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`.${CLOSE_CLASS}`) !== null;
}

function tabPathOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[data-tab-path]");
  return element?.dataset.tabPath ?? null;
}

/**
 * Path-based tabs above the content (docs/PLAN.md section 6). Every visited
 * route gets a tab; the active tab follows the pathname. Close with the
 * decorative icon inside the tab, a middle click, `alt+w` for the active tab,
 * or the right-click menu (Close, Close others). `projectNames` comes from the
 * Tessera layout's server read, so the labels are right on the first client
 * render instead of waiting for another component's effect.
 */
export function TabBar({ projectNames }: { projectNames: ProjectNameMap }) {
  const pathname = usePathname();
  const router = useRouter();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [menuTarget, setMenuTarget] = useState<string | null>(null);

  useEffect(() => {
    loadStoredTabs();
  }, []);

  useEffect(() => {
    commit(addTab(getSnapshot(), pathname));
  }, [pathname]);

  const lookup = useMemo(() => lookupFromNames(projectNames), [projectNames]);

  const close = useCallback(
    (path: string) => {
      const before = getSnapshot();
      const next = closeTab(before, path);
      commit(next);
      if (before.active === path) router.push(next.active ?? HOME_PATH);
    },
    [router],
  );

  const closeOthers = useCallback(
    (path: string) => {
      commit(closeOtherTabs(getSnapshot(), path));
      router.push(path);
    },
    [router],
  );

  // alt+w: a plain keydown listener because macOS turns alt+w into "∑" in event.key,
  // which key-name matching (useHotkeys) never sees; event.code is layout-stable.
  // Like useHotkeys, it stays silent while the user types (alt+w is a text key on macOS).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.code !== "KeyW") return;
      if (event.target instanceof HTMLElement && isTypingTarget(event.target)) return;
      const active = getSnapshot().active;
      if (!active) return;
      event.preventDefault();
      close(active);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const onStripMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button === 2) setMenuTarget(tabPathOf(event.target));
  };

  const menuItems = [
    { label: "Close", onClick: () => menuTarget && close(menuTarget) },
    { label: "Close others", onClick: () => menuTarget && closeOthers(menuTarget) },
  ];

  const tabs = labelTabs(snapshot, lookup);
  const current = snapshot.tabs.some((tab) => tab.path === pathname) ? pathname : (snapshot.active ?? "");

  return (
    <HStack className="tessera-tabbar" vAlign="center">
      {snapshot.tabs.length > 0 ? (
        <ContextMenu label="Tab actions" size="sm" items={menuItems} isDisabled={menuTarget === null}>
          <TabList
            aria-label="Open pages"
            size="sm"
            value={current}
            overflow="scroll"
            onChange={(value) => {
              if (value !== pathname) router.push(value);
            }}
            onMouseDown={onStripMouseDown}
          >
            {tabs.map((tab) => (
                <Tab
                  key={tab.path}
                  value={tab.path}
                  href={tab.path}
                  label={tab.label}
                  data-tab-path={tab.path}
                  icon={<Icon icon={TAB_ICONS[tab.icon]} size="xsm" />}
                  endContent={<Icon icon={XIcon} size="xsm" className={CLOSE_CLASS} />}
                  onClick={(event) => {
                    if (!isCloseTarget(event.target)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    close(tab.path);
                  }}
                  onMouseDown={(event) => {
                    // Button 1 would start autoscroll; the aux click below closes the tab instead.
                    if (event.button === 1) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    close(tab.path);
                  }}
                />
            ))}
          </TabList>
        </ContextMenu>
      ) : null}
    </HStack>
  );
}
