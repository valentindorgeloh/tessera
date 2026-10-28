"use client";

/**
 * Selection for the list layout: shift-click extends from the anchor, Escape
 * clears, a refresh drops rows that left the list, and a navigation clears it.
 */
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { prune, selectRange, toggle, type Selection } from "./selection";
import { useStableCallback } from "./stable";

const EMPTY: Selection = new Set();

export function useSelection(orderedIds: readonly string[], enabled: boolean) {
  const pathname = usePathname();
  const [selected, setSelected] = useState<Selection>(EMPTY);
  const [path, setPath] = useState(pathname);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const pathChanged = path !== pathname;
  if (pathChanged) {
    setPath(pathname);
    setSelected(EMPTY);
    setAnchorId(null);
  }
  const present = new Set(orderedIds);
  const pruned = !enabled || pathChanged ? EMPTY : prune(selected, present);
  if (!pathChanged && pruned !== selected) setSelected(pruned);

  useHotkeys([
    {
      keys: "escape",
      isDisabled: !enabled || selected.size === 0,
      onPress: () => {
        setSelected(EMPTY);
        setAnchorId(null);
      },
    },
  ]);

  // A fixed identity: every memoized row gets it as its `onToggle`, so a tick redraws the ticked row, not the list (decision 141).
  const toggleId = useStableCallback((id: string, shift: boolean) => {
    if (!enabled) return;
    setSelected((current) => (shift && anchorId ? selectRange(current, orderedIds, anchorId, id) : toggle(current, id)));
    setAnchorId(id);
  });

  const toggleIds = (ids: readonly string[], on: boolean) => {
    if (!enabled) return;
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const clear = () => {
    setSelected(EMPTY);
    setAnchorId(null);
  };

  return { selected: enabled ? selected : EMPTY, toggleId, toggleIds, clear };
}
