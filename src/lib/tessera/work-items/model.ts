import { z } from "zod";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { archived, locked, notFound, rule } from "../core/errors";
import { formatKey } from "../core/keys";
import { deriveCycleStatus } from "../cycles";
import { actor, cycle, estimate, estimate_point, label, moduleTable, project, state, work_item } from "../db/schema";
import { type Group } from "../filters";
import type { DateRange, ListRelation } from "./timeline";
import { getProjectRow } from "../projects";
import type { CycleRow, IntakeStatus, LabelRow, ModuleRow, ProjectRow, StateRow, WorkItemLinkRow, WorkItemRow } from "../types";

export type { Group } from "../filters";

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export type WorkItemIntake = { status: IntakeStatus };

export type WorkItem = WorkItemRow & {
  /** `<identifier>-<sequence_id>`, computed at read time. */
  key: string;
  label_ids: string[];
  module_ids: string[];
  assignee_ids: string[];
  sub_items_count: number;
  links_count: number;
  /** Present when the item went through Intake; `pending` items are hidden from lists. */
  intake: WorkItemIntake | null;
};

export type WorkItemDetail = WorkItem & {
  subscriber_ids: string[];
  links: WorkItemLinkRow[];
};

export type ListResult<T> = {
  items: T[];
  total: number;
  /** `latestSeq()` at read time so a page can start the change poller without a second query. */
  cursor: number;
};

/**
 * `items` is the loaded union and `total` always counts the whole filtered set.
 * With group paging (decision 113) `groups` carry the full counts, `item_ids`
 * list the loaded page and `has_more` says whether anything is left; the same
 * flag on the result is true when any group (or, with `limit`, the flat list)
 * has more rows than were returned.
 */
export type WorkItemListResult = ListResult<WorkItem> & {
  groups?: Group[];
  has_more?: boolean;
  /** With `include_relations` (the gantt): relations with an end among `items` and the other end in the filtered set. */
  relations?: ListRelation[];
  /** With `include_date_range` (the gantt): the dates of the whole filtered set, whatever page `items` holds. */
  date_range?: DateRange;
};

export const WORK_ITEM_NAME = z.string().trim().min(1).max(255);
export const DESCRIPTION = z.string().max(1_000_000);
/** Largest id list accepted by the set-style mutations. */
export const MAX_IDS = 500;
/** Rows per `IN (...)` batch while hydrating view models (SQLite accepts far more, but keeps statements small). */
export const CHUNK = 500;

export const ENTITY = "work_item";

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Non-deleted work item row by id; NOT_FOUND otherwise. */
export function getWorkItemRow(ctx: TesseraContext, id: string): WorkItemRow {
  const row = ctx.db
    .select()
    .from(work_item)
    .where(and(eq(work_item.id, id), isNull(work_item.deleted_at)))
    .get();
  if (!row) throw notFound(ENTITY, id);
  return row;
}

export type LoadedWorkItem = { item: WorkItemRow; project: ProjectRow };

/** Archived projects are read-only except unarchive and delete. */
export function loadWritableProject(ctx: TesseraContext, projectId: string): ProjectRow {
  const row = getProjectRow(ctx, projectId);
  if (row.archived_at !== null) throw archived(`project ${row.identifier} is archived`);
  return row;
}

/** The item plus its project; refuses archived projects, and archived items unless `allowArchived`. */
export function loadWritableWorkItem(ctx: TesseraContext, id: string, options: { allowArchived?: boolean } = {}): LoadedWorkItem {
  const item = getWorkItemRow(ctx, id);
  const projectRow = loadWritableProject(ctx, item.project_id);
  if (item.archived_at !== null && options.allowArchived !== true) {
    throw archived(`work item ${formatKey(projectRow.identifier, item.sequence_id)} is archived`);
  }
  return { item, project: projectRow };
}

export function itemKey(projectRow: ProjectRow, item: WorkItemRow): string {
  return formatKey(projectRow.identifier, item.sequence_id);
}

/** Human key for any item id, tolerating deleted rows (used for activity identifiers). */
export function keyOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db
    .select({ identifier: project.identifier, sequence_id: work_item.sequence_id })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .where(eq(work_item.id, id))
    .get();
  return row ? formatKey(row.identifier, row.sequence_id) : id;
}

