import type { Display, Group, GroupBy, State, StateGroup, WorkItem, WorkItemListResult } from "@/lib/tessera/types";
import { isOptimisticId } from "./optimistic";
import { isPriority } from "./properties";
import type { MoveInput, QuickAddGroup, UpdateWorkItemPatch } from "./types";

// Pure helpers of the optimistic list, moved out of WorkItemsScreen.tsx.
const NONE_GROUP_ID = "none";

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

function isStateGroup(value: string): value is StateGroup {
  return STATE_GROUPS.has(value);
}

export type OptimisticAction =
  | { type: "update"; id: string; patch: UpdateWorkItemPatch }
  | { type: "move"; input: MoveInput }
  | { type: "create"; item: WorkItem; group: QuickAddGroup };

export type StateGroupOf = (stateId: string) => string | undefined;

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The item's value(s) for a grouped field, or undefined for fields the client cannot derive (created_by, dates, project). */
function groupValues(field: GroupBy, item: WorkItem, stateGroupOf: StateGroupOf): string[] | undefined {
  switch (field) {
    case "state":
      return [item.state_id];
    case "state_group": {
      const group = stateGroupOf(item.state_id);
      return group ? [group] : undefined;
    }
    case "priority":
      return [item.priority];
    case "labels":
      return item.label_ids;
    case "cycle":
      return item.cycle_id ? [item.cycle_id] : [];
    case "module":
      return item.module_ids;
    case "assignees":
      return item.assignee_ids;
    default:
      return undefined;
  }
}

/** Group ids `values` name; the none group when there are none. */
function targetsOf(values: string[]): string[] {
  return values.length > 0 ? values : [NONE_GROUP_ID];
}

/** `ids` with `id` present (appended when new) or absent, keeping the position of an id that stays. */
function placeIn(ids: string[], id: string, member: boolean): string[] {
  const has = ids.includes(id);
  if (member) return has ? ids : [...ids, id];
  return has ? ids.filter((entry) => entry !== id) : ids;
}

/**
 * Puts `item` into the groups and sub-groups its values name, following the
 * display's own grouping rather than the field a move changed, so a lane move
 * on a board grouped by state keeps the card in its column. Ids the groups do
 * not know stay unassigned until the server re-renders; a grouping the client
 * cannot derive leaves the groups alone.
 *
 * On a paged list a group holds only its first rows (decision 114): the item
 * joins the end of a group's loaded ids, and the counts move by one between
 * groups according to the item's values before (`before`, absent for a new
 * item) and after the change, never by the loaded length. The server result
 * after `refresh()` replaces all of it.
 */
function regroupItem(groups: Group[] | undefined, before: WorkItem | undefined, item: WorkItem, display: Display, stateGroupOf: StateGroupOf): Group[] | undefined {
  if (!groups || !display.group_by) return groups;
  const values = groupValues(display.group_by, item, stateGroupOf);
  if (values === undefined) return groups;
  const subValues = display.sub_group_by ? groupValues(display.sub_group_by, item, stateGroupOf) : undefined;
  const targets = targetsOf(values);
  const wasValues = before ? groupValues(display.group_by, before, stateGroupOf) : undefined;
  const wasTargets = wasValues ? targetsOf(wasValues) : [];
  const wasSubTargets = before && display.sub_group_by ? groupValues(display.sub_group_by, before, stateGroupOf) : undefined;
  return groups.map((group) => {
    const member = targets.includes(group.id);
    const wasMember = wasTargets.includes(group.id);
    const item_ids = placeIn(group.item_ids, item.id, member);
    const sub_groups =
      group.sub_groups && subValues !== undefined
        ? group.sub_groups.map((sub) => {
            const subMember = member && targetsOf(subValues).includes(sub.id);
            const wasSub = wasMember && wasSubTargets !== undefined && targetsOf(wasSubTargets).includes(sub.id);
            const ids = placeIn(sub.item_ids, item.id, subMember);
            return { ...sub, item_ids: ids, count: Math.max(0, sub.count + Number(subMember) - Number(wasSub)) };
          })
        : group.sub_groups;
    return { ...group, item_ids, count: Math.max(0, group.count + Number(member) - Number(wasMember)), sub_groups };
  });
}

function reorder(ids: string[], id: string, before_id?: string, after_id?: string): string[] {
  if (!before_id && !after_id) return ids;
  const rest = ids.filter((value) => value !== id);
  const anchor = before_id ?? after_id;
  const index = anchor ? rest.indexOf(anchor) : -1;
  if (index < 0) return ids;
  // `before_id` is the neighbour that sits directly before the dropped item, `after_id` the one directly after it.
  rest.splice(before_id ? index + 1 : index, 0, id);
  return rest;
}

