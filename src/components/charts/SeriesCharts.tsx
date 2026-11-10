"use client";

/**
 * Bar and area charts for analytics (docs/drafts/p9-plan.md U4). Recharts
 * `responsive` plus colours from theme tokens, matching the burndown chart:
 * grid, axis and tooltip tokens, no animation, and a named legend so a
 * series is never identified by colour alone.
 */
import { useEffect } from "react";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Table } from "@astryxdesign/core/Table";
import { COUNT_COLUMN, NAME_COLUMN, TEXT_COLUMN } from "@/components/analytics/table-widths";
import type { AnalyticsBucket, AnalyticsMeasure, AnalyticsSegmentKey, TrendPoint } from "@/components/analytics/types";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { formatCount } from "./analytics-format";
import { ChartFrame, ChartLegend, type ChartCsv, type LegendEntry } from "./ChartFrame";
import { TREND_COMPLETED_DASH, TREND_COMPLETED_TOKEN, TREND_CREATED_TOKEN, categoricalToken, useTokenColor } from "./chart-colors";
import { createLazyModule } from "./lazy-module";
import { paletteToken } from "./palette-colors";
import type { BarChartSvgProps, TrendChartSvgProps } from "./series-charts-impl";

/**
 * The drawings (./series-charts-impl.tsx, which holds Recharts) load on demand: the import starts when this module is
 * evaluated in the browser and again from a chart's effect, which also retries a failed fetch. Until it is in, the same
 * Skeleton as before hydration holds the chart's height.
 */
const drawings = createLazyModule(() => import("./series-charts-impl"));
if (typeof window !== "undefined") drawings.preload();

/** The area chart's height (series-charts-impl.tsx draws it at the same size). */
const TREND_HEIGHT = 240;

function useDrawings() {
  const loaded = drawings.useLoaded();
  useEffect(() => {
    drawings.preload();
  }, []);
  return loaded;
}

function LazyBarChartSvg(props: BarChartSvgProps) {
  const loaded = useDrawings();
  return loaded ? <loaded.BarChartSvg {...props} /> : <Skeleton height={props.height} />;
}

function LazyTrendChartSvg(props: TrendChartSvgProps) {
  const loaded = useDrawings();
  return loaded ? <loaded.TrendChartSvg {...props} /> : <Skeleton height={TREND_HEIGHT} />;
}

export function seriesToken(index: number, color: AnalyticsBucket["color"]): string {
  return paletteToken(color) ?? categoricalToken(index);
}

function chartHeight(rows: number, layout: "horizontal" | "vertical"): number {
  if (layout === "horizontal") return 240;
  return Math.min(480, Math.max(240, rows * 28));
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

  const chart = <LazyBarChartSvg buckets={buckets} segments={segments} layout={layout} measure={measure} height={height} />;

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
  const chart = <LazyTrendChartSvg points={points} today={today} />;
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
