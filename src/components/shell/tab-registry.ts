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
export type TabIconKey = "home" | "projects" | "work-items" | "work-item" | "page" | "cycles" | "modules" | "archives";

export type TabInfo = { label: string; icon: TabIconKey };

/**
 * Name resolution for ids that appear in paths. `projectName` is required;
 * later lanes may supply `workItemLabel` (key or title of a work item) once a
 * screen knows it, and the detail tab then shows that instead of "Work item".
 * `entityLabel` names a cycle or module a detail screen registered
 * (`registerEntityLabel`, ./entity-labels.ts).
 */
export type TabLookup = {
  projectName: (projectId: string) => string | undefined;
  workItemLabel?: (workItemId: string) => string | undefined;
  entityLabel?: (id: string) => string | undefined;
};

/** Project names by id, read by the Tessera layout and server-rendered into the TabBar. */
export type ProjectNameMap = Readonly<Record<string, string>>;

/** `{ id: name }` for the project rows the layout loads. */
export function projectNameMap(projects: readonly { id: string; name: string }[]): ProjectNameMap {
  return Object.fromEntries(projects.map((project) => [project.id, project.name]));
}

/** A lookup over a name map; ids it does not hold resolve to undefined so `resolveTab` falls back to "Project". */
export function lookupFromNames(names: ProjectNameMap): TabLookup {
  return { projectName: (projectId) => (Object.hasOwn(names, projectId) ? names[projectId] : undefined) };
}

/**
 * Project id from `/projects/[id]/...`, else null. `/projects/archives` (the
 * archived projects page, a static segment next to `[projectId]`) is not a
 * project, so the palette scope, the shortcuts and the sidebar never treat
 * "archives" as an id; `/projects/<id>/archives/...` still names `<id>`.
 */
