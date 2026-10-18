"use client";

/**
 * Table layout (docs/contracts/ui.md "Work items screen"): an Astryx Table
 * with the key column pinned, one column per property enabled in
 * `display.properties`, client-side sorting by header click (within the
 * loaded result), collapsible group sections when `display.group_by` is
 * set, resizable columns and inline edits through the ghost property
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
import { HStack } from "@astryxdesign/core/Stack";
import {
  Table,
  pixel,
  proportional,
  useTableColumnResize,
  useTableGroupedRows,
  useTableSelection,
  useTableSortable,
  useTableSortableState,
  useTableStickyColumns,
  type TableColumn,
  type TablePlugin,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { PRIORITY_RANK } from "@/lib/tessera/core/group";
import type { DisplayProperties, Group, GroupBy, StateGroup, WorkItem } from "@/lib/tessera/types";
import { isOptimisticId } from "./optimistic";
import { RowProject } from "./row-project";
import { ActorLabel, AssigneeControl, CycleControl, DateControl, EstimateControl, LabelControl, ModuleControl, PriorityControl, PriorityLabel, StateControl, StateLabel, isPriority, paletteTokenColor } from "./properties";
import type { LayoutProps, ProjectBundle, UpdateWorkItemPatch } from "./types";

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

const STATE_GROUPS: ReadonlySet<string> = new Set<StateGroup>(["backlog", "unstarted", "started", "completed", "cancelled", "triage"]);
/** Id of the synthetic "no value" group (`NONE_GROUP_ID` in the engine's filters.ts). */
const NONE_GROUP = "none";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Nulls last, otherwise ISO strings compare as text. */
function compareNullableText(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildColumns(
  properties: DisplayProperties,
  bundle: ProjectBundle,
  showProject: boolean,
  onUpdate: (id: string, patch: UpdateWorkItemPatch) => void,
  onOpen: (id: string) => void,
  readOnly: boolean,
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
    sortable: true,
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
    width: proportional(2),
    sortable: true,
    renderCell: (row) => (
      <Text weight="medium" maxLines={1}>
        {row.item.name}
      </Text>
    ),
  });
  if (showProject) {
    const projectName = new Map(bundle.projects.map((project) => [project.id, project.name]));
    columns.push({
      key: "project",
      header: "Project",
      width: pixel(160),
      sortable: true,
      renderCell: (row) => (
        <Text maxLines={1}>{projectName.get(row.item.project_id) ?? ""}</Text>
      ),
    });
  }
  if (properties.state) {
    columns.push({
      key: "state",
      header: "State",
      width: pixel(176),
      sortable: true,
      renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <StateControl compact readOnly={locked(row)} value={row.item.state_id} onChange={(stateId) => onUpdate(row.item.id, { state_id: stateId })} />
        </RowProject>
      ),
    });
  }
  if (properties.priority) {
    columns.push({
      key: "priority",
      header: "Priority",
      width: pixel(148),
      sortable: true,
      renderCell: (row) => <PriorityControl compact readOnly={locked(row)} value={row.item.priority} onChange={(priority) => onUpdate(row.item.id, { priority })} />,
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
          <CycleControl compact readOnly={locked(row)} value={row.item.cycle_id} onChange={(cycleId) => onUpdate(row.item.id, { cycle_id: cycleId })} />
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
      sortable: true,
      renderCell: (row) => (
        <DateControl compact readOnly={locked(row)} label="Start date" value={row.item.start_date} max={row.item.target_date} onChange={(date) => onUpdate(row.item.id, { start_date: date })} />
      ),
    });
  }
  if (properties.target_date) {
    columns.push({
      key: "target_date",
      header: "Target date",
      width: pixel(156),
      sortable: true,
      renderCell: (row) => (
        <DateControl compact readOnly={locked(row)} label="Target date" value={row.item.target_date} min={row.item.start_date} onChange={(date) => onUpdate(row.item.id, { target_date: date })} />
      ),
    });
  }
  if (properties.estimate && bundle.project.estimates_enabled && bundle.estimate) {
    columns.push({
      key: "estimate",
      header: "Estimate",
      width: pixel(140),
      sortable: true,
      renderCell: (row) => (
        <EstimateControl value={row.item.estimate_point_id} readOnly={locked(row)} size="sm" onChange={(estimate_point_id) => onUpdate(row.item.id, { estimate_point_id })} />
      ),
    });
  }
  if (properties.created_at) {
    columns.push({
      key: "created_at",
      header: "Created",
      width: pixel(128),
      sortable: true,
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
      sortable: true,
      renderCell: (row) => (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {row.item.updated_at.slice(0, 10)}
        </Text>
      ),
    });
  }
  return columns;
}

