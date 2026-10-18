/**
 * Group paging for `listWorkItems` (decisions 112 and 113). The engine reads a
 * narrow projection of the whole filtered set (ids plus the group-by keys, in
 * display order), groups it with `groupItems`, takes each group's page of ids
 * and hydrates only the union, so group counts, `total` and `has_more` are
 * exact whatever the page holds.
 */
import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { latestSeq } from "../activity";
import type { TesseraContext } from "../core/context";
import { validation } from "../core/errors";
import { groupLimitKey } from "../core/group";
import { estimate, estimate_point, project, work_item, work_item_assignee, work_item_label, work_item_module } from "../db/schema";
import { buildOrder, groupItems, type Group, type GroupableItem } from "../filters";
import type { Display } from "../types";
import type { WorkItem, WorkItemListResult } from "./model";
import { chunked, hydrate, itemQuery } from "./hydrate";

/** Rows per group (or board cell) when a paged request names none. */
export const DEFAULT_PER_GROUP = 50;

/** The paging keys of `ListWorkItemsInput`. */
export type PagingInput = {
  per_group_limit?: number;
  group_value?: string;
  sub_group_value?: string;
  group_limits?: Record<string, number>;
  limit?: number;
  offset?: number;
};

export type GroupPagePlan = {
  /** Rows per leaf group (a group, or a sub-group cell on a board). */
  per_group: number;
  /** Per-leaf overrides keyed by group id or `groupLimitKey(group, sub)`; a cell key beats its group key. */
  limits: Record<string, number>;
  offset: number;
  /** Set when one group (or one cell) is requested. */
  only?: { group: string; sub?: string };
};

function pagingError(path: string, message: string): ReturnType<typeof validation> {
  return validation([{ code: "custom", path: [path], message }], `Invalid input: ${path}: ${message}`);
}

/**
 * Decides whether a request pages by group. Null means today's path: no
 * `group_by`, or none of `per_group_limit`, `group_value`, `group_limits`
 * (plain `limit` / `offset` keep paging the flat item list). `group_value`
 * needs `display.group_by` and `sub_group_value` needs `group_value` and
 * `display.sub_group_by` (VALIDATION); `per_group_limit` and `group_limits` on
 * an ungrouped list are ignored, so a caller can send them by layout.
 */
export function planGroupPaging(input: PagingInput, display: Display): GroupPagePlan | null {
  if (input.group_value !== undefined && display.group_by === null) throw pagingError("group_value", "group_value needs display.group_by");
  if (input.sub_group_value !== undefined) {
    if (input.group_value === undefined) throw pagingError("sub_group_value", "sub_group_value needs group_value");
    if (display.sub_group_by === null) throw pagingError("sub_group_value", "sub_group_value needs display.sub_group_by");
  }
  if (display.group_by === null) return null;
  if (input.per_group_limit === undefined && input.group_value === undefined && input.group_limits === undefined) return null;
  if (input.group_value !== undefined) {
    // One group (or cell) is requested: `limit` / `offset` page inside it.
    return {
      per_group: input.limit ?? input.per_group_limit ?? DEFAULT_PER_GROUP,
      limits: {},
      offset: input.offset ?? 0,
      only: { group: input.group_value, sub: input.sub_group_value },
    };
  }
  return { per_group: input.per_group_limit ?? DEFAULT_PER_GROUP, limits: input.group_limits ?? {}, offset: 0 };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** A projection row: what `groupItems` reads plus the numeric points estimate (null without one). */
export type GroupRow = GroupableItem & { estimate_points: number | null };

/** `estimate_point.value` of the item when its project counts points, like `getCounts` does. */
const POINT_VALUE = sql<string | null>`(SELECT ${estimate_point.value} FROM ${estimate_point} INNER JOIN ${estimate} ON ${estimate.id} = ${estimate_point.estimate_id} WHERE ${estimate_point.id} = ${work_item.estimate_point_id} AND ${estimate_point.deleted_at} IS NULL AND ${estimate.id} = ${project.estimate_id} AND ${estimate.type} = 'points' AND ${estimate.deleted_at} IS NULL AND ${estimate.archived_at} IS NULL AND ${project.estimates_enabled} = 1)`;

/** True when some project counts points; otherwise the per-row estimate lookup is skipped. */
function anyPointsEstimate(ctx: TesseraContext): boolean {
  return (
    ctx.db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.estimates_enabled, true), isNotNull(project.estimate_id)))
      .limit(1)
      .get() !== undefined
  );
}

