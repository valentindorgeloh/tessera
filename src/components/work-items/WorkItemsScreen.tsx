"use client";

/**
 * Work items screen (docs/contracts/ui.md "Work items screen"): a pinned
 * header with the sub-header (the view's name and count, the layout switch,
 * the display menu and "New work item") and the filters row, above the layout
 * the display picks, which scrolls on its own.
 * Mutations go through the action wrappers inside transitions with an
 * optimistic copy of the list, so a move or an inline edit shows at once and
 * the server's re-render (the action's `refresh()`) settles it. Layout moves
 * are translated for the engine by ./moves.ts; quick-add placeholders carry
 * ids from ./optimistic.ts and stay inert until the server item arrives.
 */
import { startTransition, useEffect, useOptimistic, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { createWorkItemAction, moveWorkItemAction, updateWorkItemAction } from "@/app/actions/work-items";
import { notePeekPush } from "@/components/detail/peek-history";
import { currentHref, peekHref } from "@/components/detail/peek-url";
import { PanelBar, PanelHeader } from "@/components/shell/PanelHeader";
import { isMultiValuedGroup } from "@/lib/tessera/core/group";
import type { CreateWorkItemInputType, Display, Filters, Group, GroupBy, State, StateGroup, WorkItem, WorkItemListResult } from "@/lib/tessera/types";
import { PlusIcon } from "@/themes/catppuccin/icons";
import { BoardLayout } from "./BoardLayout";
import { CreateWorkItemDialog } from "./CreateWorkItemDialog";
import { DisplayMenu, LayoutSwitch } from "./DisplayMenu";
import { FilterBar } from "./FilterBar";
import { ListLayout } from "./ListLayout";
import { toEngineMove } from "./moves";
import { isOptimisticId, optimisticId } from "./optimistic";
import { useProject } from "./project-provider";
import { isPriority } from "./properties";
import { TableLayout } from "./TableLayout";
import type { MoveInput, QuickAddGroup, UpdateWorkItemPatch } from "./types";
import { decodeUrlState } from "./url-state";

export type WorkItemsScreenProps = {
  projectId: string;
  result: WorkItemListResult;
  /** Effective display and filters (defaults, saved settings and URL merged). */
  display: Display;
  filters: Filters;
  /** Display from the saved view settings alone, for the menu's reset. */
  settingsDisplay: Display;
  /** Open the create dialog (`?create=1`, the sidebar's "New work item"). */
  createOnOpen: boolean;
};

const NONE_GROUP_ID = "none";

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);

function isStateGroup(value: string): value is StateGroup {
  return STATE_GROUPS.has(value);
}

type OptimisticAction =
  | { type: "update"; id: string; patch: UpdateWorkItemPatch }
  | { type: "move"; input: MoveInput }
  | { type: "create"; item: WorkItem; group: QuickAddGroup };

type StateGroupOf = (stateId: string) => string | undefined;

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
 */
function regroupItem(groups: Group[] | undefined, item: WorkItem, display: Display, stateGroupOf: StateGroupOf): Group[] | undefined {
  if (!groups || !display.group_by) return groups;
  const values = groupValues(display.group_by, item, stateGroupOf);
  if (values === undefined) return groups;
  const subValues = display.sub_group_by ? groupValues(display.sub_group_by, item, stateGroupOf) : undefined;
  const targets = targetsOf(values);
  return groups.map((group) => {
    const member = targets.includes(group.id);
    const item_ids = placeIn(group.item_ids, item.id, member);
    const sub_groups =
      group.sub_groups && subValues !== undefined
        ? group.sub_groups.map((sub) => {
            const ids = placeIn(sub.item_ids, item.id, member && targetsOf(subValues).includes(sub.id));
            return { ...sub, item_ids: ids, count: ids.length };
          })
        : group.sub_groups;
    return { ...group, item_ids, count: item_ids.length, sub_groups };
  });
}

function reorder(ids: string[], id: string, before_id?: string, after_id?: string): string[] {
  if (!before_id && !after_id) return ids;
  const rest = ids.filter((value) => value !== id);
  const anchor = before_id ?? after_id;
  const index = anchor ? rest.indexOf(anchor) : -1;
  if (index < 0) return ids;
  rest.splice(before_id ? index : index + 1, 0, id);
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
      const current = next[key].filter((entry) => entry !== fromValue);
      next[key] = value && !current.includes(value) ? [...current, value] : current;
      break;
    }
    default:
      break;
  }
  return next;
}