/** Point order in the active system; missing points sort last. */
function estimateRank(bundle: ProjectBundle, pointId: string | null): number {
  if (pointId === null || bundle.estimate === null) return Number.MAX_SAFE_INTEGER;
  const index = bundle.estimate.points.findIndex((point) => point.id === pointId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
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
function GroupHeading({ group, field, bundle }: { group: Group | undefined; field: GroupBy | null; bundle: ProjectBundle }) {
  if (!group) return <Text weight="semibold">Ungrouped</Text>;
  if (group.id === NONE_GROUP && field !== "priority") {
    return (
      <Text weight="semibold" color="secondary">
        {group.name}
      </Text>
    );
  }
  if (field === "assignees" || field === "created_by") return <ActorLabel name={group.name} />;
  if (field === "state") {
    const state = bundle.states.find((candidate) => candidate.id === group.id);
    if (state) return <StateLabel state={state} />;
  }
  if (field === "state_group" && STATE_GROUPS.has(group.id)) return <StateLabel group={group.id as StateGroup} name={group.name} />;
  if (field === "priority" && isPriority(group.id)) return <PriorityLabel value={group.id} />;
  if (group.color !== null) return <Token label={group.name} size="md" color={paletteTokenColor(group.color)} />;
  return <Text weight="semibold">{group.name}</Text>;
}

export function TableLayout({ result, display, bundle, onUpdate, onOpen, readOnly = false, showProject = false, selection }: LayoutProps) {
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

  const stateRank = useMemo(() => new Map(bundle.states.map((state, index) => [state.id, index])), [bundle.states]);

  const columns = useMemo(() => buildColumns(display.properties, bundle, showProject, onUpdate, onOpen, readOnly), [bundle, display.properties, onOpen, onUpdate, readOnly, showProject]);

  const { sortedData, sortConfig } = useTableSortableState<TableRow>({
    data: rows,
    comparators: {
      key: (a, b) => a.item.sequence_id - b.item.sequence_id,
      name: (a, b) => collator.compare(a.item.name, b.item.name),
      project: (a, b) => collator.compare(bundle.projects.find((project) => project.id === a.item.project_id)?.name ?? "", bundle.projects.find((project) => project.id === b.item.project_id)?.name ?? ""),
      state: (a, b) => (stateRank.get(a.item.state_id) ?? Number.MAX_SAFE_INTEGER) - (stateRank.get(b.item.state_id) ?? Number.MAX_SAFE_INTEGER),
      priority: (a, b) => PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority],
      estimate: (a, b) => estimateRank(bundle, a.item.estimate_point_id) - estimateRank(bundle, b.item.estimate_point_id),
      start_date: (a, b) => compareNullableText(a.item.start_date, b.item.start_date),
      target_date: (a, b) => compareNullableText(a.item.target_date, b.item.target_date),
      created_at: (a, b) => compareNullableText(a.item.created_at, b.item.created_at),
      updated_at: (a, b) => compareNullableText(a.item.updated_at, b.item.updated_at),
    },
  });
  const sortPlugin = useTableSortable<TableRow>(sortConfig);
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
    (groupKey: string, count: number): ReactNode => (
      <HStack gap={2} vAlign="center">
        <GroupHeading group={groupsById.get(groupKey)} field={display.group_by} bundle={bundle} />
        <Badge label={count} variant="neutral" />
      </HStack>
    ),
    [bundle, display.group_by, groupsById],
  );
  const groupedRows = useTableGroupedRows<TableRow>({
    data: sortedData,
    groupBy: (row) => row.groupKey,
    collapsedGroups: collapsed,
    onToggleGroup,
    renderGroupHeader,
    getRowKey: (row) => row.id,
    groupOrder,
  });

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizePlugin = useTableColumnResize<TableRow>({
    columnWidths,
    onColumnResizeEnd: (updates) => setColumnWidths((previous) => ({ ...previous, ...updates })),
    // Only key, width and resizable matter for the minimum widths; dropping renderCell keeps the row type generic.
    columns: columns.map(({ key, width, resizable }) => ({ key, width, resizable })),
  });
  const stickyPlugin = useTableStickyColumns<TableRow>({ startKeys: ["key"] });

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
            onClick: () => onOpen(row.item.id),
          },
        };
      },
      transformBodyCell: (props, column, row) => {
        if (!isDataRow(row) || !EDITABLE.has(column.key)) return props;
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
    [onOpen],
  );

  // Insertion order is the plugin order: the grouped plugin runs last so its header rows win over the open handler.
  const plugins: Record<string, TablePlugin<TableRow>> = {
    ...(selection ? { selection: selectionPlugin } : {}),
    open: openPlugin,
    sticky: stickyPlugin,
    resize: resizePlugin,
    sort: sortPlugin,
    ...(grouped ? { grouped: groupedRows.plugin } : {}),
  };

  return (
    <Table<TableRow>
      className="tessera-table"
      data={grouped ? groupedRows.data : sortedData}
      columns={columns}
      idKey={grouped ? groupedRows.idKey : "id"}
      plugins={plugins}
      density="compact"
      dividers="rows"
      hasHover
      textOverflow="truncate"
      rowCount={result.total}
      emptyState={<EmptyState isCompact title="No work items" description={readOnly ? "Change the filters to see more." : "Create a work item or change the filters."} />}
    />
  );
}
