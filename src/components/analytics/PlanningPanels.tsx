"use client";

/**
 * Cycles and modules tabs (docs/drafts/p9-plan.md U4). Cycles chart completed
 * against pending for the 12 newest end dates. Modules chart status counts.
 * Both tables link to the project page and show a completion bar.
 */
import { Link } from "@astryxdesign/core/Link";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { VStack } from "@astryxdesign/core/Stack";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { AnalyticsTableHeading } from "@/components/analytics/TableHeading";
import { BAR_COLUMN, COUNT_COLUMN, NAME_COLUMN, TEXT_COLUMN } from "@/components/analytics/table-widths";
import type { AnalyticsBucket, CycleAnalyticsRow, CyclesAnalytics, ModuleAnalyticsRow, ModulesAnalytics } from "@/components/analytics/types";
import type { CsvTable } from "@/components/charts/csv-download";
import { BarSeriesChart } from "@/components/charts/SeriesCharts";
import { cyclesForChart, formatCount, statusBuckets, statusLabel, summarizeCycles, summarizeDistribution } from "@/components/charts/analytics-format";
import { formatShortDate } from "@/components/work-items/properties/date-format";
import type { PaletteColor } from "@/lib/tessera/types";

const CYCLE_STATUS_ORDER = ["current", "upcoming", "completed", "draft"] as const;
const MODULE_STATUS_ORDER = ["backlog", "planned", "in_progress", "paused", "completed", "cancelled"] as const;

const COMPLETED_SEGMENT = { key: "completed", label: "Completed", color: "blue" as PaletteColor };
const PENDING_SEGMENT = { key: "pending", label: "Pending", color: "purple" as PaletteColor };

function CompletionCell({ name, completed, total, points }: { name: string; completed: number; total: number; points: string | null }) {
  if (total <= 0) return <Text type="supporting">No work items</Text>;
  return (
    <VStack gap={1}>
      <ProgressBar
        label={`${name} completed`}
        isLabelHidden
        value={completed}
        max={total}
        hasValueLabel
        formatValueLabel={(value, max) => `${formatCount(value)} of ${formatCount(max)}`}
        className="tessera-analytics-bar"
      />
      {points ? (
        <Text type="supporting" color="secondary">
          {points}
        </Text>
      ) : null}
    </VStack>
  );
}

type CycleTableRow = {
  id: string;
  name: string;
  href: string;
  project: string;
  status: string;
  dates: string;
  pending: string;
  completedN: number;
  totalN: number;
  points: string | null;
};

export function CyclesPanel({ result, today }: { result: CyclesAnalytics; today: string }) {
  const shown = cyclesForChart(result.rows);
  const buckets: AnalyticsBucket[] = shown.map((row) => ({
    key: row.cycle_id,
    label: row.name,
    color: null,
    total: row.completed + row.pending,
    segments: { completed: row.completed, pending: row.pending },
  }));
  const rows: CycleTableRow[] = result.rows.map((row) => ({
    id: row.cycle_id,
    name: row.name,
    href: `/projects/${row.project_id}/cycles/${row.cycle_id}`,
    project: row.project_name,
    status: statusLabel(row.status),
    dates: cycleDates(row, today),
    pending: formatCount(row.pending),
    completedN: row.completed,
    totalN: row.total,
    points: row.points ? `${formatCount(row.points.completed)} of ${formatCount(row.points.total)} points` : null,
  }));
  const csv: CsvTable = {
    fileStem: "analytics-cycles",
    header: ["Cycle", "Project", "Status", "Start date", "End date", "Pending", "Completed", "Total", "Points completed", "Points total"],
    rows: result.rows.map((row) => [
      row.name,
      row.project_name,
      statusLabel(row.status),
      row.start_date,
      row.end_date,
      row.pending,
      row.completed,
      row.total,
      row.points?.completed ?? null,
      row.points?.total ?? null,
    ]),
  };
  return (
    <VStack gap={6}>
      <BarSeriesChart
        title="Completed and pending"
        summary={summarizeCycles(shown.length, result.rows.length)}
        buckets={buckets}
        segments={[COMPLETED_SEGMENT, PENDING_SEGMENT]}
      />
      <VStack gap={2}>
        <AnalyticsTableHeading title="Cycles" csv={csv} />
        {rows.length === 0 ? (
          <Text color="secondary">No cycles in this range.</Text>
        ) : (
          <Table<CycleTableRow>
            density="compact"
            idKey="id"
            data={rows}
            columns={[
              { key: "name", header: "Cycle", width: NAME_COLUMN, renderCell: (row) => <Link href={row.href} className="tessera-analytics-link">{row.name}</Link> },
              { key: "project", header: "Project", width: TEXT_COLUMN },
              { key: "status", header: "Status", width: TEXT_COLUMN },
              { key: "dates", header: "Dates", width: TEXT_COLUMN },
              { key: "pending", header: "Pending", align: "end", width: COUNT_COLUMN },
              {
                key: "completedN",
                header: "Completion",
                width: BAR_COLUMN,
                renderCell: (row) => <CompletionCell name={row.name} completed={row.completedN} total={row.totalN} points={row.points} />,
              },
            ]}
          />
        )}
      </VStack>
      <Text type="supporting">{summarizeDistribution("Cycles by status", statusBuckets(result.by_status, CYCLE_STATUS_ORDER), "count")}</Text>
    </VStack>
  );
}

