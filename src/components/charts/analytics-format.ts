/**
 * Analytics URL, labels and chart shaping (docs/drafts/p9-plan.md U4).
 * Pure and client-safe: zod, schemas and time helpers only. The chart shows
 * the first 11 buckets plus "Other"; the table shows every bucket.
 */
import { z } from "zod";
import type {
  AnalyticsBucket,
  AnalyticsDimension,
  AnalyticsFilters,
  AnalyticsMeasure,
  AnalyticsRange,
  AnalyticsResult,
  AnalyticsSearch,
  AnalyticsTab,
  CyclesAnalytics,
  ModulesAnalytics,
  OverviewAnalytics,
  TrendPoint,
  WorkItemsAnalytics,
} from "@/components/analytics/types";
import { ANALYTICS_DIMENSIONS, ANALYTICS_RANGES, ANALYTICS_TABS } from "@/components/analytics/types";
import { encodeUrlState } from "@/components/work-items/url-state";
import { addDays } from "@/lib/tessera/core/time";
import { IdSchema } from "@/lib/tessera/schemas";
import type { Filters, StateGroup } from "@/lib/tessera/types";

export const CHART_BUCKET_LIMIT = 11;
export const CYCLE_CHART_LIMIT = 12;
export const OTHER_KEY = "other";
export const OTHER_LABEL = "Other";
export const POINTS_UNAVAILABLE = "Points need an active points estimate in every project in this view.";

const PROJECT_ID_LIMIT = 50;
const OPEN_GROUPS = ["backlog", "unstarted", "started"] as const satisfies readonly StateGroup[];

export const AnalyticsTabSchema = z.enum(ANALYTICS_TABS);
export const AnalyticsRangeSchema = z.enum(ANALYTICS_RANGES);
export const AnalyticsDimensionSchema = z.enum(ANALYTICS_DIMENSIONS);
export const AnalyticsMeasureSchema = z.enum(["count", "points"]);

export const DIMENSION_LABELS: Record<AnalyticsDimension, string> = {
  state_group: "State group",
  state: "State",
  priority: "Priority",
  assignee: "Assignee",
  label: "Label",
  cycle: "Cycle",
  module: "Module",
  project: "Project",
  created_by: "Created by",
  target_week: "Target week",
};

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  "365d": "1y",
};

export const TAB_LABELS: Record<AnalyticsTab, string> = {
  overview: "Overview",
  "work-items": "Work items",
  cycles: "Cycles",
  modules: "Modules",
};

