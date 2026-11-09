/**
 * Analytics screen types (docs/drafts/p9-plan.md U4). A UI shape, not an
 * engine type: the page maps `getAnalytics` onto it when that export exists.
 * Client-safe: type imports only.
 */
import type { ActorKind, CycleStatus, EstimateType, Logo, ModuleStatus, PaletteColor } from "@/lib/tessera/types";

export const ANALYTICS_TABS = ["overview", "work-items", "cycles", "modules"] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

/** URL values. The range control labels `365d` as "1y". */
export const ANALYTICS_RANGES = ["7d", "30d", "90d", "365d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_DIMENSIONS = [
  "state_group",
  "state",
  "priority",
  "assignee",
  "label",
  "cycle",
  "module",
  "project",
  "created_by",
  "target_week",
] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export type AnalyticsMeasure = "count" | "points";

/** One day, or one ISO week when the range is `365d`. */
export type TrendPoint = {
  date: string;
  created: number;
  completed: number;
};

export type AnalyticsBucket = {
  key: string;
  label: string;
  color: PaletteColor | null;
  total: number;
  segments: Record<string, number>;
};

export type AnalyticsSegmentKey = {
  key: string;
  label: string;
  color: PaletteColor | null;
};

/** Count record or bucket list. Overview charts accept either. */
export type AnalyticsDistribution = AnalyticsBucket[] | Record<string, number>;

export type AnalyticsScope = {
  project_ids: string[] | null;
  range: AnalyticsRange;
  from: string;
  to: string;
};

type AnalyticsCommon = {
  scope: AnalyticsScope;
  computed_seq: number;
};

export type OverviewKpis = {
  projects: number;
  work_items: number;
  open: number;
  completed: number;
  overdue: number;
  due_this_week: number;
  active_cycles: number;
  active_agents: number;
};

export type OverviewAnalytics = AnalyticsCommon & {
  kpis: OverviewKpis;
  by_state_group: AnalyticsDistribution;
  by_priority: AnalyticsDistribution;
  trend: TrendPoint[];
  top_assignees: { actor_id: string; name: string; kind: ActorKind; color: PaletteColor; open: number; completed: number }[];
  projects: {
    id: string;
    name: string;
    identifier: string;
    logo: Logo | null;
    total: number;
    open: number;
    completed: number;
  }[];
};

export type WorkItemsAnalytics = AnalyticsCommon & {
  x_axis: AnalyticsDimension;
  segment: AnalyticsDimension | null;
  measure: AnalyticsMeasure;
  buckets: AnalyticsBucket[];
  segment_keys: AnalyticsSegmentKey[];
  total: number;
  trend: TrendPoint[];
};

export type CycleAnalyticsRow = {
  cycle_id: string;
  project_id: string;
  project_name: string;
  name: string;
  status: CycleStatus;
  start_date: string | null;
  end_date: string | null;
  total: number;
  completed: number;
  pending: number;
  completion: number;
  points: { total: number; completed: number } | null;
};

export type CyclesAnalytics = AnalyticsCommon & {
  rows: CycleAnalyticsRow[];
  by_status: Record<CycleStatus, number>;
};

export type ModuleAnalyticsRow = {
  module_id: string;
  project_id: string;
  project_name: string;
  name: string;
  status: ModuleStatus;
  lead_id: string | null;
  target_date: string | null;
  total: number;
  completed: number;
  completion: number;
};

export type ModulesAnalytics = AnalyticsCommon & {
  rows: ModuleAnalyticsRow[];
  by_status: Record<ModuleStatus, number>;
};

export type AnalyticsResult = OverviewAnalytics | WorkItemsAnalytics | CyclesAnalytics | ModulesAnalytics;

/** Live project row the filter and the points control need. */
export type AnalyticsProjectOption = {
  id: string;
  name: string;
  identifier: string;
  logo: Logo | null;
  estimate_type: EstimateType | null;
};

export type AnalyticsFilters = {
  projectIds: string[];
  range: AnalyticsRange;
  xAxis: AnalyticsDimension;
  segment: AnalyticsDimension | null;
  measure: AnalyticsMeasure;
};

export type AnalyticsSearch = Record<string, string | string[] | undefined>;
