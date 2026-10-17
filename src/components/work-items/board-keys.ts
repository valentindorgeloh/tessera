/**
 * Drag keys of the board (decision 30, docs/drafts/p4-ui.md F3.1). A card
 * that belongs to several columns (labels, assignees, modules) renders once
 * per column; `usePointerDrag` keys items by string, so each copy registers
 * under `<container>|<itemId>`. Ids, group values and container ids contain
 * no `|`, so the item id is the part after the last one.
 */

/** The drag key of the copy of `itemId` rendered in `container`. */
export function dragKey(container: string, itemId: string): string {
  return `${container}|${itemId}`;
}

/** The work item id inside a drag key; a bare id passes through. */
export function itemIdOf(key: string): string {
  return key.slice(key.lastIndexOf("|") + 1);
}