export function cycleNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: cycle.name }).from(cycle).where(eq(cycle.id, id)).get();
  return row?.name ?? id;
}

export function estimatePointValueOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ value: estimate_point.value }).from(estimate_point).where(eq(estimate_point.id, id)).get();
  return row?.value ?? id;
}

export function actorNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: actor.name }).from(actor).where(eq(actor.id, id)).get();
  return row?.name ?? id;
}

export function labelNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: label.name }).from(label).where(eq(label.id, id)).get();
  return row?.name ?? id;
}

export function moduleNameOrId(ctx: TesseraContext, id: string): string {
  const row = ctx.db.select({ name: moduleTable.name }).from(moduleTable).where(eq(moduleTable.id, id)).get();
  return row?.name ?? id;
}

// ---------------------------------------------------------------------------
// Cross-project validation
// ---------------------------------------------------------------------------

export function resolveState(ctx: TesseraContext, projectId: string, stateId: string): StateRow {
  const row = ctx.db
    .select()
    .from(state)
    .where(and(eq(state.id, stateId), isNull(state.deleted_at)))
    .get();
  if (!row) throw notFound("state", stateId);
  if (row.project_id !== projectId) throw rule("state_project", `State "${row.name}" belongs to another project`);
  return row;
}

export function defaultState(ctx: TesseraContext, projectId: string): StateRow {
  const row = ctx.db
    .select()
    .from(state)
    .where(and(eq(state.project_id, projectId), eq(state.is_default, true), isNull(state.deleted_at)))
    .get();
  if (!row) throw rule("no_default_state", "The project has no default state");
  return row;
}

export function resolveCycle(ctx: TesseraContext, projectId: string, cycleId: string): CycleRow {
  const row = ctx.db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), isNull(cycle.deleted_at)))
    .get();
  if (!row) throw notFound("cycle", cycleId);
  if (row.project_id !== projectId) throw rule("cycle_project", `Cycle "${row.name}" belongs to another project`);
  return row;
}

/** The cycle row when it still exists; a deleted cycle has already detached its items, so a stale pointer is simply ignored. */
export function cycleRowIfLive(ctx: TesseraContext, cycleId: string): CycleRow | null {
  return (
    ctx.db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, cycleId), isNull(cycle.deleted_at)))
      .get() ?? null
  );
}

/** Completed cycles are read-only except reorder, archive and transfer; archived ones except unarchive and delete (schema.md "Cycles"). */
export function assertCycleOpen(ctx: TesseraContext, cycleRow: CycleRow): void {
  if (cycleRow.archived_at !== null) throw archived(`cycle "${cycleRow.name}" is archived`);
  if (deriveCycleStatus(cycleRow, ctx.today()) === "completed") {
    throw locked(`cycle "${cycleRow.name}" is completed and read-only; transfer its open items instead`);
  }
}

export function resolveEstimatePoint(ctx: TesseraContext, projectId: string, pointId: string): string {
  const row = ctx.db
    .select({
      value: estimate_point.value,
      project_id: estimate.project_id,
      estimate_id: estimate.id,
      archived_at: estimate.archived_at,
    })
    .from(estimate_point)
    .innerJoin(estimate, eq(estimate_point.estimate_id, estimate.id))
    .where(and(eq(estimate_point.id, pointId), isNull(estimate_point.deleted_at), isNull(estimate.deleted_at)))
    .get();
  if (!row) throw notFound("estimate_point", pointId);
  if (row.project_id !== projectId) throw rule("estimate_point_project", "The estimate point belongs to another project");
  const active = ctx.db.select({ estimate_id: project.estimate_id }).from(project).where(eq(project.id, projectId)).get();
  if (row.archived_at !== null || active?.estimate_id !== row.estimate_id) {
    throw rule("estimate_point_inactive", "The estimate point is not part of the project's active estimate system");
  }
  return row.value;
}

