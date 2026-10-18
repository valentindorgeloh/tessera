/**
 * Row selection for the work-item list. Pure: no React, so Vitest covers it
 * (tests/ui/selection.test.ts). At most 500 ids, the engine's bulk cap.
 */
export const MAX_SELECTION = 500;

export type Selection = ReadonlySet<string>;

function capped(ids: Iterable<string>): Selection {
  const next = new Set<string>();
  for (const id of ids) {
    if (next.size >= MAX_SELECTION) break;
    next.add(id);
  }
  return next;
}

/** Adds `id`, or removes it when it is already selected. */
export function toggle(sel: Selection, id: string): Selection {
  const next = new Set(sel);
  if (next.has(id)) next.delete(id);
  else if (next.size < MAX_SELECTION) next.add(id);
  return next;
}

/** Selects every id from `anchorId` through `id` in `orderedIds`, keeping the rest. */
export function selectRange(sel: Selection, orderedIds: readonly string[], anchorId: string, id: string): Selection {
  const start = orderedIds.indexOf(anchorId);
  const end = orderedIds.indexOf(id);
  if (start < 0 || end < 0) return toggle(sel, id);
  const [from, to] = start < end ? [start, end] : [end, start];
  const next = new Set(sel);
  for (const itemId of orderedIds.slice(from, to + 1)) {
    if (next.size >= MAX_SELECTION && !next.has(itemId)) break;
    next.add(itemId);
  }
  return next;
}

/** Every id, capped at `MAX_SELECTION`. */
export function selectAll(orderedIds: readonly string[]): Selection {
  return capped(orderedIds);
}

/** Drops ids that are no longer in `presentIds`. Returns `sel` itself when nothing drops. */
export function prune(sel: Selection, presentIds: ReadonlySet<string>): Selection {
  let changed = false;
  const next = new Set<string>();
  for (const id of sel) {
    if (presentIds.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : sel;
}