function cycleDates(row: CycleAnalyticsRow, today: string): string {
  if (!row.start_date && !row.end_date) return "—";
  const start = row.start_date ? formatShortDate(row.start_date, today) : "—";
  const end = row.end_date ? formatShortDate(row.end_date, today) : "—";
  return `${start} – ${end}`;
}

type ModuleTableRow = {
  id: string;
  name: string;
  href: string;
  project: string;
  status: string;
  target: string;
  completedN: number;
  totalN: number;
};

export function ModulesPanel({ result, today }: { result: ModulesAnalytics; today: string }) {
  const buckets = statusBuckets(result.by_status, MODULE_STATUS_ORDER);
  const rows: ModuleTableRow[] = result.rows.map((row) => ({
    id: row.module_id,
    name: row.name,
    href: moduleHref(row),
    project: row.project_name,
    status: statusLabel(row.status),
    target: row.target_date ? formatShortDate(row.target_date, today) : "—",
    completedN: row.completed,
    totalN: row.total,
  }));
  const csv: CsvTable = {
    fileStem: "analytics-modules",
    header: ["Module", "Project", "Status", "Target date", "Completed", "Total"],
    rows: result.rows.map((row) => [row.name, row.project_name, statusLabel(row.status), row.target_date, row.completed, row.total]),
  };
  return (
    <VStack gap={6}>
      <BarSeriesChart title="Modules by status" summary={summarizeDistribution("Modules by status", buckets, "count")} buckets={buckets} segments={[]} />
      <VStack gap={2}>
        <AnalyticsTableHeading title="Modules" csv={csv} />
        {rows.length === 0 ? (
          <Text color="secondary">No modules in this view.</Text>
        ) : (
          <Table<ModuleTableRow>
            density="compact"
            idKey="id"
            data={rows}
            columns={[
              { key: "name", header: "Module", width: NAME_COLUMN, renderCell: (row) => <Link href={row.href} className="tessera-analytics-link">{row.name}</Link> },
              { key: "project", header: "Project", width: TEXT_COLUMN },
              { key: "status", header: "Status", width: TEXT_COLUMN },
              { key: "target", header: "Target", width: TEXT_COLUMN },
              {
                key: "completedN",
                header: "Completion",
                width: BAR_COLUMN,
                renderCell: (row) => <CompletionCell name={row.name} completed={row.completedN} total={row.totalN} points={null} />,
              },
            ]}
          />
        )}
      </VStack>
    </VStack>
  );
}

function moduleHref(row: ModuleAnalyticsRow): string {
  return `/projects/${row.project_id}/modules/${row.module_id}`;
}
