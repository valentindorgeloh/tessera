"use client";

/**
 * Burndown or burnup of one cycle (docs/contracts/ui.md "Burndown and burnup
 * chart"). The model comes from ./burndown.ts; Recharts draws it with colours
 * resolved from theme tokens (./chart-colors.ts), so axes, labels and lines
 * follow Latte and Frappé. Lines differ by pattern as well as colour (actual
 * solid, ideal dashed, scope dotted) and the legend names them. The SVG
 * renders only after hydration: the theme mode resolves on the client and
 * `responsive` measures the DOM, so a Skeleton of the same height holds the
 * space until then. The chart is an image with a one-sentence summary as its
 * name; the same sentence shows under it, and a "Data table" collapsible
 * lists every day. No animation anywhere.
 */
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { useHydrated } from "@/components/detail/RelativeTime";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import type { Cycle, CycleProgress } from "@/lib/tessera/types";
import { buildChartModel, formatNumber, summarizeChart, todayLabelPosition, type ChartKind, type ChartModel } from "./burndown";
import { useChartColors, type ChartColorKey } from "./chart-colors";

export type BurndownChartProps = {
  cycle: Pick<Cycle, "name" | "start_date" | "end_date" | "status">;
  /** Issues or points progress. */
  progress: CycleProgress;
  kind: ChartKind;
  today: string;
  /** Default 240. */
  height?: number;
  /** Default true. */
  hasDataTable?: boolean;
  /** Draft empty state action (open cycles only). */
  onAddDates?: () => void;
};

/** Dash patterns: the lines never differ by colour alone (WCAG 1.4.1). */
const DASH = { ideal: "4 4", scope: "2 4" } as const;

type LegendEntry = { key: string; label: string; color: ChartColorKey; dash?: string; width: number };

function legendEntries(kind: ChartKind): LegendEntry[] {
  const entries: LegendEntry[] = [
    { key: "actual", label: kind === "burndown" ? "Pending (solid)" : "Done (solid)", color: "actual", width: 2 },
    { key: "ideal", label: "Ideal (dashed)", color: "ideal", dash: DASH.ideal, width: 1.5 },
  ];
  if (kind === "burnup") entries.push({ key: "scope", label: "Scope (dotted)", color: "scope", dash: DASH.scope, width: 1.5 });
  return entries;
}

/** A short line sample in the series' colour and dash, decorative next to the legend text. */
function LegendSwatch({ stroke, dash, width }: { stroke: string; dash?: string; width: number }) {
  return (
    <svg className="tessera-planning-chart-swatch" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
      <line x1="0" y1="4" x2="24" y2="4" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

function ChartLegend({ kind }: { kind: ChartKind }) {
  const colors = useChartColors();
  return (
    <HStack gap={4} wrap="wrap" vAlign="center">
      {legendEntries(kind).map((entry) => (
        <HStack key={entry.key} gap={1.5} vAlign="center">
          <LegendSwatch stroke={colors[entry.color]} dash={entry.dash} width={entry.width} />
          <Text type="supporting">{entry.label}</Text>
        </HStack>
      ))}
    </HStack>
  );
}

function ChartSvg({ model, height, today }: { model: ChartModel; height: number; today: string }) {
  const colors = useChartColors();
  const actualName = model.kind === "burndown" ? "Pending" : "Done";
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
          label={{ value: "Scope", fill: colors.axis, position: "insideTopRight" }}
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

type TableRow = { date: string; day: string; actual: string; ideal: string };

function DataTable({ model, today }: { model: ChartModel; today: string }) {
  const rows = useMemo<TableRow[]>(
    () =>
      model.rows.map((row) => ({
        date: row.date,
        day: formatShortDate(row.date, today),
        actual: row.actual === null ? "–" : formatNumber(row.actual),
        ideal: formatNumber(row.ideal),
      })),
    [model.rows, today],
  );
  return (
    // The class stops the Table's container bleed on the block axis, which pulled its header up over the trigger.
    <Collapsible trigger="Data table" defaultIsOpen={false} className="tessera-planning-data-table">
      <Table<TableRow>
        density="compact"
        idKey="date"
        data={rows}
        columns={[
          { key: "day", header: "Date" },
          { key: "actual", header: model.kind === "burndown" ? "Pending" : "Done", align: "end" },
          { key: "ideal", header: "Ideal", align: "end" },
        ]}
      />
    </Collapsible>
  );
}

export function BurndownChart({ cycle, progress, kind, today, height = 240, hasDataTable = true, onAddDates }: BurndownChartProps) {
  const hydrated = useHydrated();
  const model = useMemo(
    () => buildChartModel({ start_date: cycle.start_date, end_date: cycle.end_date, status: cycle.status, today, progress, kind }),
    [cycle.start_date, cycle.end_date, cycle.status, today, progress, kind],
  );

  if (model.empty === "draft") {
    return (
      <EmptyState
        isCompact
        title="Add dates to see the chart"
        actions={onAddDates ? <Button size="sm" variant="secondary" label="Add dates" onClick={onAddDates} /> : undefined}
      />
    );
  }
  if (model.empty === "upcoming") {
    return <EmptyState isCompact title={cycle.start_date ? `Starts ${formatShortDate(cycle.start_date, today)}` : "Not started"} />;
  }
  if (model.empty === "no_items") {
    return <EmptyState isCompact title="Add work items to see the chart" />;
  }

  const summary = summarizeChart(model, today, cycle.name);
  return (
    <VStack gap={2} className="tessera-planning-chart">
      <VStack role="img" aria-label={summary} className="tessera-planning-chart-frame">
        {hydrated ? <ChartSvg model={model} height={height} today={today} /> : <Skeleton height={height} />}
      </VStack>
      {hydrated ? <ChartLegend kind={kind} /> : null}
      <Text type="supporting">{summary}</Text>
      {hasDataTable ? <DataTable model={model} today={today} /> : null}
    </VStack>
  );
}
