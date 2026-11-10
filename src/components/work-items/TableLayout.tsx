"use client";

/**
 * Table layout (docs/contracts/ui.md "Work items screen"): an Astryx Table
 * with the key column pinned, one column per property enabled in
 * `display.properties`, sorting by header click (sets `display.order_by`, so
 * the server orders the whole filtered list; state and project have no
 * engine order and are not sortable), collapsible group sections when
 * `display.group_by` is set, resizable columns and inline edits through the ghost property
 * controls of ./properties. The key cell is the row's accessible open control
 * (a ghost button, as in the list layout) and is always present; a click on
 * the rest of the row opens the item as a pointer convenience, while clicks
 * inside an editable cell stay in the cell.
 *
 * Labels, assignees and modules are shown read-only: `onUpdate` carries the
 * update_work_item patch, which has no set-style fields for them. Quick-add
 * placeholders (./optimistic.ts) render as inert rows until the server item
 * replaces them.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { HStack } from "@astryxdesign/core/Stack";
import {
  Table,
  pixel,
  proportional,
  useTableColumnResize,
  useTableGroupedRows,
  useTableSelection,
  useTableSortable,
  useTableStickyColumns,
  type TableColumn,
  type TablePlugin,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { groupLimitKey } from "@/lib/tessera/core/group";
import type { DisplayProperties, Group, GroupBy, StateGroup, WorkItem } from "@/lib/tessera/types";
import { GroupFooter, GroupPoints } from "./GroupFooter";
import { isOptimisticId } from "./optimistic";
import { UNGROUPED_KEY, hasUnloaded, loadedOfTotal } from "./paging";
import { usePeekedId } from "./peeked";
import { NoResults } from "./NoResults";
import { OneLineText } from "./OneLineText";
import { useProjectRow, type RowBundle } from "./project-provider";
import { RowProject } from "./row-project";
import { useShared } from "./stable";
import { TABLE_SORT_FIELDS, orderByFromSort, sortFromOrderBy } from "./table-sort";
import { ActorLabel, AssigneeControl, CycleControl, DateControl, EstimateControl, LabelControl, ModuleControl, PriorityControl, PriorityLabel, StateControl, StateLabel, isPriority, paletteTokenColor } from "./properties";
import { ArmedCell, createArmedRows, tableRowArmingHandlers, type ArmedRows } from "./properties/arming";
import type { LayoutProps, UpdateWorkItemPatch } from "./types";

/** One table row; a grouped result repeats an item under every group it belongs to, so the row id carries the group. */
interface TableRow extends Record<string, unknown> {
  id: string;
  item: WorkItem;
  groupKey: string;
}

/** Group headers injected by the grouped-rows plugin read every unknown field as "" (never an object). */
function isDataRow(row: TableRow): boolean {
  return typeof row.item === "object" && row.item !== null;
}

type ColumnKey = "key" | "name" | "project" | "state" | "priority" | "assignees" | "labels" | "cycle" | "modules" | "estimate" | "start_date" | "target_date" | "created_at" | "updated_at";

/** Columns whose cells hold a control; clicks inside them do not open the row. */
const EDITABLE: ReadonlySet<string> = new Set<ColumnKey>(["state", "priority", "assignees", "labels", "cycle", "modules", "estimate", "start_date", "target_date"]);

/** Id of the selection plugin's column (`__xds_selection` in the DOM); its cell stops clicks like an editable one. */
const SELECTION_KEY = "__xds_selection";

/** The Name column grows with the table but never below Plane's first-column floor of 240px (reference section 8). */
const NAME_COLUMN_WIDTH = proportional(2, { minWidth: 240 });
/** The key (and selection) columns stay pinned from tablet width up; on a phone the whole row scrolls. */
const PIN_COLUMNS_QUERY = "(min-width: 768px)";

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);
/** Id of the synthetic "no value" group (`NONE_GROUP_ID` in the engine's filters.ts). */
const NONE_GROUP = "none";

/** The project names of the Project column: `null` while the table has no such column. */
type ProjectNames = readonly { id: string; name: string }[] | null;

