"use client";

/**
 * Power K (docs/contracts/ui.md "Power K and shortcuts (D4)"): the Astryx
 * CommandPalette on `mod+k` with search hits from `GET /api/search` (a
 * debounced client fetch through ./command-source.ts, never a Server Action),
 * the static commands of the current context (actions on the open work item
 * from ./command-context.ts, create and navigate chords, settings and the
 * colour scheme), the "Recent" group of visited routes while the query is
 * empty (./recents-store.ts; the page on screen and its peek left out), an
 * "All projects" footer toggle inside a
 * project, an "Ask" tab that hands the question to the assistant panel
 * (decision 38) and the keyboard
 * shortcuts dialog on `mod+/`. Mounts the shortcut dispatcher and the Create
 * project dialog once. The open state and the scope live here; the shell
 * reaches `open()`, `openHelp()` and `openCreateProject()` through the
 * `CommandBarHandle` ref, so the top bar's search field
 * (`useShell().openCommandBar()`) and `mod+k` take the same path and both
 * read the project of the current route when the palette opens; the field
 * passes the key typed into it as the first query.
 * The scope is the route's project, not `useOptionalProject()`: the bar is
 * mounted by the shell, above every ProjectProvider.
 *
 * The palette's search source is created once and reads the scope, the mode
 * and the command context through refs at call time; the footer and the mode
 * tabs re-run the current query through the palette context after flipping
 * them. Selection comes back as the chosen item id (`onValueChange`), looked
 * up in the map of items the source produced.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { askItems } from "@/components/ai/ask-items";
import { fetchUndoableBatch, undoAssistantBatch } from "@/components/ai/assistant-undo";
import { useCommandBarAsk } from "@/components/ai/CommandBarAsk";
import { notePeekPush } from "@/components/detail/peek-history";
import { hasPeekHost } from "@/components/detail/peek-hosts";
import { currentHref, PEEK_PARAM, workItemHitTarget } from "@/components/detail/peek-url";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import type { AppliedBatch, SearchHit, SearchType } from "@/lib/tessera/types";
import {
  AssistantIcon,
  CompassIcon,
  CycleIcon,
  FolderIcon,
  GearIcon,
  KeyboardIcon,
  LightningIcon,
  ListBulletsIcon,
  MagicIcon,
  ModuleIcon,
  PageIcon,
  PlusIcon,
  ResetIcon,
  SidebarIcon,
  ViewIcon,
} from "@/themes/catppuccin/icons";
import { setColorScheme } from "./color-scheme";
import { useCommandContext, type CommandContextValue } from "./command-context";
import {
  buildAiCommands,
  buildCommands,
  buildProjectSettingsCommands,
  buildUndoCommand,
  createCommandSource,
  DESCRIBE_VIEW_ID,
  NEW_DRAFT_ID,
  OPEN_ITEM_PREFIX,
  projectSettingsTab,
  recentToItem,
  themeCommandScheme,
  UNDO_ASSISTANT_ID,
  type CommandSearchItem,
  type CommandSection,
  type CommandSource,
} from "./command-source";
import { PaletteFooter, PaletteInput, type PaletteMode, type PaletteScope } from "./palette-parts";
import { isSidenavDrawer } from "./layout-motion";
import { getNavPrefs, SIDEBAR_COMMAND_PREFIX, sidebarCommandPatch } from "./nav-prefs";
import { readProjectFeatures } from "./project-features";
import { onScreenPaths, otherRecents, projectIdFromPath, RECENTS_IN_PALETTE } from "./recents";
import { readRecents } from "./recents-store";
import { COLOR_SCHEME_ICONS, ROUTE_ICONS } from "./shell-icons";
import { ShortcutKeys, ShortcutsDialog } from "./ShortcutsDialog";
import { isShortcutId } from "./shortcuts";
import { buildSidebarCommands } from "./sidebar-commands";
import { useShell } from "./TesseraShell";
import { useShortcutPrefs, useShortcuts } from "./useShortcuts";

/**
 * What the shell calls: `open()` behaves exactly like `mod+k`, `openHelp()`
 * like `mod+/` and `openCreateProject()` like `n p`. `open(initialQuery)`
 * starts the palette with that query (the key typed into the top bar's
 * search field); a call while the palette is open does nothing.
 */
export type CommandBarHandle = { open: (initialQuery?: string) => void; openHelp: () => void; openCreateProject: () => void };

export type CommandBarProps = {
  ref?: Ref<CommandBarHandle>;
};

const CLOSED_SCOPE: PaletteScope = { projectId: null, allProjects: false, mode: "search", onScreen: [], pathname: "/" };

