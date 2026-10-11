"use client";

/**
 * Power K (docs/contracts/ui.md "Power K and shortcuts (D4)"): the Astryx
 * CommandPalette on `mod+k` with search hits from `GET /api/search` (a
 * debounced client fetch through ./command-source.ts, never a Server Action),
 * the static commands of the current context (actions on the open work item
 * from ./command-context.ts, create and navigate chords, settings and the
 * colour scheme), an "All projects" footer toggle inside a project, an "Ask"
 * tab placeholder for the assistant (P5) and the keyboard shortcuts dialog on
 * `mod+/`. Mounts the
 * shortcut dispatcher once. The open state and the scope live here; the
 * shell reaches `open()` through the `CommandBarHandle` ref, so the sidebar's
 * search item (`useShell().openCommandBar()`) and `mod+k` take the same path
 * and both read the project of the current route when the palette opens.
 * The scope is the route's project, not `useOptionalProject()`: the bar is
 * mounted by the shell, above every ProjectProvider.
 *
 * The palette's search source is created once and reads the scope, the mode
 * and the command context through refs at call time; the footer and the mode
 * tabs re-run the current query through the palette context after flipping
 * them. Selection comes back as the chosen item id (`onValueChange`), looked
 * up in the map of items the source produced.
 */
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette, CommandPaletteFooter, CommandPaletteInput, useCommandPaletteContext } from "@astryxdesign/core/CommandPalette";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { notePeekPush } from "@/components/detail/peek-history";
import { hasPeekHost } from "@/components/detail/peek-hosts";
import { currentHref, workItemHitTarget } from "@/components/detail/peek-url";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import type { SearchHit, SearchType } from "@/lib/tessera/types";
import {
  CompassIcon,
  CycleIcon,
  FolderIcon,
  GearIcon,
  KeyboardIcon,
  LightningIcon,
  ListBulletsIcon,
  ModuleIcon,
  MonitorIcon,
  MoonIcon,
  PageIcon,
  PlusIcon,
  SearchIcon,
  SparkleIcon,
  SunIcon,
} from "@/themes/catppuccin/icons";
import { setColorScheme, type ColorScheme } from "./color-scheme";
import { useCommandContext, type CommandContextValue } from "./command-context";
import {
  buildCommands,
  createCommandSource,
  liveHighlight,
  OPEN_ITEM_PREFIX,
  shortcutHint,
  themeCommandScheme,
  type CommandSearchItem,
  type CommandSection,
  type CommandSource,
} from "./command-source";
import { isShortcutId, SHORTCUTS, type ShortcutGroup } from "./shortcuts";
import { projectIdFromPath } from "./tab-registry";
import { setSingleKeys, useShortcutPrefs, useShortcuts } from "./useShortcuts";

/** What the shell calls: `open()` behaves exactly like `mod+k`. */
export type CommandBarHandle = { open: () => void };

export type CommandBarProps = {
  ref?: Ref<CommandBarHandle>;
};

type PaletteMode = "search" | "ask";

type PaletteScope = {
  /** The project of the route the palette opened on, or null outside a project. */
  projectId: string | null;
  /** The footer toggle: search every project instead of the current one. */
  allProjects: boolean;
  mode: PaletteMode;
};

const CLOSED_SCOPE: PaletteScope = { projectId: null, allProjects: false, mode: "search" };

type PaletteState = {
  scope: PaletteScope;
  context: CommandContextValue | null;
  items: Map<string, CommandSearchItem>;
  inner: CommandSource | null;
};

const ASK_PLACEHOLDER = "The assistant arrives in P5";