const STATE_GROUP_LABELS: Record<string, string> = {
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  cancelled: "Cancelled",
  triage: "Triage",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

const STATUS_LABELS: Record<string, string> = {
  current: "Current",
  upcoming: "Upcoming",
  draft: "Draft",
  planned: "Planned",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
  backlog: "Backlog",
};

export function dimensionLabel(dimension: AnalyticsDimension): string {
  return DIMENSION_LABELS[dimension];
}

export function statusLabel(key: string): string {
  return STATUS_LABELS[key] ?? STATE_GROUP_LABELS[key] ?? PRIORITY_LABELS[key] ?? humanizeKey(key);
}

export function distributionLabel(key: string): string {
  return STATE_GROUP_LABELS[key] ?? PRIORITY_LABELS[key] ?? statusLabel(key);
}

/** "state_group" → "State group". A `none` bucket reads "None". */
export function humanizeKey(key: string): string {
  if (key === "none" || key === "") return "None";
  const text = key.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Rounds to one decimal at most, dropping a trailing ".0". */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function measureUnit(measure: AnalyticsMeasure, value: number): string {
  const text = formatCount(value);
  if (measure === "points") return `${text} ${text === "1" ? "point" : "points"}`;
  return `${text} ${text === "1" ? "work item" : "work items"}`;
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function parseProjectIds(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!IdSchema.safeParse(id).success || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === PROJECT_ID_LIMIT) break;
  }
  return ids;
}

/**
 * `projects`, `range`, `x`, `segment` and `measure`, each caught back to the
 * default. `state` is only kept when the URL names exactly one project.
 * A segment equal to the x axis is dropped.
 */
export function parseAnalyticsParams(search: AnalyticsSearch): AnalyticsFilters {
  const projectIds = parseProjectIds(first(search.projects));
  const range = AnalyticsRangeSchema.catch("30d").parse(first(search.range));
  let xAxis = AnalyticsDimensionSchema.catch("state_group").parse(first(search.x));
  if (xAxis === "state" && projectIds.length !== 1) xAxis = "state_group";
  const segmentRaw = first(search.segment);
  const segmentParsed =
    segmentRaw === undefined || segmentRaw === "" || segmentRaw === "none" ? null : AnalyticsDimensionSchema.safeParse(segmentRaw);
  let segment: AnalyticsDimension | null = segmentParsed && segmentParsed.success ? segmentParsed.data : null;
  if (segment === xAxis) segment = null;
  const measure = AnalyticsMeasureSchema.catch("count").parse(first(search.measure));
  return { projectIds, range, xAxis, segment, measure };
}

/** Drops project ids that are not live, then reapplies the state and points rules. */
export function normalizeFilters(
  filters: AnalyticsFilters,
  liveIds: readonly string[],
  pointsOk: boolean,
): AnalyticsFilters {
  const projectIds = filters.projectIds.filter((id) => liveIds.includes(id));
  let xAxis = filters.xAxis;
  if (xAxis === "state" && projectIds.length !== 1) xAxis = "state_group";
  const segment = filters.segment === xAxis ? null : filters.segment;
  const measure = filters.measure === "points" && !pointsOk ? "count" : filters.measure;
  return { projectIds, range: filters.range, xAxis, segment, measure };
}

export function pointsAvailable(projects: readonly { id: string; estimate_type: string | null }[], projectIds: readonly string[]): boolean {
  const scope = projectIds.length === 0 ? projects : projects.filter((project) => projectIds.includes(project.id));
  return scope.length > 0 && scope.every((project) => project.estimate_type === "points");
}

/** `<tab>:<sorted project ids or "all">:<range>`. */
export function narrativeId(tab: AnalyticsTab, filters: Pick<AnalyticsFilters, "projectIds" | "range">): string {
  const projects = filters.projectIds.length === 0 ? "all" : [...filters.projectIds].sort().join(",");
  return `${tab}:${projects}:${filters.range}`;
}

/** Omits default range, x axis, segment and measure so a fresh visit stays `?`-free. */
export function analyticsHref(tab: AnalyticsTab, filters: AnalyticsFilters): string {
  const params = new URLSearchParams();
  if (filters.projectIds.length > 0) params.set("projects", filters.projectIds.join(","));
  if (filters.range !== "30d") params.set("range", filters.range);
  if (tab === "work-items") {
    if (filters.xAxis !== "state_group") params.set("x", filters.xAxis);
    if (filters.segment) params.set("segment", filters.segment);
    if (filters.measure !== "count") params.set("measure", filters.measure);
  }
  const query = params.toString();
  return query === "" ? `/analytics/${tab}` : `/analytics/${tab}?${query}`;
}

export function analyticsSearchKey(tab: string, search: AnalyticsSearch): string {
  const pick = (key: string) => {
    const value = search[key];
    return Array.isArray(value) ? value.join(",") : (value ?? "");
  };
  return [tab, pick("projects"), pick("range"), pick("x"), pick("segment"), pick("measure")].join("|");
}

export type KpiKey = "projects" | "work_items" | "open" | "completed" | "overdue" | "due_this_week" | "active_cycles" | "active_agents";

function listHref(projectIds: readonly string[], filters: Filters): string {
  const q = encodeUrlState({ filters });
  if (projectIds.length === 1) {
    const path = `/projects/${projectIds[0]}/work-items`;
    return q === "" ? path : `${path}?q=${q}`;
  }
  const scoped: Filters = projectIds.length > 0 ? { ...filters, project: [...projectIds] } : filters;
  const encoded = encodeUrlState({ filters: scoped });
  return encoded === "" ? "/workspace-views/all" : `/workspace-views/all?q=${encoded}`;
}

/** Where a KPI number goes. `today` is the server local date (decision 6). */
export function kpiHref(key: KpiKey, projectIds: readonly string[], today: string): string {
  const one = projectIds.length === 1 ? projectIds[0] : null;
  switch (key) {
    case "projects":
      return one ? `/projects/${one}/work-items` : "/projects";
    case "work_items":
      return listHref(projectIds, {});
    case "open":
      return listHref(projectIds, { state_group: [...OPEN_GROUPS] });
    case "completed":
      return listHref(projectIds, { state_group: ["completed"] });
    case "overdue":
      return listHref(projectIds, { state_group: [...OPEN_GROUPS], target_date: { op: "before", to: today } });
    case "due_this_week":
      return listHref(projectIds, { target_date: { op: "between", from: today, to: addDays(today, 6) } });
    case "active_cycles":
      return one ? `/projects/${one}/cycles` : "/active-cycles";
    case "active_agents":
      return "/agents";
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

export function assigneeHref(actorId: string, projectIds: readonly string[]): string {
  return listHref(projectIds, { assignees: [actorId], state_group: [...OPEN_GROUPS] });
}

function isBucket(value: unknown): value is AnalyticsBucket {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<AnalyticsBucket>;
  return typeof row.key === "string" && typeof row.label === "string" && typeof row.total === "number";
}

export function asBuckets(
  value: AnalyticsBucket[] | Record<string, number> | null | undefined,
  options?: {
    order?: readonly string[];
    label?: (key: string) => string;
    color?: (key: string) => AnalyticsBucket["color"];
  },
): AnalyticsBucket[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(isBucket).map((bucket) => ({ ...bucket, segments: bucket.segments ?? {} }));
  const label = options?.label ?? distributionLabel;
  const color = options?.color ?? (() => null);
  const known = options?.order?.filter((key) => key in value) ?? [];
  const rest = Object.keys(value).filter((key) => !known.includes(key));
  return [...known, ...rest].map((key) => ({
    key,
    label: label(key),
    color: color(key),
    total: value[key] ?? 0,
    segments: {},
  }));
}

/** First `limit` buckets, then one "Other" row for the rest. */
export function chartBuckets(buckets: readonly AnalyticsBucket[], limit = CHART_BUCKET_LIMIT): AnalyticsBucket[] {
  if (buckets.length <= limit) return buckets.map((bucket) => ({ ...bucket, segments: { ...bucket.segments } }));
  const segments: Record<string, number> = {};
  let total = 0;
  for (const bucket of buckets.slice(limit)) {
    total += bucket.total;
    for (const [key, value] of Object.entries(bucket.segments)) segments[key] = (segments[key] ?? 0) + value;
  }
  return [
    ...buckets.slice(0, limit).map((bucket) => ({ ...bucket, segments: { ...bucket.segments } })),
    { key: OTHER_KEY, label: OTHER_LABEL, color: null, total, segments },
  ];
}

export function cyclesForChart<T extends { end_date: string | null; name: string }>(rows: readonly T[], limit = CYCLE_CHART_LIMIT): T[] {
  return [...rows]
    .sort((a, b) => {
      if (a.end_date === b.end_date) return a.name.localeCompare(b.name);
      if (a.end_date === null) return 1;
      if (b.end_date === null) return -1;
      return a.end_date < b.end_date ? 1 : -1;
    })
    .slice(0, limit);
}

export function statusBuckets(counts: Record<string, number>, order: readonly string[]): AnalyticsBucket[] {
  const keys = [...order.filter((key) => key in counts), ...Object.keys(counts).filter((key) => !order.includes(key))];
  return keys.map((key) => ({
    key,
    label: statusLabel(key),
    color: null,
    total: counts[key] ?? 0,
    segments: {},
  }));
}

export function distributionTotal(buckets: readonly AnalyticsBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.total, 0);
}

export function summarizeDistribution(title: string, buckets: readonly AnalyticsBucket[], measure: AnalyticsMeasure): string {
  const total = distributionTotal(buckets);
  if (buckets.length === 0 || total === 0) return `${title}: nothing to show.`;
  const top = buckets.reduce((best, bucket) => (bucket.total > best.total ? bucket : best), buckets[0]);
  return `${title}: ${measureUnit(measure, total)}, highest is ${top.label} at ${formatCount(top.total)}.`;
}

export function summarizeTrend(points: readonly TrendPoint[], range: AnalyticsRange): string {
  if (points.length === 0) return "Created versus completed: nothing in this range.";
  const created = points.reduce((sum, point) => sum + point.created, 0);
  const completed = points.reduce((sum, point) => sum + point.completed, 0);
  const unit = range === "365d" ? (points.length === 1 ? "week" : "weeks") : points.length === 1 ? "day" : "days";
  return `Created versus completed: ${formatCount(created)} created and ${formatCount(completed)} completed across ${points.length} ${unit}.`;
}

export function summarizeCycles(shown: number, total: number): string {
  if (total === 0) return "Cycles: nothing in this range.";
  return shown === total ? `Completed and pending for ${total} ${total === 1 ? "cycle" : "cycles"}.` : `Completed and pending for the ${shown} newest of ${total} cycles.`;
}

export function isOverviewResult(result: AnalyticsResult): result is OverviewAnalytics {
  return "kpis" in result;
}

export function isWorkItemsResult(result: AnalyticsResult): result is WorkItemsAnalytics {
  return "buckets" in result && "x_axis" in result;
}

export function isCyclesResult(result: AnalyticsResult): result is CyclesAnalytics {
  return "rows" in result && "by_status" in result && !("x_axis" in result);
}

export function isModulesResult(result: AnalyticsResult): result is ModulesAnalytics {
  return "rows" in result && "by_status" in result && !("x_axis" in result);
}
