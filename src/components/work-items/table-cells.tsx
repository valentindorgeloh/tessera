"use client";

/**
 * The cells of the work items table (decision 136): memo components that take the row's item and primitives and
 * read project data through `useProjectRow()` (decision 141), and the lean `buildColumns` that renders them. The
 * columns depend only on the display properties, the project column, the read-only flag, whether estimates are on
 * and the screen's stable handlers, so they keep their identity across a refresh, and a row that Astryx re-renders
 * (a range change shifts every rendered row's index, compared while a plugin has `transformBodyRow`,
 * `Table/BaseTable.js:199` in 0.7.11) bails out in each cell whose item did not change.
 */
import { memo } from "react";
import { Button } from "@astryxdesign/core/Button";
import { pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import type { DisplayProperties, WorkItem } from "@/lib/tessera/types";
import { isOptimisticId } from "./optimistic";
import { OneLineText } from "./OneLineText";
import { RowProject } from "./row-project";
import { AssigneeControl, CycleControl, DateControl, EstimateControl, LabelControl, ModuleControl, PriorityControl, StateControl } from "./properties";
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
      label={item.key}
      tooltip={showKey ? undefined : item.key}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item.id);
      }}
    />
  );
});

const NameCell = memo(function NameCell({ item }: { item: WorkItem }) {
  return (
    <OneLineText className="tessera-wi-cell-text" weight="medium">
      {item.name}
    </OneLineText>
  );
});

const ProjectCell = memo(function ProjectCell({ item, projectName }: { item: WorkItem; projectName: ReadonlyMap<string, string> }) {
  return <OneLineText className="tessera-wi-cell-text">{projectName.get(item.project_id) ?? ""}</OneLineText>;
});

const StateCell = memo(function StateCell({ item, readOnly, onUpdate }: { item: WorkItem; readOnly: boolean; onUpdate: OnUpdate }) {
  return (
    <RowProject projectId={item.project_id}>
      <StateControl compact readOnly={isLocked(item, readOnly)} value={item.state_id} onChange={(stateId) => onUpdate(item.id, { state_id: stateId })} />
    </RowProject>
  );
});

const PriorityCell = memo(function PriorityCell({ item, readOnly, onUpdate }: { item: WorkItem; readOnly: boolean; onUpdate: OnUpdate }) {
  return <PriorityControl compact readOnly={isLocked(item, readOnly)} value={item.priority} onChange={(priority) => onUpdate(item.id, { priority })} />;
});

const AssigneesCell = memo(function AssigneesCell({ item }: { item: WorkItem }) {
  return <AssigneeControl compact readOnly value={item.assignee_ids} onChange={() => undefined} />;
});

const LabelsCell = memo(function LabelsCell({ item }: { item: WorkItem }) {
  return (
    <RowProject projectId={item.project_id}>
      <LabelControl compact readOnly value={item.label_ids} onChange={() => undefined} />
    </RowProject>
  );
});

const CycleCell = memo(function CycleCell({ item, readOnly, onUpdate }: { item: WorkItem; readOnly: boolean; onUpdate: OnUpdate }) {
  return (
    <RowProject projectId={item.project_id}>
      <CycleControl compact readOnly={isLocked(item, readOnly)} value={item.cycle_id} onChange={(cycleId) => onUpdate(item.id, { cycle_id: cycleId })} />
    </RowProject>
  );
});

const ModulesCell = memo(function ModulesCell({ item }: { item: WorkItem }) {
  return (
    <RowProject projectId={item.project_id}>
      <ModuleControl compact readOnly value={item.module_ids} onChange={() => undefined} />
    </RowProject>
  );
});

const StartDateCell = memo(function StartDateCell({ item, readOnly, onUpdate }: { item: WorkItem; readOnly: boolean; onUpdate: OnUpdate }) {
  return <DateControl compact readOnly={isLocked(item, readOnly)} label="Start date" value={item.start_date} max={item.target_date} onChange={(date) => onUpdate(item.id, { start_date: date })} />;
});

