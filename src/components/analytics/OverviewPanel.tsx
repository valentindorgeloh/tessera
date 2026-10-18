"use client";

/**
 * Overview tab (docs/drafts/p9-plan.md U4): KPI cards, state-group and
 * priority bars, the created-versus-completed area, top assignees and
 * projects. Numbers come from the analytics result; this file only lays
 * them out.
 */
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import type { OverviewAnalytics } from "@/components/analytics/types";
import { ActorLabel } from "@/components/work-items/properties/AssigneeControl";
import { ProjectToken } from "@/components/work-items/ProjectFrame";
import { BarSeriesChart, TrendChart } from "@/components/charts/SeriesCharts";
import {
  asBuckets,
  assigneeHref,
  chartBuckets,
  formatCount,
  kpiHref,
  summarizeDistribution,
  summarizeTrend,
  type KpiKey,
} from "@/components/charts/analytics-format";
import { PRIORITY_ORDER, PRIORITY_PALETTE, STATE_GROUP_ORDER, STATE_GROUP_PALETTE } from "@/components/charts/palette-colors";
import type { Logo } from "@/lib/tessera/types";

const KPI_ORDER: { key: KpiKey; label: string }[] = [
  { key: "projects", label: "Projects" },
  { key: "work_items", label: "Work items" },
  { key: "open", label: "Open" },
  { key: "completed", label: "Completed" },
  { key: "overdue", label: "Overdue" },
  { key: "due_this_week", label: "Due this week" },
  { key: "active_cycles", label: "Active cycles" },
  { key: "active_agents", label: "Active agents" },
];

type AssigneeRow = { id: string; name: string; open: string; completed: string; href: string };
type ProjectRow = {
  id: string;
  name: string;
  identifier: string;
  logo: Logo | null;
  open: string;
  completed: string;
  total: string;
  href: string;
  completedN: number;
  totalN: number;
};

export function OverviewPanel({ result, projectIds, today }: { result: OverviewAnalytics; projectIds: readonly string[]; today: string }) {
  const stateBuckets = asBuckets(result.by_state_group, {
    order: STATE_GROUP_ORDER,
    color: (key) => STATE_GROUP_PALETTE[key] ?? null,
  });
  const priorityBuckets = asBuckets(result.by_priority, {
    order: PRIORITY_ORDER,
    color: (key) => PRIORITY_PALETTE[key] ?? null,
  });
  const stateChart = chartBuckets(stateBuckets);
  const priorityChart = chartBuckets(priorityBuckets);
  const assignees: AssigneeRow[] = result.top_assignees.map((row) => ({
    id: row.actor_id,
    name: row.name,
    open: formatCount(row.open),
    completed: formatCount(row.completed),
    href: assigneeHref(row.actor_id, projectIds),
  }));
  const projects: ProjectRow[] = result.projects.map((row) => ({
    id: row.id,
    name: row.name,
    identifier: row.identifier,
    logo: row.logo,
    open: formatCount(row.open),
    completed: formatCount(row.completed),
    total: formatCount(row.total),
    href: `/projects/${row.id}/work-items`,
    completedN: row.completed,
    totalN: row.total,
  }));

  return (
    <VStack gap={6}>
      <Grid columns={{ minWidth: 160, max: 4 }} gap={3}>
        {KPI_ORDER.map((kpi) => {
          const value = result.kpis[kpi.key];
          return (
            <ClickableCard key={kpi.key} label={`${formatCount(value)} ${kpi.label}`} href={kpiHref(kpi.key, projectIds, today)} padding={4}>
              <VStack gap={1}>
                <Heading level={2}>{formatCount(value)}</Heading>
                <Text type="supporting" color="secondary">
                  {kpi.label}
                </Text>
              </VStack>
            </ClickableCard>
          );
        })}
      </Grid>
      <BarSeriesChart
        title="Work items by state group"
        summary={summarizeDistribution("Work items by state group", stateBuckets, "count")}
        buckets={stateChart}
        tableBuckets={stateBuckets}
        segments={[]}
        layout="vertical"
      />
      <TrendChart summary={summarizeTrend(result.trend, result.scope.range)} points={result.trend} today={today} />
      <BarSeriesChart
        title="By priority"
        summary={summarizeDistribution("By priority", priorityBuckets, "count")}
        buckets={priorityChart}
        tableBuckets={priorityBuckets}
        segments={[]}
      />
      <VStack gap={2}>
        <Heading level={2}>Top assignees</Heading>
        {assignees.length === 0 ? (
          <Text color="secondary">No assignees in this view.</Text>
        ) : (
          <Table<AssigneeRow>
            density="compact"
            idKey="id"
            data={assignees}
            columns={[
              { key: "name", header: "Assignee", renderCell: (row) => <ActorLabel name={row.name} /> },
              {
                key: "open",
                header: "Open",
                align: "end",
                renderCell: (row) => (
                  <Link href={row.href} label={`${row.open} open assigned to ${row.name}`}>
                    {row.open}
                  </Link>
                ),
              },
              { key: "completed", header: "Completed", align: "end" },
            ]}
          />
        )}
      </VStack>
      <VStack gap={2}>
        <Heading level={2}>Projects</Heading>
        {projects.length === 0 ? (
          <Text color="secondary">No projects in this view.</Text>
        ) : (
          <Table<ProjectRow>
            density="compact"
            idKey="id"
            data={projects}
            columns={[
              {
                key: "name",
                header: "Project",
                renderCell: (row) => (
                  <HStack gap={2} vAlign="center">
                    <ProjectToken project={{ identifier: row.identifier, logo: row.logo }} size="sm" />
                    <Link href={row.href}>{row.name}</Link>
                  </HStack>
                ),
              },
              { key: "open", header: "Open", align: "end" },
              { key: "completed", header: "Completed", align: "end" },
              { key: "total", header: "Total", align: "end" },
              {
                key: "completedN",
                header: "Completion",
                renderCell: (row) =>
                  row.totalN <= 0 ? (
                    <Text type="supporting">No work items</Text>
                  ) : (
                    <ProgressBar
                      label={`${row.name} completed`}
                      isLabelHidden
                      value={row.completedN}
                      max={row.totalN}
                      hasValueLabel
                      formatValueLabel={(value, max) => `${formatCount(value)} of ${formatCount(max)}`}
                      className="tessera-analytics-bar"
                    />
                  ),
              },
            ]}
          />
        )}
      </VStack>
    </VStack>
  );
}
