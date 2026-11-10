"use client";

/**
 * The Recharts drawing of the burndown and burnup chart, split out of
 * ./BurndownChart.tsx so Recharts (about 105 KB gzipped) loads as its own chunk
 * after the page instead of in the route's first load (decision 142). Only
 * BurndownChart.tsx imports this module, and only through `import()`.
 */
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import { formatNumber, todayLabelPosition, type ChartModel } from "./burndown";
import { actualSeriesName, DASH } from "./BurndownChart";
import { useChartColors } from "./chart-colors";

export function ChartSvg({ model, height, today }: { model: ChartModel; height: number; today: string }) {
  const colors = useChartColors();
  const actualName = actualSeriesName(model.kind);
  return (
    <LineChart
      data={model.rows}
      responsive
      style={{ width: "100%", height }}
      accessibilityLayer={false}
      margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
    >
      <CartesianGrid vertical={false} stroke={colors.grid} />
      <XAxis
        dataKey="date"
        type="category"
        tickFormatter={(value) => formatShortDate(String(value), today)}
        tick={{ fill: colors.axis }}
        stroke={colors.grid}
        interval="preserveStartEnd"
        minTickGap={16}
      />
      <YAxis allowDecimals={model.unit === "points"} stroke={colors.grid} tick={{ fill: colors.axis }} width="auto" />
      <Tooltip
        cursor={{ stroke: colors.grid }}
        isAnimationActive={false}
        contentStyle={{
          background: colors.tooltipSurface,
          color: colors.tooltipText,
          border: `var(--border-width) solid ${colors.grid}`,
          borderRadius: "var(--radius-container)",
        }}
        labelStyle={{ color: colors.tooltipText }}
        itemStyle={{ color: colors.tooltipText }}
        labelFormatter={(label) => formatShortDate(String(label), today)}
        formatter={(value) => (typeof value === "number" ? formatNumber(value) : String(value))}
      />
      {model.kind === "burnup" ? (
        <ReferenceLine
          y={model.scope}
          stroke={colors.scope}
          strokeDasharray={DASH.scope}
          strokeWidth={1.5}
        />
      ) : null}
      {model.today ? (
        <ReferenceLine x={model.today} stroke={colors.today} label={{ value: "Today", fill: colors.axis, position: todayLabelPosition(model) }} />
      ) : null}
      <Line dataKey="ideal" name="Ideal" type="linear" stroke={colors.ideal} strokeWidth={1.5} strokeDasharray={DASH.ideal} dot={false} activeDot={false} isAnimationActive={false} />
      <Line dataKey="actual" name={actualName} type="linear" stroke={colors.actual} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
    </LineChart>
  );
}