/** The item after a layout move changed its grouped field; fields the client cannot derive leave it unchanged. */
function applyGroupValue(item: WorkItem, field: GroupBy, value: string | null | undefined, fromValue: string | null | undefined, firstStateByGroup: ReadonlyMap<StateGroup, State>): WorkItem {
  const next = { ...item };
  switch (field) {
    case "state":
      if (value) next.state_id = value;
      break;
    case "state_group": {
      const first = value && isStateGroup(value) ? firstStateByGroup.get(value) : undefined;
      if (first) next.state_id = first.id;
      break;
    }
    case "priority":
      if (value && isPriority(value)) next.priority = value;
      break;
    case "cycle":
      next.cycle_id = value ?? null;
      break;
    case "start_date":
      next.start_date = value ?? null;
      break;
    case "target_date":
      next.target_date = value ?? null;
      break;
    case "labels":
    case "assignees":
    case "module": {
      const key = field === "labels" ? "label_ids" : field === "assignees" ? "assignee_ids" : "module_ids";
      // A drop on the None group empties the field (decision 30); any other drop swaps `fromValue` for `value`.
      if (!value || value === NONE_GROUP_ID) {
        next[key] = [];
        break;
      }
      const current = next[key].filter((entry) => entry !== fromValue);
      next[key] = !current.includes(value) ? [...current, value] : current;
      break;
    }
    default:
      break;
  }
  return next;
}

/** A neighbour id the engine can resolve; a quick-add placeholder next to the drop is no neighbour yet. */
export function realNeighbour(id: string | undefined): string | undefined {
  return id !== undefined && !isOptimisticId(id) ? id : undefined;
}

/** The optimistic copy of the list after `action`: the body of the screen's `useOptimistic` reducer. */
export function reduceOptimisticList(
  state: WorkItemListResult,
  action: OptimisticAction,
  deps: { display: Display; stateGroupOf: (stateId: string) => string | undefined; firstStateByGroup: ReadonlyMap<StateGroup, State> },
): WorkItemListResult {
  const { display, stateGroupOf, firstStateByGroup } = deps;
  switch (action.type) {
    case "update": {
      const patch = stripUndefined(action.patch);
      const before = state.items.find((candidate) => candidate.id === action.id);
      const items = state.items.map((item) => (item.id === action.id ? { ...item, ...patch } : item));
      const item = items.find((candidate) => candidate.id === action.id);
      const groups = item && before ? regroupItem(state.groups, before, item, display, stateGroupOf) : state.groups;
      return { ...state, items, groups };
    }
    case "move": {
      const { id, group_by, value, from_value, before_id, after_id, sub_group_by, sub_value, sub_from_value } = action.input;
      let moved: WorkItem | undefined;
      const before = state.items.find((candidate) => candidate.id === id);
      const items = state.items.map((item) => {
        if (item.id !== id) return item;
        let next = group_by ? applyGroupValue(item, group_by, value, from_value, firstStateByGroup) : item;
        // The sub axis of a two-axis board drop (decision 30).
        if (sub_group_by) next = applyGroupValue(next, sub_group_by, sub_value, sub_from_value, firstStateByGroup);
        moved = next;
        return next;
      });
      if (!moved) return state;
      const orderedIds = reorder(
        items.map((item) => item.id),
        id,
        before_id,
        after_id,
      );
      const byId = new Map(items.map((item) => [item.id, item]));
      const ordered = orderedIds.flatMap((entry) => {
        const item = byId.get(entry);
        return item ? [item] : [];
      });
      let groups = group_by || sub_group_by ? regroupItem(state.groups, before, moved, display, stateGroupOf) : state.groups;
      if (groups && (before_id || after_id)) {
        groups = groups.map((group) => ({
          ...group,
          item_ids: reorder(group.item_ids, id, before_id, after_id),
          sub_groups: group.sub_groups?.map((sub) => ({ ...sub, item_ids: reorder(sub.item_ids, id, before_id, after_id) })),
        }));
      }
      return { ...state, items: ordered, groups };
    }
    case "create": {
      const items = [...state.items, action.item];
      const groups = regroupItem(state.groups, undefined, action.item, display, stateGroupOf);
      return { ...state, items, total: state.total + 1, groups };
    }
  }
}
