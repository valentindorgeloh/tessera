/**
 * Rows of an export, through `listWorkItems`, so filters, rich filters, view
 * order and archived match the list on screen.
 */
import { inArray } from "drizzle-orm";
import { rule } from "../core/errors";
import type { TesseraContext } from "../core/context";
import { actor, cycle, estimate_point, label, moduleTable, project, state, work_item } from "../db/schema";
import type { ExportScope } from "../types";
import { listWorkItems, type ListWorkItemsInputType } from "../work-items";
import type { WorkItem } from "../work-items/model";

export const EXPORT_CAP = 50_000;

export const CSV_HEADER = [
  "Key",
  "Project",
  "Name",
  "State",
  "State group",
  "Priority",
  "Assignees",
  "Labels",
  "Cycle",
  "Modules",
  "Estimate",
  "Start date",
  "Target date",
  "Parent",
  "Created at",
  "Created by",
  "Updated at",
  "Completed at",
  "Archived at",
  "Description",
] as const;

export type ExportItem = {
  id: string;
  key: string;
  project_id: string;
  project: string;
  name: string;
  state_id: string;
  state: string;
  state_group: string;
  priority: string;
  assignee_ids: string[];
  assignees: string;
  label_ids: string[];
  labels: string;
  cycle_id: string | null;
  cycle: string | null;
  module_ids: string[];
  modules: string;
  estimate: string | null;
  start_date: string | null;
  target_date: string | null;
  parent_id: string | null;
  parent: string | null;
  created_at: string;
  created_by: string;
  created_by_name: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  description_md: string;
};

function listInput(scope: ExportScope): ListWorkItemsInputType {
  const filters = { ...(scope.filters ?? {}) };
  if (scope.archived) filters.archived = true;
  const display = scope.order_by === undefined ? undefined : { order_by: scope.order_by };
  const rich_filters = scope.rich_filters === undefined ? undefined : scope.rich_filters;
  const common = { filters, display, rich_filters };
  if (scope.view_id !== undefined) return { scope: { type: "view", view_id: scope.view_id }, ...common };
  if (scope.cycle_id !== undefined) return { scope: { type: "cycle", cycle_id: scope.cycle_id }, ...common };
  if (scope.module_id !== undefined) return { scope: { type: "module", module_id: scope.module_id }, ...common };
  if (scope.project_id !== null) return { scope: { type: "project", project_id: scope.project_id }, ...common };
  return { scope: { type: "workspace" }, ...common };
}

function chunked<T>(ids: string[], load: (slice: string[]) => T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...load(ids.slice(i, i + 500)));
  return ids.length === 0 ? [] : out;
}

