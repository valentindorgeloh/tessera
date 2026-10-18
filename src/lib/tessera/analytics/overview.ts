/**
 * Overview tab. The numbers it shares with Counts come from getCounts.
 */
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getActiveCycles } from "../cycles";
import { getCounts } from "../counts";
import type { TesseraContext } from "../core/context";
import { actor, project, state, work_item, work_item_assignee } from "../db/schema";
import type { AnalyticsOverview, AnalyticsRange } from "../types";
import { distributionPopulation } from "./population";
import { buildTrend } from "./trend";

function scopeOf(projectIds: string[] | undefined) {
  return projectIds === undefined ? ({ type: "workspace" } as const) : ({ type: "workspace", project_ids: projectIds } as const);
}

export function overviewTab(
  ctx: TesseraContext,
  projectIds: string[] | undefined,
  range: AnalyticsRange,
): Pick<AnalyticsOverview, "kpis" | "by_state_group" | "by_priority" | "trend" | "top_assignees" | "projects"> {
  const population = distributionPopulation(ctx, projectIds);
  const counts = getCounts(ctx, scopeOf(projectIds));
  const open = counts.total - counts.by_state_group.completed - counts.by_state_group.cancelled;
  const scopeIds = new Set(population.project_ids);
  const active_cycles = getActiveCycles(ctx).filter((cycle) => scopeIds.has(cycle.project_id)).length;
  return {
    kpis: {
      projects: population.project_ids.length,
      work_items: counts.total,
      open,
      completed: counts.by_state_group.completed,
      overdue: counts.overdue,
      due_this_week: counts.due_this_week,
      active_cycles,
      active_agents: countAgents(ctx),
    },
    by_state_group: counts.by_state_group,
    by_priority: counts.by_priority,
    trend: buildTrend(ctx, projectIds, range),
    top_assignees: topAssignees(ctx, population.where),
    projects: projectRows(ctx, population.project_ids, population.where),
  };
}

function countAgents(ctx: TesseraContext): number {
  return (
    ctx.db
      .select({ n: count() })
      .from(actor)
      .where(and(isNull(actor.deleted_at), inArray(actor.kind, ["assistant", "agent", "system"])))
      .get()?.n ?? 0
  );
}

function topAssignees(ctx: TesseraContext, where: ReturnType<typeof distributionPopulation>["where"]): AnalyticsOverview["top_assignees"] {
  const rows = ctx.db
    .select({ actor_id: work_item_assignee.actor_id, name: actor.name, state_group: state.state_group, n: count() })
    .from(work_item_assignee)
    .innerJoin(work_item, eq(work_item_assignee.work_item_id, work_item.id))
    .innerJoin(state, eq(work_item.state_id, state.id))
    .innerJoin(actor, eq(work_item_assignee.actor_id, actor.id))
    .where(where)
    .groupBy(work_item_assignee.actor_id, actor.name, state.state_group)
    .all();
  const folded = new Map<string, { actor_id: string; name: string; open: number; completed: number }>();
  for (const row of rows) {
    const current = folded.get(row.actor_id) ?? { actor_id: row.actor_id, name: row.name, open: 0, completed: 0 };
    if (row.state_group === "completed") current.completed += row.n;
    else if (row.state_group !== "cancelled") current.open += row.n;
    folded.set(row.actor_id, current);
  }
  return [...folded.values()].sort((a, b) => b.open - a.open || b.completed - a.completed || a.name.localeCompare(b.name)).slice(0, 8);
}

function projectRows(ctx: TesseraContext, projectIds: string[], where: ReturnType<typeof distributionPopulation>["where"]): AnalyticsOverview["projects"] {
  const meta = new Map(
    (projectIds.length === 0
      ? []
      : ctx.db.select({ id: project.id, name: project.name, identifier: project.identifier, logo: project.logo }).from(project).where(inArray(project.id, projectIds)).all()
    ).map((row) => [row.id, row]),
  );
  const counts = new Map<string, { total: number; open: number; completed: number }>();
  for (const id of projectIds) counts.set(id, { total: 0, open: 0, completed: 0 });
  const rows = ctx.db
    .select({ id: work_item.project_id, state_group: state.state_group, n: count() })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(where)
    .groupBy(work_item.project_id, state.state_group)
    .all();
  for (const row of rows) {
    const current = counts.get(row.id) ?? { total: 0, open: 0, completed: 0 };
    current.total += row.n;
    if (row.state_group === "completed") current.completed += row.n;
    else if (row.state_group !== "cancelled") current.open += row.n;
    counts.set(row.id, current);
  }
  return projectIds.flatMap((id) => {
    const row = meta.get(id);
    const numbers = counts.get(id) ?? { total: 0, open: 0, completed: 0 };
    if (!row) return [];
    return [{ id, name: row.name, identifier: row.identifier, logo: row.logo, ...numbers }];
  });
}
