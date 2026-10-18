/**
 * Cycles and modules tabs. The range keeps cycles that overlap the window.
 * Modules are the current list; the range does not filter them.
 */
import { inArray } from "drizzle-orm";
import { getCycleProgress, listCycles } from "../cycles";
import type { TesseraContext } from "../core/context";
import { listModules } from "../modules";
import { project } from "../db/schema";
import { CycleStatusSchema, ModuleStatusSchema } from "../schemas";
import type { AnalyticsCycles, AnalyticsModules, AnalyticsRange, CycleStatus, ModuleStatus } from "../types";
import { rangeWindow } from "./dates";
import { distributionPopulation } from "./population";

function emptyCycleStatus(): Record<CycleStatus, number> {
  return Object.fromEntries(CycleStatusSchema.options.map((status) => [status, 0])) as Record<CycleStatus, number>;
}

function emptyModuleStatus(): Record<ModuleStatus, number> {
  return Object.fromEntries(ModuleStatusSchema.options.map((status) => [status, 0])) as Record<ModuleStatus, number>;
}

function ratio(completed: number, total: number, cancelled = 0): number {
  const denom = total - cancelled;
  return denom <= 0 ? 0 : completed / denom;
}

function overlaps(start: string | null, end: string | null, from: string, to: string): boolean {
  if (start === null || end === null) return false;
  return start <= to && end >= from;
}

function projectNames(ctx: TesseraContext, ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  return new Map(ctx.db.select({ id: project.id, name: project.name }).from(project).where(inArray(project.id, ids)).all().map((row) => [row.id, row.name]));
}

export function cyclesTab(ctx: TesseraContext, projectIds: string[] | undefined, range: AnalyticsRange): Pick<AnalyticsCycles, "rows" | "by_status"> {
  const { from, to } = rangeWindow(ctx.today(), range);
  const ids = distributionPopulation(ctx, projectIds).project_ids;
  const names = projectNames(ctx, ids);
  const by_status = emptyCycleStatus();
  const rows: AnalyticsCycles["rows"] = [];
  for (const projectId of ids) {
    for (const cycle of listCycles(ctx, projectId)) {
      if (!overlaps(cycle.start_date, cycle.end_date, from, to)) continue;
      const progress = getCycleProgress(ctx, cycle.id, { mode: "points" });
      by_status[cycle.status] += 1;
      rows.push({
        cycle_id: cycle.id,
        project_id: cycle.project_id,
        project_name: names.get(cycle.project_id) ?? "",
        name: cycle.name,
        status: cycle.status,
        start_date: cycle.start_date,
        end_date: cycle.end_date,
        total: cycle.progress.total,
        completed: cycle.progress.completed,
        pending: cycle.progress.total - cycle.progress.completed - cycle.progress.cancelled,
        completion: ratio(cycle.progress.completed, cycle.progress.total, cycle.progress.cancelled),
        points: progress.points ? { total: progress.points.total, completed: progress.points.completed } : null,
      });
    }
  }
  rows.sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? "") || a.name.localeCompare(b.name));
  return { rows, by_status };
}

export function modulesTab(ctx: TesseraContext, projectIds: string[] | undefined): Pick<AnalyticsModules, "rows" | "by_status"> {
  const ids = distributionPopulation(ctx, projectIds).project_ids;
  const names = projectNames(ctx, ids);
  const by_status = emptyModuleStatus();
  const rows: AnalyticsModules["rows"] = [];
  for (const projectId of ids) {
    for (const row of listModules(ctx, projectId)) {
      by_status[row.status] += 1;
      rows.push({
        module_id: row.id,
        project_id: row.project_id,
        project_name: names.get(row.project_id) ?? "",
        name: row.name,
        status: row.status,
        lead_id: row.lead_actor_id,
        target_date: row.target_date,
        total: row.progress.total,
        completed: row.progress.completed,
        completion: ratio(row.progress.completed, row.progress.total, row.progress.cancelled),
      });
    }
  }
  rows.sort((a, b) => a.project_name.localeCompare(b.project_name) || a.name.localeCompare(b.name));
  return { rows, by_status };
}
