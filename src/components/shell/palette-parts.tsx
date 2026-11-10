"use client";

/**
 * Search field and footer of Power K, split out of CommandBar so that file
 * stays within the line budget (docs/drafts/p5-plan.md §6 "U3"). The Ask tab
 * is hidden while the assistant is unavailable; Enter in either mode opens
 * the first result (decision 38: Ask then leaves the palette).
 *
 * This module also holds `PalettePanel`, the Astryx palette with this input
 * and footer. ./palette-lazy.tsx loads the whole module on demand (decision
 * 142), so CommandBar imports only types and the lazy wrapper from here, never
 * the components.
 */
import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CommandPalette, CommandPaletteFooter, CommandPaletteInput, useCommandPaletteContext } from "@astryxdesign/core/CommandPalette";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { SearchIcon, SparkleIcon } from "@/themes/catppuccin/icons";
import { autoHighlightRow, liveHighlight, type CommandSearchItem, type CommandSource } from "./command-source";

export type PaletteMode = "search" | "ask";

export type PaletteScope = {
  /** The project of the route the palette opened on, or null outside a project. */
  projectId: string | null;
  /** The footer toggle: search every project instead of the current one. */
  allProjects: boolean;
  mode: PaletteMode;
  /** The routes on screen when the palette opened (`onScreenPaths`), left out of the "Recent" group. */
  onScreen: readonly string[];
  /** Path the palette opened on. Ask suggestions are chosen from it. */
  pathname: string;
};

