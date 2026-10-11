/**
 * Quick-add placeholders (docs/contracts/ui.md "Optimistic UI"): the row the
 * list shows between Enter and the server's re-render carries a client-made
 * id with this prefix. Layouts render such rows inert (no open, no drag, no
 * edits) because the id means nothing to the engine yet.
 */

export const OPTIMISTIC_ID_PREFIX = "optimistic-";

export function optimisticId(): string {
  return `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}
