"use client";

/**
 * The cells of the work items table (decision 136): memo components that take the row's item and primitives and
 * read project data through `useProjectRow()` (decision 141), and the lean `buildColumns` that renders them. The
 * columns depend only on the display properties, the project column, the read-only flag, whether estimates are on
 * and the screen's stable handlers, so they keep their identity across a refresh, and a row that Astryx re-renders
 * (a range change shifts every rendered row's index, compared while a plugin has `transformBodyRow`,
 * `Table/BaseTable.js:199` in 0.7.11) bails out in each cell whose item did not change. The editable cells draw their
 * controls as chips until their row arms (./properties/arming.tsx): `ArmedCell` reads the table's arming store for the
 * row id, so arming re-renders the cells of that row alone, and the state outlives the row leaving the virtual window.
 * At rest a cell is its value (the quiet screen, docs/contracts/ui.md "Work items screen"): labels, modules and
 * assignees are plain pills and avatars (./properties/cell-values.tsx); the headers carry the property's icon
 * (./table-columns.tsx `Head`).
 */
import { memo } from "react";
import { Button } from "@astryxdesign/core/Button";
import { pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import type { DisplayProperties, WorkItem } from "@/lib/tessera/types";
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
import { isOptimisticId } from "./optimistic";
import { OneLineText } from "./OneLineText";
import { RowProject } from "./row-project";
import { AssigneeValue, CycleControl, DateControl, EstimateControl, LabelTokens, ModuleTokens, PriorityControl, StateControl } from "./properties";
import { ArmedCell, type ArmedRows } from "./properties/arming";
import { Head } from "./table-columns";
import type { UpdateWorkItemPatch } from "./types";

/** One table row; a grouped result repeats an item under every group it belongs to, so the row id carries the group. */
export interface TableRow extends Record<string, unknown> {
  id: string;
  item: WorkItem;
  groupKey: string;
}

/** Group headers injected by the grouped-rows plugin, and the virtual spacer rows, have no item object. */
export function isDataRow(row: TableRow): boolean {
  return typeof row.item === "object" && row.item !== null;
}

type OnUpdate = (id: string, patch: UpdateWorkItemPatch) => void;

/** An editable cell: the item, the read-only flag, the screen's update handler, and the row's place in the arming store. */
type EditCellProps = { item: WorkItem; readOnly: boolean; onUpdate: OnUpdate; armedRows: ArmedRows; rowId: string };

/** An archived project passes `readOnly` to every property control (F3.4); a placeholder row is always locked. */
function isLocked(item: WorkItem, readOnly: boolean): boolean {
  return isOptimisticId(item.id) || readOnly;
}

const KeyCell = memo(function KeyCell({ item, showKey, onOpen }: { item: WorkItem; showKey: boolean; onOpen: (id: string) => void }) {
  if (isOptimisticId(item.id)) {
    return (
      <Text type="supporting" color="secondary">
        Saving…
      </Text>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="tessera-table-open"
      data-focus-key="open"
      label={item.key}
      tooltip={showKey ? undefined : item.key}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item.id);
      }}
    />
  );
});

const NameCell = memo(function NameCell({ item, onOpen }: { item: WorkItem; onOpen: (id: string) => void }) {
  return (
    <>
      <OneLineText className="tessera-wi-cell-text" weight="medium">
        {item.name}
      </OneLineText>
      {/* Drawn on a hovered row or one holding keyboard focus (table.css); the key button stays the accessible route, so this one is a pointer convenience. */}
      {isOptimisticId(item.id) ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="tessera-table-name-open"
          label={`Open ${item.key}`}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(item.id);
          }}
        >
          Open
        </Button>
      )}
    </>
  );
});

const ProjectCell = memo(function ProjectCell({ item, projectName }: { item: WorkItem; projectName: ReadonlyMap<string, string> }) {
  return <OneLineText className="tessera-wi-cell-text">{projectName.get(item.project_id) ?? ""}</OneLineText>;
});

