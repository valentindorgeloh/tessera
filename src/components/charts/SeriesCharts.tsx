"use client";

/**
 * Bar and area charts for analytics (docs/drafts/p9-plan.md U4). Recharts
 * `responsive` plus colours from theme tokens, matching the burndown chart:
 * grid, axis and tooltip tokens, no animation, and a named legend so a
 * series is never identified by colour alone.
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { Table } from "@astryxdesign/core/Table";
import { COUNT_COLUMN, NAME_COLUMN, TEXT_COLUMN } from "@/components/analytics/table-widths";
import type { AnalyticsBucket, AnalyticsMeasure, AnalyticsSegmentKey, TrendPoint } from "@/components/analytics/types";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { formatCount } from "./analytics-format";
import { ChartFrame, ChartLegend, type ChartCsv, type LegendEntry } from "./ChartFrame";
import { CATEGORICAL_TOKENS, CHART_CHROME, TREND_COMPLETED_DASH, TREND_COMPLETED_TOKEN, TREND_CREATED_TOKEN, categoricalToken, useTokenColor } from "./chart-colors";
import { paletteToken } from "./palette-colors";

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

function seriesToken(index: number, color: AnalyticsBucket["color"]): string {
  return paletteToken(color) ?? categoricalToken(index);
}

function chartHeight(rows: number, layout: "horizontal" | "vertical"): number {
  if (layout === "horizontal") return 240;
  return Math.min(480, Math.max(240, rows * 28));
}

type BarRow = Record<string, string | number>;

function barRows(buckets: readonly AnalyticsBucket[], segments: readonly AnalyticsSegmentKey[]): BarRow[] {
  return buckets.map((bucket) => {
    const row: BarRow = { key: bucket.key, label: bucket.label, total: bucket.total };
    for (const segment of segments) row[segment.key] = bucket.segments[segment.key] ?? 0;
    return row;
  });
}

type TableRow = Record<string, string> & { key: string };

export type BarSeriesChartProps = {
  title: string;
  summary: string;
  buckets: readonly AnalyticsBucket[];
  /** Empty when the bar is one series coloured per bucket. */
  segments: readonly AnalyticsSegmentKey[];
  /** "vertical" draws sideways bars (categories on Y). */
  layout?: "horizontal" | "vertical";
  measure?: AnalyticsMeasure;
  tableBuckets?: readonly AnalyticsBucket[];
};

export function BarSeriesChart({ title, summary, buckets, segments, layout = "horizontal", measure = "count", tableBuckets }: BarSeriesChartProps) {
  const paint = useTokenColor();
  const shown = tableBuckets ?? buckets;
  const segmented = segments.length > 0;
  const data = barRows(buckets, segments);
  const height = chartHeight(buckets.length, layout);
  const legend: LegendEntry[] = segmented
    ? segments.map((segment, index) => ({ key: segment.key, label: segment.label, color: paint(seriesToken(index, segment.color)) }))
    : buckets.map((bucket, index) => ({ key: bucket.key, label: bucket.label, color: paint(seriesToken(index, bucket.color)) }));
  const columns = segmented
    ? [
        { key: "label", header: "Bucket", width: NAME_COLUMN },
        ...segments.map((segment) => ({ key: segment.key, header: segment.label, align: "end" as const, width: COUNT_COLUMN })),
        { key: "total", header: "Total", align: "end" as const, width: COUNT_COLUMN },
      ]
    : [
        { key: "label", header: "Bucket", width: NAME_COLUMN },
        { key: "total", header: measure === "points" ? "Points" : "Count", align: "end" as const, width: COUNT_COLUMN },
      ];
  const rows: TableRow[] = shown.map((bucket) => {
    const row: TableRow = { key: bucket.key, label: bucket.label, total: formatCount(bucket.total) };
    for (const segment of segments) row[segment.key] = formatCount(bucket.segments[segment.key] ?? 0);
    return row;
  });
  const csv: ChartCsv = {
    fileStem: `analytics-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart"}`,
    header: columns.map((column) => column.header),
    rows: shown.map((bucket) => {
      const cells: (string | number | null)[] = [bucket.label];
      if (segmented) {
        for (const segment of segments) cells.push(bucket.segments[segment.key] ?? 0);
      }
      cells.push(bucket.total);
      return cells;
    }),
  };

  const chart = (
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
      {segmented ? (
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

  return (
    <ChartFrame
      title={title}
      summary={summary}
      height={height}
      empty={buckets.length === 0}
      chart={chart}
      legend={<ChartLegend entries={legend} />}
      table={<Table<TableRow> density="compact" idKey="key" data={rows} columns={columns} />}
      csv={csv}
    />
  );
}

export type TrendChartProps = {
  title?: string;
  summary: string;
  points: readonly TrendPoint[];
  today: string;
};

export function TrendChart({ title = "Created vs completed", summary, points, today }: TrendChartProps) {
  const paint = useTokenColor();
  const created = paint(TREND_CREATED_TOKEN);
  const completed = paint(TREND_COMPLETED_TOKEN);
  const rows: TableRow[] = points.map((point) => ({
    key: point.date,
    date: formatShortDate(point.date.slice(0, 10), today),
    created: formatCount(point.created),
    completed: formatCount(point.completed),
  }));
  const chart = (
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
  const csv: ChartCsv = {
    fileStem: "analytics-created-vs-completed",
    header: ["Date", "Created", "Completed"],
    rows: points.map((point) => [point.date, point.created, point.completed]),
  };
  return (
    <ChartFrame
      title={title}
      summary={summary}
      chart={chart}
      empty={points.length === 0}
      legend={
        <ChartLegend
          entries={[
            { key: "created", label: "Created (solid)", color: created },
            { key: "completed", label: "Completed (dashed)", color: completed, dash: TREND_COMPLETED_DASH },
          ]}
        />
      }
      table={
        <Table<TableRow>
          density="compact"
          idKey="key"
          data={rows}
          columns={[
            { key: "date", header: "Date", width: TEXT_COLUMN },
            { key: "created", header: "Created", align: "end", width: COUNT_COLUMN },
            { key: "completed", header: "Completed", align: "end", width: COUNT_COLUMN },
          ]}
        />
      }
      csv={csv}
    />
  );
}