export function projectIdFromPath(pathname: string): string | null {
  const match = /^\/projects\/(?!archives(?:\/|$))([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

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

/** A path segment decoded for display; the raw segment when it is not valid percent-encoding. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Label and icon for a route. Known routes: `/home`, `/projects`,
 * `/projects/archives` ("Archived projects"), `/projects/[id]`,
 * `/projects/[id]/work-items`, `/projects/[id]/work-items/[workItemId]`,
 * `/projects/[id]/cycles(/[cycleId])` and `/projects/[id]/modules(/[moduleId])`
 * (the entity's registered name, else "Cycle" / "Module"),
 * `/projects/[id]/archives(/...)`, `/work-items/[workItemId]` (the global
 * detail, labelled by `workItemLabel` once the screen registers it),
 * `/browse/[key]` (the key, upper-cased) and the aliases `/cycles/[id]` and
 * `/modules/[id]`. Any other project section (`/settings`, ...) resolves to
 * "<project> · <Section>" with the page icon, so later lanes get sensible tabs
 * without editing this file; unknown top-level paths use their first segment.
 */
export function resolveTab(pathname: string, lookup: TabLookup): TabInfo {
  const segments = normalizePath(pathname).split("/").filter(Boolean);
  const [root, projectId, section, entityId] = segments;

  if (root === undefined || root === "home") return { label: "Home", icon: "home" };

  // Global detail routes: the second segment is the work item id or key, not a project.
  if (root === "work-items" && projectId !== undefined) {
    return { label: lookup.workItemLabel?.(projectId) ?? "Work item", icon: "work-item" };
  }
  if (root === "browse" && projectId !== undefined) {
    return { label: decodeSegment(projectId).toUpperCase(), icon: "work-item" };
  }
  // Alias routes that redirect to the cycle or module inside its project.
  if (root === "cycles" && projectId !== undefined) return { label: "Cycle", icon: "cycles" };
  if (root === "modules" && projectId !== undefined) return { label: "Module", icon: "modules" };

  if (root === "projects") {
    if (projectId === undefined) return { label: "Projects", icon: "projects" };
    // A static segment next to `[projectId]`, so it is checked before the project lookup.
    if (projectId === "archives") return { label: "Archived projects", icon: "archives" };
    const name = lookup.projectName(projectId) ?? FALLBACK_PROJECT_NAME;
    if (section === undefined) return { label: name, icon: "projects" };
    if (section === "work-items") {
      if (entityId === undefined) return { label: `${name} · Work items`, icon: "work-items" };
      const itemLabel = lookup.workItemLabel?.(entityId) ?? "Work item";
      return { label: `${name} · ${itemLabel}`, icon: "work-item" };
    }
    if (section === "cycles") {
      if (entityId === undefined) return { label: `${name} · Cycles`, icon: "cycles" };
      return { label: `${name} · ${lookup.entityLabel?.(entityId) ?? "Cycle"}`, icon: "cycles" };
    }
    if (section === "modules") {
      if (entityId === undefined) return { label: `${name} · Modules`, icon: "modules" };
      return { label: `${name} · ${lookup.entityLabel?.(entityId) ?? "Module"}`, icon: "modules" };
    }
    if (section === "archives") return { label: `${name} · Archives`, icon: "archives" };
    return { label: `${name} · ${titleCase(section)}`, icon: "page" };
  }

  return { label: titleCase(root), icon: "page" };
}

/** A stored tab with the label and icon it shows right now. */
export type LabelledTab = TabEntry & TabInfo;

/**
 * Labels every stored tab for rendering. Labels are derived here on each
 * render and never persisted, so tabs stored before the project names were
 * known, or under an old name, read correctly as soon as the lookup does.
 */
export function labelTabs(state: TabsState, lookup: TabLookup): LabelledTab[] {
  return state.tabs.map((tab) => ({ ...tab, ...resolveTab(tab.path, lookup) }));
}

/**
 * Redirect aliases (`/browse/[key]`, `/cycles/[id]`, `/modules/[id]`), the
 * project index `/projects/[id]` (it lands on the work items) and the
 * archives index `/projects/[id]/archives` (it lands on the archived work
 * items): the route either redirects or shows not-found, so its tab only
 * lasts until the next route. `/projects/archives` is a page of its own.
 */
export function isTransientPath(path: string): boolean {
  const key = normalizePath(path);
  if (key.startsWith("/browse/") || key.startsWith("/cycles/") || key.startsWith("/modules/")) return true;
  // The project index `/projects/[id]` only redirects to its work items.
  if (/^\/projects\/(?!archives$)[^/]+$/.test(key)) return true;
  return /^\/projects\/(?!archives\/)[^/]+\/archives$/.test(key);
}

/**
 * Adds a tab for `path` (or activates the existing one). A transient tab
 * (`isTransientPath`) gives its slot to the route that follows it, which is
 * the redirect target after `/browse/WEB-1`; other transient tabs (restored
 * from storage, say) are dropped.
 */
export function addTab(state: TabsState, path: string): TabsState {
  const key = normalizePath(path);
  const hasStale = state.tabs.some((tab) => tab.path !== key && isTransientPath(tab.path));
  if (!hasStale) {
    if (state.tabs.some((tab) => tab.path === key)) return activateTab(state, key);
    return { tabs: [...state.tabs, { path: key }], active: key };
  }
  const exists = state.tabs.some((tab) => tab.path === key);
  const slot = state.active !== null && state.active !== key && isTransientPath(state.active) ? state.tabs.findIndex((tab) => tab.path === state.active) : -1;
  const tabs = state.tabs.flatMap((tab, index) => {
    if (index === slot && !exists) return [{ path: key }];
    return tab.path !== key && isTransientPath(tab.path) ? [] : [tab];
  });
  if (!tabs.some((tab) => tab.path === key)) tabs.push({ path: key });
  return { tabs, active: key };
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

/**
 * Removes the tab of `path` and every tab below it (`path/...`), for an
 * entity that no longer exists: a deleted cycle or module, or every tab of a
 * deleted project. A removed active tab leaves `active` null; the screen that
 * deleted it navigates next, and that route's tab becomes active.
 */
export function dropTabsUnder(state: TabsState, path: string): TabsState {
  const key = normalizePath(path);
  const isUnder = (tabPath: string) => tabPath === key || tabPath.startsWith(`${key}/`);
  if (!state.tabs.some((tab) => isUnder(tab.path))) return state;
  const tabs = state.tabs.filter((tab) => !isUnder(tab.path));
  return { tabs, active: state.active !== null && isUnder(state.active) ? null : state.active };
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
