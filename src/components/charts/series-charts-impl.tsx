"use client";

/**
 * The Recharts drawings of the analytics bar and area charts, split out of
 * ./SeriesCharts.tsx so Recharts (about 105 KB gzipped) loads as its own chunk
 * after the page instead of in the route's first load (decision 142). Only
 * SeriesCharts.tsx imports this module, and only through `import()`. Colours
 * come from theme tokens and nothing animates.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsBucket, AnalyticsMeasure, AnalyticsSegmentKey, TrendPoint } from "@/components/analytics/types";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { formatCount } from "./analytics-format";
import { CATEGORICAL_TOKENS, CHART_CHROME, TREND_COMPLETED_DASH, TREND_COMPLETED_TOKEN, TREND_CREATED_TOKEN, useTokenColor } from "./chart-colors";
import { seriesToken } from "./SeriesCharts";

const MARGIN = { top: 16, right: 12, bottom: 0, left: 0 } as const;

type Paint = (name: string) => string;

function tooltipProps(paint: Paint) {
  const grid = paint(CHART_CHROME.grid);
  const text = paint(CHART_CHROME.tooltipText);
  return {
    isAnimationActive: false as const,
    cursor: { stroke: grid },
    contentStyle: {
      background: paint(CHART_CHROME.tooltipSurface),
      color: text,
      border: `var(--border-width) solid ${grid}`,
      borderRadius: "var(--radius-container)",
    },
    labelStyle: { color: text },
    itemStyle: { color: text },
  };
}

function axisProps(paint: Paint) {
  return { stroke: paint(CHART_CHROME.grid), tick: { fill: paint(CHART_CHROME.axis) } };
}

type BarRow = Record<string, string | number>;

function barRows(buckets: readonly AnalyticsBucket[], segments: readonly AnalyticsSegmentKey[]): BarRow[] {
  return buckets.map((bucket) => {
    const row: BarRow = { key: bucket.key, label: bucket.label, total: bucket.total };
    for (const segment of segments) row[segment.key] = bucket.segments[segment.key] ?? 0;
    return row;
  });
}

export type BarChartSvgProps = {
  buckets: readonly AnalyticsBucket[];
  segments: readonly AnalyticsSegmentKey[];
  layout: "horizontal" | "vertical";
  measure: AnalyticsMeasure;
  height: number;
};

export function BarChartSvg({ buckets, segments, layout, measure, height }: BarChartSvgProps) {
  const paint = useTokenColor();
  const data = barRows(buckets, segments);
  return (
    <BarChart data={data} layout={layout} responsive style={{ width: "100%", height }} accessibilityLayer={false} margin={MARGIN}>
      <CartesianGrid vertical={layout === "vertical"} horizontal={layout === "horizontal"} stroke={paint(CHART_CHROME.grid)} />
      {layout === "vertical" ? (
        <XAxis type="number" {...axisProps(paint)} />
      ) : (
        <XAxis dataKey="label" type="category" {...axisProps(paint)} interval="preserveStartEnd" minTickGap={16} />
      )}
      {layout === "vertical" ? (
        <YAxis dataKey="label" type="category" {...axisProps(paint)} width="auto" />
      ) : (
        <YAxis {...axisProps(paint)} width="auto" allowDecimals={measure === "points"} />
      )}
      <Tooltip
        {...tooltipProps(paint)}
        formatter={(value) => (typeof value === "number" ? formatCount(value) : String(value ?? ""))}
      />
      {segments.length > 0 ? (
        segments.map((segment, index) => (
          <Bar key={segment.key} dataKey={segment.key} name={segment.label} stackId="s" fill={paint(seriesToken(index, segment.color))} isAnimationActive={false} />
        ))
      ) : (
        <Bar dataKey="total" name={measure === "points" ? "Points" : "Count"} fill={paint(CATEGORICAL_TOKENS[0])} isAnimationActive={false}>
          {buckets.map((bucket, index) => (
            <Cell key={bucket.key} fill={paint(seriesToken(index, bucket.color))} />
          ))}
        </Bar>
      )}
    </BarChart>
  );
}

export type TrendChartSvgProps = {
  points: readonly TrendPoint[];
  today: string;
};

export function TrendChartSvg({ points, today }: TrendChartSvgProps) {
  const paint = useTokenColor();
  const created = paint(TREND_CREATED_TOKEN);
  const completed = paint(TREND_COMPLETED_TOKEN);
  return (
    <AreaChart data={[...points]} responsive style={{ width: "100%", height: 240 }} accessibilityLayer={false} margin={MARGIN}>
      <CartesianGrid vertical={false} stroke={paint(CHART_CHROME.grid)} />
      <XAxis dataKey="date" tickFormatter={(value) => formatShortDate(String(value).slice(0, 10), today)} {...axisProps(paint)} interval="preserveStartEnd" minTickGap={16} />
      <YAxis {...axisProps(paint)} width="auto" />
      <Tooltip
        {...tooltipProps(paint)}
        labelFormatter={(label) => formatShortDate(String(label).slice(0, 10), today)}
        formatter={(value) => (typeof value === "number" ? formatCount(value) : String(value ?? ""))}
      />
      <Area dataKey="created" name="Created" type="monotone" stroke={created} fill={created} fillOpacity={0.16} strokeWidth={2} dot={false} isAnimationActive={false} />
      <Area
        dataKey="completed"
        name="Completed"
        type="monotone"
        stroke={completed}
        fill={completed}
        fillOpacity={0.08}
        strokeWidth={2}
        strokeDasharray={TREND_COMPLETED_DASH}
        dot={false}
        isAnimationActive={false}
      />
    </AreaChart>
  );
}