type PaletteState = {
  scope: PaletteScope;
  context: CommandContextValue | null;
  items: Map<string, CommandSearchItem>;
  inner: CommandSource | null;
  aiAvailable: boolean;
  handoff: (text: string) => void;
  /** The newest undoable assistant batch, read when the palette lists (null: none, or the lookup failed). */
  undoBatch: AppliedBatch | null;
};

export function CommandBar({ ref }: CommandBarProps) {
  const router = useRouter();
  const toast = useToast();
  const ask = useCommandBarAsk();
  const context = useCommandContext();
  const { singleKeys } = useShortcutPrefs();
  const { setNavView, setNavDock } = useShell();
  const [isOpen, setOpen] = useState(false);
  // A new palette instance per opening, so a close from outside the palette
  // (the help dialog taking over) never leaves a stale query behind.
  const [session, setSession] = useState(0);
  const [initialQuery, setInitialQuery] = useState("");
  // Set the moment `open()` runs, before the render that opens the palette, so a second key the top bar's field
  // receives before the palette takes focus does not start a new palette over the first.
  const isOpenRef = useRef(false);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isCreateProjectOpen, setCreateProjectOpen] = useState(false);
  const [scope, setScope] = useState<PaletteScope>(CLOSED_SCOPE);

  // What the stable search source and the selection handler read at call
  // time. Handlers write `scope` before re-running the query so the source
  // sees the new value; `context` follows the hook; `items` is the map of
  // palette items by id that the selection handler resolves.
  const paletteRef = useRef<PaletteState>({ scope: CLOSED_SCOPE, context: null, items: new Map(), inner: null, aiAvailable: false, handoff: () => undefined, undoBatch: null });

  // Layout effect so the palette's own effect, which re-runs the query, reads the new values.
  useLayoutEffect(() => {
    paletteRef.current.aiAvailable = ask.isAskShown;
    paletteRef.current.handoff = ask.handoff;
  }, [ask.handoff, ask.isAskShown]);

  useEffect(() => {
    paletteRef.current.context = context;
  }, [context]);

  const notify = useCallback(
    (message: string) => {
      toast({ body: message });
    },
    [toast],
  );

  const push = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  const open = useCallback((query?: string) => {
    if (isOpenRef.current) return;
    isOpenRef.current = true;
    const { pathname, search } = window.location;
    const next: PaletteScope = {
      projectId: projectIdFromPath(pathname),
      allProjects: false,
      mode: "search",
      onScreen: onScreenPaths(pathname, new URLSearchParams(search).get(PEEK_PARAM)),
      pathname,
    };
    paletteRef.current.scope = next;
    setScope(next);
    setInitialQuery(query ?? "");
    setSession((count) => count + 1);
    setOpen(true);
  }, []);

  // The palette calls this with false on Escape, a selection or a click
  // outside; the next open starts from a fresh scope and an empty item map.
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    isOpenRef.current = next;
    if (next) return;
    paletteRef.current.scope = CLOSED_SCOPE;
    paletteRef.current.items = new Map();
    paletteRef.current.undoBatch = null;
    setScope(CLOSED_SCOPE);
  }, []);

  // The help dialog replaces the palette instead of stacking on it.
  const openHelp = useCallback(() => {
    onOpenChange(false);
    setHelpOpen(true);
  }, [onOpenChange]);
  const openCreateProject = useCallback(() => setCreateProjectOpen(true), []);

  useImperativeHandle(ref, () => ({ open, openHelp, openCreateProject }), [open, openHelp, openCreateProject]);

  const run = useShortcuts({
    isDisabled: isOpen || isHelpOpen || isCreateProjectOpen,
    push,
    notify,
    openCommandBar: open,
    openHelp,
    openCreateProject,
  });

  useHotkeys([
    { keys: "mod+k", onPress: () => open(), allowInInputs: true, isDisabled: isOpen },
    { keys: "mod+/", onPress: openHelp, allowInInputs: true, isDisabled: isHelpOpen },
  ]);

  // The inner source is created on first use, not during render, so the
  // getters it receives can read the ref when the palette calls them.
  const source = useMemo<CommandSource>(() => {
    const state = () => paletteRef.current;
    const inner = () => {
      const current = state();
      current.inner ??= createCommandSource({
        commands: () => {
          const current = state();
          if (current.scope.mode === "ask") return [];
          const features = readProjectFeatures(current.scope.projectId);
          return [
            ...buildCommands(current.context, features),
            ...buildProjectSettingsCommands(current.scope.projectId),
            ...buildAiCommands(current.scope.projectId, features, current.aiAvailable),
            ...buildUndoCommand(current.undoBatch),
            // Read when the palette asks, like the project features (decision 131).
            ...buildSidebarCommands(getNavPrefs(), isSidenavDrawer()),
          ];
        },
        recents: () => (state().scope.mode === "ask" ? [] : otherRecents(readRecents(), state().scope.onScreen, RECENTS_IN_PALETTE).map(recentToItem)),
        scope: () => (state().scope.allProjects ? null : state().scope.projectId),
      });
      return current.inner;
    };
    const remember = (items: CommandSearchItem[]) => {
      const map = state().items;
      for (const item of items) map.set(item.id, item);
      return items;
    };
    const askList = (query: string) => remember(askItems(query, state().scope.pathname));
    return {
      bootstrap: async () => {
        if (state().scope.mode === "ask") return askList("");
        // Before listing, so the "Undo last assistant change" row (decisions 116-117) is there only when a batch is.
        state().undoBatch = await fetchUndoableBatch();
        return remember(await inner().bootstrap());
      },
      search: async (query: string) => (state().scope.mode === "ask" ? askList(query) : remember(await inner().search(query))),
      cancel: () => state().inner?.cancel(),
    };
  }, []);

  const setMode = useCallback((mode: PaletteMode) => {
    const next = { ...paletteRef.current.scope, mode };
    paletteRef.current.scope = next;
    setScope(next);
  }, []);

  const setAllProjects = useCallback((allProjects: boolean) => {
    const next = { ...paletteRef.current.scope, allProjects };
    paletteRef.current.scope = next;
    setScope(next);
  }, []);

  const openHit = useCallback(
    (hit: SearchHit) => {
      switch (hit.type) {
        case "work_item": {
          if (!hit.project_id) return;
          const { pathname, search } = window.location;
          // A list of the item's project (work items, a cycle, a module, the archived items) with its peek host
          // mounted opens it in the peek; anywhere else (a feature-off or not-found screen too) opens the full page.
          const target = workItemHitTarget(pathname, search, hit.project_id, hit.id, hasPeekHost(hit.project_id));
          if (target.isPeek) {
            notePeekPush(currentHref(pathname, search), target.href);
            router.push(target.href, { scroll: false });
          } else {
            router.push(target.href);
          }
          return;
        }
        case "project":
          router.push(`/projects/${hit.id}/work-items`);
          return;
        case "cycle":
          if (hit.project_id) router.push(`/projects/${hit.project_id}/cycles/${hit.id}`);
          return;
        case "module":
          if (hit.project_id) router.push(`/projects/${hit.project_id}/modules/${hit.id}`);
          return;
        case "view":
          if (hit.project_id) router.push(`/projects/${hit.project_id}/views/${hit.id}`);
          else router.push(`/workspace-views/${hit.id}`);
          return;
        case "page":
          if (hit.project_id) router.push(`/projects/${hit.project_id}/pages/${hit.id}`);
          else router.push(`/pages/${hit.id}`);
          return;
      }
    },
    [router],
  );

  const handleSelect = useCallback(
    (id: string) => {
      const item = paletteRef.current.items.get(id);
      if (!item) return;
      const aux = item.auxiliaryData;
      if (aux?.kind === "hit") {
        openHit(aux.hit);
        return;
      }
      if (aux?.kind === "recent") {
        router.push(aux.path);
        return;
      }
      if (aux?.kind === "ask") {
        paletteRef.current.handoff(aux.text);
        return;
      }
      if (id === NEW_DRAFT_ID) {
        router.push("/drafts?draft=new");
        return;
      }
      if (id === DESCRIBE_VIEW_ID) {
        const projectId = paletteRef.current.scope.projectId;
        if (projectId) router.push(`/projects/${projectId}/views?describe=1`);
        return;
      }
      if (id === UNDO_ASSISTANT_ID) {
        // The batch the row showed; a newer one since then makes the undo refuse instead of reversing it.
        const batch = paletteRef.current.undoBatch;
        if (batch) void undoAssistantBatch(batch.proposal_ids, toast);
        return;
      }
      if (id.startsWith(OPEN_ITEM_PREFIX)) {
        const current = paletteRef.current.context;
        if (current) router.push(current.item.url);
        return;
      }
      const settingsTab = projectSettingsTab(id);
      const settingsProject = paletteRef.current.scope.projectId;
      if (settingsTab && settingsProject) {
        router.push(`/projects/${settingsProject}/settings/${settingsTab}`);
        return;
      }
      const scheme = themeCommandScheme(id);
      if (scheme) {
        setColorScheme(scheme);
        return;
      }
      // After the palette has closed (decision 131); "Undock" leaves the overlay closed.
      const sidebarPatch = sidebarCommandPatch(id);
      if (sidebarPatch) {
        window.setTimeout(() => {
          if (sidebarPatch.dock) setNavDock(sidebarPatch.dock);
          else setNavView(sidebarPatch.display === "rail" && sidebarPatch.rail ? sidebarPatch.rail : "full");
        }, 0);
        return;
      }
      // After the palette has closed and handed focus back to where it was,
      // so a picker the command opens (Change state…) keeps the focus.
      if (isShortcutId(id)) window.setTimeout(() => run(id), 0);
    },
    [openHit, router, run, setNavDock, setNavView, toast],
  );

  return (
    <>
      <CommandPalette<CommandSearchItem>
        key={session}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        searchSource={source}
        value=""
        onValueChange={handleSelect}
        label="Command bar"
        renderItem={(item) => <CommandRow item={item} />}
        emptyBootstrapText="Type to search, or pick a command"
        emptySearchText="No matches"
        input={<PaletteInput initialQuery={initialQuery} mode={scope.mode} isAskShown={ask.isAskShown} onModeChange={setMode} />}
        footer={<PaletteFooter scope={scope} onAllProjectsChange={setAllProjects} />}
      />
      <ShortcutsDialog isOpen={isHelpOpen} onOpenChange={setHelpOpen} singleKeys={singleKeys} />
      <CreateProjectDialog isOpen={isCreateProjectOpen} onOpenChange={setCreateProjectOpen} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const HIT_ICONS: Readonly<Record<SearchType, IconType>> = {
  work_item: ListBulletsIcon,
  project: FolderIcon,
  cycle: CycleIcon,
  module: ModuleIcon,
  view: ViewIcon,
  page: PageIcon,
};

const SECTION_ICONS: Partial<Record<CommandSection, IconType>> = {
  Actions: LightningIcon,
  Create: PlusIcon,
  Navigate: CompassIcon,
  Settings: GearIcon,
};

function commandIcon(item: CommandSearchItem): IconType {
  if (item.auxiliaryData?.kind === "ask") return AssistantIcon;
  if (item.id === DESCRIBE_VIEW_ID) return MagicIcon;
  if (item.id === UNDO_ASSISTANT_ID) return ResetIcon;
  if (item.id === "shortcuts.help") return KeyboardIcon;
  if (item.id.startsWith(SIDEBAR_COMMAND_PREFIX)) return SidebarIcon;
  const scheme = themeCommandScheme(item.id);
  if (scheme) return COLOR_SCHEME_ICONS[scheme];
  const group = item.auxiliaryData?.group;
  return (group && SECTION_ICONS[group]) || CompassIcon;
}

function CommandRow({ item }: { item: CommandSearchItem }) {
  const aux = item.auxiliaryData;
  if (aux?.kind === "recent") {
    return (
      <HStack gap={2} vAlign="center" width="100%" className="tessera-cmd-row">
        <Icon icon={ROUTE_ICONS[aux.icon]} size="sm" color="secondary" />
        <Text maxLines={1} className="tessera-cmd-label">
          {item.label}
        </Text>
      </HStack>
    );
  }
  if (aux?.kind === "hit") {
    const { hit } = aux;
    return (
      <HStack gap={2} vAlign="center" width="100%" className="tessera-cmd-row">
        <Icon icon={HIT_ICONS[hit.type]} size="sm" color="secondary" />
        {hit.key ? (
          <Text type="supporting" color="secondary" hasTabularNumbers className="tessera-cmd-key">
            {hit.key}
          </Text>
        ) : null}
        <Text maxLines={1} className="tessera-cmd-label">
          {hit.title}
        </Text>
        {/* A project's subtitle is its identifier, already shown as the key. */}
        {hit.subtitle && hit.subtitle !== hit.key ? (
          <Text type="supporting" color="secondary" maxLines={1} className="tessera-cmd-meta">
            {hit.subtitle}
          </Text>
        ) : null}
      </HStack>
    );
  }
  return (
    <HStack gap={2} vAlign="center" width="100%" className="tessera-cmd-row">
      <Icon icon={commandIcon(item)} size="sm" color="secondary" />
      <Text maxLines={1} className="tessera-cmd-label">
        {item.label}
      </Text>
      {aux?.kind === "command" && aux.hint ? (
        <Text type="supporting" color="secondary" className="tessera-cmd-meta">
          {aux.hint}
        </Text>
      ) : null}
      {aux?.kind === "command" && aux.keys ? <ShortcutKeys keys={aux.keys} /> : null}
    </HStack>
  );
}
