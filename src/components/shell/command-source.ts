/**
 * Search source behind Power K (docs/contracts/ui.md "Power K and shortcuts
 * (D4)"): Astryx's `SearchSource` over `GET /api/search` plus the static
 * commands of the current context. Pure apart from `fetch` (injectable), so
 * Vitest covers the merge, the debounce and the abort behaviour
 * (tests/ui/shortcuts.test.ts).
 *
 * Item ids: hits are `hit:<type>:<id>`, commands are `CommandId`s (the
 * `ShortcutId`s plus the palette-only `theme.<scheme>` commands), the
 * open-item command is `open:<workItemId>` and a recent route is
 * `recent:<path>`. Every item carries its section in
 * `auxiliaryData.group`; the palette groups by it in insertion order, so the
 * source sorts by `SECTION_ORDER` before returning.
 */
import type { SearchSource, SearchableItem } from "@astryxdesign/core/Typeahead";
import { favoriteTarget, isFavoriteInTree } from "@/components/favorites/tree";
import { readFavoritesTree } from "@/components/favorites/state";
import { SETTINGS_TABS } from "@/components/project-settings/settings-tabs";
import type { SearchHit, SearchType } from "@/lib/tessera/types";
import { COLOR_SCHEME_LABELS, isColorScheme, type ColorScheme } from "./color-scheme";
import type { CommandContextValue } from "./command-context";
import { isShortcutHidden, type ProjectFeatures } from "./project-features";
import type { LabelledRecent, RouteIconKey } from "./recents";
import { SHORTCUTS, type CommandId, type ShellCommandId, type ShortcutDef, type ShortcutId } from "./shortcuts";

/** Keystrokes closer than this share one request. */
export const SEARCH_DEBOUNCE_MS = 150;
export const SEARCH_LIMIT = 20;
export const SEARCH_ENDPOINT = "/api/search";

/** "Ask" is last: Ask-mode items never share a list with the others. */
export const SECTION_ORDER = ["Recent", "Work items", "Projects", "Cycles", "Modules", "Views", "Pages", "Actions", "Create", "Navigate", "Settings", "Ask"] as const;

export type CommandSection = (typeof SECTION_ORDER)[number];

export const HIT_SECTION: Readonly<Record<SearchType, CommandSection>> = {
  work_item: "Work items",
  project: "Projects",
  cycle: "Cycles",
  module: "Modules",
  view: "Views",
  page: "Pages",
};

export type HitAux = { group: CommandSection; kind: "hit"; hit: SearchHit };

export type CommandAux = {
  group: CommandSection;
  kind: "command";
  /** The shortcut's keys, shown as Kbd. */
  keys?: string;
  /** "Arrives in P4" for targets that do not exist yet, or the shortcut's note. */
  hint?: string;
  /** Extra words the search matches besides the label. */
  keywords: readonly string[];
};

/** A recently visited route (./recents.ts), listed while the query is empty. */
export type RecentAux = { group: "Recent"; kind: "recent"; path: string; icon: RouteIconKey };

/** An Ask-mode item (../ai/ask-items.ts): selecting it hands `text` to the assistant panel (decision 38). */
export type AskAux = { group: "Ask"; kind: "ask"; text: string };

export type CommandSearchItem = SearchableItem<HitAux | CommandAux | RecentAux | AskAux>;

export const HIT_PREFIX = "hit:";
export const OPEN_ITEM_PREFIX = "open:";
export const RECENT_PREFIX = "recent:";

/** A recent route as a palette item. */
export function recentToItem(recent: LabelledRecent): CommandSearchItem {
  return {
    id: `${RECENT_PREFIX}${recent.path}`,
    label: recent.label,
    auxiliaryData: { group: "Recent", kind: "recent", path: recent.path, icon: recent.icon },
  };
}

export function hitItemId(hit: Pick<SearchHit, "type" | "id">): string {
  return `${HIT_PREFIX}${hit.type}:${hit.id}`;
}

const SEARCH_TYPES: ReadonlySet<string> = new Set<SearchType>(["work_item", "page", "cycle", "module", "project", "view"]);

function isSearchType(value: string): value is SearchType {
  return SEARCH_TYPES.has(value);
}

