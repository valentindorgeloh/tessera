"use client";

/**
 * Shared chart frame (docs/drafts/p9-plan.md U4). Same hydration rule as the
 * burndown chart: the theme and `responsive` resolve on the client, so a
 * Skeleton holds the height until then. The chart is an image named by its
 * summary; the summary is also text, and a "Data table" collapsible lists
 * the rows with an optional CSV download (decision 100).
 */
import type { ReactNode } from "react";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useHydrated } from "@/components/detail/RelativeTime";
import { DownloadCsvButton, type CsvTable } from "./csv-download";

export type ChartCsv = CsvTable;

export type ChartFrameProps = {
  title: string;
  summary: string;
  /** Default 240. A number is the Skeleton height, as on the burndown chart. */
  height?: number;
  empty?: boolean;
  chart: ReactNode;
  legend?: ReactNode;
  table?: ReactNode;
  /** When set, the data table offers Download CSV (decision 100). */
  csv?: ChartCsv;
};

export function ChartFrame({ title, summary, height = 240, empty = false, chart, legend, table, csv }: ChartFrameProps) {
  const hydrated = useHydrated();
  return (
    <VStack gap={2} className="tessera-analytics-chart">
      <Heading level={2}>{title}</Heading>
      {empty ? (
        <EmptyState isCompact title="Nothing to show" />
      ) : (
        <VStack role="img" aria-label={summary} className="tessera-analytics-chart-frame">
          {hydrated ? chart : <Skeleton height={height} />}
        </VStack>
      )}
      {hydrated && !empty && legend ? legend : null}
      <Text type="supporting">{summary}</Text>
      {!empty && table ? (
        <Collapsible trigger="Data table" defaultIsOpen={false} className="tessera-analytics-data-table">
          <VStack gap={2}>
            {csv ? (
              <HStack hAlign="end">
                <DownloadCsvButton table={csv} title={title} />
              </HStack>
            ) : null}
            {table}
          </VStack>
        </Collapsible>
      ) : null}
    </VStack>
  );
}

export type LegendEntry = { key: string; label: string; color: string; dash?: string };

function LegendSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg className="tessera-analytics-chart-swatch" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
      <line x1="0" y1="4" x2="24" y2="4" stroke={color} strokeWidth={dash ? 2 : 3} strokeDasharray={dash} />
    </svg>
  );
}

export function ChartLegend({ entries }: { entries: readonly LegendEntry[] }) {
  return (
    <HStack gap={4} wrap="wrap" vAlign="center">
      {entries.map((entry) => (
        <HStack key={entry.key} gap={1.5} vAlign="center">
          <LegendSwatch color={entry.color} dash={entry.dash} />
          <Text type="supporting">{entry.label}</Text>
        </HStack>
      ))}
    </HStack>
  );
}
