/**
 * Created vs completed per local day, or per ISO week for a 365-day range.
 * Archived items of live projects are included; deleted and triage items are not.
 */
import { eq } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { localDateOf } from "../core/time";
import { state, work_item } from "../db/schema";
import type { AnalyticsRange, TrendPoint } from "../types";
import { eachDay, eachWeek, isoWeekStart, rangeWindow } from "./dates";
import { trendPopulation } from "./population";

export function buildTrend(ctx: TesseraContext, projectIds: string[] | undefined, range: AnalyticsRange): TrendPoint[] {
  const { from, to, weekly } = rangeWindow(ctx.today(), range);
  const population = trendPopulation(ctx, projectIds);
  const rows = ctx.db
    .select({ created_at: work_item.created_at, completed_at: work_item.completed_at, state_group: state.state_group })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(population.where)
    .all();
  const buckets = new Map<string, TrendPoint>();
  for (const day of weekly ? eachWeek(from, to) : eachDay(from, to)) buckets.set(day, { date: day, created: 0, completed: 0 });
  for (const row of rows) {
    const created = localDateOf(row.created_at);
    const createdKey = weekly ? isoWeekStart(created) : created;
    const createdBucket = buckets.get(createdKey);
    if (created >= from && created <= to && createdBucket) createdBucket.created += 1;
    if (row.completed_at === null || row.state_group !== "completed") continue;
    const completed = localDateOf(row.completed_at);
    const completedKey = weekly ? isoWeekStart(completed) : completed;
    const completedBucket = buckets.get(completedKey);
    if (completed >= from && completed <= to && completedBucket) completedBucket.completed += 1;
  }
  return [...buckets.values()];
}
