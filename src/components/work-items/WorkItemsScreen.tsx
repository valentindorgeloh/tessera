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
 *
 * The same screen lists a cycle's or a module's items (P3, the scoped list in
 * src/app/(tessera)/projects/[projectId]/work-items/scoped-list.tsx): the
 * optional scope props save the display (layout switch and display menu) to
 * that scope's view settings, let new items join the scope (./quick-add.ts),
 * hide grouping by the scope's own field and, for a closed scope, remove every
 * way to create an item. The sub-header's title and count are props too
 * (default "Work items" and the list's total).
 */
import { startTransition, useEffect, useMemo, useOptimistic, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { createWorkItemAction, moveWorkItemAction, updateWorkItemAction } from "@/app/actions/work-items";
import { notePeekPush } from "@/components/detail/peek-history";
import { currentHref, peekHref } from "@/components/detail/peek-url";
import { PanelBar, PanelHeader } from "@/components/shell/PanelHeader";
import { SaveViewButton } from "@/components/views/SaveViewButton";
import { normalizeFilters } from "@/components/views/view-state";
import { isMultiValuedGroup } from "@/lib/tessera/core/group";
import type { CreateWorkItemInputType, Display, Filters, GroupBy, RichFilters, WorkItem, WorkItemListResult } from "@/lib/tessera/types";
import { ExportDialog } from "@/components/exports/ExportDialog";
import { ExportIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { BoardLayout } from "./BoardLayout";
import { CalendarLayout } from "./CalendarLayout";
import { BulkBar } from "./BulkBar";
import { CreateWorkItemDialog } from "./CreateWorkItemDialog";
import { DisplayMenu, LayoutSwitch } from "./DisplayMenu";
import { FilterBar } from "./FilterBar";
import { GanttLayout } from "./GanttLayout";
import { ListLayout } from "./ListLayout";
import { toEngineMove } from "./moves";
import { isOptimisticId, optimisticId } from "./optimistic";
import { realNeighbour, reduceOptimisticList, type OptimisticAction, type StateGroupOf } from "./optimistic-list";
import { firstStateByGroupOf, useProject } from "./project-provider";
import { useBundles } from "./row-project";
import { useSelection } from "./use-selection";
import { createDefaultsFromScope, openMemberships, quickAddAllowed, quickAddInput, withScopeDefaults, type QuickAddContext } from "./quick-add";
import { TableLayout } from "./TableLayout";
import type { LayoutProps, MoveInput, QuickAddGroup, ScopeDefaults, SettingsScope, UpdateWorkItemPatch } from "./types";
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
  /**
   * View settings row the layout switch and the display menu save to; undefined
   * means `{ "project", projectId }`, null means URL only (a saved view's page,
   * decision 32: nothing is saved until "Update view").
   */
  settingsScope?: SettingsScope | null;
  /** Memberships and fields new items start with (a cycle's or a module's list, a view's filters). */
  scopeDefaults?: ScopeDefaults;
  /** Default true; false hides "New work item", the `c` hotkey, `?create=1` and quick-add. */
  canCreate?: boolean;
  /** Group fields the display menu leaves out (the scope's own field); default none. */
  hiddenGroupFields?: readonly GroupBy[];
  /**
   * The sub-header's title, also the name of the header and list landmarks.
   * Default "Work items", in a cycle or module too: the scope's own header
   * above the list already names the cycle or module.
   */
  title?: string;
  /**
   * The count in the purple Badge next to the title. Default (undefined) the
   * list's total after filters, with optimistic quick-adds; `null` hides the
   * Badge (a scope header that shows its own count).
   */
  count?: number | null;
  /** After the count Badge in the sub-header's start (a view's lock icon). */
  titleAdornment?: ReactNode;
  /** Last item of the sub-header's end, after "New work item" (a view's menu). */
  subheaderEnd?: ReactNode;
  /** The filters row's end slot (a view's ViewBar); wins over `saveView`. */
  filtersEnd?: ReactNode;
  /** Show "Save view" in the filters row's end while filters or display are set in the URL (the project list). */
  saveView?: boolean;
  /** Row selection and the bulk bar. Off for a locked view. Default true on the list. */
  allowSelection?: boolean;
  /** Items come from more than one project: group by project, filter by project, and edit each row with that project's states. */
  crossProject?: boolean;
  /** Workspace views are table-only, so the layout switch stays off. */
  showLayoutSwitch?: boolean;
  /** Add the Project column. Workspace views pass this; profile lists group by project instead. */
  showProjectColumn?: boolean;
  /** `page` opens `/work-items/<id>`. A cross-project route has no peek host. */
  openMode?: "peek" | "page";
  /** Effective rich filter tree when it is not only the URL (a saved view). */
  richFilters?: RichFilters | null;
  /** Narrows Export… to a cycle, module or view. Default is this project, or the workspace when crossProject. */
  exportScope?: { project_id: string | null; cycle_id?: string; module_id?: string; view_id?: string };
};

const DEFAULT_TITLE = "Work items";

const NO_HIDDEN_FIELDS: readonly GroupBy[] = [];

export function WorkItemsScreen({
  projectId,
  result,
  display,
  filters,
  createOnOpen: createRequested,
  settingsScope: settingsScopeProp,
  scopeDefaults,
  canCreate = true,
  hiddenGroupFields = NO_HIDDEN_FIELDS,
  title = DEFAULT_TITLE,
  count,
  titleAdornment,
  subheaderEnd,
  filtersEnd,
  saveView = false,
  allowSelection = true,
  crossProject = false,
  showLayoutSwitch = true,
  showProjectColumn = false,
  openMode = "peek",
  richFilters,
  exportScope,
}: WorkItemsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { bundle, statesById, firstStateByGroup } = useProject();
  const bundles = useBundles();
  const urlState = decodeUrlState(searchParams.get("q"));
  const settingsScope: SettingsScope | null = settingsScopeProp === undefined ? { scope_type: "project", scope_id: projectId } : settingsScopeProp;
  // An archived project is read-only: no create, no drag, no inline edit (P3 leftover).
  const readOnly = bundle.project.archived_at !== null;
  const canCreateItems = canCreate && !readOnly;
  // A closed scope (completed or archived cycle, archived module) or an archived project ignores `?create=1`.
  const createOnOpen = canCreateItems && createRequested;
  // Open modules and cycles: groups of an archived module or a completed or archived cycle get no quick-add row.
  const quickAddContext: QuickAddContext = { projectId, states: bundle.states, ...openMemberships(bundle), scopeDefaults };
  const stateGroupOf: StateGroupOf = (stateId) => statesById.get(stateId)?.state_group;

  const [optimistic, applyOptimistic] = useOptimistic(result, (state: WorkItemListResult, action: OptimisticAction) =>
    reduceOptimisticList(state, action, { display, stateGroupOf, firstStateByGroup }),
  );

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<Partial<Omit<CreateWorkItemInputType, "project_id">> | undefined>(undefined);

  // `?create=1` opens the dialog. Reacting to the prop rather than the mount also covers the
  // sidebar's "New work item" while this page is already open (only the search params change
  // then, and Next keeps the component mounted).
  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (createOnOpen && !createRequestSeen) {
    setCreateRequestSeen(true);
    setCreateDefaults(createDefaultsFromScope(scopeDefaults));
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
    setCreateDefaults(createDefaultsFromScope(scopeDefaults));
    setCreateOpen(true);
  };
  useHotkeys([{ keys: "c", onPress: openCreate, isDisabled: isCreateOpen || !canCreateItems }]);

  const fail = (what: string, message: string) => toast({ type: "error", body: `${what}: ${message}` });

  const onUpdate = (id: string, patch: UpdateWorkItemPatch) => {
    if (readOnly || isOptimisticId(id)) return;
    startTransition(async () => {
      applyOptimistic({ type: "update", id, patch });
      const result = await updateWorkItemAction({ work_item_id: id, ...patch });
      if (!result.ok) fail("Could not update the work item", result.message);
    });
  };

  const onMove = (input: MoveInput) => {
    if (readOnly || isOptimisticId(input.id)) return;
    const move: MoveInput = { ...input, before_id: realNeighbour(input.before_id), after_id: realNeighbour(input.after_id) };
    const source = optimistic.items.find((item) => item.id === move.id);
    const rowStates = source ? bundles?.[source.project_id]?.states : undefined;
    const engineMove = toEngineMove(move, rowStates ? firstStateByGroupOf(rowStates) : firstStateByGroup);
    if (!engineMove) return;
    startTransition(async () => {
      applyOptimistic({ type: "move", input: move });
      const result = await moveWorkItemAction({
        work_item_id: engineMove.id,
        group_by: engineMove.group_by ?? undefined,
        value: engineMove.value,
        from_value: engineMove.group_by && isMultiValuedGroup(engineMove.group_by) ? engineMove.from_value : undefined,
        // A two-axis board drop (swimlanes, decision 30): the sub axis rides along, its from_value only for multi-valued fields.
        sub_group_by: engineMove.sub_group_by,
        sub_value: engineMove.sub_value,
        sub_from_value: engineMove.sub_group_by && isMultiValuedGroup(engineMove.sub_group_by) ? engineMove.sub_from_value : undefined,
        before_id: engineMove.before_id,
        after_id: engineMove.after_id,
      });
      if (!result.ok) fail("Could not move the work item", result.message);
    });
  };

  const onQuickAdd = (group: QuickAddGroup, name: string) => {
    if (readOnly) return;
    const input = quickAddInput(group, name, quickAddContext);
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
    if (openMode === "page") {
      router.push(`/work-items/${id}`);
      return;
    }
    // The peek: `?peek=<id>` next to the list, keeping `q` (docs/contracts/ui.md "Routes and modes"). The push is
    // noted so closing the panel can go Back to this entry instead of stacking a copy of the list URL.
    const href = peekHref(pathname, searchParams, id);
    notePeekPush(currentHref(pathname, searchParams), href);
    router.push(href, { scroll: false });
  };

  const orderedIds = useMemo(() => {
    const ids = display.group_by && optimistic.groups ? optimistic.groups.flatMap((group) => group.item_ids) : optimistic.items.map((item) => item.id);
    return ids.filter((id) => !isOptimisticId(id));
  }, [display.group_by, optimistic]);
  const selectionOn = allowSelection && !readOnly && (display.layout === "list" || display.layout === "table");
  const selection = useSelection(orderedIds, selectionOn);
  const layoutProps: LayoutProps = {
    result: optimistic,
    display,
    bundle,
    onMove,
    onUpdate,
    onOpen,
    onQuickAdd: canCreateItems ? onQuickAdd : undefined,
    canQuickAdd: (group) => quickAddAllowed(group, quickAddContext),
    readOnly,
    showProject: showProjectColumn,
    selection: selectionOn ? { selected: selection.selected, onToggle: selection.toggleId, onToggleIds: selection.toggleIds } : undefined,
  };
  // The dialog starts in the scope: `{ ...scopeDefaults, ...createDefaults }` with module ids united.
  const dialogDefaults = scopeDefaults ? withScopeDefaults(createDefaults ?? {}, scopeDefaults) : createDefaults;
  const shownCount = count === undefined ? optimistic.total : count;
  const showSaveView =
    saveView && bundle.project.views_enabled && !readOnly && (Object.keys(normalizeFilters(filters)).length > 0 || urlState.display !== undefined || urlState.rich_filters !== undefined);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <>
      <Layout
        height="fill"
        header={
          <PanelHeader label={title}>
            <PanelBar
              size="subheader"
              canWrap
              start={
                <>
                  <Text weight="medium" maxLines={1}>
                    {title}
                  </Text>
                  {shownCount === null ? null : <Badge variant="purple" label={String(shownCount)} />}
                  {titleAdornment}
                </>
              }
              end={
                <>
                  {showLayoutSwitch ? <LayoutSwitch display={display} urlState={urlState} settingsScope={settingsScope} /> : null}
                  <DisplayMenu display={display} urlState={urlState} settingsScope={settingsScope} hiddenGroupFields={hiddenGroupFields} includeProject={crossProject} />
                  <Button variant="ghost" size="sm" label="Export…" icon={<ExportIcon />} onClick={() => setExportOpen(true)} />
                  {canCreateItems ? <Button variant="primary" size="sm" label="New work item" icon={<PlusIcon />} onClick={openCreate} tooltip="Press c" /> : null}
                  {subheaderEnd}
                </>
              }
            />
            <PanelBar
              size="filters"
              canWrap
              hasDivider
              start={<FilterBar filters={filters} urlState={urlState} resultCount={optimistic.total} showProject={crossProject} richFilters={richFilters} />}
              end={filtersEnd ?? (showSaveView ? <SaveViewButton projectId={projectId} filters={filters} display={display} richFilters={urlState.rich_filters ?? richFilters} /> : undefined)}
            />
          </PanelHeader>
        }
        content={
          <LayoutContent padding={0} isScrollable label={`${title} list`} className="tessera-wi-scroller">
            {display.layout === "list" ? (
              <ListLayout {...layoutProps} />
            ) : display.layout === "board" ? (
              <BoardLayout {...layoutProps} />
            ) : display.layout === "table" ? (
              <TableLayout {...layoutProps} />
            ) : display.layout === "calendar" ? (
              <CalendarLayout {...layoutProps} />
            ) : (
              <GanttLayout {...layoutProps} />
            )}
            {selectionOn && selection.selected.size > 0 ? <BulkBar items={optimistic.items} selected={selection.selected} onClear={selection.clear} /> : null}
          </LayoutContent>
        }
      />
      <CreateWorkItemDialog projectId={projectId} isOpen={isCreateOpen} onOpenChange={setCreateOpen} defaults={dialogDefaults} />
      <ExportDialog
        isOpen={exportOpen}
        onOpenChange={setExportOpen}
        title={title}
        scope={{
          project_id: exportScope?.project_id ?? (crossProject ? null : projectId),
          cycle_id: exportScope?.cycle_id,
          module_id: exportScope?.module_id,
          view_id: exportScope?.view_id,
          filters,
          rich_filters: richFilters === undefined ? (urlState.rich_filters ?? null) : richFilters,
          order_by: display.order_by,
        }}
      />
    </>
  );
}
