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
  const { group_by, value, from_value, ...placement } = input;
  const hasPlacement = placement.before_id !== undefined || placement.after_id !== undefined;
  const placementOnly = hasPlacement ? placement : null;
  if (!group_by) return placementOnly;
  if (group_by === "state_group") {
    const first = typeof value === "string" && isStateGroup(value) ? firstStateByGroup.get(value) : undefined;
    return first ? { ...placement, group_by: "state", value: first.id } : placementOnly;
  }
  if (!ENGINE_MOVABLE.has(group_by)) return placementOnly;
  return { ...placement, group_by, value, from_value };
}