function names(ctx: TesseraContext, items: WorkItem[]): ExportItem[] {
  const parentIds = [...new Set(items.flatMap((item) => (item.parent_id ? [item.parent_id] : [])))];
  const parentRows = chunked(parentIds, (slice) => ctx.db.select({ id: work_item.id, project_id: work_item.project_id, sequence_id: work_item.sequence_id }).from(work_item).where(inArray(work_item.id, slice)).all());
  const projectIds = [...new Set([...items.map((item) => item.project_id), ...parentRows.map((row) => row.project_id)])];
  const stateIds = [...new Set(items.map((item) => item.state_id))];
  const actorIds = [...new Set(items.flatMap((item) => [item.created_by, ...item.assignee_ids]))];
  const labelIds = [...new Set(items.flatMap((item) => item.label_ids))];
  const cycleIds = [...new Set(items.flatMap((item) => (item.cycle_id ? [item.cycle_id] : [])))];
  const moduleIds = [...new Set(items.flatMap((item) => item.module_ids))];
  const pointIds = [...new Set(items.flatMap((item) => (item.estimate_point_id ? [item.estimate_point_id] : [])))];

  const projects = new Map(chunked(projectIds, (slice) => ctx.db.select({ id: project.id, name: project.name, identifier: project.identifier }).from(project).where(inArray(project.id, slice)).all()).map((row) => [row.id, row]));
  const states = new Map(chunked(stateIds, (slice) => ctx.db.select({ id: state.id, name: state.name, state_group: state.state_group }).from(state).where(inArray(state.id, slice)).all()).map((row) => [row.id, row]));
  const actors = new Map(chunked(actorIds, (slice) => ctx.db.select({ id: actor.id, name: actor.name }).from(actor).where(inArray(actor.id, slice)).all()).map((row) => [row.id, row.name]));
  const labels = new Map(chunked(labelIds, (slice) => ctx.db.select({ id: label.id, name: label.name }).from(label).where(inArray(label.id, slice)).all()).map((row) => [row.id, row.name]));
  const cycles = new Map(chunked(cycleIds, (slice) => ctx.db.select({ id: cycle.id, name: cycle.name }).from(cycle).where(inArray(cycle.id, slice)).all()).map((row) => [row.id, row.name]));
  const modules = new Map(chunked(moduleIds, (slice) => ctx.db.select({ id: moduleTable.id, name: moduleTable.name }).from(moduleTable).where(inArray(moduleTable.id, slice)).all()).map((row) => [row.id, row.name]));
  const points = new Map(chunked(pointIds, (slice) => ctx.db.select({ id: estimate_point.id, value: estimate_point.value }).from(estimate_point).where(inArray(estimate_point.id, slice)).all()).map((row) => [row.id, row.value]));
  const parents = new Map(
    parentRows.map((row) => {
      const identifier = projects.get(row.project_id)?.identifier ?? "";
      return [row.id, identifier === "" ? String(row.sequence_id) : `${identifier}-${row.sequence_id}`] as const;
    }),
  );

  const join = (ids: string[], map: Map<string, string>) => ids.map((id) => map.get(id) ?? id).join(", ");

  return items.map((item) => {
    const projectRow = projects.get(item.project_id);
    const stateRow = states.get(item.state_id);
    return {
      id: item.id,
      key: item.key,
      project_id: item.project_id,
      project: projectRow?.name ?? item.project_id,
      name: item.name,
      state_id: item.state_id,
      state: stateRow?.name ?? item.state_id,
      state_group: stateRow?.state_group ?? "",
      priority: item.priority,
      assignee_ids: item.assignee_ids,
      assignees: join(item.assignee_ids, actors),
      label_ids: item.label_ids,
      labels: join(item.label_ids, labels),
      cycle_id: item.cycle_id,
      cycle: item.cycle_id ? (cycles.get(item.cycle_id) ?? null) : null,
      module_ids: item.module_ids,
      modules: join(item.module_ids, modules),
      estimate: item.estimate_point_id ? (points.get(item.estimate_point_id) ?? null) : null,
      start_date: item.start_date,
      target_date: item.target_date,
      parent_id: item.parent_id,
      parent: item.parent_id ? (parents.get(item.parent_id) ?? null) : null,
      created_at: item.created_at,
      created_by: item.created_by,
      created_by_name: actors.get(item.created_by) ?? item.created_by,
      updated_at: item.updated_at,
      completed_at: item.completed_at,
      archived_at: item.archived_at,
      description_md: item.description_md,
    };
  });
}

export function exportRows(ctx: TesseraContext, scope: ExportScope): ExportItem[] {
  const input = listInput(scope);
  const probe = listWorkItems(ctx, { ...input, limit: 1 });
  if (probe.total > EXPORT_CAP) throw rule("export_too_large", `An export can hold at most ${EXPORT_CAP} work items`);
  if (probe.total === 0) return [];
  return names(ctx, listWorkItems(ctx, input).items);
}

export function csvRows(items: ExportItem[]): (string | null)[][] {
  return items.map((item) => [
    item.key,
    item.project,
    item.name,
    item.state,
    item.state_group,
    item.priority,
    item.assignees,
    item.labels,
    item.cycle,
    item.modules,
    item.estimate,
    item.start_date,
    item.target_date,
    item.parent,
    item.created_at,
    item.created_by_name,
    item.updated_at,
    item.completed_at,
    item.archived_at,
    item.description_md,
  ]);
}
