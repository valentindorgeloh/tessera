/**
 * Move up / Move down for the States and Labels settings (docs/drafts/p4-ui.md
 * "Shared pieces"). The rows are shown grouped while the engine's adjacency
 * check reads the flat order, so a move names exactly one neighbour: the one
 * the row swaps with among the rows shown beside it.
 */
export type SiblingMove = { after_id: string } | { before_id: string };

/**
 * The engine's `after_id` is the row that ends up directly after the moved one,
 * `before_id` the row directly before it. Up therefore names the previous
 * sibling as `after_id` and down names the next sibling as `before_id`; null at
 * an edge or for an unknown id.
 */
export function siblingMove(siblingIds: readonly string[], id: string, direction: "up" | "down"): SiblingMove | null {
  const index = siblingIds.indexOf(id);
  if (index === -1) return null;
  if (direction === "up") {
    const previous = siblingIds[index - 1];
    return previous === undefined ? null : { after_id: previous };
  }
  const next = siblingIds[index + 1];
  return next === undefined ? null : { before_id: next };
}
