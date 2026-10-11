/**
 * Pure recents model of the shell (docs/contracts/ui.md "Shell"): the routes
 * the user visited, newest first, which Home's "Recent" section and the
 * "Recent" group of Power K list. `resolveRoute` turns a path into a label and
 * an icon key; `addRecent` records a visit. No React or browser API lives
 * here so Vitest covers every function directly (tests/ui/recents.test.ts).
 */

export const RECENTS_STORAGE_KEY = "tessera.recents.v1";

/** How many visits the store keeps; Power K shows the first `RECENTS_IN_PALETTE`. */
export const MAX_RECENTS = 12;
export const RECENTS_IN_PALETTE = 5;

/** Icon keys the recents lists map to Phosphor glyphs; a string so this module stays free of React. */
export type RouteIconKey = "home" | "projects" | "work-items" | "work-item" | "page";

export type RouteInfo = { label: string; icon: RouteIconKey };

/**
 * Name resolution for ids that appear in paths. `projectName` is required;
 * `workItemLabel` (key and title of a work item) comes from the labels detail
 * screens register (./entity-labels.ts), and the route then shows that
 * instead of "Work item".
 */
export type RouteLookup = {
  projectName: (projectId: string) => string | undefined;
  workItemLabel?: (workItemId: string) => string | undefined;
};

/** Project names by id, read by the Tessera layout and handed to the recents store. */
export type ProjectNameMap = Readonly<Record<string, string>>;

/** `{ id: name }` for the project rows the layout loads. */
export function projectNameMap(projects: readonly { id: string; name: string }[]): ProjectNameMap {
  return Object.fromEntries(projects.map((project) => [project.id, project.name]));
}

/** A lookup over a name map; ids it does not hold resolve to undefined so `resolveRoute` falls back to "Project". */
export function lookupFromNames(names: ProjectNameMap): RouteLookup {
  return { projectName: (projectId) => (Object.hasOwn(names, projectId) ? names[projectId] : undefined) };
}

/** Project id from `/projects/[id]/...`, else null. Shared by the sidebar, Power K and the shortcut dispatcher. */
export function projectIdFromPath(pathname: string): string | null {
  const match = /^\/projects\/([^/?#]+)/.exec(pathname);
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
 * `/projects/[id]`, `/projects/[id]/work-items`,
 * `/projects/[id]/work-items/[workItemId]`, `/work-items/[workItemId]` (the
 * global detail, labelled by `workItemLabel` once the screen registers it)
 * and `/browse/[key]` (the key, upper-cased). Any other project section
 * (`/projects/[id]/cycles`, `/settings`, ...) resolves to "<project> · <Section>"
 * with the page icon, so later lanes get sensible labels without editing this
 * file; unknown top-level paths use their first segment.
 */
export function resolveRoute(pathname: string, lookup: RouteLookup): RouteInfo {
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

/**
 * Redirect aliases (`/browse/[key]`, `/projects/[id]`): the route either
 * redirects to another page or shows not-found, so it is never a recent.
 */
export function isTransientPath(path: string): boolean {
  const key = normalizePath(path);
  return key.startsWith("/browse/") || /^\/projects\/[^/]+$/.test(key);
}

/** Routes that never become recents: Home (where the list lives), the root and the redirect aliases. */
export function isRecordable(path: string): boolean {
  const key = normalizePath(path);
  return key !== "/" && key !== "/home" && !isTransientPath(key);
}

/**
 * `recents` with `path` moved to the front (added when new), trimmed to `max`.
 * Returns `recents` itself when nothing changes (the path is already first, or
 * it is not recordable), so callers can skip the write and the re-render.
 */
export function addRecent(recents: readonly string[], path: string, max: number = MAX_RECENTS): readonly string[] {
  const key = normalizePath(path);
  if (!isRecordable(key)) return recents;
  if (recents[0] === key) return recents;
  return [key, ...recents.filter((entry) => entry !== key)].slice(0, max);
}

/**
 * Validates a stored value (localStorage `tessera.recents.v1`): an array of
 * paths, newest first. Anything else yields an empty list; malformed,
 * duplicate and unrecordable entries are dropped and the list is capped.
 */
export function parseRecents(raw: unknown, max: number = MAX_RECENTS): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const recents: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.startsWith("/")) continue;
    const key = normalizePath(entry);
    if (!isRecordable(key) || recents.includes(key)) continue;
    recents.push(key);
    if (recents.length === max) break;
  }
  return recents;
}

/** A recent route with the label and icon it shows right now. */
export type LabelledRecent = RouteInfo & { path: string };

/**
 * Labels every recent for rendering. Labels are derived on each render and
 * never persisted, so a renamed project or work item reads correctly as soon
 * as the lookup does.
 */
export function labelRecents(recents: readonly string[], lookup: RouteLookup): LabelledRecent[] {
  return recents.map((path) => ({ path, ...resolveRoute(path, lookup) }));
}
