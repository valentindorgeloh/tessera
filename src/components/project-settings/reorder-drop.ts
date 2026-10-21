/**
 * Drop maths of the States and Labels drag reorder (decision 105), pure so
 * Vitest covers it (tests/ui/reorder-drop.test.ts). The pointer hook
 * (src/components/dnd/use-pointer-drag.ts) reports a drop as a container, an
 * insertion index among the items that stay and the two neighbours; this file
 * turns that into the optimistic list and the engine input, and refuses the
 * drops a surface does not allow (a state in another group, a label that
 * would nest two levels deep) so the row snaps back.
 */
import { applyMove, type MoveAdapter } from "@/components/dnd/drag-math";
import type { Label, State, StateGroup } from "@/lib/tessera/types";

/** The part of the hook's drop event the maths reads (a structural subset of `DragDropEvent`). */
export type DropEvent = {
  id: string;
  fromContainer: string;
  toContainer: string;
  index: number;
  before_id?: string;
  after_id?: string;
};

// ---------------------------------------------------------------------------
// States: one container per group, a drop in another group snaps back
// ---------------------------------------------------------------------------

export function stateContainerId(group: StateGroup): string {
  return `state-group:${group}`;
}

const STATE_ADAPTER: MoveAdapter<State> = {
  idOf: (item) => item.id,
  containerOf: (item) => stateContainerId(item.state_group),
  withContainer: (item) => item,
};

/** `states` (every state of the project) with `id` moved to `index` among the other states of its group. */
export function moveStateInGroup(states: readonly State[], id: string, index: number): State[] {
  const moved = states.find((state) => state.id === id);
  if (moved === undefined) return [...states];
  return applyMove(states, { id, toContainer: stateContainerId(moved.state_group), index }, STATE_ADAPTER);
}

export type StateDrop = { state_id: string; index: number; input: { before_id: string } | { after_id: string } };

/**
 * The engine input for a state drop, or null when it must snap back: the
 * target is another group, or the state is unknown. States share one flat sort
 * order across groups, so a state names ONE neighbour (the one it follows when
 * there is one): both neighbours of a group are rarely adjacent in that flat
 * order and `reorder_state` would refuse the pair.
 */
export function stateDrop(states: readonly State[], event: DropEvent): StateDrop | null {
  const state = states.find((candidate) => candidate.id === event.id);
  if (state === undefined) return null;
  const own = stateContainerId(state.state_group);
  if (event.toContainer !== own || event.fromContainer !== own) return null;
  if (event.before_id !== undefined) return { state_id: state.id, index: event.index, input: { before_id: event.before_id } };
  if (event.after_id !== undefined) return { state_id: state.id, index: event.index, input: { after_id: event.after_id } };
  return null;
}

// ---------------------------------------------------------------------------
// Labels: the top level and each parent's children are the containers
// ---------------------------------------------------------------------------

export const LABEL_TOP_CONTAINER = "label-top";

export function labelContainerId(parentId: string | null): string {
  return parentId === null ? LABEL_TOP_CONTAINER : `label-children:${parentId}`;
}

/** The parent a container id stands for (null = top level), or undefined for an id that is no label container. */
export function labelParentOfContainer(container: string): string | null | undefined {
  if (container === LABEL_TOP_CONTAINER) return null;
  const prefix = "label-children:";
  return container.startsWith(prefix) ? container.slice(prefix.length) : undefined;
}

const LABEL_ADAPTER: MoveAdapter<Label> = {
  idOf: (item) => item.id,
  containerOf: (item) => labelContainerId(item.parent_id),
  withContainer: (item, container) => ({ ...item, parent_id: labelParentOfContainer(container) ?? null }),
};

/** `labels` with `id` moved into `parentId`'s container at `index` among that container's other labels. */
export function moveLabel(labels: readonly Label[], id: string, parentId: string | null, index: number): Label[] {
  return applyMove(labels, { id, toContainer: labelContainerId(parentId), index }, LABEL_ADAPTER);
}

/**
 * Why `label` cannot be dropped into `parentId`'s container, or null when it
 * can: the engine's one-level rule (a label with children stays top level, a
 * parent must itself be top level, never the label itself).
 */
export function labelDropRefusal(labels: readonly Label[], id: string, parentId: string | null): string | null {
  const dragged = labels.find((label) => label.id === id);
  if (dragged === undefined) return "unknown label";
  if (parentId === null) return null;
  if (parentId === id) return "a label cannot be its own parent";
  const parent = labels.find((label) => label.id === parentId);
  if (parent === undefined) return "unknown parent";
  if (parent.parent_id !== null) return "labels nest one level deep";
  if (dragged.parent_id !== parentId && labels.some((label) => label.parent_id === id)) return "a label with sub-labels stays top level";
  return null;
}

export type LabelDrop = { label_id: string; parent_id: string | null; index: number; before_id?: string; after_id?: string };

/**
 * The `reorder_label` input for a label drop (always carrying `parent_id`, so
 * a drop inside one container and a drop into another are one call), or null
 * when it must snap back. Neighbours are siblings of the target container.
 */
export function labelDrop(labels: readonly Label[], event: DropEvent): LabelDrop | null {
  const parentId = labelParentOfContainer(event.toContainer);
  if (parentId === undefined) return null;
  if (labelDropRefusal(labels, event.id, parentId) !== null) return null;
  const drop: LabelDrop = { label_id: event.id, parent_id: parentId, index: event.index };
  if (event.before_id !== undefined) drop.before_id = event.before_id;
  if (event.after_id !== undefined) drop.after_id = event.after_id;
  return drop;
}

/** Labels of one container in display order. */
export function labelsIn(labels: readonly Label[], parentId: string | null): Label[] {
  return labels.filter((label) => label.parent_id === parentId);
}