function buildColumns(
  properties: DisplayProperties,
  projects: ProjectNames,
  hasEstimate: boolean,
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void,
  onOpen: (id: string) => void,
  readOnly: boolean,
  armedRows: ArmedRows,
): TableColumn<TableRow>[] {
  const columns: TableColumn<TableRow>[] = [];
  const pending = (row: TableRow) => isOptimisticId(row.item.id);
  // An archived project passes `readOnly` to every property control (F3.4); a placeholder row is always locked.
  const locked = (row: TableRow) => pending(row) || readOnly;
  // The key column stays even when the key property is off: it is the row's keyboard-reachable open control.
  columns.push({
    key: "key",
    header: "Key",
    width: pixel(104),
    renderCell: (row) =>
      pending(row) ? (
        <Text type="supporting" color="secondary">
          Saving…
        </Text>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="tessera-table-open"
          data-focus-key="open"
          label={row.item.key}
          tooltip={properties.key ? undefined : row.item.key}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.item.id);
          }}
        />
      ),
  });
  columns.push({
    key: "name",
    header: "Name",
    width: NAME_COLUMN_WIDTH,
    renderCell: (row) => (
      <OneLineText className="tessera-wi-cell-text" weight="medium">
        {row.item.name}
      </OneLineText>
    ),
  });
  if (projects !== null) {
    const projectName = new Map(projects.map((project) => [project.id, project.name]));
    columns.push({
      key: "project",
      header: "Project",
      width: pixel(160),
        renderCell: (row) => (
        <OneLineText className="tessera-wi-cell-text">{projectName.get(row.item.project_id) ?? ""}</OneLineText>
      ),
    });
  }
  if (properties.state) {
    columns.push({
      key: "state",
      header: "State",
      width: pixel(176),
        renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <ArmedCell store={armedRows} rowId={row.id}>
            <StateControl armKey="state" compact readOnly={locked(row)} value={row.item.state_id} onChange={(stateId) => onUpdate(row.item.id, { state_id: stateId })} />
          </ArmedCell>
        </RowProject>
      ),
    });
  }
  if (properties.priority) {
    columns.push({
      key: "priority",
      header: "Priority",
      width: pixel(148),
        renderCell: (row) => (
        <ArmedCell store={armedRows} rowId={row.id}>
          <PriorityControl armKey="priority" compact readOnly={locked(row)} value={row.item.priority} onChange={(priority) => onUpdate(row.item.id, { priority })} />
        </ArmedCell>
      ),
    });
  }
  if (properties.assignees) {
    columns.push({
      key: "assignees",
      header: "Assignees",
      width: pixel(184),
      renderCell: (row) => <AssigneeControl compact readOnly value={row.item.assignee_ids} onChange={() => undefined} />,
    });
  }
  if (properties.labels) {
    columns.push({
      key: "labels",
      header: "Labels",
      width: pixel(200),
      renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <LabelControl compact readOnly value={row.item.label_ids} onChange={() => undefined} />
        </RowProject>
      ),
    });
  }
  if (properties.cycle) {
    columns.push({
      key: "cycle",
      header: "Cycle",
      width: pixel(168),
      renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <ArmedCell store={armedRows} rowId={row.id}>
            <CycleControl armKey="cycle" compact readOnly={locked(row)} value={row.item.cycle_id} onChange={(cycleId) => onUpdate(row.item.id, { cycle_id: cycleId })} />
          </ArmedCell>
        </RowProject>
      ),
    });
  }
  if (properties.modules) {
    columns.push({
      key: "modules",
      header: "Modules",
      width: pixel(184),
      renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <ModuleControl compact readOnly value={row.item.module_ids} onChange={() => undefined} />
        </RowProject>
      ),
    });
  }
  if (properties.start_date) {
    columns.push({
      key: "start_date",
      header: "Start date",
      width: pixel(156),
        renderCell: (row) => (
        <ArmedCell store={armedRows} rowId={row.id}>
          <DateControl armKey="start" compact readOnly={locked(row)} label="Start date" value={row.item.start_date} max={row.item.target_date} onChange={(date) => onUpdate(row.item.id, { start_date: date })} />
        </ArmedCell>
      ),
    });
  }
  if (properties.target_date) {
    columns.push({
      key: "target_date",
      header: "Target date",
      width: pixel(156),
        renderCell: (row) => (
        <ArmedCell store={armedRows} rowId={row.id}>
          <DateControl armKey="target" compact readOnly={locked(row)} label="Target date" value={row.item.target_date} min={row.item.start_date} onChange={(date) => onUpdate(row.item.id, { target_date: date })} />
        </ArmedCell>
      ),
    });
  }
  if (properties.estimate && hasEstimate) {
    columns.push({
      key: "estimate",
      header: "Estimate",
      width: pixel(140),
        renderCell: (row) => (
        <ArmedCell store={armedRows} rowId={row.id}>
          <EstimateControl armKey="estimate" value={row.item.estimate_point_id} readOnly={locked(row)} size="sm" onChange={(estimate_point_id) => onUpdate(row.item.id, { estimate_point_id })} />
        </ArmedCell>
      ),
    });
  }
  if (properties.created_at) {
    columns.push({
      key: "created_at",
      header: "Created",
      width: pixel(128),
        renderCell: (row) => (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {row.item.created_at.slice(0, 10)}
        </Text>
      ),
    });
  }
  if (properties.updated_at) {
    columns.push({
      key: "updated_at",
      header: "Updated",
      width: pixel(128),
        renderCell: (row) => (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {row.item.updated_at.slice(0, 10)}
        </Text>
      ),
    });
  }
  return columns;
}

