/**
 * Counts (docs/contracts/service-api.md "Counts"). One function serves the
 * sidebar badges, list headers, progress bars, analytics, MCP `get_counts`
 * and the assistant, so numbers never disagree.
 *
 * Every scope counts the population `listWorkItems` shows for it: non-deleted,
 * non-archived work items outside the hidden triage state, in live projects
 * for the workspace-wide scopes. The view scope applies the view's saved
 * filters (and its display `type` / `sub_items`) through `filters.buildWhere`,
 * exactly like the list does. A few grouped queries produce every number;
 * nothing loops over items.
 */
import { and, count, eq, gte, inArray, isNull, lt, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getActor } from "./actors";
import type { TesseraContext } from "./core/context";
import { notFound, validateInput } from "./core/errors";
import { addDays } from "./core/time";
import { cycle, estimate_point, moduleTable, project, state, view, work_item, work_item_assignee, work_item_label, work_item_module } from "./db/schema";
import { buildWhere } from "./filters";
import { getProjectRow } from "./projects";
import { DisplaySchema, FiltersSchema, IdSchema, PrioritySchema, StateGroupSchema } from "./schemas";
import type { Display, Filters, Priority, StateGroup } from "./types";

export type Counts = {
  total: number;
  by_state_group: Record<StateGroup, number>;
  /** Item count per state id; only states that hold items appear. */
  by_state: Record<string, number>;
  by_priority: Record<Priority, number>;
  /** Item count per assignee actor id; an item with two assignees counts once per assignee. */
  by_assignee: Record<string, number>;
  /** Item count per label id; an item with two labels counts once per label. */
  by_label: Record<string, number>;
  /** target_date before today and the state group is neither completed nor cancelled. */
  overdue: number;
  /** target_date within [today, today + 6 days], whatever the state. */
  due_this_week: number;
  /** Sum of the numeric estimate point values; only when a project in scope has estimates enabled. */
  total_points?: number;
  completed_points?: number;
};

export const CountsScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace") }).strict(),
  z.object({ type: z.literal("project"), project_id: IdSchema.describe("Project whose items are counted.") }).strict(),
  z.object({ type: z.literal("cycle"), cycle_id: IdSchema.describe("Cycle whose items are counted.") }).strict(),
  z.object({ type: z.literal("module"), module_id: IdSchema.describe("Module whose items are counted.") }).strict(),
  z.object({ type: z.literal("view"), view_id: IdSchema.describe("Saved view whose filters select the items.") }).strict(),
  z.object({ type: z.literal("profile"), actor_id: IdSchema.describe("Actor whose assigned items are counted.") }).strict(),
]);

export type CountsScope = z.infer<typeof CountsScopeSchema>;

export const GetCountsInput = z.object({ scope: CountsScopeSchema.describe("Which population to count.") }).strict();

export type GetCountsInputType = z.input<typeof GetCountsInput>;

/** Groups whose items are not overdue even when their target date has passed. */
const CLOSED_GROUPS: readonly StateGroup[] = ["completed", "cancelled"];

const DUE_WINDOW_DAYS = 6;

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

type ResolvedScope = {
  where: SQL;
  filters: Filters;
  /** The one project the scope belongs to (narrows full-text search), or null for cross-project scopes. */
  project_id: string | null;
  /** Projects whose estimate settings decide whether points are reported. */
  project_ids: string[];
};

function liveProjectIds(ctx: TesseraContext): string[] {
  return ctx.db
    .select({ id: project.id })
    .from(project)
    .where(and(isNull(project.deleted_at), isNull(project.archived_at)))
    .all()
    .map((row) => row.id);
}

/** Items of live (non-deleted, non-archived) projects, as a subquery so no join is needed. */
function inLiveProject(ctx: TesseraContext): SQL {
  return inArray(
    work_item.project_id,
    ctx.db
      .select({ id: project.id })
      .from(project)
      .where(and(isNull(project.deleted_at), isNull(project.archived_at))),
  );
}

/** `Display.type` and `Display.sub_items` act as filters when the filters do not say otherwise (same rule as listWorkItems). */
function withDisplayFilters(filters: Filters, display: Display): Filters {
  return {
    ...filters,
    type: filters.type !== undefined ? filters.type : display.type,
    sub_items: filters.sub_items !== undefined ? filters.sub_items : display.sub_items,
  };
}

