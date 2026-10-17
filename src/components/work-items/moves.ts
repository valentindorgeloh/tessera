/**
 * Translation between layout moves and the engine's `move_work_item`
 * vocabulary (docs/contracts/ui.md "LayoutProps.onMove"). Layouts speak in
 * terms of the field they are grouped by; the engine's `applyGroupChange`
 * (src/lib/tessera/work-items.ts) only changes state, priority, cycle, dates,
 * labels, assignees and modules and throws RULE group_not_movable for
 * state_group, created_by, created_at and project. A state_group move is
 * expressed here as a move to the group's first state; the other three are
 * reduced to their reorder part or dropped.
 */
import { isMultiValuedGroup } from "@/lib/tessera/core/group";
import type { GroupBy, State, StateGroup } from "@/lib/tessera/types";
import type { MoveInput } from "./types";

const ENGINE_MOVABLE: ReadonlySet<GroupBy> = new Set<GroupBy>(["state", "priority", "labels", "cycle", "module", "assignees", "start_date", "target_date"]);

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

function isStateGroup(value: string): value is StateGroup {
  return STATE_GROUPS.has(value);
}

/** Whether a layout may offer moving items between the groups of `field` (drag across columns, "Move to"). */
export function isMovableGroup(field: GroupBy | null): field is GroupBy {
  return field !== null && (field === "state_group" || ENGINE_MOVABLE.has(field));
}

/**
 * The move the engine should run for a layout move, or null when nothing
 * remains: a state_group target becomes its first state (an unknown or empty
 * group keeps only the reorder), a field the engine cannot move between keeps
 * only the reorder, and a pure reorder passes through. `from_value` is kept
 * for the caller to trim to multi-valued fields.
 */
export function toEngineMove(input: MoveInput, firstStateByGroup: ReadonlyMap<StateGroup, State>): MoveInput | null {
  const { group_by, value, from_value, sub_group_by, sub_value, sub_from_value, ...placement } = input;
  const hasPlacement = placement.before_id !== undefined || placement.after_id !== undefined;
  const placementOnly = hasPlacement ? placement : null;
  if (!group_by) return placementOnly;
  const axis = engineAxis(group_by, value, from_value, firstStateByGroup);
  if (sub_group_by === undefined) return axis === null ? placementOnly : { ...placement, ...axis };
  // Two axes (swimlanes, decision 30): a field the engine cannot move between on either one refuses the whole
  // move, so the card snaps back and no request goes out.
  const subAxis = engineAxis(sub_group_by, sub_value, sub_from_value, firstStateByGroup);
  if (axis === null || subAxis === null) return null;
  return {
    ...placement,
    ...axis,
    sub_group_by: subAxis.group_by,
    sub_value: subAxis.value,
    ...(subAxis.from_value !== undefined ? { sub_from_value: subAxis.from_value } : {}),
  };
}

type Axis = { group_by: GroupBy; value: string | null | undefined; from_value?: string | null };

/** One axis in the engine's vocabulary: state_group becomes its first state; null for a field the engine cannot move between. */
function engineAxis(field: GroupBy, value: string | null | undefined, fromValue: string | null | undefined, firstStateByGroup: ReadonlyMap<StateGroup, State>): Axis | null {
  if (field === "state_group") {
    const first = typeof value === "string" && isStateGroup(value) ? firstStateByGroup.get(value) : undefined;
    return first ? { group_by: "state", value: first.id } : null;
  }
  if (!ENGINE_MOVABLE.has(field)) return null;
  return { group_by: field, value, from_value: fromValue };
}

/** The `move_work_item` tool input of an engine move (F3.6): the item id, both axes and the neighbours. */
export type MoveToolInput = {
  work_item_id: string;
  group_by?: GroupBy;
  value?: string | null;
  from_value?: string | null;
  sub_group_by?: GroupBy;
  sub_value?: string | null;
  sub_from_value?: string | null;
  before_id?: string;
  after_id?: string;
};

/**
 * `move` (already through `toEngineMove`) as the tool's input. `from_value` and
 * `sub_from_value` go out only for labels, assignees and module, the fields
 * whose other values stay (decision 30); the sub fields only when the drop
 * changed both axes. The server action takes this object as it is.
 */
export function moveToolInput(move: MoveInput): MoveToolInput {
  const { id, group_by, value, from_value, sub_group_by, sub_value, sub_from_value, before_id, after_id } = move;
  const input: MoveToolInput = { work_item_id: id, before_id, after_id };
  if (!group_by) return input;
  input.group_by = group_by;
  input.value = value;
  if (isMultiValuedGroup(group_by)) input.from_value = from_value;
  if (sub_group_by) {
    input.sub_group_by = sub_group_by;
    input.sub_value = sub_value;
    if (isMultiValuedGroup(sub_group_by)) input.sub_from_value = sub_from_value;
  }
  return input;
}
