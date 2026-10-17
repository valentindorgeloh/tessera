"use client";

/**
 * Search field and footer of Power K, split out of CommandBar so that file
 * stays within the line budget (docs/drafts/p5-plan.md §6 "U3"). The Ask tab
 * is hidden while the assistant is unavailable; Enter in either mode opens
 * the first result (decision 38: Ask then leaves the palette).
 */
import { useCallback, useEffect, useId, useRef, type KeyboardEvent } from "react";
import { CommandPaletteFooter, CommandPaletteInput, useCommandPaletteContext } from "@astryxdesign/core/CommandPalette";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { SearchIcon, SparkleIcon } from "@/themes/catppuccin/icons";
import { liveHighlight } from "./command-source";

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
  // The palette remounts per opening (`session`), so this seeds each opening's query once.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !palette) return;
    seeded.current = true;
    if (initialQuery) palette.setSearch(initialQuery);
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
  useEffect(() => {
    setHighlighted?.(-1);
  }, [query, setHighlighted]);
  useEffect(() => {
    if (highlighted >= rowCount) setHighlighted?.(-1);
  }, [highlighted, rowCount, setHighlighted]);

  // The palette highlights nothing until an arrow key moves; Enter on a fresh
  // query opens the first result (a key such as WEB-1, or "Ask: …"). A row the
  // user highlighted is the palette's to open; a stale highlight is not.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      pendingEnter.current = false;
      return;
    }
    if (!palette || liveHighlight(palette.highlightedIndex, palette.selectableItems) >= 0) return;
    if (palette.isBusy) {
      event.preventDefault();
      pendingEnter.current = true;
      return;
    }
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