export function CommandBar({ ref }: CommandBarProps) {
  const router = useRouter();
  const toast = useToast();
  const context = useCommandContext();
  const { singleKeys } = useShortcutPrefs();
  const [isOpen, setOpen] = useState(false);
  // A new palette instance per opening, so a close from outside the palette
  // (the help dialog taking over) never leaves a stale query behind.
  const [session, setSession] = useState(0);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [isCreateProjectOpen, setCreateProjectOpen] = useState(false);
  const [scope, setScope] = useState<PaletteScope>(CLOSED_SCOPE);

  // What the stable search source and the selection handler read at call
  // time. Handlers write `scope` before re-running the query so the source
  // sees the new value; `context` follows the hook; `items` is the map of
  // palette items by id that the selection handler resolves.
  const paletteRef = useRef<PaletteState>({ scope: CLOSED_SCOPE, context: null, items: new Map(), inner: null });

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

  const open = useCallback(() => {
    const next: PaletteScope = { projectId: projectIdFromPath(window.location.pathname), allProjects: false, mode: "search" };
    paletteRef.current.scope = next;
    setScope(next);
    setSession((count) => count + 1);
    setOpen(true);
  }, []);

  // The palette calls this with false on Escape, a selection or a click
  // outside; the next open starts from a fresh scope and an empty item map.
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) return;
    paletteRef.current.scope = CLOSED_SCOPE;
    paletteRef.current.items = new Map();
    setScope(CLOSED_SCOPE);
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  // The help dialog replaces the palette instead of stacking on it.
  const openHelp = useCallback(() => {
    onOpenChange(false);
    setHelpOpen(true);
  }, [onOpenChange]);
  const openCreateProject = useCallback(() => setCreateProjectOpen(true), []);

  const run = useShortcuts({
    isDisabled: isOpen || isHelpOpen || isCreateProjectOpen,
    push,
    notify,
    openCommandBar: open,
    openHelp,
    openCreateProject,
  });

  useHotkeys([
    { keys: "mod+k", onPress: open, allowInInputs: true, isDisabled: isOpen },
    { keys: "mod+/", onPress: openHelp, allowInInputs: true, isDisabled: isHelpOpen },
  ]);

  // The inner source is created on first use, not during render, so the
  // getters it receives can read the ref when the palette calls them.
  const source = useMemo<CommandSource>(() => {
    const state = () => paletteRef.current;
    const inner = () => {
      const current = state();
      current.inner ??= createCommandSource({
        commands: () => (state().scope.mode === "ask" ? [] : buildCommands(state().context)),
        scope: () => (state().scope.allProjects ? null : state().scope.projectId),
      });
      return current.inner;
    };
    const remember = (items: CommandSearchItem[]) => {
      const map = state().items;
      for (const item of items) map.set(item.id, item);
      return items;
    };
    return {
      bootstrap: async () => remember(await inner().bootstrap()),
      search: async (query: string) => (state().scope.mode === "ask" ? [] : remember(await inner().search(query))),
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
        case "page":
          notify("Arrives in P6");
          return;
      }
    },
    [notify, router],
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
      if (id.startsWith(OPEN_ITEM_PREFIX)) {
        const current = paletteRef.current.context;
        if (current) router.push(current.item.url);
        return;
      }
      const scheme = themeCommandScheme(id);
      if (scheme) {
        setColorScheme(scheme);
        return;
      }
      // After the palette has closed and handed focus back to where it was,
      // so a picker the command opens (Change state…) keeps the focus.
      if (isShortcutId(id)) window.setTimeout(() => run(id), 0);
    },
    [openHit, router, run],
  );

  const emptyText = scope.mode === "ask" ? ASK_PLACEHOLDER : undefined;

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
        emptyBootstrapText={emptyText ?? "Type to search, or pick a command"}
        emptySearchText={emptyText ?? "No matches"}
        input={<PaletteInput mode={scope.mode} onModeChange={setMode} />}
        footer={<PaletteFooter scope={scope} onAllProjectsChange={setAllProjects} />}
      />
      <ShortcutsDialog isOpen={isHelpOpen} onOpenChange={setHelpOpen} singleKeys={singleKeys} />
      <CreateProjectDialog isOpen={isCreateProjectOpen} onOpenChange={setCreateProjectOpen} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Input slot: the search field above the Search / Ask tabs
