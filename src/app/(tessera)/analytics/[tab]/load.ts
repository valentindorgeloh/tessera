/**
 * Loads analytics for one tab. `getAnalytics` is read off the server module
 * so this file still typechecks before that export exists. When it does,
 * this is the only call. A stored digest is read, never generated.
 */
import "server-only";
import type { AnalyticsFilters, AnalyticsProjectOption, AnalyticsResult, AnalyticsTab } from "@/components/analytics/types";
import { narrativeId, normalizeFilters, pointsAvailable } from "@/components/charts/analytics-format";
import { DigestKindSchema } from "@/lib/tessera/schemas";
import * as server from "@/lib/tessera/server";
import type { DigestView } from "@/lib/tessera/types";

type AnalyticsCtx = Parameters<Parameters<typeof server.readTessera>[0]>[0];
type EngineAnalytics = (ctx: AnalyticsCtx, input: Record<string, unknown>) => AnalyticsResult;

function engineAnalytics(): EngineAnalytics | null {
  const bag = server as typeof server & { getAnalytics?: EngineAnalytics };
  return typeof bag.getAnalytics === "function" ? bag.getAnalytics : null;
}

function pointsRule(err: unknown): boolean {
  if (!server.isTrackerError(err) || err.code !== "RULE") return false;
  const details = err.details;
  return typeof details === "object" && details !== null && "rule" in details && details.rule === "points_unavailable";
}

function analyticsInput(tab: AnalyticsTab, filters: AnalyticsFilters): Record<string, unknown> {
  const input: Record<string, unknown> = { tab, range: filters.range };
  if (filters.projectIds.length > 0) input.project_ids = filters.projectIds;
  if (tab === "work-items") {
    input.x_axis = filters.xAxis;
    input.segment = filters.segment;
    input.measure = filters.measure;
  }
  return input;
}

export type AnalyticsLoad = {
  result: AnalyticsResult | null;
  projects: AnalyticsProjectOption[];
  digest: DigestView | null;
  today: string;
};

export async function loadAnalytics(tab: AnalyticsTab, filters: AnalyticsFilters): Promise<AnalyticsLoad & { filters: AnalyticsFilters }> {
  const getAnalytics = engineAnalytics();
  return server.readTessera((ctx) => {
    const projects = server.listProjects(ctx, {}).map(
      (project): AnalyticsProjectOption => ({
        id: project.id,
        name: project.name,
        identifier: project.identifier,
        logo: project.logo,
        estimate_type: project.estimate_type,
      }),
    );
    const liveIds = projects.map((project) => project.id);
    const kept = filters.projectIds.filter((id) => liveIds.includes(id));
    const ready = normalizeFilters(filters, liveIds, pointsAvailable(projects, kept));
    let result: AnalyticsResult | null = null;
    if (getAnalytics) {
      try {
        result = getAnalytics(ctx, analyticsInput(tab, ready));
      } catch (err) {
        if (!pointsRule(err) || ready.measure === "count") throw err;
        result = getAnalytics(ctx, analyticsInput(tab, { ...ready, measure: "count" }));
      }
    }
    const kind = DigestKindSchema.safeParse("analytics");
    const digest = kind.success ? server.getStoredDigest(ctx, kind.data, narrativeId(tab, ready)) : null;
    return { result, projects, digest, today: ctx.today(), filters: ready };
  });
}
