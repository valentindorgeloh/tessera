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

/**
 * Icon keys the recents lists map to Phosphor glyphs (./shell-icons.ts); a
 * string so this module stays free of React. A list and its entity have
 * their own keys (`cycles` and `cycle`), like `work-items` and `work-item`.
 */
export type RouteIconKey =
  | "home"
  | "projects"
  | "work-items"
  | "work-item"
  | "page"
  | "cycles"
  | "cycle"
  | "modules"
  | "module"
  | "views"
  | "view"
  | "settings"
  | "archives"
  | "intake"
  | "drafts"
  | "your-work"
  | "agents"
  | "analytics"
  | "stickies"
  | "exports"
  | "webhooks";

export type RouteInfo = { label: string; icon: RouteIconKey };

/**
 * Name resolution for ids that appear in paths. `projectName` is required;
 * `workItemLabel` (key and title of a work item) and `entityLabel` (the name
 * of a cycle or module) come from the labels detail screens register
 * (`registerEntityLabel`, ./entity-labels.ts), and the route then shows that
 * instead of "Work item", "Cycle" or "Module".
 */
export type RouteLookup = {
  projectName: (projectId: string) => string | undefined;
  workItemLabel?: (workItemId: string) => string | undefined;
  entityLabel?: (id: string) => string | undefined;
  /** Name of an actor, for `/agents/<id>`. */
  actorLabel?: (actorId: string) => string | undefined;
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

/**
 * Project id from `/projects/[id]/...`, else null. Shared by the sidebar,
 * Power K, the shortcut dispatcher and the recents. `/projects/archives` (the
 * archived projects page, a static segment next to `[projectId]`) is not a
 * project, so the palette scope, the shortcuts and the sidebar never treat
 * "archives" as an id; `/projects/<id>/archives/...` still names `<id>`.
 */
export function projectIdFromPath(pathname: string): string | null {
  const match = /^\/projects\/(?!archives(?:[/?#]|$))([^/?#]+)/.exec(pathname);
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

/** The project archives tabs (`/projects/[id]/archives/<tab>`), named like their empty states. */
const ARCHIVE_TAB_LABELS: ReadonlyMap<string, string> = new Map([
  ["work-items", "Archived work items"],
  ["cycles", "Archived cycles"],
  ["modules", "Archived modules"],
]);

/** A path segment decoded for display; the raw segment when it is not valid percent-encoding. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Label and icon for a route. Known routes: `/` (Home; `/home` still
 * resolves to Home), `/agents/superagent` ("Superagent"),
 * `/agents/superagent/chat` ("Superagent chat") and its `/<KEY>` ("Chat KEY"), `/projects`,
 * `/projects/archives` ("Archived projects"), `/projects/[id]`,
 * `/projects/[id]/work-items`, `/projects/[id]/work-items/[workItemId]`,
 * `/projects/[id]/cycles(/[cycleId])` and `/projects/[id]/modules(/[moduleId])`
 * (the entity's registered name, else "Cycle" / "Module"),
 * `/projects/[id]/views(/[viewId])` (the view's registered name, else "View"),
 * `/projects/[id]/settings(/<tab>)` ("Settings · General", ...),
 * `/projects/[id]/archives(/...)` ("Archived work items", "Archived cycles"
 * or "Archived modules" by tab), `/work-items/[workItemId]` (the global
 * detail, labelled by `workItemLabel` once the screen registers it),
 * `/browse/[key]` (the key, upper-cased), `/inbox` ("Inbox", any query — the
 * path is normalised first) and the aliases `/cycles/[id]` and
 * `/modules/[id]`. Any other project section (`/intake`, ...) resolves to
 * "<project> · <Section>" with the page icon, so later lanes get sensible
 * labels without editing this file; unknown top-level paths use their first
 * segment.
 */
export function resolveRoute(pathname: string, lookup: RouteLookup): RouteInfo {
  const segments = normalizePath(pathname).split("/").filter(Boolean);
  const [root, projectId, section, entityId] = segments;

  if (root === undefined || root === "home") return { label: "Home", icon: "home" };
  // ASSUMPTION: RouteIconKey has no inbox glyph, and InboxIcon is not exported, so the recent uses the page icon.
  if (root === "inbox") return { label: "Inbox", icon: "page" };
  if (root === "drafts") return { label: "Drafts", icon: "drafts" };
  if (root === "your-work") return { label: projectId === undefined ? "Your work" : `Your work · ${titleCase(projectId)}`, icon: "your-work" };
  if (root === "agents") {
    if (projectId === undefined) return { label: "Agents", icon: "agents" };
    // A static segment next to `[actorId]` (decision 145); real actor ids are uuids, so the literal word is the superagent screen.
    if (projectId === "superagent") {
      // The chat (decision 146): `/agents/superagent/chat` and `/agents/superagent/chat/<KEY>`.
      if (section === "chat") return { label: entityId === undefined ? "Superagent chat" : `Chat ${decodeSegment(entityId)}`, icon: "agents" };
      return { label: "Superagent", icon: "agents" };
    }
    const actor = lookup.actorLabel?.(projectId) ?? lookup.entityLabel?.(projectId) ?? "Agent";
    return { label: section === undefined ? actor : `${actor} · ${titleCase(section)}`, icon: "agents" };
  }
  if (root === "workspace-views") {
    if (projectId === undefined) return { label: "Workspace views", icon: "views" };
    const named = lookup.entityLabel?.(projectId);
    // A saved view's id is a uuid; a static key is a short word ("all", "assigned").
    return { label: named ?? (projectId.length < 24 ? titleCase(projectId) : "View"), icon: "views" };
  }
  if (root === "active-cycles") return { label: "Active cycles", icon: "cycles" };
  if (root === "analytics") return { label: projectId === undefined ? "Analytics" : `Analytics · ${titleCase(projectId)}`, icon: "analytics" };
  if (root === "stickies") return { label: "Stickies", icon: "stickies" };
  if (root === "settings") {
    if (projectId === undefined) return { label: "Settings", icon: "settings" };
    if (projectId === "exports") return { label: "Exports", icon: "exports" };
    if (projectId === "webhooks") {
      if (section === undefined) return { label: "Webhooks", icon: "webhooks" };
      return { label: lookup.entityLabel?.(section) ?? "Webhook", icon: "webhooks" };
    }
    return { label: `Settings · ${titleCase(projectId)}`, icon: "settings" };
  }

  // Global detail routes: the second segment is the work item id or key, not a project.
  if (root === "work-items" && projectId !== undefined) {
    return { label: lookup.workItemLabel?.(projectId) ?? "Work item", icon: "work-item" };
  }
  if (root === "browse" && projectId !== undefined) {
    return { label: decodeSegment(projectId).toUpperCase(), icon: "work-item" };
  }
  // Alias routes that redirect to the cycle or module inside its project.
  if (root === "cycles" && projectId !== undefined) return { label: "Cycle", icon: "cycle" };
  if (root === "modules" && projectId !== undefined) return { label: "Module", icon: "module" };

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
      return { label: `${name} · ${lookup.entityLabel?.(entityId) ?? "Cycle"}`, icon: "cycle" };
    }
    if (section === "modules") {
      if (entityId === undefined) return { label: `${name} · Modules`, icon: "modules" };
      return { label: `${name} · ${lookup.entityLabel?.(entityId) ?? "Module"}`, icon: "module" };
    }
    if (section === "views") {
      if (entityId === undefined) return { label: `${name} · Views`, icon: "views" };
      return { label: `${name} · ${lookup.entityLabel?.(entityId) ?? "View"}`, icon: "view" };
    }
    if (section === "settings") {
      // `/settings/<tab>` names its tab; any other path under `/settings` reads as "Settings".
      return { label: entityId === undefined ? `${name} · Settings` : `${name} · Settings · ${titleCase(entityId)}`, icon: "settings" };
    }
    if (section === "intake") return { label: `${name} · Intake`, icon: "intake" };
    if (section === "archives") {
      // One label per archives tab, so the three tabs never read as one repeated recent.
      const tab = entityId === undefined ? undefined : ARCHIVE_TAB_LABELS.get(entityId);
      return { label: `${name} · ${tab ?? "Archives"}`, icon: "archives" };
    }
    return { label: `${name} · ${titleCase(section)}`, icon: "page" };
  }

  return { label: titleCase(root), icon: "page" };
}

/**
 * Redirect aliases (`/browse/[key]`, `/cycles/[id]`, `/modules/[id]`), the
 * project index `/projects/[id]` (it lands on the work items), the
 * archives index `/projects/[id]/archives` (it lands on the archived work
 * items) and the settings index `/projects/[id]/settings` (it lands on
 * General): the route either redirects to another page or shows not-found, so
 * it is never a recent. `/projects/archives` is a page of its own.
 */
export function isTransientPath(path: string): boolean {
  const key = normalizePath(path);
  if (key.startsWith("/browse/") || key.startsWith("/cycles/") || key.startsWith("/modules/")) return true;
  // The project index `/projects/[id]` only redirects to its work items.
  if (/^\/projects\/(?!archives$)[^/]+$/.test(key)) return true;
  return /^\/projects\/(?!archives\/)[^/]+\/(?:archives|settings)$/.test(key);
}

/** Routes that never become recents: Home (where the list lives), the root and the redirect aliases. */
export function isRecordable(path: string): boolean {
  const key = normalizePath(path);
  return key !== "/" && key !== "/home" && !isTransientPath(key);
}

/** The work item a detail route shows (`/projects/<p>/work-items/<id>` or `/work-items/<id>`), else null. */
function workItemIdOf(path: string): string | null {
  const match = /^(?:\/projects\/[^/]+)?\/work-items\/([^/]+)$/.exec(normalizePath(path));
  return match ? match[1] : null;
}

/** Whether two recents lead to the same page: the same path, or the project and global routes of one work item. */
export function isSameRecent(a: string, b: string): boolean {
  if (normalizePath(a) === normalizePath(b)) return true;
  const item = workItemIdOf(a);
  return item !== null && item === workItemIdOf(b);
}

/**
 * `recents` with `path` moved to the front (added when new, replacing the
 * other route of the same work item), trimmed to `max`. Returns `recents`
 * itself when nothing changes (the path is already first, or it is not
 * recordable), so callers can skip the write and the re-render.
 */
export function addRecent(recents: readonly string[], path: string, max: number = MAX_RECENTS): readonly string[] {
  const key = normalizePath(path);
  if (!isRecordable(key)) return recents;
  if (recents[0] === key) return recents;
  return [key, ...recents.filter((entry) => !isSameRecent(entry, key))].slice(0, max);
}

/**
 * `recents` without `path` and the routes under it (a deleted work item,
 * cycle or module, every route of a deleted or archived project, a page that
 * showed not-found); a sibling that only shares a prefix stays. Returns
 * `recents` itself when none is there.
 */
export function removeRecentsUnder(recents: readonly string[], path: string): readonly string[] {
  const key = normalizePath(path);
  const next = recents.filter((entry) => entry !== key && !entry.startsWith(`${key}/`));
  return next.length === recents.length ? recents : next;
}

/**
 * The recents the screen shows right now: the page at `pathname` and, with a
 * work item open in the peek (`?peek=<id>`, any route inside a project), that
 * item's full page. Power K leaves them out of its "Recent" group.
 */
export function onScreenPaths(pathname: string, peekId: string | null): readonly string[] {
  const path = normalizePath(pathname);
  const projectId = projectIdFromPath(path);
  return peekId && projectId ? [path, `/projects/${projectId}/work-items/${encodeURIComponent(peekId)}`] : [path];
}

/** The newest `limit` recents that do not lead to a page on screen (`onScreenPaths`, `isSameRecent`). */
export function otherRecents<T extends { path: string }>(recents: readonly T[], onScreen: readonly string[], limit: number): T[] {
  return recents.filter((recent) => !onScreen.some((path) => isSameRecent(path, recent.path))).slice(0, limit);
}

/**
 * Validates a stored value (localStorage `tessera.recents.v1`): an array of
 * paths, newest first. Anything else yields an empty list; malformed,
 * duplicate (`isSameRecent`) and unrecordable entries are dropped and the
 * list is capped.
 */
export function parseRecents(raw: unknown, max: number = MAX_RECENTS): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const recents: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.startsWith("/")) continue;
    const key = normalizePath(entry);
    if (!isRecordable(key) || recents.some((kept) => isSameRecent(kept, key))) continue;
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