// ---------------------------------------------------------------------------

function PaletteInput({ mode, onModeChange }: { mode: PaletteMode; onModeChange: (mode: PaletteMode) => void }) {
  const palette = useCommandPaletteContext();
  // An id for the combobox input, so the browser can tell the form field apart (DevTools flags fields with neither id nor name).
  const inputId = useId();
  // Enter pressed while the debounced search is still running: open the
  // first result once it lands instead of the stale list on screen.
  const pendingEnter = useRef(false);

  const change = (value: string) => {
    onModeChange(value === "ask" ? "ask" : "search");
    // Re-run the current query against the source in its new mode.
    palette?.setSearch(palette.search);
  };

  const openFirst = useCallback(() => {
    if (!palette) return false;
    const first = palette.selectableItems.find((item) => !item.disabled);
    if (!first) return false;
    palette.selectItem(first.value);
    palette.onClose();
    return true;
  }, [palette]);

  useEffect(() => {
    if (!pendingEnter.current || !palette || palette.isBusy) return;
    pendingEnter.current = false;
    openFirst();
  }, [openFirst, palette]);

  // Astryx keeps a hover highlight when the list changes under it. A new query
  // starts without one, so Enter opens its first result; a highlight past the
  // end of the list (the list narrowed) is dropped too, so the input's
  // aria-activedescendant never names an option that is gone.
  const query = palette?.search;
  const highlighted = palette?.highlightedIndex ?? -1;
  const rowCount = palette?.selectableItems.length ?? 0;
  const setHighlighted = palette?.setHighlightedIndex;
  useEffect(() => {
    setHighlighted?.(-1);
  }, [query, setHighlighted]);
  useEffect(() => {
    if (highlighted >= rowCount) setHighlighted?.(-1);
  }, [highlighted, rowCount, setHighlighted]);

  // The palette highlights nothing until an arrow key moves; Enter on a fresh
  // query opens the first result (a key such as WEB-1 ranks first). A row the
  // user highlighted is the palette's to open; a stale highlight is not.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      pendingEnter.current = false;
      return;
    }
    if (!palette || mode === "ask" || liveHighlight(palette.highlightedIndex, palette.selectableItems) >= 0) return;
    if (palette.isBusy) {
      event.preventDefault();
      pendingEnter.current = true;
      return;
    }
    if (openFirst()) event.preventDefault();
  };
  return (
    <VStack gap={0} width="100%">
      <CommandPaletteInput
        id={inputId}
        placeholder={mode === "ask" ? "Ask the assistant…" : "Search work items, or type a command…"}
        label={mode === "ask" ? "Ask" : "Search"}
        endContent={<Kbd keys="escape" />}
        onKeyDown={onKeyDown}
      />
      <TabList value={mode} onChange={change} size="sm" aria-label="Command bar mode" className="tessera-cmd-tabs">
        <Tab value="search" label="Search" icon={<Icon icon={SearchIcon} size="sm" />} />
        <Tab value="ask" label="Ask" icon={<Icon icon={SparkleIcon} size="sm" />} />
      </TabList>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Footer slot: key hints and the "All projects" toggle
// ---------------------------------------------------------------------------

function PaletteFooter({ scope, onAllProjectsChange }: { scope: PaletteScope; onAllProjectsChange: (allProjects: boolean) => void }) {
  const palette = useCommandPaletteContext();
  const showToggle = scope.projectId !== null && scope.mode === "search";
  return (
    <CommandPaletteFooter>
      <HStack gap={4} vAlign="center" hAlign="between" width="100%">
        <HStack gap={3} vAlign="center" wrap="wrap">
          <HStack gap={1} vAlign="center">
            <Kbd keys="up" />
            <Kbd keys="down" />
            <Text type="supporting" color="secondary">
              to move
            </Text>
          </HStack>
          <HStack gap={1} vAlign="center">
            <Kbd keys="enter" />
            <Text type="supporting" color="secondary">
              to open
            </Text>
          </HStack>
          <HStack gap={1} vAlign="center">
            <Kbd keys="mod+/" />
            <Text type="supporting" color="secondary">
              shortcuts
            </Text>
          </HStack>
        </HStack>
        {showToggle ? (
          <Switch
            label="All projects"
            size="sm"
            value={scope.allProjects}
            onChange={(checked) => {
              onAllProjectsChange(checked);
              palette?.setSearch(palette.search);
            }}
          />
        ) : null}
      </HStack>
    </CommandPaletteFooter>
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
  page: PageIcon,
};

const SECTION_ICONS: Partial<Record<CommandSection, IconType>> = {
  Actions: LightningIcon,
  Create: PlusIcon,
  Navigate: CompassIcon,
  Settings: GearIcon,
};

/** The glyphs of the sidebar's colour scheme menu. */
const THEME_ICONS: Readonly<Record<ColorScheme, IconType>> = {
  dark: MoonIcon,
  light: SunIcon,
  system: MonitorIcon,
};

function commandIcon(item: CommandSearchItem): IconType {
  if (item.id === "shortcuts.help") return KeyboardIcon;
  const scheme = themeCommandScheme(item.id);
  if (scheme) return THEME_ICONS[scheme];
  const group = item.auxiliaryData?.group;
  return (group && SECTION_ICONS[group]) || CompassIcon;
}

function CommandRow({ item }: { item: CommandSearchItem }) {
  const aux = item.auxiliaryData;
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

/** Kbd for `mod+delete` shows the Backspace glyph, the key most keyboards label Delete. */
function kbdKeys(step: string): string {
  return step.replace("delete", "backspace");
}

function ShortcutKeys({ keys }: { keys: string }) {
  const steps = keys.split(" ");
  return (
    <HStack gap={1} vAlign="center" className="tessera-cmd-keys">
      {steps.map((step, index) => (
        <HStack key={step} gap={1} vAlign="center">
          {index > 0 ? (
            <Text type="supporting" color="secondary">
              then
            </Text>
          ) : null}
          <Kbd keys={kbdKeys(step)} />
        </HStack>
      ))}
    </HStack>
  );
}

// ---------------------------------------------------------------------------
// Help dialog (mod+/)
// ---------------------------------------------------------------------------

const GROUP_ORDER: readonly ShortcutGroup[] = ["Global", "Work item", "Create", "Navigate"];

/** Shell shortcuts owned by other components; listed here so the dialog is complete. */
const EXTRA_GLOBAL: readonly { label: string; keys: string }[] = [
  { label: "Collapse the sidebar", keys: "mod+b" },
  { label: "Close the tab", keys: "alt+w" },
];

function ShortcutsDialog({ isOpen, onOpenChange, singleKeys }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; singleKeys: boolean }) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} width={560} maxHeight="85dvh" purpose="info">
      <Layout
        header={<DialogHeader title="Keyboard shortcuts" onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent isScrollable>
            <VStack gap={5}>
              <Switch
                label="Single-key shortcuts"
                description="Letters such as s and p, and the g and n chords. Turn them off if they get in the way of speech input."
                value={singleKeys}
                onChange={(checked) => setSingleKeys(checked)}
              />
              {GROUP_ORDER.map((group) => (
                <VStack key={group} gap={2}>
                  <Heading level={3}>{group}</Heading>
                  <List density="compact">
                    {group === "Global"
                      ? EXTRA_GLOBAL.map((row) => <ListItem key={row.keys} label={row.label} endContent={<ShortcutKeys keys={row.keys} />} />)
                      : null}
                    {SHORTCUTS.filter((def) => def.group === group).map((def) => (
                      <ListItem
                        key={def.id}
                        label={def.label}
                        description={shortcutHint(def)}
                        endContent={<ShortcutKeys keys={def.keys} />}
                      />
                    ))}
                  </List>
                </VStack>
              ))}
            </VStack>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