/** `{ type, id }` of a `hit:<type>:<id>` item id, or null for anything else. */
export function parseHitId(itemId: string): { type: SearchType; id: string } | null {
  if (!itemId.startsWith(HIT_PREFIX)) return null;
  const rest = itemId.slice(HIT_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  const type = rest.slice(0, colon);
  const id = rest.slice(colon + 1);
  if (!isSearchType(type) || id === "") return null;
  return { type, id };
}

/** A search hit as a palette item; the label carries the key so the palette's own narrowing matches `WEB-1`. */
export function hitToItem(hit: SearchHit): CommandSearchItem {
  return {
    id: hitItemId(hit),
    label: hit.key ? `${hit.key} ${hit.title}` : hit.title,
    auxiliaryData: { group: HIT_SECTION[hit.type], kind: "hit", hit },
  };
}

const KEYWORDS: Partial<Record<ShortcutId, readonly string[]>> = {
  "shortcuts.help": ["keyboard", "help", "keys", "hotkeys"],
  "item.state": ["status", "move"],
  "item.priority": ["urgent", "high", "low"],
  "item.assign": ["assignee", "owner"],
  "item.assignMe": ["me", "self", "take"],
  "item.labels": ["tag"],
  "item.estimate": ["points"],
  "item.cycle": ["sprint"],
  "item.subscribe": ["notify", "watch", "follow"],
  "item.delete": ["remove", "trash"],
  "item.copyId": ["copy", "key", "identifier"],
  "item.copyTitle": ["copy", "name"],
  "item.copyUrl": ["copy", "url", "link", "share"],
  "create.workItem": ["new", "create", "issue", "task", "ticket"],
  "create.cycle": ["new", "create", "sprint"],
  "create.module": ["new", "create"],
  "create.view": ["new", "create", "filter"],
  "create.page": ["new", "create", "doc", "wiki"],
  "create.project": ["new", "create"],
  "nav.home": ["go", "start"],
  "nav.workItems": ["go", "issues", "tasks", "list", "board"],
  "nav.cycles": ["go", "sprints"],
  "nav.modules": ["go"],
  "nav.views": ["go"],
  "nav.pages": ["go", "wiki", "docs"],
  "nav.inbox": ["go", "notifications"],
  "nav.archives": ["go", "archived"],
  "nav.settings": ["preferences", "configuration"],
  "nav.yourWork": ["go", "assigned", "mine"],
  "nav.analytics": ["go", "charts", "reports"],
  "nav.projects": ["go", "all projects"],
  "nav.intake": ["go", "requests", "triage"],
  "nav.drafts": ["go"],
};

/** The palette section of a shortcut, or null for shortcuts the palette does not list. */
export function paletteSection(def: ShortcutDef): CommandSection | null {
  if (def.id === "palette.open" || def.id === "peek.close") return null;
  if (def.id === "shortcuts.help" || def.id === "nav.settings") return "Settings";
  switch (def.group) {
    case "Work item":
      return "Actions";
    case "Create":
      return "Create";
    case "Navigate":
      return "Navigate";
    default:
      return null;
  }
}

/** "Arrives in P4" for a target that does not exist yet, else the shortcut's note, else nothing. */
export function shortcutHint(def: ShortcutDef): string | undefined {
  return def.arrives ? `Arrives in ${def.arrives}` : def.note;
}

export const THEME_COMMAND_PREFIX = "theme.";

const THEME_KEYWORDS: Readonly<Record<ColorScheme, readonly string[]>> = {
  dark: ["colour", "color", "scheme", "appearance", "dark", "frappe", "night"],
  light: ["colour", "color", "scheme", "appearance", "light", "latte", "day"],
  system: ["colour", "color", "scheme", "appearance", "system", "os", "auto"],
};

function themeCommand(scheme: ColorScheme): CommandSearchItem {
  const id: CommandId = `${THEME_COMMAND_PREFIX}${scheme}`;
  return {
    id,
    label: `Theme: ${COLOR_SCHEME_LABELS[scheme]}`,
    auxiliaryData: { group: "Settings", kind: "command", keywords: THEME_KEYWORDS[scheme] },
  };
}

/**
 * The palette-only theme commands, labelled like the top bar's colour scheme
 * menu. They have no key binding and are not entries in `SHORTCUTS`.
 */
export const THEME_COMMANDS: readonly CommandSearchItem[] = (Object.keys(COLOR_SCHEME_LABELS) as ColorScheme[]).map(themeCommand);

export const PROJECT_SETTINGS_PREFIX = "projectSettings.";

/**
 * The project settings tabs the palette opens: every tab of the settings layout
 * (F2's settings-tabs.ts, including Automations), so a new tab cannot be missed here.
 */
const PROJECT_SETTINGS_TABS: readonly { tab: string; label: string }[] = SETTINGS_TABS.map(({ key, label }) => ({ tab: key, label }));

/**
 * "Settings: General" ... "Settings: Automations" for the project in scope, in the
 * Settings section next to the theme commands; none outside a project. The id
 * is `projectSettings.<tab>`, which the command bar routes to
 * `/projects/<projectId>/settings/<tab>`.
 */
export function buildProjectSettingsCommands(projectId: string | null): CommandSearchItem[] {
  if (projectId === null) return [];
  return PROJECT_SETTINGS_TABS.map(({ tab, label }) => ({
    id: `${PROJECT_SETTINGS_PREFIX}${tab}`,
    label: `Settings: ${label}`,
    auxiliaryData: { group: "Settings", kind: "command", keywords: ["project", "configuration", "preferences", tab] },
  }));
}

/** The project command that opens the views list with the "Describe a view" dialog (P5 view from prompt). */
export const DESCRIBE_VIEW_ID = "ai.describeView";

/** Opens `/drafts?draft=new`. Not a shortcut: the drafts list is `g y`. */
export const NEW_DRAFT_ID = "create.draft";

/** Palette destinations that are not chords. `g j` and `g a` stay on the shortcut rows. */
const GO_PATHS = {
  "go.yourWork": "/your-work",
  "go.agents": "/agents",
  "go.workspaceViews": "/workspace-views",
  "go.activeCycles": "/active-cycles",
  "go.analytics": "/analytics",
  "go.stickies": "/stickies",
  "go.workspaceSettings": "/settings",
  "go.newSticky": "/stickies?create=1",
} as const satisfies Partial<Record<ShellCommandId, string>>;

const GO_COMMANDS: readonly { id: keyof typeof GO_PATHS; label: string; group: "Navigate" | "Create"; keywords: readonly string[] }[] = [
  { id: "go.yourWork", label: "Go to Your work", group: "Navigate", keywords: ["go", "assigned", "mine"] },
  { id: "go.agents", label: "Go to Agents", group: "Navigate", keywords: ["go", "robots", "actors"] },
  { id: "go.workspaceViews", label: "Go to Workspace views", group: "Navigate", keywords: ["go", "views", "filters"] },
  { id: "go.activeCycles", label: "Go to Active cycles", group: "Navigate", keywords: ["go", "cycles", "current"] },
  { id: "go.analytics", label: "Go to Analytics", group: "Navigate", keywords: ["go", "charts", "reports"] },
  { id: "go.stickies", label: "Go to Stickies", group: "Navigate", keywords: ["go", "notes"] },
  { id: "go.workspaceSettings", label: "Go to Workspace settings", group: "Navigate", keywords: ["go", "settings", "workspace"] },
  { id: "go.newSticky", label: "New sticky", group: "Create", keywords: ["new", "note", "sticky"] },
];

/** Path a palette go-to command opens, or null for any other id. */
export function goCommandPath(id: string): string | null {
  if (Object.prototype.hasOwnProperty.call(GO_PATHS, id)) return GO_PATHS[id as keyof typeof GO_PATHS];
  return null;
}

function workspaceGoItems(): CommandSearchItem[] {
  return GO_COMMANDS.map((command) => ({
    id: command.id,
    label: command.label,
    auxiliaryData: { group: command.group, kind: "command" as const, keywords: command.keywords },
  }));
}

/**
 * Add or remove the favourite for the page on screen. Omitted when the path
 * names nothing that can be favourited (and under Vitest, where there is no window).
 */
export function favoritePaletteCommand(pathname: string): CommandSearchItem | null {
  const target = favoriteTarget(pathname);
  if (!target) return null;
  const on = isFavoriteInTree(readFavoritesTree(), target.entity_type, target.entity_id);
  return {
    id: on ? "favorite.remove" : "favorite.add",
    label: on ? "Remove from favorites" : "Add to favorites",
    auxiliaryData: { group: "Actions", kind: "command", keywords: ["star", "favorite", "favourite", "pin", target.entity_type] },
  };
}

/**
 * "Describe a view…" for the project in scope, in the Create section. Left out
 * outside a project, while the project has views off (decision 31) and while the
 * assistant is unavailable (`isAiAvailable`, from the AI status).
 */
export function buildAiCommands(projectId: string | null, features: ProjectFeatures | null | undefined, isAiAvailable: boolean): CommandSearchItem[] {
  if (projectId === null || !isAiAvailable || (features && !features.views)) return [];
  return [
    {
      id: DESCRIBE_VIEW_ID,
      label: "Describe a view…",
      auxiliaryData: { group: "Create", kind: "command", keywords: ["view", "ai", "assistant", "prompt", "filter", "generate", "new"] },
    },
  ];
}

/** The settings tab of a `projectSettings.<tab>` command id, or null for any other id. */
export function projectSettingsTab(itemId: string): string | null {
  if (!itemId.startsWith(PROJECT_SETTINGS_PREFIX)) return null;
  const tab = itemId.slice(PROJECT_SETTINGS_PREFIX.length);
  return PROJECT_SETTINGS_TABS.some((entry) => entry.tab === tab) ? tab : null;
}

/** The colour scheme a `theme.<scheme>` command sets, or null for any other id. */
export function themeCommandScheme(itemId: string): ColorScheme | null {
  if (!itemId.startsWith(THEME_COMMAND_PREFIX)) return null;
  const scheme = itemId.slice(THEME_COMMAND_PREFIX.length);
  return isColorScheme(scheme) ? scheme : null;
}

export function commandItem(def: ShortcutDef, section: CommandSection): CommandSearchItem {
  return {
    id: def.id,
    label: def.label,
    auxiliaryData: {
      group: section,
      kind: "command",
      keys: def.keys,
      hint: shortcutHint(def),
      keywords: KEYWORDS[def.id] ?? [],
    },
  };
}

/**
 * The static commands for a context, in section order: the "Actions" group
 * only while a work item is open and only for the actions it registered
 * (labelled by the context's `labels` where it gives one, e.g. "Unsubscribe"),
 * with "Open full page" and "Delete…" closing it; then Create, Navigate and
 * Settings, which ends with the theme commands. The create and navigate
 * commands of a feature the project in scope has off (`features`, decision 31:
 * cycles, modules, views) are left out; without `features` all are listed.
 */
export function buildCommands(context: CommandContextValue | null, features?: ProjectFeatures | null): CommandSearchItem[] {
  const actions: CommandSearchItem[] = [];
  const rest: CommandSearchItem[] = [];
  let deleteItem: CommandSearchItem | null = null;
  for (const def of SHORTCUTS) {
    const section = paletteSection(def);
    if (!section) continue;
    if (isShortcutHidden(def.id, features)) continue;
    if (section !== "Actions") {
      rest.push(commandItem(def, section));
      continue;
    }
    if (!context || !context.actions[def.id]) continue;
    const label = context.labels?.[def.id];
    const item = commandItem(label ? { ...def, label } : def, section);
    if (def.id === "item.delete") deleteItem = item;
    else actions.push(item);
  }
  rest.push({
    id: NEW_DRAFT_ID,
    label: "New draft",
    auxiliaryData: { group: "Create", kind: "command", keywords: ["draft", "new", "save"] },
  });
  rest.push(...workspaceGoItems());
  const favorite = favoritePaletteCommand(typeof window === "undefined" ? "" : window.location.pathname);
  if (favorite) rest.push(favorite);
  if (context) {
    actions.push({
      id: `${OPEN_ITEM_PREFIX}${context.item.id}`,
      label: "Open full page",
      auxiliaryData: { group: "Actions", kind: "command", keywords: ["open", "page", "full", context.item.key] },
    });
    if (deleteItem) actions.push(deleteItem);
  }
  return sortBySection([...actions, ...rest, ...THEME_COMMANDS]);
}

/** True when the query is empty or appears in the label or (for commands) the keywords; case-insensitive. */
export function matchesCommand(item: CommandSearchItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (item.label.toLowerCase().includes(q)) return true;
  const aux = item.auxiliaryData;
  return aux?.kind === "command" && aux.keywords.some((word) => word.toLowerCase().includes(q));
}

function sectionRank(item: CommandSearchItem): number {
  const group = item.auxiliaryData?.group;
  const index = group ? SECTION_ORDER.indexOf(group) : -1;
  return index === -1 ? SECTION_ORDER.length : index;
}

/** Items ordered by `SECTION_ORDER`; the order inside a section is kept. */
export function sortBySection(items: readonly CommandSearchItem[]): CommandSearchItem[] {
  return [...items].sort((a, b) => sectionRank(a) - sectionRank(b));
}

/**
 * The palette row Enter would open: `index` when it names an enabled row of
 * `rows` (the palette's selectable items), else -1. Astryx keeps a hover
 * highlight when a new query narrows the list, so the index can point past
 * the end; Power K then treats it as no highlight and opens the first result.
 */
export function liveHighlight(index: number, rows: readonly { disabled?: boolean }[]): number {
  if (index < 0 || index >= rows.length) return -1;
  return rows[index]?.disabled ? -1 : index;
}

/** The request URL for a query, with the project scope when one applies. */
export function searchUrl(query: string, scope: string | null, limit: number = SEARCH_LIMIT): string {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (scope) params.set("scope", scope);
  return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSearchHit(value: unknown): value is SearchHit {
  if (!isRecord(value)) return false;
  return (
    typeof value.type === "string" &&
    isSearchType(value.type) &&
    typeof value.id === "string" &&
    (typeof value.project_id === "string" || value.project_id === null) &&
    typeof value.title === "string" &&
    typeof value.score === "number" &&
    (value.key === undefined || typeof value.key === "string") &&
    (value.subtitle === undefined || typeof value.subtitle === "string")
  );
}

/** The hits of a `{ hits }` response body; anything malformed yields none. */
export function parseHits(body: unknown): SearchHit[] {
  if (!isRecord(body) || !Array.isArray(body.hits)) return [];
  return body.hits.filter(isSearchHit);
}

/** The slice of `fetch` the source uses; a test passes a stub. Hits are never served from the HTTP cache. */
export type FetchLike = (url: string, init: { signal: AbortSignal; cache: "no-store" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export type CommandSourceOptions = {
  /** The static commands for the current context (see `buildCommands`). */
  commands: () => readonly CommandSearchItem[];
  /** The "Recent" group (`recentToItem`), shown above the commands while the query is empty. */
  recents?: () => readonly CommandSearchItem[];
  /** The project id that scopes the search, or null for all projects. */
  scope: () => string | null;
  fetchImpl?: FetchLike;
  debounceMs?: number;
  limit?: number;
};

export type CommandSource = SearchSource<CommandSearchItem> & { cancel(): void };

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchHits(fetchImpl: FetchLike, url: string, signal: AbortSignal): Promise<SearchHit[]> {
  try {
    const response = await fetchImpl(url, { signal, cache: "no-store" });
    if (!response.ok) return [];
    return parseHits(await response.json());
  } catch {
    // Aborted by a newer query, or the network failed: the commands still show.
    return [];
  }
}

/**
 * The palette's search source. `bootstrap()` and an empty `search("")` return
 * the recents followed by the static commands;
 * `search(q)` aborts the previous request, waits `debounceMs`, fetches
 * `/api/search` and returns the hits followed by the commands whose label or
 * keywords contain `q`. A superseded or cancelled search resolves to an empty
 * list, which the palette discards by its own version check.
 */
export function createCommandSource(options: CommandSourceOptions): CommandSource {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const debounceMs = options.debounceMs ?? SEARCH_DEBOUNCE_MS;
  const limit = options.limit ?? SEARCH_LIMIT;
  let controller: AbortController | null = null;

  const cancel = () => {
    controller?.abort();
    controller = null;
  };

  const idle = () => sortBySection([...(options.recents?.() ?? []), ...options.commands()]);

  return {
    bootstrap() {
      return idle();
    },
    cancel,
    async search(query) {
      cancel();
      const current = new AbortController();
      controller = current;
      const q = query.trim();
      if (q === "") return idle();
      const commands = sortBySection(options.commands().filter((item) => matchesCommand(item, q)));
      const settled = await wait(debounceMs, current.signal);
      if (!settled) return [];
      const hits = await fetchHits(fetchImpl, searchUrl(q, options.scope(), limit), current.signal);
      if (current.signal.aborted) return [];
      return sortBySection([...hits.map(hitToItem), ...commands]);
    },
  };
}