function pointValue(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

type BuiltQuery = { toSQL(): { sql: string; params: unknown[] } };

/**
 * Runs a drizzle query on the raw driver and returns positional rows. The
 * projection reads up to every item of a project, where object mapping alone
 * costs more than the statement (decision 115 budgets the first page at 40 ms).
 */
function rawRows(ctx: TesseraContext, query: BuiltQuery): unknown[][] {
  const { sql: text, params } = query.toSQL();
  return ctx.sqlite.prepare(text).raw().all(...params) as unknown[][];
}

function toLists(pairs: unknown[][]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [k, v] of pairs as [string, string][]) {
    const list = map.get(k);
    if (list) list.push(v);
    else map.set(k, [v]);
  }
  return map;
}

/**
 * Every item of the filtered set in display order with only the keys grouping
 * needs. Multi-valued keys (labels, assignees, modules) come from one list
 * read each over the same WHERE, only for the fields the display groups by; the
 * other lists stay empty.
 */
export function groupKeyRows(ctx: TesseraContext, where: SQL | undefined, display: Display): GroupRow[] {
  const rows = rawRows(
    ctx,
    ctx.db
      .select({
        id: work_item.id,
        project_id: work_item.project_id,
        state_id: work_item.state_id,
        priority: work_item.priority,
        cycle_id: work_item.cycle_id,
        created_by: work_item.created_by,
        start_date: work_item.start_date,
        target_date: work_item.target_date,
        created_at: work_item.created_at,
        point_value: anyPointsEstimate(ctx) ? POINT_VALUE : sql<string | null>`NULL`,
      })
      .from(work_item)
      .innerJoin(project, eq(work_item.project_id, project.id))
      .where(where)
      .orderBy(...buildOrder(display)),
  );
  const fields = [display.group_by, display.sub_group_by];
  // One statement per multi-valued list over the same WHERE instead of a chunked IN per 500 ids (decision 113 allows either).
  const inSet = ctx.db.select({ id: work_item.id }).from(work_item).innerJoin(project, eq(work_item.project_id, project.id)).where(where);
  const labels = fields.includes("labels")
    ? toLists(rawRows(ctx, ctx.db.select({ k: work_item_label.work_item_id, v: work_item_label.label_id }).from(work_item_label).where(inArray(work_item_label.work_item_id, inSet))))
    : null;
  const modules = fields.includes("module")
    ? toLists(rawRows(ctx, ctx.db.select({ k: work_item_module.work_item_id, v: work_item_module.module_id }).from(work_item_module).where(inArray(work_item_module.work_item_id, inSet))))
    : null;
  const assignees = fields.includes("assignees")
    ? toLists(rawRows(ctx, ctx.db.select({ k: work_item_assignee.work_item_id, v: work_item_assignee.actor_id }).from(work_item_assignee).where(inArray(work_item_assignee.work_item_id, inSet))))
    : null;
  return rows.map((row) => {
    const id = row[0] as string;
    return {
      id,
      project_id: row[1] as string,
      state_id: row[2] as string,
      priority: row[3] as GroupRow["priority"],
      cycle_id: row[4] as string | null,
      created_by: row[5] as string,
      start_date: row[6] as string | null,
      target_date: row[7] as string | null,
      created_at: row[8] as string,
      label_ids: labels?.get(id) ?? [],
      module_ids: modules?.get(id) ?? [],
      assignee_ids: assignees?.get(id) ?? [],
      estimate_points: pointValue(row[9] as string | null),
    };
  });
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

function pageOf(ids: string[], size: number, offset: number): { ids: string[]; has_more: boolean } {
  const page = ids.slice(offset, offset + size);
  return { ids: page, has_more: offset + page.length < ids.length };
}

/**
 * Takes the page of ids of every leaf group: a group, or each sub-group cell
 * of a group that has sub-groups. `count` stays the full count; `item_ids` is
 * the page and `has_more` says whether more follow. A group with sub-groups
 * lists the loaded ids of its cells (in its own order) and is `has_more` when
 * any cell is. `only` keeps one group (and one of its cells). Returns the
 * paged groups and the ids they load, each once, in order of appearance.
 */
export function pageGroups(
  groups: Group[],
  perGroup: number,
  limits: Record<string, number> = {},
  offset = 0,
  only?: GroupPagePlan["only"],
): { groups: Group[]; ids: string[] } {
  const loaded = new Set<string>();
  const ids: string[] = [];
  const take = (page: string[]) => {
    for (const id of page) {
      if (loaded.has(id)) continue;
      loaded.add(id);
      ids.push(id);
    }
  };
  const paged: Group[] = [];
  for (const group of groups) {
    if (only !== undefined && group.id !== only.group) continue;
    if (group.sub_groups === undefined) {
      const page = pageOf(group.item_ids, limits[group.id] ?? perGroup, offset);
      take(page.ids);
      paged.push({ ...group, item_ids: page.ids, has_more: page.has_more });
      continue;
    }
    const cells = group.sub_groups
      .filter((cell) => only?.sub === undefined || cell.id === only.sub)
      .map((cell) => {
        const page = pageOf(cell.item_ids, limits[groupLimitKey(group.id, cell.id)] ?? limits[group.id] ?? perGroup, offset);
        return { ...cell, item_ids: page.ids, has_more: page.has_more };
      });
    const own = new Set(cells.flatMap((cell) => cell.item_ids));
    const groupIds = group.item_ids.filter((id) => own.has(id));
    take(groupIds);
    paged.push({ ...group, item_ids: groupIds, has_more: cells.some((cell) => cell.has_more), sub_groups: cells });
  }
  return { groups: paged, ids };
}

/** Sets `estimate_points` on a group and its sub-groups from the full projection. */
function addPoints(groups: Group[], points: Map<string, number>): void {
  for (const group of groups) {
    group.estimate_points = group.item_ids.reduce((sum, id) => sum + (points.get(id) ?? 0), 0);
    if (group.sub_groups !== undefined) addPoints(group.sub_groups, points);
  }
}

/** View models of `ids` in that order, hydrated in chunks. */
function hydrateInOrder(ctx: TesseraContext, ids: string[]): WorkItem[] {
  const byId = new Map<string, WorkItem>();
  for (const slice of chunked(ids)) {
    const rows = itemQuery(ctx).where(inArray(work_item.id, slice)).all();
    for (const item of hydrate(ctx, rows)) byId.set(item.id, item);
  }
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
}

/**
 * The grouped list of decision 113: exact group counts and `total` over the
 * whole filtered set, `item_ids` and `items` limited to the requested pages.
 * `items` is the union of the loaded ids in display order. `where` is the
 * list's own WHERE, so filters, rich filters and cross-project scopes apply
 * unchanged.
 */
export function listGroupPage(
  ctx: TesseraContext,
  request: { where: SQL | undefined; display: Display; project_ids: string[]; plan: GroupPagePlan },
): WorkItemListResult {
  const { display, plan } = request;
  const rows = groupKeyRows(ctx, request.where, display);
  const groups = groupItems(ctx, rows, display, { project_ids: request.project_ids });
  const points = new Map<string, number>();
  for (const row of rows) if (row.estimate_points !== null) points.set(row.id, row.estimate_points);
  if (points.size > 0) addPoints(groups, points);
  const paged = pageGroups(groups, plan.per_group, plan.limits, plan.offset, plan.only);
  const position = new Map(rows.map((row, index) => [row.id, index]));
  const ordered = [...paged.ids].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
  return {
    items: hydrateInOrder(ctx, ordered),
    total: rows.length,
    cursor: latestSeq(ctx),
    groups: paged.groups,
    has_more: paged.groups.some((group) => group.has_more),
  };
}