/** A neighbour id the engine can resolve; a quick-add placeholder next to the drop is no neighbour yet. */
function realNeighbour(id: string | undefined): string | undefined {
  return id !== undefined && !isOptimisticId(id) ? id : undefined;
}

export function WorkItemsScreen({ projectId, result, display, filters, createOnOpen }: WorkItemsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { bundle, statesById, firstStateByGroup } = useProject();
  const urlState = decodeUrlState(searchParams.get("q"));
  const stateGroupOf: StateGroupOf = (stateId) => statesById.get(stateId)?.state_group;

  const [optimistic, applyOptimistic] = useOptimistic(result, (state: WorkItemListResult, action: OptimisticAction): WorkItemListResult => {
    switch (action.type) {
      case "update": {
        const patch = stripUndefined(action.patch);
        const items = state.items.map((item) => (item.id === action.id ? { ...item, ...patch } : item));
        const item = items.find((candidate) => candidate.id === action.id);
        const groups = item ? regroupItem(state.groups, item, display, stateGroupOf) : state.groups;
        return { ...state, items, groups };
      }
      case "move": {
        const { id, group_by, value, from_value, before_id, after_id } = action.input;
        let moved: WorkItem | undefined;
        const items = state.items.map((item) => {
          if (item.id !== id) return item;
          moved = group_by ? applyGroupValue(item, group_by, value, from_value, firstStateByGroup) : item;
          return moved;
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
        let groups = group_by ? regroupItem(state.groups, moved, display, stateGroupOf) : state.groups;
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
        const groups = regroupItem(state.groups, action.item, display, stateGroupOf);
        return { ...state, items, total: state.total + 1, groups };
      }
    }
  });

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<Partial<Omit<CreateWorkItemInputType, "project_id">> | undefined>(undefined);

  // `?create=1` opens the dialog. Reacting to the prop rather than the mount also covers the
  // sidebar's "New work item" while this page is already open (only the search params change
  // then, and Next keeps the component mounted).
  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (createOnOpen && !createRequestSeen) {
    setCreateRequestSeen(true);
    setCreateDefaults(undefined);
    setCreateOpen(true);
  } else if (!createOnOpen && createRequestSeen) {
    setCreateRequestSeen(false);
  }

  useEffect(() => {
    if (!createOnOpen) return;
    // Drop the param so a reload does not reopen the dialog.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the flag only; pathname and params are read when it flips
  }, [createOnOpen]);

  const openCreate = () => {
    setCreateDefaults(undefined);
    setCreateOpen(true);
  };
  useHotkeys([{ keys: "c", onPress: openCreate, isDisabled: isCreateOpen }]);

  const fail = (what: string, message: string) => toast({ type: "error", body: `${what}: ${message}` });

  const onUpdate = (id: string, patch: UpdateWorkItemPatch) => {
    if (isOptimisticId(id)) return;
    startTransition(async () => {
      applyOptimistic({ type: "update", id, patch });
      const result = await updateWorkItemAction({ work_item_id: id, ...patch });
      if (!result.ok) fail("Could not update the work item", result.message);
    });
  };

  const onMove = (input: MoveInput) => {
    if (isOptimisticId(input.id)) return;
    const move: MoveInput = { ...input, before_id: realNeighbour(input.before_id), after_id: realNeighbour(input.after_id) };
    const engineMove = toEngineMove(move, firstStateByGroup);
    if (!engineMove) return;
    startTransition(async () => {
      applyOptimistic({ type: "move", input: move });
      const result = await moveWorkItemAction({
        work_item_id: engineMove.id,
        group_by: engineMove.group_by ?? undefined,
        value: engineMove.value,
        from_value: engineMove.group_by && isMultiValuedGroup(engineMove.group_by) ? engineMove.from_value : undefined,
        before_id: engineMove.before_id,
        after_id: engineMove.after_id,
      });
      if (!result.ok) fail("Could not move the work item", result.message);
    });
  };

  /** Create input for a quick-add row: the group's field carries the group's value. */
  const quickAddInput = (group: QuickAddGroup, name: string): CreateWorkItemInputType | null => {
    const input: CreateWorkItemInputType = { project_id: projectId, name, source: "in_app" };
    const { field, value } = group;
    if (!field || value === null) return input;
    switch (field) {
      case "state":
        input.state_id = value;
        break;
      case "state_group": {
        const first = isStateGroup(value) ? firstStateByGroup.get(value) : undefined;
        if (!first) return null;
        input.state_id = first.id;
        break;
      }
      case "priority":
        if (!isPriority(value)) return null;
        input.priority = value;
        break;
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
    return input;
  };

  const onQuickAdd = (group: QuickAddGroup, name: string) => {
    const input = quickAddInput(group, name);
    if (!input) {
      setCreateDefaults({ name });
      setCreateOpen(true);
      return;
    }
    const defaultState = bundle.states.find((state) => state.is_default) ?? bundle.states[0];
    const stateId = input.state_id ?? defaultState?.id ?? "";
    const now = new Date().toISOString();
    const placeholder: WorkItem = {
      id: optimisticId(),
      project_id: projectId,
      sequence_id: 0,
      name,
      description_md: "",
      description_version: 0,
      state_id: stateId,
      priority: input.priority ?? "none",
      parent_id: null,
      cycle_id: input.cycle_id ?? null,
      estimate_point_id: null,
      start_date: input.start_date ?? null,
      target_date: input.target_date ?? null,
      completed_at: null,
      archived_at: null,
      is_draft: false,
      sort_order: "",
      external_source: null,
      external_id: null,
      created_by: bundle.actors[0]?.id ?? "",
      updated_by: bundle.actors[0]?.id ?? "",
      created_at: now,
      updated_at: now,
      deleted_at: null,
      key: `${bundle.project.identifier}-…`,
      label_ids: input.label_ids ?? [],
      module_ids: input.module_ids ?? [],
      assignee_ids: input.assignee_ids ?? [],
      sub_items_count: 0,
      links_count: 0,
      intake: null,
    };
    startTransition(async () => {
      applyOptimistic({ type: "create", item: placeholder, group });
      const result = await createWorkItemAction(input);
      if (!result.ok) fail("Could not create the work item", result.message);
    });
  };

  const onOpen = (id: string) => {
    if (isOptimisticId(id)) return;
    // The peek: `?peek=<id>` next to the list, keeping `q` (docs/contracts/ui.md "Routes and modes"). The push is
    // noted so closing the panel can go Back to this entry instead of stacking a copy of the list URL.
    const href = peekHref(pathname, searchParams, id);
    notePeekPush(currentHref(pathname, searchParams), href);
    router.push(href, { scroll: false });
  };

  const layoutProps = { result: optimistic, display, bundle, onMove, onUpdate, onOpen, onQuickAdd };

  return (
    <>
      <Layout
        height="fill"
        header={
          <PanelHeader label="Work items">
            <PanelBar
              size="subheader"
              canWrap
              start={
                <>
                  <Text weight="medium" maxLines={1}>
                    Work items
                  </Text>
                  <Badge variant="purple" label={String(optimistic.total)} />
                </>
              }
              end={
                <>
                  <LayoutSwitch projectId={projectId} display={display} urlState={urlState} />
                  <DisplayMenu projectId={projectId} display={display} urlState={urlState} />
                  <Button variant="primary" size="sm" label="New work item" icon={<PlusIcon />} onClick={openCreate} tooltip="Press c" />
                </>
              }
            />
            <PanelBar size="filters" hasDivider start={<FilterBar filters={filters} urlState={urlState} resultCount={optimistic.total} />} />
          </PanelHeader>
        }
        content={
          <LayoutContent padding={0} isScrollable label="Work items list" className="tessera-wi-scroller">
            {display.layout === "list" ? (
              <ListLayout {...layoutProps} />
            ) : display.layout === "board" ? (
              <BoardLayout {...layoutProps} />
            ) : display.layout === "table" ? (
              <TableLayout {...layoutProps} />
            ) : (
              <EmptyState title={display.layout === "calendar" ? "Calendar arrives in P10" : "Gantt arrives in P10"} description="Switch back to list, board or table with the layout switch." />
            )}
          </LayoutContent>
        }
      />
      <CreateWorkItemDialog projectId={projectId} isOpen={isCreateOpen} onOpenChange={setCreateOpen} defaults={createDefaults} />
    </>
  );
}