export function PaletteInput({
  initialQuery,
  mode,
  isAskShown,
  onModeChange,
}: {
  initialQuery: string;
  mode: PaletteMode;
  /** False while the assistant status is missing or unavailable: the Ask tab stays hidden. */
  isAskShown: boolean;
  onModeChange: (mode: PaletteMode) => void;
}) {
  const palette = useCommandPaletteContext();
  // An id for the combobox input, so the browser can tell the form field apart (DevTools flags fields with neither id nor name).
  const inputId = useId();
  // The palette remounts per opening (`session`), so this seeds each opening's query once. The seed
  // waits one task: Astryx's palette runs its empty-query bootstrap in its own mount effect, which
  // runs after this child's effects in the same commit and would reset a query set synchronously
  // here (the first letter typed into the top bar's field was lost). A key typed into the dialog
  // before that task runs is kept after the seeded letter. Astryx's modal Dialog keeps this input
  // mounted after a close, and the palette context changes then (it carries `isOpen`), so this
  // effect runs again on close: the cleanup clears a pending seed and a closed palette arms none,
  // or the seed would search the closed palette and announce its results over the next dialog.
  const seeded = useRef(false);
  const typedBeforeSeed = useRef("");
  useEffect(() => {
    typedBeforeSeed.current = palette?.search ?? "";
  });
  useEffect(() => {
    if (seeded.current || !palette?.isOpen || !initialQuery) return;
    const timer = window.setTimeout(() => {
      seeded.current = true;
      palette.setSearch(initialQuery + typedBeforeSeed.current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialQuery, palette]);
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

  // The assistant status arrives after the palette may already be open. Leave
  // Ask mode when it is unavailable, and re-run the query so the list matches.
  const shownRef = useRef(isAskShown);
  useEffect(() => {
    if (shownRef.current === isAskShown) return;
    shownRef.current = isAskShown;
    if (!isAskShown && mode === "ask") onModeChange("search");
    palette?.setSearch(palette.search);
  }, [isAskShown, mode, onModeChange, palette]);

  // Astryx keeps a hover highlight when the list changes under it. A new query
  // starts without one, so Enter opens its first result; a highlight past the
  // end of the list (the list narrowed) is dropped too, so the input's
  // aria-activedescendant never names an option that is gone.
  const query = palette?.search;
  const highlighted = palette?.highlightedIndex ?? -1;
  const rowCount = palette?.selectableItems.length ?? 0;
  const setHighlighted = palette?.setHighlightedIndex;
  // The query whose first row was already highlighted: that happens once per
  // query, so a row the user un-highlights (mouse leave, ArrowUp to -1) stays so.
  const autoHighlighted = useRef(false);
  useEffect(() => {
    autoHighlighted.current = false;
    setHighlighted?.(-1);
  }, [query, setHighlighted]);
  useEffect(() => {
    if (highlighted >= rowCount) setHighlighted?.(-1);
  }, [highlighted, rowCount, setHighlighted]);

  // Once the results for a query have landed, the first row is the active one:
  // it carries the highlight overlay and the input's aria-activedescendant, so
  // the row Enter opens is the row on screen (S12). Only after a query change
  // (the idle empty-query list keeps Astryx's no-highlight start) and only
  // once per query, and never while a search is in flight.
  const isBusy = palette?.isBusy ?? true;
  const autoRow = palette ? autoHighlightRow(query ?? "", isBusy, palette.selectableItems) : -1;
  useEffect(() => {
    if (autoRow < 0 || autoHighlighted.current) return;
    autoHighlighted.current = true;
    if (highlighted < 0) setHighlighted?.(autoRow);
  }, [autoRow, highlighted, setHighlighted]);

  // Enter on a fresh query opens the first result (a key such as WEB-1, or
  // "Ask: …"), which is also the highlighted row once the results land. A row
  // the user highlighted is the palette's to open; a stale highlight is not.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      pendingEnter.current = false;
      return;
    }
    if (!palette) return;
    // A search in flight: wait for its results, even when a row of the old list
    // is highlighted (the first row is highlighted automatically).
    if (palette.isBusy) {
      event.preventDefault();
      pendingEnter.current = true;
      return;
    }
    if (liveHighlight(palette.highlightedIndex, palette.selectableItems) >= 0) return;
    if (openFirst()) event.preventDefault();
  };
  const shownMode = isAskShown ? mode : "search";
  return (
    <VStack gap={0} width="100%">
      <CommandPaletteInput
        id={inputId}
        placeholder={shownMode === "ask" ? "Ask the assistant…" : "Search work items, or type a command…"}
        label={shownMode === "ask" ? "Ask" : "Search"}
        endContent={<Kbd keys="escape" />}
        onKeyDown={onKeyDown}
      />
      <TabList value={shownMode} onChange={change} size="sm" aria-label="Command bar mode" className="tessera-cmd-tabs">
        <Tab value="search" label="Search" icon={<Icon icon={SearchIcon} size="sm" />} />
        {isAskShown ? <Tab value="ask" label="Ask" icon={<Icon icon={SparkleIcon} size="sm" />} /> : null}
      </TabList>
    </VStack>
  );
}

export function PaletteFooter({ scope, onAllProjectsChange }: { scope: PaletteScope; onAllProjectsChange: (allProjects: boolean) => void }) {
  const palette = useCommandPaletteContext();
  const showToggle = scope.projectId !== null && scope.mode === "search";
  return (
    <CommandPaletteFooter>
      <HStack gap={4} vAlign="center" hAlign="between" width="100%">
        <HStack gap={3} vAlign="center" wrap="wrap" className="tessera-cmd-hints">
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

export type PalettePanelProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  searchSource: CommandSource;
  onValueChange: (id: string) => void;
  renderItem: (item: CommandSearchItem) => ReactNode;
  initialQuery: string;
  scope: PaletteScope;
  isAskShown: boolean;
  onModeChange: (mode: PaletteMode) => void;
  onAllProjectsChange: (allProjects: boolean) => void;
};

/** The Power K palette with its search field and footer (CommandBar renders it through ./palette-lazy.tsx). */
export function PalettePanel({ isOpen, onOpenChange, searchSource, onValueChange, renderItem, initialQuery, scope, isAskShown, onModeChange, onAllProjectsChange }: PalettePanelProps) {
  return (
    <CommandPalette<CommandSearchItem>
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      searchSource={searchSource}
      value=""
      onValueChange={onValueChange}
      label="Command bar"
      renderItem={renderItem}
      emptyBootstrapText="Type to search, or pick a command"
      emptySearchText="No matches"
      input={<PaletteInput initialQuery={initialQuery} mode={scope.mode} isAskShown={isAskShown} onModeChange={onModeChange} />}
      footer={<PaletteFooter scope={scope} onAllProjectsChange={onAllProjectsChange} />}
    />
  );
}
