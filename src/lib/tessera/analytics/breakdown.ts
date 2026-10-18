/**
 * Work-items breakdown. One item counts once per value of a multi-valued
 * dimension (assignee, label, module), plus a none bucket, matching getCounts.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TesseraContext } from "../core/context";
import { rule, validation } from "../core/errors";
import { actor, cycle, estimate, estimate_point, label, moduleTable, project, state, work_item, work_item_assignee, work_item_label, work_item_module } from "../db/schema";
import { PrioritySchema, StateGroupSchema } from "../schemas";
import type { AnalyticsBucket, AnalyticsDimension, AnalyticsMeasure, AnalyticsSegmentKey, AnalyticsWorkItems, PaletteColor } from "../types";
import { dimensionRank, enumColor, enumLabel, NONE_KEY } from "./dimensions";
import { isoWeekKey } from "./dates";
import { distributionPopulation } from "./population";

type Item = {
  id: string;
  state_id: string;
  state_group: string;
  state_name: string;
  state_color: PaletteColor;
  priority: string;
  project_id: string;
  created_by: string;
  cycle_id: string | null;
  target_date: string | null;
  points: number;
};

type Catalog = Map<string, { label: string; color: PaletteColor | null }>;

function pointValue(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function assertPoints(ctx: TesseraContext, projectIds: string[]): void {
  if (projectIds.length === 0) throw rule("points_unavailable", "Points need an active points estimate in every project in scope.");
  const ready = ctx.db
    .select({ id: project.id })
    .from(project)
    .innerJoin(estimate, and(eq(estimate.id, project.estimate_id), eq(estimate.type, "points"), isNull(estimate.deleted_at), isNull(estimate.archived_at)))
    .where(and(inArray(project.id, projectIds), eq(project.estimates_enabled, true)))
    .all();
  if (ready.length !== projectIds.length) throw rule("points_unavailable", "Points need an active points estimate in every project in scope.");
}

function loadItems(ctx: TesseraContext, where: ReturnType<typeof distributionPopulation>["where"]): Item[] {
  return ctx.db
    .select({
      id: work_item.id,
      state_id: work_item.state_id,
      state_group: state.state_group,
      state_name: state.name,
      state_color: state.color,
      priority: work_item.priority,
      project_id: work_item.project_id,
      created_by: work_item.created_by,
      cycle_id: work_item.cycle_id,
      target_date: work_item.target_date,
      estimates_enabled: project.estimates_enabled,
      point_value: estimate_point.value,
    })
    .from(work_item)
    .innerJoin(state, eq(work_item.state_id, state.id))
    .innerJoin(project, eq(work_item.project_id, project.id))
    .leftJoin(estimate_point, and(eq(work_item.estimate_point_id, estimate_point.id), isNull(estimate_point.deleted_at)))
    .where(where)
    .all()
    .map((row) => ({
      id: row.id,
      state_id: row.state_id,
      state_group: row.state_group,
      state_name: row.state_name,
      state_color: row.state_color,
      priority: row.priority,
      project_id: row.project_id,
      created_by: row.created_by,
      cycle_id: row.cycle_id,
      target_date: row.target_date,
      points: row.estimates_enabled ? pointValue(row.point_value) : 0,
    }));
}

function groupIds(ctx: TesseraContext, itemIds: string[], table: "assignee" | "label" | "module"): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  if (itemIds.length === 0) return grouped;
  const rows =
    table === "assignee"
      ? ctx.db
          .select({ item: work_item_assignee.work_item_id, key: work_item_assignee.actor_id })
          .from(work_item_assignee)
          .where(inArray(work_item_assignee.work_item_id, itemIds))
          .all()
      : table === "label"
        ? ctx.db
            .select({ item: work_item_label.work_item_id, key: work_item_label.label_id })
            .from(work_item_label)
            .where(inArray(work_item_label.work_item_id, itemIds))
            .all()
        : ctx.db
            .select({ item: work_item_module.work_item_id, key: work_item_module.module_id })
            .from(work_item_module)
            .where(inArray(work_item_module.work_item_id, itemIds))
            .all();
  for (const row of rows) {
    const list = grouped.get(row.item) ?? [];
    list.push(row.key);
    grouped.set(row.item, list);
  }
  return grouped;
}

function valuesOf(item: Item, dimension: AnalyticsDimension, links: { assignee: Map<string, string[]>; label: Map<string, string[]>; module: Map<string, string[]> }): string[] {
  switch (dimension) {
    case "state_group":
      return [item.state_group];
    case "state":
      return [item.state_id];
    case "priority":
      return [item.priority];
    case "project":
      return [item.project_id];
    case "created_by":
      return [item.created_by];
    case "cycle":
      return [item.cycle_id ?? NONE_KEY];
    case "target_week":
      return [item.target_date ? isoWeekKey(item.target_date) : NONE_KEY];
    case "assignee":
      return links.assignee.get(item.id) ?? [NONE_KEY];
    case "label":
      return links.label.get(item.id) ?? [NONE_KEY];
    case "module":
      return links.module.get(item.id) ?? [NONE_KEY];
  }
}

function loadCatalog(ctx: TesseraContext, items: Item[], links: { assignee: Map<string, string[]>; label: Map<string, string[]>; module: Map<string, string[]> }): Record<AnalyticsDimension, Catalog> {
  const states: Catalog = new Map(items.map((item) => [item.state_id, { label: item.state_name, color: item.state_color }]));
  const actorIds = [...new Set([...items.map((item) => item.created_by), ...[...links.assignee.values()].flat()])];
  const actors: Catalog = new Map(
    (actorIds.length === 0
      ? []
      : ctx.db.select({ id: actor.id, name: actor.name, color: actor.color }).from(actor).where(inArray(actor.id, actorIds)).all()
    ).map((row) => [row.id, { label: row.name, color: row.color }]),
  );
  const projectIds = [...new Set(items.map((item) => item.project_id))];
  const projects: Catalog = new Map(
    (projectIds.length === 0
      ? []
      : ctx.db.select({ id: project.id, name: project.name, logo: project.logo }).from(project).where(inArray(project.id, projectIds)).all()
    ).map((row) => [row.id, { label: row.name, color: row.logo?.color ?? null }]),
  );
  const labelIds = [...new Set([...links.label.values()].flat())];
  const labels: Catalog = new Map(
    (labelIds.length === 0
      ? []
      : ctx.db.select({ id: label.id, name: label.name, color: label.color }).from(label).where(inArray(label.id, labelIds)).all()
    ).map((row) => [row.id, { label: row.name, color: row.color }]),
  );
  const cycleIds = [...new Set(items.flatMap((item) => (item.cycle_id ? [item.cycle_id] : [])))];
  const cycles: Catalog = new Map(
    (cycleIds.length === 0 ? [] : ctx.db.select({ id: cycle.id, name: cycle.name }).from(cycle).where(inArray(cycle.id, cycleIds)).all()).map((row) => [
      row.id,
      { label: row.name, color: null },
    ]),
  );
  const moduleIds = [...new Set([...links.module.values()].flat())];
  const modules: Catalog = new Map(
    (moduleIds.length === 0
      ? []
      : ctx.db.select({ id: moduleTable.id, name: moduleTable.name }).from(moduleTable).where(inArray(moduleTable.id, moduleIds)).all()
    ).map((row) => [row.id, { label: row.name, color: null }]),
  );
  return {
    state_group: new Map(),
    state: states,
    priority: new Map(),
    assignee: actors,
    label: labels,
    cycle: cycles,
    module: modules,
    project: projects,
    created_by: actors,
    target_week: new Map(),
  };
}

function describe(dimension: AnalyticsDimension, key: string, catalog: Catalog): { label: string; color: PaletteColor | null } {
  const known = enumLabel(dimension, key);
  if (known !== null && dimension !== "target_week") return { label: known, color: enumColor(dimension, key) };
  if (key === NONE_KEY) return { label: "None", color: "gray" };
  if (dimension === "target_week") return { label: key, color: null };
  return catalog.get(key) ?? { label: key, color: enumColor(dimension, key) };
}

function seedKeys(dimension: AnalyticsDimension): string[] {
  if (dimension === "state_group") return [...StateGroupSchema.options];
  if (dimension === "priority") return [...PrioritySchema.options];
  return [];
}

export function workItemsTab(
  ctx: TesseraContext,
  projectIds: string[] | undefined,
  xAxis: AnalyticsDimension,
  segment: AnalyticsDimension | null,
  measure: AnalyticsMeasure,
): Pick<AnalyticsWorkItems, "buckets" | "segment_keys" | "total"> {
  if (segment !== null && segment === xAxis) throw validation({ segment }, "segment must differ from x_axis");
  const population = distributionPopulation(ctx, projectIds);
  const usesState = xAxis === "state" || segment === "state";
  if (usesState && population.project_ids.length !== 1) throw validation({ x_axis: "state" }, "state is only available for exactly one project");
  if (measure === "points") assertPoints(ctx, population.project_ids);
  const items = loadItems(ctx, population.where);
  const itemIds = items.map((item) => item.id);
  const links = {
    assignee: groupIds(ctx, itemIds, "assignee"),
    label: groupIds(ctx, itemIds, "label"),
    module: groupIds(ctx, itemIds, "module"),
  };
  const catalogs = loadCatalog(ctx, items, links);
  const totals = new Map<string, Map<string, number>>();
  const ensure = (key: string) => {
    const current = totals.get(key) ?? new Map<string, number>();
    totals.set(key, current);
    return current;
  };
  for (const key of seedKeys(xAxis)) ensure(key);
  for (const item of items) {
    const weight = measure === "points" ? item.points : 1;
    for (const x of valuesOf(item, xAxis, links)) {
      const row = ensure(x);
      if (segment === null) {
        row.set(NONE_KEY, (row.get(NONE_KEY) ?? 0) + weight);
        continue;
      }
      for (const y of valuesOf(item, segment, links)) row.set(y, (row.get(y) ?? 0) + weight);
    }
  }
  const segmentKeys = new Set<string>();
  const buckets: AnalyticsBucket[] = [...totals.entries()]
    .map(([key, segments]) => {
      const meta = describe(xAxis, key, catalogs[xAxis]);
      const record: Record<string, number> = {};
      if (segment !== null) {
        for (const [segmentKey, value] of segments) {
          record[segmentKey] = value;
          segmentKeys.add(segmentKey);
        }
      }
      const total = [...segments.values()].reduce((sum, value) => sum + value, 0);
      return { key, label: meta.label, color: meta.color, total, segments: segment === null ? {} : record };
    })
    .sort((a, b) => dimensionRank(xAxis, a.key).localeCompare(dimensionRank(xAxis, b.key)) || a.label.localeCompare(b.label));
  const segment_keys: AnalyticsSegmentKey[] =
    segment === null
      ? []
      : [...segmentKeys]
          .sort((a, b) => dimensionRank(segment, a).localeCompare(dimensionRank(segment, b)) || a.localeCompare(b))
          .map((key) => {
            const meta = describe(segment, key, catalogs[segment]);
            return { key, label: meta.label, color: meta.color };
          });
  const total = measure === "points" ? items.reduce((sum, item) => sum + item.points, 0) : items.length;
  return { buckets, segment_keys, total };
}