/** Work item ids the table can select, once each when a grouped result repeats a row. */
function selectableIds(rows: readonly TableRow[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isDataRow(row) || isOptimisticId(row.item.id) || seen.has(row.item.id)) continue;
    seen.add(row.item.id);
    ids.push(row.item.id);
  }
  return ids;
}

/** Group section title: StatusDot for states, the priority glyph, a coloured Token for labels, cycles and modules. */
function GroupHeading({ group, field, bundle }: { group: Group | undefined; field: GroupBy | null; bundle: Pick<RowBundle, "states" | "actors"> }) {
  if (!group) return <Text weight="semibold">Ungrouped</Text>;
  if (group.id === NONE_GROUP && field !== "priority") {
    return (
      <Text weight="semibold" color="secondary">
        {group.name}
      </Text>
    );
  }
  if (field === "assignees" || field === "created_by") return <ActorLabel name={group.name} actor={bundle.actors.find((actor) => actor.id === group.id) ?? null} />;
  if (field === "state") {
    const state = bundle.states.find((candidate) => candidate.id === group.id);
    if (state) return <StateLabel state={state} />;
  }
  if (field === "state_group" && STATE_GROUPS.has(group.id)) return <StateLabel group={group.id as StateGroup} name={group.name} />;
  if (field === "priority" && isPriority(group.id)) return <PriorityLabel value={group.id} />;
  if (group.color !== null) return <Token label={group.name} size="md" color={paletteTokenColor(group.color)} />;
  return <Text weight="semibold">{group.name}</Text>;
}

