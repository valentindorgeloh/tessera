/**
 * Gantt extras of `listWorkItems` (decisions 90 and 92): the date range of the
 * whole filtered set, so a timeline keeps its bounds whichever page is
 * loaded, and the relations that touch the loaded rows. Both are opt-in
 * (`include_date_range`, `include_relations`) and cost one aggregate or one
 * indexed lookup.
 */
import { and, eq, inArray, isNull, max, min, or, type SQL } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { project, work_item, work_item_relation } from "../db/schema";
import type { RelationType } from "../types";
import { chunked } from "./hydrate";
import type { WorkItem } from "./model";

/** One live relation in its canonical direction: `from_id` is `<type>` `to_id` (`A blocked_by B` is from A to B). */
export type ListRelation = { from_id: string; to_id: string; type: RelationType };

/** Earliest and latest `start_date` or `target_date` of the filtered set; both null when no item has a date. */
export type DateRange = { start: string | null; end: string | null };

export type TimelineOptions = { include_relations?: boolean; include_date_range?: boolean };

function earliest(values: (string | null)[]): string | null {
  const dates = values.filter((value): value is string => value !== null);
  return dates.length === 0 ? null : dates.reduce((a, b) => (a <= b ? a : b));
}

function latest(values: (string | null)[]): string | null {
  const dates = values.filter((value): value is string => value !== null);
  return dates.length === 0 ? null : dates.reduce((a, b) => (a >= b ? a : b));
}

/** Min and max date over every row `where` keeps (not just the loaded page). */
export function dateRangeOf(ctx: TesseraContext, where: SQL | undefined): DateRange {
  const row = ctx.db
    .select({
      first_start: min(work_item.start_date),
      last_start: max(work_item.start_date),
      first_target: min(work_item.target_date),
      last_target: max(work_item.target_date),
    })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .where(where)
    .get();
  if (!row) return { start: null, end: null };
  return { start: earliest([row.first_start, row.first_target]), end: latest([row.last_start, row.last_target]) };
}

/**
 * Relations with one end among `items` and the other end inside the filtered
 * set (`where`). A later page of the same list therefore needs no second look
 * at the rows already loaded: an edge between a loaded and a not yet loaded
 * item is already here when the second one arrives.
 */
export function relationsOf(ctx: TesseraContext, where: SQL | undefined, items: readonly WorkItem[]): ListRelation[] {
  if (items.length === 0) return [];
  const inSet = ctx.db.select({ id: work_item.id }).from(work_item).innerJoin(project, eq(work_item.project_id, project.id)).where(where);
  const found = new Map<string, ListRelation>();
  for (const slice of chunked(items.map((item) => item.id))) {
    const rows = ctx.db
      .select({ id: work_item_relation.id, from_id: work_item_relation.work_item_id, to_id: work_item_relation.related_work_item_id, type: work_item_relation.relation_type })
      .from(work_item_relation)
      .where(
        and(
          isNull(work_item_relation.deleted_at),
          or(
            and(inArray(work_item_relation.work_item_id, slice), inArray(work_item_relation.related_work_item_id, inSet)),
            and(inArray(work_item_relation.related_work_item_id, slice), inArray(work_item_relation.work_item_id, inSet)),
          ),
        ),
      )
      .all();
    for (const row of rows) found.set(row.id, { from_id: row.from_id, to_id: row.to_id, type: row.type });
  }
  return [...found.values()].sort((a, b) => a.from_id.localeCompare(b.from_id) || a.to_id.localeCompare(b.to_id));
}

/** Adds the opted-in extras to a list result. */
export function withTimeline<T extends { items: WorkItem[] }>(ctx: TesseraContext, result: T, where: SQL | undefined, options: TimelineOptions): T & { relations?: ListRelation[]; date_range?: DateRange } {
  const out: T & { relations?: ListRelation[]; date_range?: DateRange } = { ...result };
  if (options.include_relations === true) out.relations = relationsOf(ctx, where, result.items);
  if (options.include_date_range === true) out.date_range = dateRangeOf(ctx, where);
  return out;
}