export function resolveLabels(ctx: TesseraContext, projectId: string, ids: string[]): Map<string, LabelRow> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = ctx.db
    .select()
    .from(label)
    .where(and(inArray(label.id, wanted), isNull(label.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of wanted) {
    const row = byId.get(id);
    if (!row) throw notFound("label", id);
    if (row.project_id !== projectId) throw rule("label_project", `Label "${row.name}" belongs to another project`);
  }
  return byId;
}

export function resolveModules(ctx: TesseraContext, projectId: string, ids: string[]): Map<string, ModuleRow> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = ctx.db
    .select()
    .from(moduleTable)
    .where(and(inArray(moduleTable.id, wanted), isNull(moduleTable.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of wanted) {
    const row = byId.get(id);
    if (!row) throw notFound("module", id);
    if (row.project_id !== projectId) throw rule("module_project", `Module "${row.name}" belongs to another project`);
  }
  return byId;
}

/**
 * Items neither join nor leave an archived module: ARCHIVED when one of `ids`
 * (the modules a call adds or removes) is archived. Memberships of archived
 * modules that the call leaves unchanged are kept.
 */
export function assertModulesNotArchived(ctx: TesseraContext, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const row = ctx.db
    .select({ name: moduleTable.name })
    .from(moduleTable)
    .where(and(inArray(moduleTable.id, [...ids]), isNull(moduleTable.deleted_at), isNotNull(moduleTable.archived_at)))
    .orderBy(asc(moduleTable.sort_order), asc(moduleTable.created_at))
    .get();
  if (row) throw archived(`module "${row.name}" is archived`);
}

/** Live actors by id; NOT_FOUND for a deleted or unknown one. */
export function resolveActors(ctx: TesseraContext, ids: string[]): Map<string, string> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = ctx.db
    .select({ id: actor.id, name: actor.name })
    .from(actor)
    .where(and(inArray(actor.id, wanted), isNull(actor.deleted_at)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  for (const id of wanted) if (!byId.has(id)) throw notFound("actor", id);
  return byId;
}

/** Same project, not the item itself, and the parent chain must not lead back to the item. */
export function resolveParent(ctx: TesseraContext, projectId: string, parentId: string, selfId: string | null): WorkItemRow {
  if (parentId === selfId) throw rule("parent_self", "A work item cannot be its own parent");
  const parent = getWorkItemRow(ctx, parentId);
  if (parent.project_id !== projectId) throw rule("parent_project", "The parent must belong to the same project");
  if (selfId !== null) {
    let ancestor: string | null = parent.parent_id;
    const visited = new Set<string>([parent.id]);
    while (ancestor !== null) {
      if (ancestor === selfId) throw rule("parent_cycle", "The parent chain would form a cycle");
      if (visited.has(ancestor)) break;
      visited.add(ancestor);
      const row: { parent_id: string | null } | undefined = ctx.db
        .select({ parent_id: work_item.parent_id })
        .from(work_item)
        .where(eq(work_item.id, ancestor))
        .get();
      ancestor = row?.parent_id ?? null;
    }
  }
  return parent;
}

export function checkDates(start: string | null, target: string | null): void {
  if (start !== null && target !== null && start > target) {
    throw rule("date_order", `start_date ${start} must not be after target_date ${target}`);
  }
}

export function assertNotTriage(stateRow: StateRow): void {
  if (stateRow.state_group === "triage") throw rule("triage_state", "The triage state is reserved for Intake");
}

/** `completed_at` follows the state group: set on entering `completed`, cleared on leaving it. */
export function nextCompletedAt(ctx: TesseraContext, before: StateRow | null, after: StateRow, current: string | null): string | null {
  const wasCompleted = before?.state_group === "completed";
  if (after.state_group === "completed") return wasCompleted && current !== null ? current : ctx.now();
  return null;
}

/** A completed or cancelled item cannot be moved into a cycle (schema.md "Cycles"). */
export function assertCycleAllowed(stateRow: StateRow, cycleRow: CycleRow): void {
  if (stateRow.state_group === "completed" || stateRow.state_group === "cancelled") {
    throw rule("cycle_closed_item", `A ${stateRow.state_group} work item cannot be moved into cycle "${cycleRow.name}"`);
  }
}