export function TableLayout({ result, display, bundle, onUpdate, onOpen, readOnly = false, showProject = false, selection, onLoadMore, onLoadMoreUngrouped, isLoadingMore, onOrderChange, onClearFilters }: LayoutProps) {
  const peekedId = usePeekedId();
  // The lean row bundle keeps its identity across writes that change no state or actor, so the group headers (and with
  // them the grouped-rows plugin every row compares) are not rebuilt by a counter ticking.
  const { bundle: rowBundle } = useProjectRow();
  // Property controls draw as chips until the pointer or focus reaches their row (./properties/arming.tsx).
  const [armedRows] = useState(createArmedRows);
  const groups = useMemo(() => result.groups ?? [], [result.groups]);
  const grouped = display.group_by !== null && groups.length > 0;

  const rows = useMemo<TableRow[]>(() => {
    const byId = new Map(result.items.map((item) => [item.id, item]));
    if (!grouped) return result.items.map((item) => ({ id: item.id, item, groupKey: "" }));
    return groups.flatMap((group) =>
      group.item_ids
        .map((id) => byId.get(id))
        .filter((item): item is WorkItem => item !== undefined)
        .map((item) => ({ id: `${group.id}:${item.id}`, item, groupKey: group.id })),
    );
  }, [grouped, groups, result.items]);

  const groupOrder = useMemo(() => groups.map((group) => group.id), [groups]);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  // Every write hands the screen a new `bundle` (the cursor, the counts), and a new `columns` array re-renders every row
  // (Astryx's row memo compares it), so the columns are built from the few things they read, each kept by value:
  // the Project column's names, whether the Estimate column shows, and the display's properties.
  const projectNames = useShared<ProjectNames>(showProject ? bundle.projects.map(({ id, name }) => ({ id, name })) : null);
  const hasEstimate = bundle.project.estimates_enabled && bundle.estimate !== null;
  const isSortable = onOrderChange !== undefined;
  const columns = useMemo(() => {
    const built = buildColumns(display.properties, projectNames, hasEstimate, onUpdate, onOpen, readOnly, armedRows);
    return isSortable ? built.map((column) => (column.key in TABLE_SORT_FIELDS ? { ...column, sortable: true } : column)) : built;
  }, [armedRows, display.properties, hasEstimate, isSortable, onOpen, onUpdate, projectNames, readOnly]);

  // The order lives in the display: a header click asks the server for it (whole list), the rows arrive already ordered.
  const sort = useMemo(() => sortFromOrderBy(display.order_by), [display.order_by]);
  const sortPlugin = useTableSortable<TableRow>({ sort, onSortChange: (next) => onOrderChange?.(orderByFromSort(next)), allowUnsortedState: true });
  const selectable = useMemo(() => selectableIds(rows), [rows]);
  const selectionPlugin = useTableSelection<TableRow>({
    getIsItemSelected: (row) => isDataRow(row) && (selection?.selected.has(row.item.id) ?? false),
    onSelectItem: ({ item, isSelected }) => {
      if (!selection || !isDataRow(item) || selection.selected.has(item.item.id) === isSelected) return;
      selection.onToggle(item.item.id, false);
    },
    onSelectAll: ({ isAllSelected }) => selection?.onToggleIds(selectable, isAllSelected),
    getIsAllSelected: () => selectable.length > 0 && selectable.every((id) => selection?.selected.has(id) ?? false),
    getIsIndeterminate: () => {
      const count = selectable.filter((id) => selection?.selected.has(id)).length;
      return count > 0 && count < selectable.length;
    },
    getIsItemSelectable: (row) => selection !== undefined && isDataRow(row) && !isOptimisticId(row.item.id),
    getRowLabel: (row) => (isDataRow(row) ? row.item.key : "row"),
    hasRowHighlight: true,
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const onToggleGroup = useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const renderGroupHeader = useCallback(
    (groupKey: string, loadedCount: number): ReactNode => {
      const group = groupsById.get(groupKey);
      return (
        <HStack gap={2} vAlign="center">
          <GroupHeading group={group} field={display.group_by} bundle={rowBundle} />
          {/* The badge is the group's full count (decision 113); the rows under it may be only the first page. */}
          <Badge label={group?.count ?? loadedCount} variant="neutral" />
          <GroupPoints points={group?.estimate_points} display={display} />
          {group?.has_more && onLoadMore ? (
            <GroupFooter
              display={display}
              variant="inline"
              loaded={group.item_ids.length}
              total={group.count}
              isLoading={isLoadingMore?.(groupLimitKey(group.id))}
              onLoadMore={() => onLoadMore(group.id)}
            />
          ) : null}
        </HStack>
      );
    },
    [rowBundle, display, groupsById, isLoadingMore, onLoadMore],
  );
  const groupedRows = useTableGroupedRows<TableRow>({
    data: rows,
    groupBy: (row) => row.groupKey,
    collapsedGroups: collapsed,
    onToggleGroup,
    renderGroupHeader,
    getRowKey: (row) => row.id,
    groupOrder,
  });

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  // Only key, width and resizable matter for the minimum widths; dropping renderCell keeps the row type generic. The list
  // keeps one identity while `columns` does: the plugin is rebuilt (and every row re-rendered) when it changes.
  const resizeColumns = useMemo(() => columns.map(({ key, width, resizable }) => ({ key, width, resizable })), [columns]);
  const resizePlugin = useTableColumnResize<TableRow>({
    columnWidths,
    onColumnResizeEnd: (updates) => setColumnWidths((previous) => ({ ...previous, ...updates })),
    columns: resizeColumns,
  });
  // Pinned key columns need room to leave something to scroll; on a phone the whole row scrolls (reference section 8).
  // The server (and the first client render) pins, as a tablet or desktop does; a phone unpins right after hydration.
  const pinColumns = useMediaQuery(PIN_COLUMNS_QUERY, true);
  const stickyPlugin = useTableStickyColumns<TableRow>({ startKeys: pinColumns ? ["key"] : [] });

  /** A pointer click on the row opens the item (the key button is the keyboard route); editable cells keep their clicks. */
  const openPlugin = useMemo<TablePlugin<TableRow>>(
    () => ({
      transformBodyRow: (props, row) => {
        if (!isDataRow(row)) return props;
        if (isOptimisticId(row.item.id)) {
          return { ...props, htmlProps: { ...props.htmlProps, className: "tessera-table-row-pending", "aria-busy": true } };
        }
        return {
          ...props,
          htmlProps: {
            ...props.htmlProps,
            className: "tessera-table-row",
            // The focus-follow finds the item's row by it when a change moves the row to another group (./focus-follow.ts).
            "data-item-id": row.item.id,
            "aria-current": row.item.id === peekedId ? "true" : undefined,
            onClick: () => onOpen(row.item.id),
            ...tableRowArmingHandlers(armedRows, row.id),
          },
        };
      },
      transformBodyCell: (props, column, row) => {
        if (!isDataRow(row)) return props;
        // The key cell's text starts where the Key header's does (table.css): its open button brings the inset.
        if (column.key === "key") return { ...props, htmlProps: { ...props.htmlProps, className: "tessera-table-key-cell" } };
        // Ticking a row's checkbox selects it; the click (and Space on the checkbox) must not also open the peek.
        if (column.key === SELECTION_KEY) {
          return {
            ...props,
            htmlProps: {
              ...props.htmlProps,
              className: "tessera-table-select-cell",
              onClick: (event) => event.stopPropagation(),
              onKeyDown: (event) => event.stopPropagation(),
            },
          };
        }
        if (!EDITABLE.has(column.key)) return props;
        return {
          ...props,
          htmlProps: {
            ...props.htmlProps,
            className: "tessera-table-cell-edit",
            onClick: (event) => event.stopPropagation(),
            onKeyDown: (event) => event.stopPropagation(),
          },
        };
      },
    }),
    [armedRows, onOpen, peekedId],
  );

  // Insertion order is the plugin order: the grouped plugin runs last so its header rows win over the open handler.
  // Each plugin keeps its identity across renders that change nothing it reads, so the record is built from them once per
  // change (Astryx compares the plugins by identity to decide whether every row must render again).
  const hasSelection = selection !== undefined;
  const groupedPlugin = groupedRows.plugin;
  const plugins = useMemo<Record<string, TablePlugin<TableRow>>>(
    () => ({
      ...(hasSelection ? { selection: selectionPlugin } : {}),
      open: openPlugin,
      sticky: stickyPlugin,
      resize: resizePlugin,
      sort: sortPlugin,
      ...(grouped ? { grouped: groupedPlugin } : {}),
    }),
    [grouped, groupedPlugin, hasSelection, openPlugin, resizePlugin, selectionPlugin, sortPlugin, stickyPlugin],
  );

  // Select all reaches the loaded rows only (decision 114): say how many of the whole set that is.
  const showLoadedNote = selection !== undefined && hasUnloaded(selectable.length, result.total);

  return (
    <>
      {showLoadedNote ? (
        <HStack paddingInline={4} paddingBlock={2} className="tessera-table-loaded-note">
          <Text type="supporting" color="secondary" hasTabularNumbers>
            Select all picks the loaded rows only ({loadedOfTotal(selectable.length, result.total)})
          </Text>
        </HStack>
      ) : null}
      <Table<TableRow>
        className="tessera-table"
        data-list-ready=""
        data={grouped ? groupedRows.data : rows}
        columns={columns}
        idKey={grouped ? groupedRows.idKey : "id"}
        plugins={plugins}
        density="compact"
        dividers="rows"
        hasHover
        textOverflow="truncate"
        rowCount={result.total}
        emptyState={
          onClearFilters ? (
            <NoResults onClear={onClearFilters} />
          ) : (
            <EmptyState isCompact title="No work items" description={readOnly ? "Change the filters to see more." : "Create a work item or change the filters."} />
          )
        }
      />
      {!grouped && result.has_more && onLoadMoreUngrouped ? (
        <GroupFooter display={display} loaded={result.items.length} total={result.total} isLoading={isLoadingMore?.(UNGROUPED_KEY)} onLoadMore={onLoadMoreUngrouped} />
      ) : null}
    </>
  );
}
