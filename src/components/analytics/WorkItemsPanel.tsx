"use client";

/**
 * Work-items tab (docs/drafts/p9-plan.md U4): one dimension, an optional
 * segment, and count or points. The chart keeps the top 11 buckets plus
 * Other; the table lists every bucket the result returned.
 */
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector, type SelectorOptionData } from "@astryxdesign/core/Selector";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { AnalyticsDimension, AnalyticsFilters, WorkItemsAnalytics } from "@/components/analytics/types";
import { ANALYTICS_DIMENSIONS } from "@/components/analytics/types";
import { PanelBar } from "@/components/shell/PanelHeader";
import { BarSeriesChart, TrendChart } from "@/components/charts/SeriesCharts";
import {
  AnalyticsDimensionSchema,
  DIMENSION_LABELS,
  POINTS_UNAVAILABLE,
  chartBuckets,
  dimensionLabel,
  measureUnit,
  summarizeDistribution,
  summarizeTrend,
} from "@/components/charts/analytics-format";

export function WorkItemsPanel({
  result,
  filters,
  pointsOk,
  today,
  onChange,
}: {
  result: WorkItemsAnalytics;
  filters: AnalyticsFilters;
  pointsOk: boolean;
  today: string;
  onChange: (next: AnalyticsFilters) => void;
}) {
  const xOptions: SelectorOptionData[] = ANALYTICS_DIMENSIONS.filter((dimension) => dimension !== "state" || filters.projectIds.length === 1).map(
    (dimension) => ({ value: dimension, label: DIMENSION_LABELS[dimension] }),
  );
  const segmentOptions: SelectorOptionData[] = [
    { value: "none", label: "None" },
    ...ANALYTICS_DIMENSIONS.filter((dimension) => dimension !== filters.xAxis && (dimension !== "state" || filters.projectIds.length === 1)).map(
      (dimension) => ({ value: dimension, label: DIMENSION_LABELS[dimension] }),
    ),
  ];
  const chart = chartBuckets(result.buckets);
  const title = filters.segment ? `${dimensionLabel(filters.xAxis)} by ${dimensionLabel(filters.segment)}` : dimensionLabel(filters.xAxis);
  const summary = summarizeDistribution(title, result.buckets, filters.measure);

  const setAxis = (value: string) => {
    const parsed = AnalyticsDimensionSchema.safeParse(value);
    if (!parsed.success) return;
    const xAxis: AnalyticsDimension = parsed.data;
    onChange({ ...filters, xAxis, segment: filters.segment === xAxis ? null : filters.segment });
  };
  const setSegment = (value: string) => {
    if (value === "none") {
      onChange({ ...filters, segment: null });
      return;
    }
    const parsed = AnalyticsDimensionSchema.safeParse(value);
    if (!parsed.success || parsed.data === filters.xAxis) return;
    onChange({ ...filters, segment: parsed.data });
  };

  return (
    <VStack gap={4}>
      <PanelBar
        size="filters"
        canWrap
        start={
          <>
            <Selector label="X axis" size="sm" options={xOptions} value={filters.xAxis} onChange={setAxis} controlClassName="tessera-analytics-axis" />
            <Selector
              label="Segment"
              size="sm"
              options={segmentOptions}
              value={filters.segment ?? "none"}
              onChange={setSegment}
              controlClassName="tessera-analytics-axis"
            />
          </>
        }
        end={
          <>
            <SegmentedControl
              label="Measure"
              size="sm"
              value={filters.measure}
              onChange={(value) => {
                if (value === "points" && !pointsOk) return;
                if (value === "count" || value === "points") onChange({ ...filters, measure: value });
              }}
            >
              <SegmentedControlItem value="count" label="Count" />
              <SegmentedControlItem value="points" label="Points" isDisabled={!pointsOk} />
            </SegmentedControl>
            {pointsOk ? null : (
              <Text type="supporting" color="secondary">
                {POINTS_UNAVAILABLE}
              </Text>
            )}
          </>
        }
      />
      <Text type="supporting">{measureUnit(filters.measure, result.total)} in this view.</Text>
      <BarSeriesChart
        title={title}
        summary={summary}
        buckets={chart}
        tableBuckets={result.buckets}
        segments={result.segment_keys}
        measure={filters.measure}
      />
      <TrendChart summary={summarizeTrend(result.trend, filters.range)} points={result.trend} today={today} />
    </VStack>
  );
}
