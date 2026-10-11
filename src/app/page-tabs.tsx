"use client";

import {useEffect, useSyncExternalStore} from "react";
import {usePathname, useRouter} from "next/navigation";
import {Icon} from "@astryxdesign/core/Icon";
import {IconButton} from "@astryxdesign/core/IconButton";
import {HStack} from "@astryxdesign/core/Layout";
import {Tab, TabList} from "@astryxdesign/core/TabList";
import {CaretLeft, CaretRight, Plus, X} from "@phosphor-icons/react";
import {WORKSPACE_NAME, findNode, type WorkspaceNode} from "../lib/workspace-model";
import {FolderIcon, PageIcon} from "../themes/catppuccin/icons";

export const HOME_TAB = "/";
const STORAGE_KEY = "handbook.tabs";
const NEW_TAB = "__new__";

type OpenTab = {key: string; page: string};

type TabState = {
  tabs: OpenTab[];
  active: string;
  seq: number;
};

const EMPTY: TabState = {tabs: [{key: "t1", page: HOME_TAB}], active: "t1", seq: 1};

let state: TabState = EMPTY;
let openNextAsNew = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

function loadStored(): TabState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as TabState;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return EMPTY;
    const tabs = parsed.tabs.filter(
      (tab): tab is OpenTab =>
        typeof tab?.key === "string" && typeof tab?.page === "string",
    );
    if (tabs.length === 0) return EMPTY;
    const active = tabs.some((tab) => tab.key === parsed.active) ? parsed.active : tabs[0].key;
    const seq = Math.max(parsed.seq ?? 0, ...tabs.map((tab) => Number(tab.key.slice(1)) || 0));
    return {tabs, active, seq};
  } catch {
    return EMPTY;
  }
}

function getServerSnapshot() {
  return EMPTY;
}

function getSnapshot() {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function activeTab(next: TabState) {
  return next.tabs.find((tab) => tab.key === next.active) ?? next.tabs[0];
}

function setState(next: TabState) {
  state = next;
  emit();
}

export function tabHref(page: string) {
  return page === HOME_TAB ? "/" : `/items/${page}`;
}

export function tabIdFromPath(pathname: string) {
  const match = pathname.match(/^\/items\/([^/]+)/);
  return match ? match[1] : HOME_TAB;
}

export function tabIdFromHref(href: string) {
  const path = href.split("?")[0];
  if (path === "/") return HOME_TAB;
  const match = path.match(/^\/items\/([^/]+)$/);
  return match ? match[1] : null;
}

export function markNextNavigationAsNewTab() {
  openNextAsNew = true;
}

export function pruneTabs(validIds: ReadonlySet<string>) {
  const tabs = state.tabs.filter((tab) => tab.page === HOME_TAB || validIds.has(tab.page));
  if (tabs.length === 0) {
    setState(EMPTY);
    return;
  }
  const active = tabs.some((tab) => tab.key === state.active) ? state.active : tabs[0].key;
  if (tabs.length === state.tabs.length && active === state.active) return;
  setState({...state, tabs, active});
}

export function followPath(page: string) {
  if (openNextAsNew) {
    openNextAsNew = false;
    const key = `t${state.seq + 1}`;
    setState({
      tabs: [...state.tabs, {key, page}],
      active: key,
      seq: state.seq + 1,
    });
    return;
  }
  const current = activeTab(state);
  if (current.page === page) return;
  setState({
    ...state,
    tabs: state.tabs.map((tab) => (tab.key === current.key ? {...tab, page} : tab)),
  });
}

export function activateTab(key: string) {
  if (key === state.active) return;
  if (!state.tabs.some((tab) => tab.key === key)) return;
  setState({...state, active: key});
}

export function addHomeTab() {
  const key = `t${state.seq + 1}`;
  setState({
    tabs: [...state.tabs, {key, page: HOME_TAB}],
    active: key,
    seq: state.seq + 1,
  });
}

export function closeTab(key: string) {
  if (state.tabs.length === 1) {
    setState({tabs: [{key: state.tabs[0].key, page: HOME_TAB}], active: state.tabs[0].key, seq: state.seq});
    return HOME_TAB;
  }
  const index = state.tabs.findIndex((tab) => tab.key === key);
  const tabs = state.tabs.filter((tab) => tab.key !== key);
  const neighbour = tabs[Math.max(0, index - 1)] ?? tabs[0];
  const active = state.active === key ? neighbour.key : state.active;
  setState({...state, tabs, active});
  return activeTab({...state, tabs, active}).page;
}

export function PageTabs({nodes}: {nodes: WorkspaceNode[]}) {
  const pathname = usePathname();
  const router = useRouter();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    state = loadStored();
    emit();
  }, []);

  useEffect(() => {
    pruneTabs(new Set(nodes.map((node) => node.id)));
  }, [nodes]);

  useEffect(() => {
    followPath(tabIdFromPath(pathname));
  }, [pathname]);

  const onChange = (value: string) => {
    if (value === NEW_TAB) {
      addHomeTab();
      router.push("/");
      return;
    }
    activateTab(value);
    const tab = state.tabs.find((item) => item.key === value);
    if (tab) router.push(tabHref(tab.page));
  };

  return (
    <TabList
      aria-label="Open pages"
      size="sm"
      value={snapshot.active}
      onChange={onChange}
      className="handbook-tabs"
    >
      {snapshot.tabs.map((tab) => {
        const node = tab.page === HOME_TAB ? null : findNode(nodes, tab.page);
        const label = node?.title ?? WORKSPACE_NAME;
        const icon = (
          <Icon
            icon={node?.kind === "collection" ? FolderIcon : PageIcon}
            size="xsm"
          />
        );
        return (
          <Tab
            key={tab.key}
            value={tab.key}
            label={label}
            icon={icon}
            endContent={
              <IconButton
                label="Close tab"
                tooltip="Close tab"
                variant="ghost"
                size="sm"
                icon={<X weight="bold" size={12} aria-hidden />}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const wasActive = tab.key === snapshot.active;
                  const nextPage = closeTab(tab.key);
                  if (wasActive) router.push(tabHref(nextPage));
                }}
              />
            }
          />
        );
      })}
      <Tab
        value={NEW_TAB}
        label="New tab"
        isLabelHidden
        icon={<Plus weight="bold" size={14} aria-hidden />}
      />
    </TabList>
  );
}

export function NavButtons() {
  const router = useRouter();
  return (
    <HStack gap={0} vAlign="center">
      <IconButton
        label="Back"
        tooltip="Back"
        variant="ghost"
        size="sm"
        icon={<CaretLeft weight="bold" size={16} aria-hidden />}
        onClick={() => router.back()}
      />
      <IconButton
        label="Forward"
        tooltip="Forward"
        variant="ghost"
        size="sm"
        icon={<CaretRight weight="bold" size={16} aria-hidden />}
        onClick={() => router.forward()}
      />
    </HStack>
  );
}