function resolveScope(ctx: TesseraContext, scope: CountsScope): ResolvedScope {
  switch (scope.type) {
    case "workspace":
      return { where: inLiveProject(ctx), filters: {}, project_id: null, project_ids: liveProjectIds(ctx) };
    case "project": {
      getProjectRow(ctx, scope.project_id);
      return { where: eq(work_item.project_id, scope.project_id), filters: {}, project_id: scope.project_id, project_ids: [scope.project_id] };
    }
    case "cycle": {
      const row = ctx.db
        .select({ project_id: cycle.project_id })
        .from(cycle)
        .where(and(eq(cycle.id, scope.cycle_id), isNull(cycle.deleted_at)))
        .get();
      if (!row) throw notFound("cycle", scope.cycle_id);
      return { where: eq(work_item.cycle_id, scope.cycle_id), filters: {}, project_id: row.project_id, project_ids: [row.project_id] };
    }
    case "module": {
      const row = ctx.db
        .select({ project_id: moduleTable.project_id })
        .from(moduleTable)
        .where(and(eq(moduleTable.id, scope.module_id), isNull(moduleTable.deleted_at)))
        .get();
      if (!row) throw notFound("module", scope.module_id);
      const member = inArray(
        work_item.id,
        ctx.db.select({ id: work_item_module.work_item_id }).from(work_item_module).where(eq(work_item_module.module_id, scope.module_id)),
      );
      return { where: member, filters: {}, project_id: row.project_id, project_ids: [row.project_id] };
    }
    case "view": {
      const row = ctx.db
        .select({ project_id: view.project_id, filters: view.filters, display: view.display })
        .from(view)
        .where(and(eq(view.id, scope.view_id), isNull(view.deleted_at)))
        .get();
      if (!row) throw notFound("view", scope.view_id);
      const filters = withDisplayFilters(FiltersSchema.parse(row.filters), DisplaySchema.parse(row.display));
      if (row.project_id !== null) {
        return { where: eq(work_item.project_id, row.project_id), filters, project_id: row.project_id, project_ids: [row.project_id] };
      }
      return { where: inLiveProject(ctx), filters, project_id: null, project_ids: liveProjectIds(ctx) };
    }
    case "profile": {
      getActor(ctx, scope.actor_id);
      const assigned = inArray(
        work_item.id,
        ctx.db.select({ id: work_item_assignee.work_item_id }).from(work_item_assignee).where(eq(work_item_assignee.actor_id, scope.actor_id)),
      );
      return { where: and(inLiveProject(ctx), assigned) ?? assigned, filters: {}, project_id: null, project_ids: liveProjectIds(ctx) };
    }
  }
}

// ---------------------------------------------------------------------------
// Grouped queries
// ---------------------------------------------------------------------------

function emptyByGroup(): Record<StateGroup, number> {
  return Object.fromEntries(StateGroupSchema.options.map((group) => [group, 0])) as Record<StateGroup, number>;
}

function emptyByPriority(): Record<Priority, number> {
  return Object.fromEntries(PrioritySchema.options.map((priority) => [priority, 0])) as Record<Priority, number>;
}

type StateCounts = { total: number; by_state_group: Record<StateGroup, number>; by_state: Record<string, number> };

function countByState(ctx: TesseraContext, where: SQL): StateCounts {
  const result: StateCounts = { total: 0, by_state_group: emptyByGroup(), by_state: {} };
  const rows = ctx.db
    .select({ state_id: work_item.state_id, state_group: state.state_group, n: count() })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(where)
    .groupBy(work_item.state_id, state.state_group)
    .all();
  for (const row of rows) {
    result.total += row.n;
    result.by_state_group[row.state_group] += row.n;
    result.by_state[row.state_id] = (result.by_state[row.state_id] ?? 0) + row.n;
  }
  return result;
}

function countByPriority(ctx: TesseraContext, where: SQL): Record<Priority, number> {
  const result = emptyByPriority();
  const rows = ctx.db.select({ priority: work_item.priority, n: count() }).from(work_item).where(where).groupBy(work_item.priority).all();
  for (const row of rows) result[row.priority] += row.n;
  return result;
}

/** Ids of the items in scope, as a subquery for the junction tables. */
function itemIds(ctx: TesseraContext, where: SQL) {
  return ctx.db.select({ id: work_item.id }).from(work_item).where(where);
}