const StateCell = memo(function StateCell({ item, readOnly, onUpdate, armedRows, rowId }: EditCellProps) {
  return (
    <RowProject projectId={item.project_id}>
      <ArmedCell store={armedRows} rowId={rowId}>
        <StateControl armKey="state" compact readOnly={isLocked(item, readOnly)} value={item.state_id} onChange={(stateId) => onUpdate(item.id, { state_id: stateId })} />
      </ArmedCell>
    </RowProject>
  );
});

const PriorityCell = memo(function PriorityCell({ item, readOnly, onUpdate, armedRows, rowId }: EditCellProps) {
  return (
    <ArmedCell store={armedRows} rowId={rowId}>
      <PriorityControl armKey="priority" compact hasLabel readOnly={isLocked(item, readOnly)} value={item.priority} onChange={(priority) => onUpdate(item.id, { priority })} />
    </ArmedCell>
  );
});

const AssigneesCell = memo(function AssigneesCell({ item }: { item: WorkItem }) {
  return (
    <RowProject projectId={item.project_id}>
      <AssigneeValue ids={item.assignee_ids} />
    </RowProject>
  );
});

const LabelsCell = memo(function LabelsCell({ item }: { item: WorkItem }) {
  return (
    <RowProject projectId={item.project_id}>
      <LabelTokens ids={item.label_ids} />
    </RowProject>
  );
});

const CycleCell = memo(function CycleCell({ item, readOnly, onUpdate, armedRows, rowId }: EditCellProps) {
  return (
    <RowProject projectId={item.project_id}>
      <ArmedCell store={armedRows} rowId={rowId}>
        <CycleControl armKey="cycle" compact readOnly={isLocked(item, readOnly)} value={item.cycle_id} onChange={(cycleId) => onUpdate(item.id, { cycle_id: cycleId })} />
      </ArmedCell>
    </RowProject>
  );
});

const ModulesCell = memo(function ModulesCell({ item }: { item: WorkItem }) {
  return (
    <RowProject projectId={item.project_id}>
      <ModuleTokens ids={item.module_ids} />
    </RowProject>
  );
});

const StartDateCell = memo(function StartDateCell({ item, readOnly, onUpdate, armedRows, rowId }: EditCellProps) {
  return (
    <ArmedCell store={armedRows} rowId={rowId}>
      <DateControl armKey="start" compact readOnly={isLocked(item, readOnly)} label="Start date" value={item.start_date} max={item.target_date} onChange={(date) => onUpdate(item.id, { start_date: date })} />
    </ArmedCell>
  );
});

const TargetDateCell = memo(function TargetDateCell({ item, readOnly, onUpdate, armedRows, rowId }: EditCellProps) {
  return (
    <ArmedCell store={armedRows} rowId={rowId}>
      <DateControl armKey="target" compact readOnly={isLocked(item, readOnly)} label="Target date" value={item.target_date} min={item.start_date} onChange={(date) => onUpdate(item.id, { target_date: date })} />
    </ArmedCell>
  );
});

const EstimateCell = memo(function EstimateCell({ item, readOnly, onUpdate, armedRows, rowId }: EditCellProps) {
  return (
    <ArmedCell store={armedRows} rowId={rowId}>
      <EstimateControl armKey="estimate" value={item.estimate_point_id} readOnly={isLocked(item, readOnly)} size="sm" onChange={(estimate_point_id) => onUpdate(item.id, { estimate_point_id })} />
    </ArmedCell>
  );
});

const DayCell = memo(function DayCell({ value }: { value: string }) {
  return (
    <Text type="supporting" color="secondary" hasTabularNumbers>
      {value.slice(0, 10)}
    </Text>
  );
});

/** The Name column grows with the table but never below Plane's first-column floor of 240px (reference section 8). */
const NAME_COLUMN_WIDTH = proportional(2, { minWidth: 240 });

