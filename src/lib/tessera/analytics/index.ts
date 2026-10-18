/**
 * Analytics reads. Every number shared with Counts uses the same population.
 */
import { z } from "zod";
import { latestSeq } from "../activity";
import type { TesseraContext } from "../core/context";
import { validateInput, validation } from "../core/errors";
import { AnalyticsDimensionSchema, AnalyticsMeasureSchema, AnalyticsRangeSchema, AnalyticsTabSchema, IdSchema } from "../schemas";
import type { AnalyticsRange, AnalyticsResult, AnalyticsTab } from "../types";
import { workItemsTab } from "./breakdown";
import { rangeWindow } from "./dates";
import { overviewTab } from "./overview";
import { cyclesTab, modulesTab } from "./planning";
import { distributionPopulation } from "./population";
import { buildTrend } from "./trend";

export const GetAnalyticsInput = z
  .object({
    tab: AnalyticsTabSchema.describe("overview, work-items, cycles or modules."),
    project_ids: z.array(IdSchema).min(1).max(50).optional().describe("Live projects to include. Omit for every live project."),
    range: AnalyticsRangeSchema.default("30d").describe("7d, 30d, 90d or 365d. Used by the trend and the cycles tab."),
    x_axis: AnalyticsDimensionSchema.default("state_group").describe("Work-items dimension. state needs exactly one project."),
    segment: AnalyticsDimensionSchema.nullable().default(null).describe("Optional second work-items dimension. It cannot equal x_axis."),
    measure: AnalyticsMeasureSchema.default("count").describe("count, or points when every project in scope has an active points estimate."),
  })
  .strict();

export type GetAnalyticsInputType = z.input<typeof GetAnalyticsInput>;

export function getAnalytics(ctx: TesseraContext, input: GetAnalyticsInputType): AnalyticsResult {
  const data = validateInput(GetAnalyticsInput, input);
  const population = distributionPopulation(ctx, data.project_ids);
  const window = rangeWindow(ctx.today(), data.range);
  const meta = {
    scope: {
      project_ids: data.project_ids === undefined ? null : population.project_ids,
      range: data.range,
      from: window.from,
      to: window.to,
    },
    computed_seq: latestSeq(ctx),
  };
  switch (data.tab) {
    case "overview":
      return { tab: "overview", ...meta, ...overviewTab(ctx, data.project_ids, data.range) };
    case "work-items":
      return {
        tab: "work-items",
        ...meta,
        x_axis: data.x_axis,
        segment: data.segment,
        measure: data.measure,
        ...workItemsTab(ctx, data.project_ids, data.x_axis, data.segment, data.measure),
        trend: buildTrend(ctx, data.project_ids, data.range),
      };
    case "cycles":
      return { tab: "cycles", ...meta, ...cyclesTab(ctx, data.project_ids, data.range) };
    case "modules":
      return { tab: "modules", ...meta, ...modulesTab(ctx, data.project_ids) };
  }
}

const DIGEST_ID = /^(overview|work-items|cycles|modules):(all|[^:]+):(7d|30d|90d|365d)$/;

/** Parses `<tab>:<sorted project ids or all>:<range>` into the tab's analytics result. */
export function analyticsForDigest(ctx: TesseraContext, id: string): { subject: string; result: AnalyticsResult; input_seq: number } {
  const match = DIGEST_ID.exec(id);
  if (!match) throw validation({ entity_id: id }, "Analytics digest id is <tab>:<project ids or all>:<range>.");
  const tab = match[1] as AnalyticsTab;
  const range = match[3] as AnalyticsRange;
  const project_ids = match[2] === "all" ? undefined : match[2].split(",");
  return {
    subject: `Analytics ${tab}`,
    result: getAnalytics(ctx, { tab, project_ids, range }),
    input_seq: latestSeq(ctx),
  };
}
