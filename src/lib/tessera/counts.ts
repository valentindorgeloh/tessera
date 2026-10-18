/**
 * Counts (docs/contracts/service-api.md "Counts"). One function serves the
 * sidebar badges, list headers, progress bars, analytics, MCP `get_counts`
 * and the assistant, so numbers never disagree.
 *
 * Every scope counts the population `listWorkItems` shows for it: non-deleted,
 * non-archived work items outside the hidden triage state, in live projects
 * for the workspace-wide scopes. The view scope applies the view's saved
 * filters and rich filter tree (and its display `type` / `sub_items`) through
 * `buildWhere` and `buildRichWhere`, exactly like the list does. A few grouped queries produce every number;
 * nothing loops over items.
 */
import { and, count, eq, gte, inArray, isNull, lt, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getActor } from "./actors";
import type { TesseraContext } from "./core/context";
import { notFound, validateInput } from "./core/errors";
import { addDays } from "./core/time";
import { cycle, estimate, estimate_point, moduleTable, project, state, view, work_item, work_item_assignee, work_item_label, work_item_module, work_item_subscriber } from "./db/schema";
import { buildWhere } from "./filters";
import { buildRichWhere } from "./rich-filters";
import { getProjectRow } from "./projects";
import { DisplaySchema, FiltersSchema, IdSchema, PrioritySchema, ProfileCountsTabSchema, RichFiltersSchema, StateGroupSchema } from "./schemas";
import type { Display, Filters, Priority, RichFilters, StateGroup } from "./types";

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
  z
    .object({
      type: z.literal("workspace"),
      project_ids: z.array(IdSchema).min(1).max(50).optional().describe("Live projects to count. Omit for every live project."),
    })
    .strict(),
  z.object({ type: z.literal("project"), project_id: IdSchema.describe("Project whose items are counted.") }).strict(),
  z.object({ type: z.literal("cycle"), cycle_id: IdSchema.describe("Cycle whose items are counted.") }).strict(),
  z.object({ type: z.literal("module"), module_id: IdSchema.describe("Module whose items are counted.") }).strict(),
  z.object({ type: z.literal("view"), view_id: IdSchema.describe("Saved view whose filters select the items.") }).strict(),
  z
    .object({
      type: z.literal("profile"),
      actor_id: IdSchema.describe("Actor whose items are counted."),
      tab: ProfileCountsTabSchema.optional().describe("Assigned, created or subscribed items. Defaults to assigned."),
    })
    .strict(),
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
  /** The view's saved tree; other scopes have none. */
  rich_filters: RichFilters | null;
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

function resolveWorkspaceProjects(ctx: TesseraContext, projectIds: string[] | undefined): { where: SQL; project_ids: string[] } {
  if (projectIds === undefined) return { where: inLiveProject(ctx), project_ids: liveProjectIds(ctx) };
  const unique = [...new Set(projectIds)];
  const live = new Set(liveProjectIds(ctx));
  for (const id of unique) {
    if (live.has(id)) continue;
    getProjectRow(ctx, id);
    throw notFound("project", id);
  }
  return { where: inArray(work_item.project_id, unique), project_ids: unique };
}

