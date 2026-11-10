"use client";

/**
 * The table's columns (TableLayout.tsx): one per property enabled in `display.properties`, built from the few things
 * they read so the list keeps one identity across writes. At rest a cell is its value (a dot and a name, a tinted pill,
 * avatars, plain text); the property controls draw as chips until the row arms (./properties/arming.tsx) and then
 * swap in the real Astryx controls, in the same box. The whole cell is the click target of an editable property
 * (`openCellEditor`); labels, assignees and modules have no patch field and are plain values.
 */
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import {
  CalendarIcon,
  ClockIcon,
  CycleIcon,
  DescriptionIcon,
  EstimateIcon,
  FolderIcon,
  HashIcon,
  ModuleIcon,
  PriorityHighIcon,
  StateIcon,
  TagIcon,
  UsersIcon,
} from "@/themes/catppuccin/icons";
import type { DisplayProperties, WorkItem } from "@/lib/tessera/types";
import { isOptimisticId } from "./optimistic";
import { OneLineText } from "./OneLineText";
import { RowProject } from "./row-project";
import { AssigneeValue, CycleControl, DateControl, EstimateControl, LabelTokens, ModuleTokens, PriorityControl, StateControl } from "./properties";
import { ArmedCell, type ArmedRows } from "./properties/arming";
import type { UpdateWorkItemPatch } from "./types";

/** One table row; a grouped result repeats an item under every group it belongs to, so the row id carries the group. */
export interface TableRow extends Record<string, unknown> {
  id: string;
  item: WorkItem;
  groupKey: string;
}

/** Group headers injected by the grouped-rows plugin read every unknown field as "" (never an object). */
export function isDataRow(row: TableRow): boolean {
  return typeof row.item === "object" && row.item !== null;
}

type ColumnKey = "key" | "name" | "project" | "state" | "priority" | "assignees" | "labels" | "cycle" | "modules" | "estimate" | "start_date" | "target_date" | "created_at" | "updated_at";

/** Columns whose cell holds an editor: a click anywhere in the cell opens it and does not open the row. */
export const EDITABLE: ReadonlySet<string> = new Set<ColumnKey>(["state", "priority", "cycle", "estimate", "start_date", "target_date"]);

/** The Name column grows with the table but never below Plane's first-column floor of 240px (reference section 8). */
const NAME_COLUMN_WIDTH = proportional(2, { minWidth: 240 });

/** The project names of the Project column: `null` while the table has no such column. */
export type ProjectNames = readonly { id: string; name: string }[] | null;

/** A column header: the property's small icon before its label (the registry's, never a new one). */
function Head({ icon, children }: { icon?: IconType; children: string }): ReactNode {
  return (
    <Text type="inherit" className="tessera-table-head">
      {icon ? <Icon icon={icon} size="sm" color="inherit" /> : null}
      {children}
    </Text>
  );
}

/** What can take a click inside a cell: the cell's own click must not reach it twice. */
const OWN_CLICK = "button, a, input, [role='combobox'], [role='option'], [role='listbox'], [role='dialog'], [popover]";
/** The control a cell opens: its chip, the armed selector's trigger or the date button. */
const EDITOR = "button:not([disabled]):not([aria-disabled='true']):not(.astryx-input-clear-button), [role='combobox']:not([aria-disabled='true'])";

/**
 * A click on an editable cell that did not land on its control (the padding, the empty part of the cell) opens the
 * editor all the same: the control's own trigger is clicked for the pointer. The click never opens the row. A click on
 * the control itself, or in a layer it opened (a React portal bubbles here too), is the control's own.
 */
export function openCellEditor(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation();
  const cell = event.currentTarget;
  const target = event.target;
  if (!(target instanceof Element) || !cell.contains(target)) return;
  const own = target.closest(OWN_CLICK);
  if (own !== null && cell.contains(own)) return;
  cell.querySelector<HTMLElement>(EDITOR)?.click();
}

export function buildColumns(
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
    header: <Head icon={HashIcon}>Key</Head>,
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
    header: <Head icon={DescriptionIcon}>Name</Head>,
    width: NAME_COLUMN_WIDTH,
    renderCell: (row) => (
      <>
        <OneLineText className="tessera-wi-cell-text" weight="medium">
          {row.item.name}
        </OneLineText>
        {/* Drawn on a hovered row or one holding keyboard focus (table.css); the key button stays the accessible route, so this one is a pointer convenience. */}
        {pending(row) ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="tessera-table-name-open"
            label={`Open ${row.item.key}`}
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(row.item.id);
            }}
          >
            Open
          </Button>
        )}
      </>
    ),
  });
  if (projects !== null) {
    const projectName = new Map(projects.map((project) => [project.id, project.name]));
    columns.push({
      key: "project",
      header: <Head icon={FolderIcon}>Project</Head>,
      width: pixel(160),
      renderCell: (row) => <OneLineText className="tessera-wi-cell-text">{projectName.get(row.item.project_id) ?? ""}</OneLineText>,
    });
  }
  if (properties.state) {
    columns.push({
      key: "state",
      header: <Head icon={StateIcon}>State</Head>,
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
      header: <Head icon={PriorityHighIcon}>Priority</Head>,
      width: pixel(172),
      renderCell: (row) => (
        <ArmedCell store={armedRows} rowId={row.id}>
          <PriorityControl armKey="priority" compact hasLabel readOnly={locked(row)} value={row.item.priority} onChange={(priority) => onUpdate(row.item.id, { priority })} />
        </ArmedCell>
      ),
    });
  }
  if (properties.assignees) {
    columns.push({
      key: "assignees",
      header: <Head icon={UsersIcon}>Assignees</Head>,
      width: pixel(184),
      renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <AssigneeValue ids={row.item.assignee_ids} />
        </RowProject>
      ),
    });
  }
  if (properties.labels) {
    columns.push({
      key: "labels",
      header: <Head icon={TagIcon}>Labels</Head>,
      width: pixel(200),
      renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <LabelTokens ids={row.item.label_ids} />
        </RowProject>
      ),
    });
  }
  if (properties.cycle) {
    columns.push({
      key: "cycle",
      header: <Head icon={CycleIcon}>Cycle</Head>,
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
      header: <Head icon={ModuleIcon}>Modules</Head>,
      width: pixel(184),
      renderCell: (row) => (
        <RowProject projectId={row.item.project_id}>
          <ModuleTokens ids={row.item.module_ids} />
        </RowProject>
      ),
    });
  }
  if (properties.start_date) {
    columns.push({
      key: "start_date",
      header: <Head icon={CalendarIcon}>Start date</Head>,
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
      header: <Head icon={CalendarIcon}>Target date</Head>,
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
      header: <Head icon={EstimateIcon}>Estimate</Head>,
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
      header: <Head icon={ClockIcon}>Created</Head>,
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
      header: <Head icon={ClockIcon}>Updated</Head>,
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