export type BuildColumnsInput = {
  properties: DisplayProperties;
  /** The Project column (workspace views): project id → name, kept while the names are equal. */
  projectName: ReadonlyMap<string, string> | null;
  /** The project has estimates on and an estimate system. */
  hasEstimates: boolean;
  readOnly: boolean;
  onUpdate: OnUpdate;
  onOpen: (id: string) => void;
  /** The table's arming store (one per table, kept for its lifetime). */
  armedRows: ArmedRows;
};

export function buildColumns({ properties, projectName, hasEstimates, readOnly, onUpdate, onOpen, armedRows }: BuildColumnsInput): TableColumn<TableRow>[] {
  const edit = (row: TableRow): EditCellProps => ({ item: row.item, readOnly, onUpdate, armedRows, rowId: row.id });
  const columns: TableColumn<TableRow>[] = [];
  // The key column stays even when the key property is off: it is the row's keyboard-reachable open control.
  columns.push({ key: "key", header: <Head icon={HashIcon}>Key</Head>, width: pixel(104), renderCell: (row) => <KeyCell item={row.item} showKey={properties.key} onOpen={onOpen} /> });
  columns.push({ key: "name", header: <Head icon={DescriptionIcon}>Name</Head>, width: NAME_COLUMN_WIDTH, renderCell: (row) => <NameCell item={row.item} onOpen={onOpen} /> });
  if (projectName) {
    columns.push({ key: "project", header: <Head icon={FolderIcon}>Project</Head>, width: pixel(160), renderCell: (row) => <ProjectCell item={row.item} projectName={projectName} /> });
  }
  if (properties.state) {
    columns.push({ key: "state", header: <Head icon={StateIcon}>State</Head>, width: pixel(176), renderCell: (row) => <StateCell {...edit(row)} /> });
  }
  if (properties.priority) {
    columns.push({ key: "priority", header: <Head icon={PriorityHighIcon}>Priority</Head>, width: pixel(172), renderCell: (row) => <PriorityCell {...edit(row)} /> });
  }
  if (properties.assignees) {
    columns.push({ key: "assignees", header: <Head icon={UsersIcon}>Assignees</Head>, width: pixel(184), renderCell: (row) => <AssigneesCell item={row.item} /> });
  }
  if (properties.labels) {
    columns.push({ key: "labels", header: <Head icon={TagIcon}>Labels</Head>, width: pixel(200), renderCell: (row) => <LabelsCell item={row.item} /> });
  }
  if (properties.cycle) {
    columns.push({ key: "cycle", header: <Head icon={CycleIcon}>Cycle</Head>, width: pixel(168), renderCell: (row) => <CycleCell {...edit(row)} /> });
  }
  if (properties.modules) {
    columns.push({ key: "modules", header: <Head icon={ModuleIcon}>Modules</Head>, width: pixel(184), renderCell: (row) => <ModulesCell item={row.item} /> });
  }
  if (properties.start_date) {
    columns.push({ key: "start_date", header: <Head icon={CalendarIcon}>Start date</Head>, width: pixel(156), renderCell: (row) => <StartDateCell {...edit(row)} /> });
  }
  if (properties.target_date) {
    columns.push({ key: "target_date", header: <Head icon={CalendarIcon}>Target date</Head>, width: pixel(156), renderCell: (row) => <TargetDateCell {...edit(row)} /> });
  }
  if (properties.estimate && hasEstimates) {
    columns.push({ key: "estimate", header: <Head icon={EstimateIcon}>Estimate</Head>, width: pixel(140), renderCell: (row) => <EstimateCell {...edit(row)} /> });
  }
  if (properties.created_at) {
    columns.push({ key: "created_at", header: <Head icon={ClockIcon}>Created</Head>, width: pixel(128), renderCell: (row) => <DayCell value={row.item.created_at} /> });
  }
  if (properties.updated_at) {
    columns.push({ key: "updated_at", header: <Head icon={ClockIcon}>Updated</Head>, width: pixel(128), renderCell: (row) => <DayCell value={row.item.updated_at} /> });
  }
  return columns;
}