function resolveScope(ctx: TesseraContext, scope: CountsScope): ResolvedScope {
  switch (scope.type) {
    case "workspace": {
      const resolved = resolveWorkspaceProjects(ctx, scope.project_ids);
      return { where: resolved.where, filters: {}, rich_filters: null, project_id: null, project_ids: resolved.project_ids };
    }
    case "project": {
      getProjectRow(ctx, scope.project_id);
      return { where: eq(work_item.project_id, scope.project_id), filters: {}, rich_filters: null, project_id: scope.project_id, project_ids: [scope.project_id] };
    }
    case "cycle": {
      const row = ctx.db
        .select({ project_id: cycle.project_id })
        .from(cycle)
        .where(and(eq(cycle.id, scope.cycle_id), isNull(cycle.deleted_at)))
        .get();
      if (!row) throw notFound("cycle", scope.cycle_id);
      return { where: eq(work_item.cycle_id, scope.cycle_id), filters: {}, rich_filters: null, project_id: row.project_id, project_ids: [row.project_id] };
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
      return { where: member, filters: {}, rich_filters: null, project_id: row.project_id, project_ids: [row.project_id] };
    }
    case "view": {
      const row = ctx.db
        .select({ project_id: view.project_id, filters: view.filters, rich_filters: view.rich_filters, display: view.display })
        .from(view)
        .where(and(eq(view.id, scope.view_id), isNull(view.deleted_at)))
        .get();
      if (!row) throw notFound("view", scope.view_id);
      const filters = withDisplayFilters(FiltersSchema.parse(row.filters), DisplaySchema.parse(row.display));
      const rich_filters = row.rich_filters === null ? null : RichFiltersSchema.parse(row.rich_filters);
      if (row.project_id !== null) {
        return { where: eq(work_item.project_id, row.project_id), filters, rich_filters, project_id: row.project_id, project_ids: [row.project_id] };
      }
      return { where: inLiveProject(ctx), filters, rich_filters, project_id: null, project_ids: liveProjectIds(ctx) };
    }
    case "profile": {
      getActor(ctx, scope.actor_id);
      const tab = scope.tab ?? "assigned";
      const relation =
        tab === "created"
          ? eq(work_item.created_by, scope.actor_id)
          : inArray(
              work_item.id,
              tab === "subscribed"
                ? ctx.db.select({ id: work_item_subscriber.work_item_id }).from(work_item_subscriber).where(eq(work_item_subscriber.actor_id, scope.actor_id))
                : ctx.db.select({ id: work_item_assignee.work_item_id }).from(work_item_assignee).where(eq(work_item_assignee.actor_id, scope.actor_id)),
            );
      return { where: and(inLiveProject(ctx), relation) ?? relation, filters: {}, rich_filters: null, project_id: null, project_ids: liveProjectIds(ctx) };
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
    .innerJoin(estimate, and(eq(estimate.id, project.estimate_id), eq(estimate.type, "points"), isNull(estimate.deleted_at), isNull(estimate.archived_at)))
    .where(and(inArray(project.id, projectIds), eq(project.estimates_enabled, true)))
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
    .innerJoin(estimate, and(eq(estimate.id, project.estimate_id), eq(estimate.type, "points"), isNull(estimate.deleted_at), isNull(estimate.archived_at)))
    .innerJoin(
      estimate_point,
      and(eq(work_item.estimate_point_id, estimate_point.id), eq(estimate_point.estimate_id, estimate.id), isNull(estimate_point.deleted_at)),
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
// Taxonomy usage (P4 A6)
// ---------------------------------------------------------------------------

/** Work items per state and per label of one project, for the settings screens. */
export type TaxonomyUsage = { states: Record<string, number>; labels: Record<string, number> };

/**
 * Counts the project's non-deleted work items, archived and triage ones
 * included: the population `deleteState` moves and `deleteLabel` strips. An id
 * with no items is absent. NOT_FOUND for an unknown project.
 */
export function getTaxonomyUsage(ctx: TesseraContext, projectId: string): TaxonomyUsage {
  getProjectRow(ctx, projectId);
  const live = and(eq(work_item.project_id, projectId), isNull(work_item.deleted_at));
  const stateRows = ctx.db.select({ id: work_item.state_id, n: count() }).from(work_item).where(live).groupBy(work_item.state_id).all();
  const labelRows = ctx.db
    .select({ id: work_item_label.label_id, n: count() })
    .from(work_item_label)
    .innerJoin(work_item, eq(work_item_label.work_item_id, work_item.id))
    .where(live)
    .groupBy(work_item_label.label_id)
    .all();
  return {
    states: Object.fromEntries(stateRows.map((row) => [row.id, row.n])),
    labels: Object.fromEntries(labelRows.map((row) => [row.id, row.n])),
  };
}

// ---------------------------------------------------------------------------
// Public read
// ---------------------------------------------------------------------------

export type CountsPopulation = { where: SQL; project_ids: string[] };

/**
 * The WHERE getCounts uses. Analytics reads this so its totals cannot drift.
 * includeArchived keeps deleted and triage rows out but leaves archived items in (trend series).
 */
export function countsPopulation(ctx: TesseraContext, scope: CountsScope, options?: { includeArchived?: boolean }): CountsPopulation {
  const data = validateInput(GetCountsInput, { scope });
  const resolved = resolveScope(ctx, data.scope);
  const filters: Filters = options?.includeArchived ? { ...resolved.filters, archived: true } : resolved.filters;
  const archivedClause = options?.includeArchived ? undefined : isNull(work_item.archived_at);
  const rich = resolved.rich_filters === null ? undefined : buildRichWhere(ctx, resolved.rich_filters, { today: ctx.today() });
  const where = and(resolved.where, archivedClause, buildWhere(ctx, filters, { project_id: resolved.project_id }), rich) ?? resolved.where;
  return { where, project_ids: resolved.project_ids };
}

/** Counts for one scope; NOT_FOUND when the scoped entity does not exist. */
export function getCounts(ctx: TesseraContext, scope: CountsScope): Counts {
  const population = countsPopulation(ctx, scope);
  const counts: Counts = {
    ...countByState(ctx, population.where),
    by_priority: countByPriority(ctx, population.where),
    by_assignee: countByAssignee(ctx, population.where),
    by_label: countByLabel(ctx, population.where),
    ...countDates(ctx, population.where),
  };
  if (pointsEnabled(ctx, population.project_ids)) Object.assign(counts, sumPoints(ctx, population.where));
  return counts;
}