function countByAssignee(ctx: TesseraContext, where: SQL): Record<string, number> {
  const rows = ctx.db
    .select({ actor_id: work_item_assignee.actor_id, n: count() })
    .from(work_item_assignee)
    .where(inArray(work_item_assignee.work_item_id, itemIds(ctx, where)))
    .groupBy(work_item_assignee.actor_id)
    .all();
  return Object.fromEntries(rows.map((row) => [row.actor_id, row.n]));
}

function countByLabel(ctx: TesseraContext, where: SQL): Record<string, number> {
  const rows = ctx.db
    .select({ label_id: work_item_label.label_id, n: count() })
    .from(work_item_label)
    .where(inArray(work_item_label.work_item_id, itemIds(ctx, where)))
    .groupBy(work_item_label.label_id)
    .all();
  return Object.fromEntries(rows.map((row) => [row.label_id, row.n]));
}

function countDates(ctx: TesseraContext, where: SQL): { overdue: number; due_this_week: number } {
  const today = ctx.today();
  const weekEnd = addDays(today, DUE_WINDOW_DAYS);
  const isOverdue = and(lt(work_item.target_date, today), notInArray(state.state_group, [...CLOSED_GROUPS]));
  const isDueThisWeek = and(gte(work_item.target_date, today), lte(work_item.target_date, weekEnd));
  const row = ctx.db
    .select({
      overdue: sql<number>`coalesce(sum(CASE WHEN ${isOverdue} THEN 1 ELSE 0 END), 0)`,
      due_this_week: sql<number>`coalesce(sum(CASE WHEN ${isDueThisWeek} THEN 1 ELSE 0 END), 0)`,
    })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(where)
    .get();
  return { overdue: Number(row?.overdue ?? 0), due_this_week: Number(row?.due_this_week ?? 0) };
}

/** True when a project in scope has an active estimate system, so point totals mean something. */
function pointsEnabled(ctx: TesseraContext, projectIds: string[]): boolean {
  if (projectIds.length === 0) return false;
  const row = ctx.db
    .select({ n: count() })
    .from(project)
    .where(and(inArray(project.id, projectIds), eq(project.estimates_enabled, true), sql`${project.estimate_id} IS NOT NULL`))
    .get();
  return (row?.n ?? 0) > 0;
}

/** `estimate_point.value` as a number; non-numeric values (category names) count as 0, like module progress. */
function pointValue(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Point totals grouped by (state group, point value): a handful of rows per
 * scope, parsed in code so numeric parsing matches cycles and modules. Only
 * points of the project's active estimate system count.
 */
function sumPoints(ctx: TesseraContext, where: SQL): { total_points: number; completed_points: number } {
  const rows = ctx.db
    .select({ state_group: state.state_group, value: estimate_point.value, n: count() })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .innerJoin(project, eq(work_item.project_id, project.id))
    .innerJoin(
      estimate_point,
      and(eq(work_item.estimate_point_id, estimate_point.id), eq(estimate_point.estimate_id, project.estimate_id), isNull(estimate_point.deleted_at)),
    )
    .where(and(where, eq(project.estimates_enabled, true)))
    .groupBy(state.state_group, estimate_point.value)
    .all();
  let total_points = 0;
  let completed_points = 0;
  for (const row of rows) {
    const points = pointValue(row.value) * row.n;
    total_points += points;
    if (row.state_group === "completed") completed_points += points;
  }
  return { total_points, completed_points };
}

// ---------------------------------------------------------------------------
// Public read
// ---------------------------------------------------------------------------

/** Counts for one scope; NOT_FOUND when the scoped entity does not exist. */
export function getCounts(ctx: TesseraContext, scope: CountsScope): Counts {
  const data = validateInput(GetCountsInput, { scope });
  const resolved = resolveScope(ctx, data.scope);
  // buildWhere excludes deleted and triage rows; archived rows are excluded here even when a view asks for them.
  const where = and(resolved.where, isNull(work_item.archived_at), buildWhere(ctx, resolved.filters, { project_id: resolved.project_id })) ?? resolved.where;
  const counts: Counts = {
    ...countByState(ctx, where),
    by_priority: countByPriority(ctx, where),
    by_assignee: countByAssignee(ctx, where),
    by_label: countByLabel(ctx, where),
    ...countDates(ctx, where),
  };
  if (pointsEnabled(ctx, resolved.project_ids)) Object.assign(counts, sumPoints(ctx, where));
  return counts;
}
