/**
 * Drop maths of the views list drag reorder (decision 105), pure so Vitest
 * covers it (tests/ui/view-reorder.test.ts). The list is one container; the
 * pointer hook reports the insertion index among the other views and the two
 * neighbours, which `reorder_view` takes as they are (the views of a scope are
 * one adjacent list, unlike the states of a project).
 */
import { reorderIds } from "@/components/dnd/drag-math";
import type { View } from "@/lib/tessera/types";

/** The container id of the views list. */
export const VIEWS_CONTAINER = "views";

/** `views` with `id` moved to `index` among the other views (the index the pointer hook reports). */
export function moveView(views: readonly View[], id: string, index: number): View[] {
  const byId = new Map(views.map((view) => [view.id, view]));
  if (!byId.has(id)) return [...views];
  return reorderIds(
    views.map((view) => view.id),
    id,
    index,
  ).map((viewId) => byId.get(viewId) as View);
}

export type ViewDropInput = { view_id: string; before_id?: string; after_id?: string };

/** The `reorder_view` input of a drop; null when it names no neighbour (a one-view list has nothing to reorder). */
export function viewDropInput(event: { id: string; before_id?: string; after_id?: string }): ViewDropInput | null {
  if (event.before_id === undefined && event.after_id === undefined) return null;
  const input: ViewDropInput = { view_id: event.id };
  if (event.before_id !== undefined) input.before_id = event.before_id;
  if (event.after_id !== undefined) input.after_id = event.after_id;
  return input;
}

export type ViewStep = {
  /** The insertion index among the other views, as `moveView` takes it. */
  index: number;
  /** The `reorder_view` neighbour: Move up lands before the previous row (`after_id` = that row), Move down after the next row (`before_id` = that row). */
  input: ViewDropInput;
};

/**
 * The menu's Move up / Move down as one step (decision 105's keyboard path):
 * the optimistic index and the `reorder_view` input, or null at the list's
 * end (the menu item is disabled there) or for an unknown view.
 */
export function viewStep(ids: readonly string[], id: string, direction: "up" | "down"): ViewStep | null {
  const at = ids.indexOf(id);
  if (at < 0) return null;
  if (direction === "up") {
    const previous = ids[at - 1];
    return previous === undefined ? null : { index: at - 1, input: { view_id: id, after_id: previous } };
  }
  const next = ids[at + 1];
  return next === undefined ? null : { index: at + 1, input: { view_id: id, before_id: next } };
}