const TargetDateCell = memo(function TargetDateCell({ item, readOnly, onUpdate }: { item: WorkItem; readOnly: boolean; onUpdate: OnUpdate }) {
  return <DateControl compact readOnly={isLocked(item, readOnly)} label="Target date" value={item.target_date} min={item.start_date} onChange={(date) => onUpdate(item.id, { target_date: date })} />;
});

const EstimateCell = memo(function EstimateCell({ item, readOnly, onUpdate }: { item: WorkItem; readOnly: boolean; onUpdate: OnUpdate }) {
  return <EstimateControl value={item.estimate_point_id} readOnly={isLocked(item, readOnly)} size="sm" onChange={(estimate_point_id) => onUpdate(item.id, { estimate_point_id })} />;
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
};

export function buildColumns({ properties, projectName, hasEstimates, readOnly, onUpdate, onOpen }: BuildColumnsInput): TableColumn<TableRow>[] {
  const columns: TableColumn<TableRow>[] = [];
  // The key column stays even when the key property is off: it is the row's keyboard-reachable open control.
  columns.push({ key: "key", header: "Key", width: pixel(104), renderCell: (row) => <KeyCell item={row.item} showKey={properties.key} onOpen={onOpen} /> });
  columns.push({ key: "name", header: "Name", width: NAME_COLUMN_WIDTH, renderCell: (row) => <NameCell item={row.item} /> });
  if (projectName) {
    columns.push({ key: "project", header: "Project", width: pixel(160), renderCell: (row) => <ProjectCell item={row.item} projectName={projectName} /> });
  }
  if (properties.state) {
    columns.push({ key: "state", header: "State", width: pixel(176), renderCell: (row) => <StateCell item={row.item} readOnly={readOnly} onUpdate={onUpdate} /> });
  }
  if (properties.priority) {
    columns.push({ key: "priority", header: "Priority", width: pixel(148), renderCell: (row) => <PriorityCell item={row.item} readOnly={readOnly} onUpdate={onUpdate} /> });
  }
  if (properties.assignees) {
    columns.push({ key: "assignees", header: "Assignees", width: pixel(184), renderCell: (row) => <AssigneesCell item={row.item} /> });
  }
  if (properties.labels) {
    columns.push({ key: "labels", header: "Labels", width: pixel(200), renderCell: (row) => <LabelsCell item={row.item} /> });
  }
  if (properties.cycle) {
    columns.push({ key: "cycle", header: "Cycle", width: pixel(168), renderCell: (row) => <CycleCell item={row.item} readOnly={readOnly} onUpdate={onUpdate} /> });
  }
  if (properties.modules) {
    columns.push({ key: "modules", header: "Modules", width: pixel(184), renderCell: (row) => <ModulesCell item={row.item} /> });
  }
  if (properties.start_date) {
    columns.push({ key: "start_date", header: "Start date", width: pixel(156), renderCell: (row) => <StartDateCell item={row.item} readOnly={readOnly} onUpdate={onUpdate} /> });
  }
  if (properties.target_date) {
    columns.push({ key: "target_date", header: "Target date", width: pixel(156), renderCell: (row) => <TargetDateCell item={row.item} readOnly={readOnly} onUpdate={onUpdate} /> });
  }
  if (properties.estimate && hasEstimates) {
    columns.push({ key: "estimate", header: "Estimate", width: pixel(140), renderCell: (row) => <EstimateCell item={row.item} readOnly={readOnly} onUpdate={onUpdate} /> });
  }
  if (properties.created_at) {
    columns.push({ key: "created_at", header: "Created", width: pixel(128), renderCell: (row) => <DayCell value={row.item.created_at} /> });
  }
  if (properties.updated_at) {
    columns.push({ key: "updated_at", header: "Updated", width: pixel(128), renderCell: (row) => <DayCell value={row.item.updated_at} /> });
  }
  return columns;
}
