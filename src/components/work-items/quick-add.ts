/**
 * Quick-add rules of the work items screen (docs/contracts/ui.md
 * "Integration (E4)"). Pure and directive-free, so Vitest covers it
 * (tests/ui/quick-add.test.ts) without loading client components.
 *
 * A quick-add row creates an item with its group's value. In a scoped list
 * (a cycle or a module) the item also joins the scope. Closed items cannot
 * join a cycle (`RULE work_item_closed`), so in a cycle scope the groups that
 * pin a completed or cancelled state show no quick-add row (mismatch 33).
 *
 * Items neither join nor leave an archived module (`ARCHIVED`) or a completed
 * (`LOCKED`) or archived (`ARCHIVED`) cycle, so a group of such a module or
 * cycle shows no quick-add row either, and the board takes no drop into or out
 * of its column (`isOpenGroupValue`, `acceptsGroupMove`).
 */
import { PrioritySchema, StateGroupSchema } from "@/lib/tessera/schemas";
import type { CreateWorkItemInputType, GroupBy, State, StateGroup } from "@/lib/tessera/types";
import type { ProjectBundle, QuickAddGroup, ScopeDefaults } from "./types";

/** The modules and cycles items may join or leave; built by `openMemberships` from the project bundle. */
export type OpenMemberships = {
  /** bundle.modules: every module that is not archived. */
  openModuleIds: ReadonlySet<string>;
  /** bundle.cycles without the completed ones (the bundle holds no archived cycle). */
  openCycleIds: ReadonlySet<string>;
};

export type QuickAddContext = OpenMemberships & {
  projectId: string;
  /** bundle.states (state_group, sort_order); the first state per group is the one a state_group group uses. */
  states: readonly State[];
  scopeDefaults?: ScopeDefaults;
};

/** Open module and cycle ids of a project bundle: non-archived modules, non-archived cycles that are not completed. */
export function openMemberships(bundle: Pick<ProjectBundle, "modules" | "cycles">): OpenMemberships {
  return {
    openModuleIds: new Set(bundle.modules.filter((module) => module.archived_at === null).map((module) => module.id)),
    openCycleIds: new Set(bundle.cycles.filter((cycle) => cycle.archived_at === null && cycle.status !== "completed").map((cycle) => cycle.id)),
  };
}

/**
 * Whether items may join or leave the group value `value` of `field`: false
 * for a module group whose module is not open (archived) and a cycle group
 * whose cycle is not open (completed or archived); true for every other field
 * and for the none group (`value` null).
 */
export function isOpenGroupValue(field: GroupBy | null, value: string | null, open: OpenMemberships): boolean {
  if (value === null) return true;
  if (field === "module") return open.openModuleIds.has(value);
  if (field === "cycle") return open.openCycleIds.has(value);
  return true;
}

/**
 * Whether a board move between two group values of `field` may go through:
 * the item leaves `fromValue` and joins `toValue`, so both must be open.
 */
export function acceptsGroupMove(field: GroupBy | null, fromValue: string | null, toValue: string | null, open: OpenMemberships): boolean {
  return isOpenGroupValue(field, fromValue, open) && isOpenGroupValue(field, toValue, open);
}

const CLOSED_GROUPS: ReadonlySet<StateGroup> = new Set<StateGroup>(["completed", "cancelled"]);

function asStateGroup(value: string): StateGroup | null {
  const parsed = StateGroupSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function firstStateOf(group: StateGroup, states: readonly State[]): State | undefined {
  return states.find((state) => state.state_group === group);
}

/** `a` followed by the ids of `b` it lacks; undefined when both are empty or absent. */
function unite(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] | undefined {
  if (!a?.length && !b?.length) return a || b ? [] : undefined;
  const out = [...(a ?? [])];
  for (const id of b ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * Create input for a quick-add row: the group's field carries the group's
 * value, then the scope's memberships apply (`cycle_id` when the group set
 * none, `module_ids` united). Null when the group's value cannot be turned
 * into a field (the caller opens the create dialog instead).
 */
export function quickAddInput(group: QuickAddGroup, name: string, context: QuickAddContext): CreateWorkItemInputType | null {
  const input: CreateWorkItemInputType = { project_id: context.projectId, name, source: "in_app" };
  const { field, value } = group;
  if (field && value !== null) {
    switch (field) {
      case "state":
        input.state_id = value;
        break;
      case "state_group": {
        const stateGroup = asStateGroup(value);
        const first = stateGroup ? firstStateOf(stateGroup, context.states) : undefined;
        if (!first) return null;
        input.state_id = first.id;
        break;
      }
      case "priority": {
        const priority = PrioritySchema.safeParse(value);
        if (!priority.success) return null;
        input.priority = priority.data;
        break;
      }
      case "labels":
        input.label_ids = [value];
        break;
      case "cycle":
        input.cycle_id = value;
        break;
      case "module":
        input.module_ids = [value];
        break;
      case "assignees":
        input.assignee_ids = [value];
        break;
      case "start_date":
        input.start_date = value;
        break;
      case "target_date":
        input.target_date = value;
        break;
      default:
        return null;
    }
  }
  return withScopeDefaults(input, context.scopeDefaults);
}

/** `input` joined to the scope: the scope's cycle unless the input names one, the union of module ids. */
export function withScopeDefaults<T extends ScopeDefaults>(input: T, scopeDefaults: ScopeDefaults | undefined): T {
  if (!scopeDefaults) return input;
  const cycleId = input.cycle_id ?? scopeDefaults.cycle_id;
  const moduleIds = unite(input.module_ids, scopeDefaults.module_ids);
  const next: T = { ...input };
  if (cycleId !== undefined) next.cycle_id = cycleId;
  if (moduleIds !== undefined) next.module_ids = moduleIds;
  return next;
}

/**
 * Whether a group shows its quick-add row. False for a group of a module or
 * cycle that is not open (`isOpenGroupValue`), and in a cycle scope for a
 * group that pins a closed state: field `state` whose state's group is
 * completed or cancelled, or field `state_group` with one of those values.
 */
export function quickAddAllowed(group: QuickAddGroup, context: QuickAddContext): boolean {
  const { field, value } = group;
  if (value === null) return true;
  if (!isOpenGroupValue(field, value, context)) return false;
  if (context.scopeDefaults?.cycle_id === undefined) return true;
  if (field === "state") {
    const state = context.states.find((entry) => entry.id === value);
    return state === undefined || !CLOSED_GROUPS.has(state.state_group);
  }
  if (field === "state_group") {
    const stateGroup = asStateGroup(value);
    return stateGroup === null || !CLOSED_GROUPS.has(stateGroup);
  }
  return true;
}
