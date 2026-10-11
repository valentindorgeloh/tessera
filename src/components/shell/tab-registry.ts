/**
 * Pure tab model behind the shell's TabBar (docs/contracts/ui.md "Shell",
 * docs/PLAN.md section 6). Tabs are keyed by pathname: opening a route adds a
 * tab for its path, closing the active tab hands activation to its left
 * neighbour, and `resolveTab` turns a path into a label and an icon key. No
 * React or browser API lives here so Vitest covers every function directly
 * (tests/ui/tab-registry.test.ts).
 */

export const TABS_STORAGE_KEY = "tessera.tabs.v1";

/** What the typing-surface check needs from an event target; DOM-free so Vitest runs it in Node. */
export type TypingTargetLike = { tagName: string; isContentEditable?: boolean } | null | undefined;

/**
 * True for inputs, textareas, selects and contenteditable elements: a global
 * shortcut that navigates (alt+w closes the tab) stays silent there, the same
 * rule Astryx's useHotkeys applies to every shortcut by default.
 */
export function isTypingTarget(target: TypingTargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export type TabEntry = { path: string };

export type TabsState = {
  /** Open tabs in display order; paths are unique. */
  tabs: TabEntry[];
  /** Path of the active tab, or null when nothing is open. */
  active: string | null;
};

export const EMPTY_TABS: TabsState = { tabs: [], active: null };

/** Icon keys the TabBar maps to Phosphor glyphs; a string so this module stays free of React. */
export type TabIconKey = "home" | "projects" | "work-items" | "work-item" | "page";

export type TabInfo = { label: string; icon: TabIconKey };

/**
 * Name resolution for ids that appear in paths. `projectName` is required;
 * later lanes may supply `workItemLabel` (key or title of a work item) once a
 * screen knows it, and the detail tab then shows that instead of "Work item".
 */
export type TabLookup = {
  projectName: (projectId: string) => string | undefined;
  workItemLabel?: (workItemId: string) => string | undefined;
};

/** Pathname without query, hash or trailing slash; "/" stays "/". */
export function normalizePath(pathname: string): string {
  const bare = pathname.split(/[?#]/, 1)[0] ?? "";
  const withSlash = bare.startsWith("/") ? bare : `/${bare}`;
  const trimmed = withSlash.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** "work-items" → "Work items". */
function titleCase(segment: string): string {
  const words = segment.split(/[-_]+/).filter(Boolean).join(" ");
  if (words === "") return "Page";
  try {
    const decoded = decodeURIComponent(words);
    return decoded.charAt(0).toUpperCase() + decoded.slice(1);
  } catch {
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
}

const FALLBACK_PROJECT_NAME = "Project";

/**
 * Label and icon for a route. Known routes: `/home`, `/projects`,
 * `/projects/[id]`, `/projects/[id]/work-items`,
 * `/projects/[id]/work-items/[workItemId]`. Any other project section
 * (`/projects/[id]/cycles`, `/settings`, ...) resolves to "<project> · <Section>"
 * with the page icon, so later lanes get sensible tabs without editing this
 * file; unknown top-level paths use their first segment.
 */
export function resolveTab(pathname: string, lookup: TabLookup): TabInfo {
  const segments = normalizePath(pathname).split("/").filter(Boolean);
  const [root, projectId, section, entityId] = segments;

  if (root === undefined || root === "home") return { label: "Home", icon: "home" };

  if (root === "projects") {
    if (projectId === undefined) return { label: "Projects", icon: "projects" };
    const name = lookup.projectName(projectId) ?? FALLBACK_PROJECT_NAME;
    if (section === undefined) return { label: name, icon: "projects" };
    if (section === "work-items") {
      if (entityId === undefined) return { label: `${name} · Work items`, icon: "work-items" };
      const itemLabel = lookup.workItemLabel?.(entityId) ?? "Work item";
      return { label: `${name} · ${itemLabel}`, icon: "work-item" };
    }
    return { label: `${name} · ${titleCase(section)}`, icon: "page" };
  }

  return { label: titleCase(root), icon: "page" };
}

/** Adds a tab for `path` (or activates the existing one). */
export function addTab(state: TabsState, path: string): TabsState {
  const key = normalizePath(path);
  if (state.tabs.some((tab) => tab.path === key)) return activateTab(state, key);
  return { tabs: [...state.tabs, { path: key }], active: key };
}

/** Makes `path` the active tab; unknown paths leave the state untouched. */
export function activateTab(state: TabsState, path: string): TabsState {
  const key = normalizePath(path);
  if (state.active === key) return state;
  if (!state.tabs.some((tab) => tab.path === key)) return state;
  return { ...state, active: key };
}

/**
 * Removes `path`. When it was the active tab the left neighbour takes over
 * (the right one when it was first); the last tab closing leaves `active` null
 * so the TabBar can fall back to Home.
 */
export function closeTab(state: TabsState, path: string): TabsState {
  const key = normalizePath(path);
  const index = state.tabs.findIndex((tab) => tab.path === key);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.path !== key);
  if (state.active !== key) return { tabs, active: state.active };
  const neighbour = tabs[index - 1] ?? tabs[index] ?? null;
  return { tabs, active: neighbour ? neighbour.path : null };
}

/** Keeps only `path` and activates it; unknown paths leave the state untouched. */
export function closeOtherTabs(state: TabsState, path: string): TabsState {
  const key = normalizePath(path);
  const keep = state.tabs.find((tab) => tab.path === key);
  if (!keep) return state;
  if (state.tabs.length === 1 && state.active === key) return state;
  return { tabs: [keep], active: key };
}

/** Moves the tab at `fromIndex` so it ends up at `toIndex`; out-of-range indexes are ignored. */
export function reorderTab(state: TabsState, fromIndex: number, toIndex: number): TabsState {
  const last = state.tabs.length - 1;
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return state;
  if (fromIndex < 0 || fromIndex > last || toIndex < 0 || toIndex > last) return state;
  if (fromIndex === toIndex) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(fromIndex, 1);
  tabs.splice(toIndex, 0, moved);
  return { ...state, tabs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates a stored value (localStorage `tessera.tabs.v1`). Returns null for
 * anything that is not `{ tabs: [{ path }], active }`; duplicate or malformed
 * entries are dropped and an unknown `active` falls back to the first tab.
 */
export function parseTabsState(raw: unknown): TabsState | null {
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) return null;
  const seen = new Set<string>();
  const tabs: TabEntry[] = [];
  for (const entry of raw.tabs) {
    if (!isRecord(entry) || typeof entry.path !== "string" || !entry.path.startsWith("/")) continue;
    const path = normalizePath(entry.path);
    if (seen.has(path)) continue;
    seen.add(path);
    tabs.push({ path });
  }
  const requested = typeof raw.active === "string" ? normalizePath(raw.active) : null;
  const active = requested !== null && seen.has(requested) ? requested : (tabs[0]?.path ?? null);
  return { tabs, active };
}
